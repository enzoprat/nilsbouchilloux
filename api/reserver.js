"use strict";

/* ==========================================================================
   POST /api/reserver

   Le seul endroit où une réservation naît. Trois principes :

   1. Le client n'envoie jamais un prix ni une durée. Il envoie un code de
      formule ; la base va chercher elle-même ce que ça vaut.

   2. La vérification « ce créneau est-il libre ? » n'a pas lieu ici. Elle a
      lieu dans la transaction verrouillée de reserver_creneau(). Vérifier
      avant d'écrire, côté application, laisserait une fenêtre de quelques
      millisecondes pendant laquelle deux clients peuvent gagner.

   3. Les emails partent APRÈS la réservation, et leur échec ne l'annule
      pas. Une réservation enregistrée dont l'email n'est pas parti reste
      une réservation ; on le dit au client plutôt que de faire semblant.
   ========================================================================== */

const L = require("./_lib.js");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const MESSAGES = {
  CRENEAU_PRIS: [409, "Ce créneau vient d'être réservé par quelqu'un d'autre. Choisissez-en un autre."],
  DUREE_IMPOSSIBLE: [409, "Cette durée n'est plus possible sur ce créneau. Essayez une heure, ou un autre horaire."],
  CRENEAU_PASSE: [410, "Ce créneau est passé."],
  JOURNEE_FERMEE: [410, "Cette journée n'est plus proposée."],
  CRENEAU_INTROUVABLE: [404, "Ce créneau n'existe plus."],
  FORMULE_INCONNUE: [400, "Cette formule n'existe pas."]
};

function texte(valeur, maxi) {
  return String(valeur == null ? "" : valeur).trim().slice(0, maxi);
}

function valider(corps) {
  const erreurs = [];
  const d = {
    creneauId: texte(corps.creneauId, 40),
    formule: texte(corps.formule, 40),
    prenom: texte(corps.prenom, 80),
    nom: texte(corps.nom, 80),
    email: texte(corps.email, 160).toLowerCase(),
    telephone: texte(corps.telephone, 40),
    message: texte(corps.message, 1000)
  };
  if (!UUID.test(d.creneauId)) erreurs.push("creneauId");
  if (!d.formule) erreurs.push("formule");
  if (d.prenom.length < 2) erreurs.push("prenom");
  if (d.nom.length < 2) erreurs.push("nom");
  if (!EMAIL.test(d.email)) erreurs.push("email");
  if (d.telephone.replace(/[^0-9]/g, "").length < 9) erreurs.push("telephone");
  return { donnees: d, erreurs: erreurs };
}

/* --------------------------------------------------------------------------
   Emails. HTML volontairement primitif — styles en ligne, pas de grille, pas
   de police à télécharger : les clients de messagerie ne savent pas faire
   mieux. Les couleurs et la chasse fixe des données reprennent celles du
   site pour que la confirmation ait la même voix.
   -------------------------------------------------------------------------- */
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

function ligne(intitule, valeur) {
  return '<tr>' +
    '<td style="padding:9px 0;border-bottom:1px solid rgba(18,22,15,.14);font-family:' + MONO +
      ';font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7C8577;vertical-align:top;width:150px">' +
      L.echapper(intitule) + '</td>' +
    '<td style="padding:9px 0;border-bottom:1px solid rgba(18,22,15,.14);font-family:' + SANS +
      ';font-size:15px;color:#12160F">' + valeur + '</td>' +
  '</tr>';
}

