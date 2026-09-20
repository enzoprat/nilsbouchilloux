# Système de réservation

Prise de rendez-vous en ligne pour les cours de Nils, intégrée au site
existant. Le client choisit une journée, un horaire, une formule ; Nils
reçoit un e-mail et voit son planning depuis son téléphone.

Deux adresses :

| Adresse | Pour qui | Indexée |
| --- | --- | --- |
| `/reservation/` | les élèves, lien à envoyer par SMS, WhatsApp, Instagram | non, `noindex` |
| `/admin/` | Nils seul, protégé par mot de passe | non, `noindex` + `Disallow` |

`/reserver/` ne change pas de rôle : elle reste la page de contenu qui vise
« réserver un cours de golf à Bordeaux », avec ses tarifs, son formulaire
WhatsApp et son référencement. Elle porte simplement un encart vers
`/reservation/`.

---

## Ce que le site n'a pas gagné

Aucune dépendance npm, aucun `package.json`, aucune étape de construction.
Le site reste servi tel quel.

Supabase et Resend exposent tous les deux une API REST, et Node embarque
`fetch` : les cinq fonctions de `/api/` tiennent en appels HTTP natifs.
Vercel les exécute sans configuration, simplement parce qu'elles sont dans
un dossier `api/`.

---

## Mise en service

Trois choses à créer, une seule fois. Les clés ne doivent jamais quitter les
variables d'environnement Vercel : le navigateur ne parle qu'aux fonctions
`/api/` du site, jamais à Supabase.

### 1. La base — Supabase

1. Créer un projet sur [supabase.com](https://supabase.com) (formule
   gratuite suffisante), région Europe de préférence.
2. Ouvrir **SQL Editor → New query**, coller tout `supabase/schema.sql`,
   exécuter. Le fichier est rejouable : on peut le relancer après
   modification sans rien casser.
3. Relever dans **Project Settings → API** :
   - l'URL du projet ;
   - la clé **`service_role`**, celle qui est marquée « secret ».
     Jamais la clé `anon`, et jamais dans du code envoyé au navigateur.

### 2. Les e-mails — Resend

