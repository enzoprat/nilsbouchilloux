-- ==========================================================================
-- Nils Bouchilloux — schéma du système de réservation
--
-- À exécuter une fois dans l'éditeur SQL de Supabase (SQL Editor > New query),
-- puis à chaque fois qu'on le modifie : le fichier est idempotent, on peut le
-- rejouer sans rien casser.
--
-- Deux partis pris qui expliquent tout le reste :
--
-- 1. Le navigateur ne parle JAMAIS à Supabase. Il parle aux fonctions
--    /api/ du site, qui seules détiennent la clé de service. Conséquence :
--    on retire toute permission aux rôles « anon » et « authenticated ».
--    Même si la clé publique fuitait, elle n'ouvrirait rien.
--
-- 2. La règle « un créneau réservé n'est plus réservable » n'est pas une
--    vérification applicative, c'est une transaction verrouillée en base,
--    dans la fonction reserver_creneau(). Deux clients qui valident à la
--    même seconde : le second reçoit une erreur, jamais un doublon.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- Les lieux. Table plutôt que constante : ajouter un golf se fait par une
-- ligne de SQL, sans redéploiement.
-- --------------------------------------------------------------------------
create table if not exists public.lieux (
  code        text primary key,
  libelle     text not null,
  ville       text not null,
  teinte      text not null default 'vert' check (teinte in ('vert', 'sable')),
  ordre       int  not null default 0,
  actif       boolean not null default true
);

insert into public.lieux (code, libelle, ville, teinte, ordre) values
  ('cestas', 'Golf de Cestas',  'Cestas',   'vert',  1),
  ('barena', 'Barena Golf',     'Mérignac', 'sable', 2)
on conflict (code) do update
  set libelle = excluded.libelle,
      ville   = excluded.ville,
      teinte  = excluded.teinte,
      ordre   = excluded.ordre;

-- --------------------------------------------------------------------------
-- Les formules. En base, et pas dans le JavaScript : le client envoie un
-- code, le serveur va chercher lui-même la durée et le prix. Personne ne
-- peut réserver deux heures au tarif d'une.
-- --------------------------------------------------------------------------
create table if not exists public.formules (
  code           text primary key,
  libelle        text not null,
  personnes      int  not null,
  duree_minutes  int  not null check (duree_minutes > 0),
  prix_centimes  int  not null check (prix_centimes >= 0),
  ordre          int  not null default 0,
  actif          boolean not null default true
);

insert into public.formules (code, libelle, personnes, duree_minutes, prix_centimes, ordre) values
  ('particulier-1h', 'Cours particulier',  1,  60,  7000, 1),
  ('particulier-2h', 'Cours particulier',  1, 120, 14000, 2),
  ('duo-1h',         'Cours à deux',       2,  60,  9500, 3),
  ('duo-2h',         'Cours à deux',       2, 120, 19000, 4)
on conflict (code) do update
  set libelle       = excluded.libelle,
      personnes     = excluded.personnes,
      duree_minutes = excluded.duree_minutes,
      prix_centimes = excluded.prix_centimes,
      ordre         = excluded.ordre;

-- --------------------------------------------------------------------------
-- Une journée d'enseignement : une date, un lieu. Nils ne peut pas ouvrir
-- deux fois le même jour au même endroit, la contrainte le garantit.
-- --------------------------------------------------------------------------
create table if not exists public.journees (
  id       uuid primary key default gen_random_uuid(),
  date     date not null,
  lieu     text not null references public.lieux(code),
  statut   text not null default 'ouverte' check (statut in ('ouverte', 'masquee')),
  cree_le  timestamptz not null default now(),
  unique (date, lieu)
);

