# nilsbouchilloux.fr

Site de **Nils Bouchilloux**, professeur de golf diplômé BPJEPS à Bordeaux.

HTML statique, sans build, sans dépendance, sans police téléchargée.
Neuf pages, environ 430 Ko au total.

## Structure

```
index.html                            Accueil
cours-particuliers-golf-bordeaux/     Cours particuliers, tarifs
cours-de-golf-debutant-bordeaux/      Débuter le golf, carte verte
budget-debuter-golf-bordeaux/         Budget pour commencer  (noindex)
ecole-de-golf-bordeaux/               Cycle jeunes           (noindex)
a-propos/                             Parcours de l'enseignant
reserver/                             Formulaire de réservation
mentions-legales/
politique-de-confidentialite/
assets/css/style.css                  Système visuel complet
assets/js/main.js                     Navigation, accordéons, widgets, formulaire
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

## Mise en ligne

Site statique : il se sert tel quel. Avant la bascule DNS, vérifier l'absence
d'un `X-Robots-Tag: noindex` côté hébergeur, rediriger l'apex vers `www` en 301,
et soumettre `sitemap.xml` dans la Search Console.

---

Conception et développement : [Enzo Prat](https://www.enzoprat.fr)
