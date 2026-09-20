# nilsbouchilloux.fr

Site de **Nils Bouchilloux**, professeur de golf diplômé BPJEPS à Bordeaux.

HTML statique, sans build, sans dépendance, sans police téléchargée.
Neuf pages de contenu, plus un système de réservation en ligne dont les
fonctions serverless tiennent elles aussi sans la moindre dépendance.

## Structure

```
index.html                            Accueil
cours-particuliers-golf-bordeaux/     Cours particuliers, tarifs
cours-de-golf-debutant-bordeaux/      Débuter le golf, carte verte
budget-debuter-golf-bordeaux/         Budget pour commencer  (noindex)
ecole-de-golf-bordeaux/               Cycle jeunes           (noindex)
a-propos/                             Parcours de l'enseignant
reserver/                             Contenu, tarifs, formulaire WhatsApp
mentions-legales/
politique-de-confidentialite/

reservation/                          Prise de rendez-vous  (noindex)
admin/                                Planning de Nils      (noindex)
api/                                  Fonctions Vercel du système de réservation
supabase/schema.sql                   Base de données du système de réservation

assets/css/style.css                  Système visuel complet
assets/css/reservation.css            Style du module de réservation seul
assets/js/main.js                     Navigation, accordéons, widgets, formulaire
assets/js/reservation.js              Parcours client
assets/js/admin.js                    Outil de Nils
assets/img/                           Logo, photographies, favicons
robots.txt  sitemap.xml
```

Deux pages sont volontairement en `noindex` et absentes du sitemap : la page
budget attend un relevé daté des tarifs de marché, la page école de golf attend
la validation d'un cycle jeunes à l'année. Les commentaires en tête de ces
fichiers expliquent quoi faire pour les publier.

## Aperçu en local

Aucune compilation. N'importe quel serveur statique fait l'affaire :

```bash
python3 -m http.server 4788
```

Puis ouvrir `http://localhost:4788`.

## Deux réglages à connaître

Les deux se trouvent en haut de `assets/js/main.js`.

- `MASQUER_A_CONFIRMER` — le site contient des marqueurs `[[À CONFIRMER]]` là où
  un fait n'a pas encore été fourni. À `true`, ils sont masqués et les blocs qui
  seraient bancals sans leur valeur disparaissent en entier. À `false`, ils
  s'affichent, pour la relecture.
- `WHATSAPP_NILS` — le numéro qui reçoit les demandes. Le formulaire de
  réservation ne poste vers aucun service d'envoi : il met la demande en forme
  et ouvre la conversation WhatsApp, que le visiteur envoie lui-même. Changer
  ce numéro suffit à changer de destinataire.

## Système de réservation

Journées et créneaux créés à la main par Nils, réservation immédiate côté
client, e-mails automatiques des deux côtés. Installation, variables
d'environnement et mode d'emploi : **[RESERVATION.md](RESERVATION.md)**.

Il ne fonctionne qu'une fois les variables d'environnement renseignées sur
Vercel. Sans elles, le site continue de marcher exactement comme avant et les
deux pages concernées affichent un message explicite.

## Mise en ligne

Site statique : il se sert tel quel. Avant la bascule DNS, vérifier l'absence
d'un `X-Robots-Tag: noindex` côté hébergeur, rediriger l'apex vers `www` en 301,
et soumettre `sitemap.xml` dans la Search Console.

---

Conception et développement : [Enzo Prat](https://www.enzoprat.fr)