-- --------------------------------------------------------------------------
-- Les réservations. Créées avant d'être rattachées aux créneaux, dans la
-- même transaction.
-- --------------------------------------------------------------------------
create table if not exists public.reservations (
  id             uuid primary key default gen_random_uuid(),
  prenom         text not null,
  nom            text not null,
  email          text not null,
  telephone      text not null,
  message        text,
  formule        text not null references public.formules(code),
  duree_minutes  int  not null,
  prix_centimes  int  not null,
  cree_le        timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- Les créneaux. reservation_id nul = libre. C'est cette colonne, et elle
-- seule, qui fait foi.
--
-- Un cours de deux heures occupe le créneau choisi ET tout créneau libre
-- qui tombe dans les deux heures suivantes : ils pointent alors vers la
-- même réservation.
-- --------------------------------------------------------------------------
create table if not exists public.creneaux (
  id             uuid primary key default gen_random_uuid(),
  journee_id     uuid not null references public.journees(id) on delete cascade,
  heure          time not null,
  reservation_id uuid references public.reservations(id) on delete set null,
  cree_le        timestamptz not null default now(),
  unique (journee_id, heure)
);

create index if not exists creneaux_journee_idx on public.creneaux (journee_id, heure);
create index if not exists journees_date_idx    on public.journees (date);

-- --------------------------------------------------------------------------
-- Ce que le public a le droit de voir : les journées ouvertes et à venir,
-- avec l'état de chaque créneau. Aucune donnée personnelle n'y figure.
--
-- Le « à venir » se juge à l'heure de Paris, sinon un créneau de 9 h reste
-- proposé à 14 h.
-- --------------------------------------------------------------------------
create or replace view public.v_creneaux_publics as
select
  j.id                             as journee_id,
  j.date                           as date,
  j.lieu                           as lieu,
  c.id                             as creneau_id,
  c.heure                          as heure,
  (c.reservation_id is not null)   as pris
from public.journees j
join public.creneaux c on c.journee_id = j.id
where j.statut = 'ouverte'
  and (j.date + c.heure) > (now() at time zone 'Europe/Paris');

-- --------------------------------------------------------------------------
-- La réservation elle-même. Tout se joue ici.
--
-- Le verrou est posé sur TOUS les créneaux de la journée avant la moindre
-- lecture : deux requêtes concurrentes sur la même journée s'exécutent
-- l'une après l'autre, jamais en parallèle. La seconde voit donc le
-- créneau déjà pris et échoue proprement.
-- --------------------------------------------------------------------------
-- Toutes les erreurs sortent en P0001 (raise_exception), le code prévu pour
-- les exceptions applicatives. Les codes P0002 à P0004 appartiennent à
-- PL/pgSQL — no_data_found, too_many_rows, assert_failure — et le dernier
-- échappe même à WHEN OTHERS : les détourner rendrait certaines erreurs
-- impossibles à rattraper. L'identité de l'erreur tient donc à son message,
-- que PostgREST recopie tel quel et que le site relit.
create or replace function public.reserver_creneau(
  p_creneau_id  uuid,
  p_formule     text,
  p_prenom      text,
  p_nom         text,
  p_email       text,
  p_telephone   text,
  p_message     text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_formule    public.formules%rowtype;
  v_creneau    public.creneaux%rowtype;
  v_journee    public.journees%rowtype;
  v_lieu       public.lieux%rowtype;
  v_fin        time;
  v_conflits   int;
  v_reservation uuid;
  v_pris       int;
begin
  select * into v_formule from public.formules where code = p_formule and actif;
  if not found then
    raise exception 'FORMULE_INCONNUE' using errcode = 'P0001';
  end if;

  select * into v_creneau from public.creneaux where id = p_creneau_id;
  if not found then
    raise exception 'CRENEAU_INTROUVABLE' using errcode = 'P0001';
  end if;

  -- Verrou sur la journée entière, avant toute décision.
  perform 1 from public.creneaux where journee_id = v_creneau.journee_id for update;

  -- Relecture après verrou : c'est cet état-là qui fait foi.
  select * into v_creneau from public.creneaux where id = p_creneau_id;
  select * into v_journee from public.journees where id = v_creneau.journee_id;
  select * into v_lieu    from public.lieux    where code = v_journee.lieu;

  if v_journee.statut <> 'ouverte' then
    raise exception 'JOURNEE_FERMEE' using errcode = 'P0001';
  end if;

  if (v_journee.date + v_creneau.heure) <= (now() at time zone 'Europe/Paris') then
    raise exception 'CRENEAU_PASSE' using errcode = 'P0001';
  end if;

  if v_creneau.reservation_id is not null then
    raise exception 'CRENEAU_PRIS' using errcode = 'P0001';
  end if;

  v_fin := v_creneau.heure + make_interval(mins => v_formule.duree_minutes);

  -- Un cours qui déborderait sur le lendemain n'a pas de sens ici.
  if v_fin <= v_creneau.heure then
    raise exception 'DUREE_IMPOSSIBLE' using errcode = 'P0001';
  end if;

  -- Un créneau déjà réservé à l'intérieur de la plage interdit la durée.
  select count(*) into v_conflits
    from public.creneaux
   where journee_id = v_creneau.journee_id
     and id <> p_creneau_id
     and reservation_id is not null
     and heure > v_creneau.heure
     and heure < v_fin;

  if v_conflits > 0 then
    raise exception 'DUREE_IMPOSSIBLE' using errcode = 'P0001';
  end if;

  insert into public.reservations
    (prenom, nom, email, telephone, message, formule, duree_minutes, prix_centimes)
  values
    (btrim(p_prenom), btrim(p_nom), btrim(lower(p_email)), btrim(p_telephone),
     nullif(btrim(coalesce(p_message, '')), ''),
     v_formule.code, v_formule.duree_minutes, v_formule.prix_centimes)
  returning id into v_reservation;

  -- Le créneau choisi et tout créneau libre avalé par la durée.
  update public.creneaux
     set reservation_id = v_reservation
   where journee_id = v_creneau.journee_id
     and reservation_id is null
     and heure >= v_creneau.heure
     and heure <  v_fin;

  get diagnostics v_pris = row_count;
  if v_pris < 1 then
    raise exception 'CRENEAU_PRIS' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'reservation_id', v_reservation,
    'date',           to_char(v_journee.date, 'YYYY-MM-DD'),
    'heure',          to_char(v_creneau.heure, 'HH24:MI'),
    'fin',            to_char(v_fin, 'HH24:MI'),
    'lieu_code',      v_lieu.code,
    'lieu_libelle',   v_lieu.libelle,
    'lieu_ville',     v_lieu.ville,
    'formule_code',   v_formule.code,
    'formule',        v_formule.libelle,
    'personnes',      v_formule.personnes,
    'duree_minutes',  v_formule.duree_minutes,
    'prix_centimes',  v_formule.prix_centimes,
    'creneaux_pris',  v_pris,
    'prenom',         btrim(p_prenom),
    'nom',            btrim(p_nom),
    'email',          btrim(lower(p_email)),
    'telephone',      btrim(p_telephone),
    'message',        nullif(btrim(coalesce(p_message, '')), '')
  );
end;
$fn$;

-- --------------------------------------------------------------------------
-- Fermeture. Le site ne se connecte à la base que par sa clé de service,
-- côté serveur. Les rôles publics de Supabase n'ont donc rien à faire ici.
-- --------------------------------------------------------------------------
alter table public.lieux        enable row level security;
alter table public.formules     enable row level security;
alter table public.journees     enable row level security;
alter table public.creneaux     enable row level security;
alter table public.reservations enable row level security;

revoke all on public.lieux, public.formules, public.journees,
              public.creneaux, public.reservations, public.v_creneaux_publics
  from anon, authenticated;

revoke all on function public.reserver_creneau(uuid, text, text, text, text, text, text)
  from anon, authenticated, public;

grant execute on function public.reserver_creneau(uuid, text, text, text, text, text, text)
  to service_role;

/* Supabase accorde d'ordinaire ces droits automatiquement au rôle de
   service. On les écrit quand même : un projet configuré autrement échouerait
   sinon avec un « permission denied » difficile à relier à sa cause. */
grant select, insert, update, delete
  on public.lieux, public.formules, public.journees, public.creneaux, public.reservations
  to service_role;
grant select on public.v_creneaux_publics to service_role;

-- PostgREST met son schéma en cache : sans ça, la fonction reste invisible.
notify pgrst, 'reload schema';