1. Créer un compte sur [resend.com](https://resend.com).
2. **Domains → Add domain** : `nilsbouchilloux.fr`, puis ajouter chez IONOS
   les enregistrements DNS que Resend indique (SPF, DKIM). Sans domaine
   vérifié, les confirmations partiront en indésirables, quand elles
   partiront.
3. **API Keys → Create**, droit d'envoi uniquement.

### 3. Les variables d'environnement — Vercel

Dans **Settings → Environment Variables**, pour *Production*, *Preview* et
*Development* :

| Variable | Valeur | Sans elle |
| --- | --- | --- |
| `SUPABASE_URL` | l'URL du projet Supabase | rien ne fonctionne, message explicite |
| `SUPABASE_SERVICE_ROLE_KEY` | la clé `service_role` | idem |
| `ADMIN_MOT_DE_PASSE` | un mot de passe long, choisi par Nils | l'espace de gestion reste fermé |
| `EMAIL_NILS` | l'adresse où Nils reçoit ses réservations | la réservation est enregistrée, Nils n'est pas prévenu |
| `RESEND_API_KEY` | la clé Resend | la réservation est enregistrée, aucun e-mail ne part |
| `EMAIL_EXPEDITEUR` | `Nils Bouchilloux <bonjour@nilsbouchilloux.fr>` | idem |
| `SITE_URL` | facultatif, `https://www.nilsbouchilloux.fr` | valeur par défaut correcte |

Redéployer après les avoir ajoutées : Vercel ne les injecte pas dans un
déploiement déjà construit.

### 4. Vérifier

1. Ouvrir `/admin/`, entrer le mot de passe.
2. Ouvrir une journée de test, y mettre un horaire.
3. Ouvrir `/reservation/` dans un autre navigateur, réserver ce créneau.
4. Vérifier les deux e-mails, puis supprimer la journée de test.

---

## Comment Nils s'en sert

Ouvrir `/admin/`, mot de passe. Ensuite, tout est sur une seule page.

**Ouvrir une journée** : une date, un lieu, des horaires. Les horaires
s'écrivent comme on les dit — `9h`, `9h30`, `930`, `14` sont tous compris,
séparés par des espaces ou des virgules. Pour une journée complète, le
bouton **Remplir** génère la série : de 9 h à 17 h toutes les heures, en un
geste.

Rouvrir une journée déjà ouverte n'en crée pas une seconde : les horaires
s'ajoutent à celle qui existe.

**Le planning** montre chaque journée avec ses lignes. Une ligne libre dit
« Libre ». Une ligne réservée porte le nom du client, son téléphone
cliquable, sa formule et son message.

**Masquer** retire une journée de la page publique sans la supprimer — utile
quand la météo est douteuse. **Supprimer** l'efface. Si des clients y sont
inscrits, le site refuse une première fois et affiche qui prévenir.

---

## Les lieux et les tarifs

Ils vivent en base, pas dans le code. Ajouter un golf :

```sql
insert into public.lieux (code, libelle, ville, teinte, ordre)
values ('teynac', 'Golf de Teynac', 'Beychac-et-Caillau', 'vert', 3);
```

`teinte` vaut `vert` ou `sable` : c'est la couleur du repère qui distingue
les lieux dans la bande des journées. Changer un tarif se fait de même dans
`public.formules` — le prix affiché au client et celui de l'e-mail viennent
tous deux de là, jamais du JavaScript.

---

## Comment un créneau ne peut pas être pris deux fois

La règle n'est pas appliquée par le navigateur, ni même par les fonctions
`/api/`. Elle l'est par une transaction PostgreSQL, `reserver_creneau()`,
qui verrouille tous les créneaux de la journée avant de lire quoi que ce
soit. Deux clients qui valident à la même seconde s'exécutent l'un après
l'autre : le second voit le créneau pris et reçoit une erreur claire, plus
une page rechargée avec les disponibilités réelles.

Cette garantie n'est pas théorique : le schéma a été exécuté sur
PostgreSQL 17 et soumis à trente réservations simultanées du même créneau.
Une seule est passée, les vingt-neuf autres ont été refusées proprement,
sans laisser la moindre ligne orpheline en base.

Un cours de deux heures occupe le créneau choisi **et** tout créneau libre
qui tombe dans les deux heures suivantes. C'est pourquoi la page ne propose
pas toujours les quatre formules : si un cours est déjà réservé une heure
plus tard, seules les formules d'une heure apparaissent, et la raison est
écrite.

---

## Ce qui est délibérément limité

- **Un seul mot de passe, sans second facteur.** Proportionné à l'enjeu — un
  planning de cours, pas des données bancaires — mais cela suppose un mot de
  passe long, et de le changer si un téléphone est perdu. Le changer
  déconnecte toutes les sessions ouvertes.
- **Aucun paiement en ligne.** Le cours se règle sur place, comme avant.
- **Aucune annulation par le client.** Il appelle. À ce volume, c'est plus
  rapide qu'une page d'annulation, et Nils préfère savoir pourquoi.
- **Aucun compte client, aucun mot de passe à créer.** Le parcours tient en
  quatre gestes.

---

## Les fichiers

```
api/_lib.js                  clés, appels Supabase, session, dates, e-mails
api/disponibilites.js        GET  ce que le client peut réserver
api/reserver.js              POST la réservation et les deux e-mails
api/admin/session.js         connexion, vérification, déconnexion
api/admin/journees.js        planning, ouvrir, masquer, supprimer une journée
api/admin/creneaux.js        ajouter, déplacer, retirer un horaire
reservation/index.html       la page publique
admin/index.html             l'espace de Nils
assets/js/reservation.js     le parcours client
assets/js/admin.js           l'outil de Nils
assets/css/reservation.css   le style des deux, chargé nulle part ailleurs
supabase/schema.sql          tables, vue, transaction de réservation, droits
```