function enveloppe(titre, chapeau, corps, pied) {
  /* Le <meta charset> n'est pas décoratif : sans lui, une partie des clients
     de messagerie lit l'HTML en latin-1 et « réservation » devient
     « rÃ©servation ». En français, ça n'est pas négociable. */
  return '<!doctype html><html lang="fr"><head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + L.echapper(titre) + '</title>' +
    '</head><body style="margin:0;padding:24px;background:#F1EEE4">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" ' +
      'style="max-width:560px;margin:0 auto;background:#FAF8F2;border:1px solid rgba(18,22,15,.14)">' +
    '<tr><td style="padding:28px 26px 0">' +
      '<div style="font-family:' + MONO + ';font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#7C8577">' +
        '<span style="background:#C43D28;color:#fff;padding:3px 7px 2px;font-weight:600">NB</span>' +
        '&nbsp;&nbsp;Nils Bouchilloux, professeur de golf</div>' +
      '<h1 style="font-family:' + SANS + ';font-size:26px;line-height:1.2;letter-spacing:-.03em;color:#12160F;margin:18px 0 0">' +
        L.echapper(titre) + '</h1>' +
      (chapeau ? '<p style="font-family:' + SANS + ';font-size:15px;line-height:1.55;color:#4C5449;margin:12px 0 0">' +
        chapeau + '</p>' : '') +
    '</td></tr>' +
    '<tr><td style="padding:22px 26px 6px">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
        'style="border-top:1px solid rgba(18,22,15,.14)">' + corps + '</table>' +
    '</td></tr>' +
    '<tr><td style="padding:18px 26px 28px;font-family:' + SANS + ';font-size:13px;line-height:1.6;color:#4C5449">' +
      pied + '</td></tr>' +
    '</table></body></html>';
}

function emailPourNils(r) {
  const date = L.dateComplete(r.date);
  const heure = L.heureEnFrancais(r.heure);
  const corps =
    ligne("Client", '<strong>' + L.echapper(r.prenom + " " + r.nom) + '</strong>') +
    ligne("Téléphone", '<a href="tel:' + L.echapper(r.telephone.replace(/[^0-9+]/g, "")) +
      '" style="color:#12160F;font-family:' + MONO + '">' + L.echapper(r.telephone) + '</a>') +
    ligne("Email", '<a href="mailto:' + L.echapper(r.email) + '" style="color:#12160F">' + L.echapper(r.email) + '</a>') +
    ligne("Date", L.echapper(date)) +
    ligne("Heure", '<span style="font-family:' + MONO + '">' + L.echapper(heure) +
      " → " + L.echapper(L.heureEnFrancais(r.fin)) + '</span>') +
    ligne("Lieu", L.echapper(L.lieuComplet(r.lieu_libelle, r.lieu_ville))) +
    ligne("Formule", L.echapper(r.formule + ", " + (r.duree_minutes / 60) + " h") +
      ' · <span style="font-family:' + MONO + '">' + L.echapper(L.prix(r.prix_centimes)) + '</span>') +
    (r.message ? ligne("Message", L.echapper(r.message).replace(/\n/g, "<br>")) : "");

  return {
    objet: "Nouvelle réservation — " + L.dateEnFrancais(r.date, false) + " à " + heure,
    html: enveloppe("Nouvelle réservation", "", corps,
      "Répondre à cet email écrit directement au client."),
    texte: [
      "Nouvelle réservation de cours.", "",
      "Client : " + r.prenom + " " + r.nom,
      "Téléphone : " + r.telephone,
      "Email : " + r.email,
      "Date : " + date,
      "Heure : " + heure + " à " + L.heureEnFrancais(r.fin),
      "Lieu : " + L.lieuComplet(r.lieu_libelle, r.lieu_ville),
      "Formule : " + r.formule + ", " + (r.duree_minutes / 60) + " h, " + L.prix(r.prix_centimes),
      r.message ? "\nMessage :\n" + r.message : ""
    ].join("\n")
  };
}

function emailPourClient(r) {
  const date = L.dateComplete(r.date);
  const heure = L.heureEnFrancais(r.heure);
  const corps =
    ligne("Date", '<strong>' + L.echapper(date) + '</strong>') +
    ligne("Heure", '<span style="font-family:' + MONO + '">' + L.echapper(heure) +
      " → " + L.echapper(L.heureEnFrancais(r.fin)) + '</span>') +
    ligne("Lieu", L.echapper(L.lieuComplet(r.lieu_libelle, r.lieu_ville))) +
    ligne("Formule", L.echapper(r.formule + ", " + (r.duree_minutes / 60) + " h")) +
    ligne("Tarif", '<span style="font-family:' + MONO + '">' + L.echapper(L.prix(r.prix_centimes)) +
      '</span>, à régler sur place') +
    ligne("Professeur", "Nils Bouchilloux, diplômé BPJEPS golf");

  const pied =
    'Un empêchement, une question, un retard : appelez ou écrivez au ' +
    '<a href="tel:+33682377506" style="color:#12160F;font-family:' + MONO + '">06 82 37 75 06</a>.' +
    '<br><br>Prévoyez une tenue souple et des chaussures plates. Le matériel peut être prêté, ' +
    'dites-le avant la séance. Les balles de practice et l\'accès au parcours se règlent sur place.';

  return {
    objet: "Votre cours de golf est confirmé — " + L.dateEnFrancais(r.date, false) + " à " + heure,
    html: enveloppe(
      "Votre cours est confirmé",
      "Bonjour " + L.echapper(r.prenom) + ", votre cours avec Nils Bouchilloux est réservé.",
      corps, pied),
    texte: [
      "Bonjour " + r.prenom + ",", "",
      "Votre cours avec Nils Bouchilloux est confirmé.", "",
      date + " à " + heure + " (jusqu'à " + L.heureEnFrancais(r.fin) + ")",
      L.lieuComplet(r.lieu_libelle, r.lieu_ville),
      r.formule + ", " + (r.duree_minutes / 60) + " h, " + L.prix(r.prix_centimes) + " à régler sur place", "",
      "Professeur : Nils Bouchilloux, diplômé BPJEPS golf",
      "Téléphone : 06 82 37 75 06", "",
      "Prévoyez une tenue souple et des chaussures plates. Le matériel peut être prêté,",
      "dites-le avant la séance."
    ].join("\n")
  };
}

/* -------------------------------------------------------------------------- */
module.exports = async function (requete, reponse) {
  if (!L.methodeAutorisee(requete, reponse, ["POST"])) return;
  if (!L.exigerBase(reponse, true)) return;

  const corps = await L.lireCorps(requete);
  const controle = valider(corps);
  if (controle.erreurs.length) {
    return L.repondre(reponse, 400, {
      erreur: "CHAMPS_INVALIDES",
      champs: controle.erreurs,
      message: "Certains champs sont incomplets."
    });
  }

  const d = controle.donnees;
  let r;
  try {
    r = await L.sb("/rpc/reserver_creneau", {
      method: "POST",
      corps: {
        p_creneau_id: d.creneauId,
        p_formule: d.formule,
        p_prenom: d.prenom,
        p_nom: d.nom,
        p_email: d.email,
        p_telephone: d.telephone,
        p_message: d.message || null
      }
    });
  } catch (erreur) {
    const connue = MESSAGES[erreur.code];
    if (connue) return L.repondre(reponse, connue[0], { erreur: erreur.code, message: connue[1] });
    return L.repondre(reponse, 502, {
      erreur: "RESERVATION_ECHOUEE",
      message: "La réservation n'a pas pu être enregistrée. Appelez le 06 82 37 75 06."
    });
  }

  /* La réservation est acquise. Les emails sont un plus, pas une condition. */
  const pourNils = emailPourNils(r);
  const pourClient = emailPourClient(r);
  const [nils, client] = await Promise.all([
    L.CONFIG.emailNils
      ? L.envoyerEmail({ a: L.CONFIG.emailNils, objet: pourNils.objet, html: pourNils.html,
                         texte: pourNils.texte, repondreA: r.email })
      : Promise.resolve({ envoye: false, raison: "EMAIL_NILS n'est pas défini." }),
    L.envoyerEmail({ a: r.email, objet: pourClient.objet, html: pourClient.html, texte: pourClient.texte })
  ]);

  if (!nils.envoye || !client.envoye) {
    console.error("Réservation " + r.reservation_id + " enregistrée, email incomplet.",
      { nils: nils.raison, client: client.raison });
  }

  L.repondre(reponse, 201, {
    reservation: {
      id: r.reservation_id,
      date: r.date,
      dateTexte: L.dateComplete(r.date),
      heure: r.heure,
      heureTexte: L.heureEnFrancais(r.heure),
      finTexte: L.heureEnFrancais(r.fin),
      lieu: r.lieu_libelle,
      ville: r.lieu_ville,
      formule: r.formule,
      dureeMinutes: r.duree_minutes,
      prixTexte: L.prix(r.prix_centimes),
      prenom: r.prenom,
      email: r.email
    },
    emailClient: client.envoye,
    emailNils: nils.envoye
  });
};
