"use strict";

/* ==========================================================================
   /api/admin/journees — le planning de Nils.

   GET     le planning à partir d'aujourd'hui, créneaux et clients compris
   POST    ouvrir une journée : une date, un lieu, et déjà ses horaires
   PATCH   masquer ou réafficher une journée
   DELETE  supprimer une journée entière

   Une journée qui porte des réservations ne se supprime pas par accident :
   la première tentative est refusée et renvoie la liste des clients
   concernés, pour que Nils sache qui il doit prévenir avant d'insister.
   ========================================================================== */

const L = require("../_lib.js");

function parametres(requete) {
  return new URL(requete.url, "http://local").searchParams;
}

/* Le planning tel qu'il se lit : une journée, un lieu, des lignes d'horaire.
   Pour un cours de deux heures, seule la première ligne porte le client ;
   la suivante est marquée comme sa continuation, sinon Nils croirait avoir
   deux élèves. */
function mettreEnForme(journees, lieux, formules) {
  const parCode = {};
  lieux.forEach(function (l) { parCode[l.code] = l; });
  /* La réservation ne garde que le code de la formule. Nils, lui, doit lire
     « Cours à deux », pas « duo-2h ». */
  const libelleFormule = {};
  (formules || []).forEach(function (f) { libelleFormule[f.code] = f.libelle; });

  return journees.map(function (j) {
    const creneaux = (j.creneaux || []).slice().sort(function (a, b) {
      return String(a.heure).localeCompare(String(b.heure));
    });

    const premiere = {};
    creneaux.forEach(function (c) {
      if (!c.reservation_id) return;
      if (!premiere[c.reservation_id]) premiere[c.reservation_id] = c.id;
    });

    return {
      id: j.id,
      date: j.date,
      dateTexte: L.dateEnFrancais(j.date),
      dateLongue: L.dateComplete(j.date),
      statut: j.statut,
      lieu: parCode[j.lieu] || { code: j.lieu, libelle: j.lieu, ville: "", teinte: "vert" },
      creneaux: creneaux.map(function (c) {
        const r = c.reservations || null;
        const debut = !c.reservation_id || premiere[c.reservation_id] === c.id;
        return {
          id: c.id,
          heure: String(c.heure).slice(0, 5),
          heureTexte: L.heureEnFrancais(c.heure),
          reserve: Boolean(c.reservation_id),
          suite: Boolean(c.reservation_id) && !debut,
          client: (r && debut) ? {
            nom: r.prenom + " " + r.nom,
            telephone: r.telephone,
            email: r.email,
            formule: libelleFormule[r.formule] || r.formule,
            dureeMinutes: r.duree_minutes,
            dureeTexte: (r.duree_minutes / 60) + " h",
            prixTexte: L.prix(r.prix_centimes),
            message: r.message || "",
            reserveLe: r.cree_le
          } : null
        };
      })
    };
  });
}

module.exports = async function (requete, reponse) {
  if (!L.methodeAutorisee(requete, reponse, ["GET", "POST", "PATCH", "DELETE"])) return;
  if (!L.exigerBase(reponse)) return;
  if (!L.exigerAdmin(requete, reponse)) return;

  const p = parametres(requete);

  /* ---------------------------------------------------------------- GET */
  if (requete.method === "GET") {
    const depuis = p.get("depuis") || L.aujourdhuiParis();
    try {
      const [lieux, formules, journees] = await Promise.all([
        L.sb("/lieux?actif=eq.true&select=code,libelle,ville,teinte&order=ordre.asc"),
        L.sb("/formules?select=code,libelle&order=ordre.asc"),
        L.sb("/journees?select=id,date,lieu,statut,creneaux(id,heure,reservation_id," +
             "reservations(prenom,nom,email,telephone,message,formule,duree_minutes,prix_centimes,cree_le))" +
             "&date=gte." + encodeURIComponent(depuis) + "&order=date.asc")
      ]);
      return L.repondre(reponse, 200, {
        aujourdhui: L.aujourdhuiParis(),
        lieux: lieux,
        journees: mettreEnForme(journees, lieux, formules)
      });
    } catch (erreur) {
      return L.repondre(reponse, 502, { erreur: "BASE_INJOIGNABLE", message: "Planning indisponible." });
    }
  }

  const corps = await L.lireCorps(requete);

  /* --------------------------------------------------------------- POST */
  if (requete.method === "POST") {
    const date = String(corps.date || "").trim();
    const lieu = String(corps.lieu || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return L.repondre(reponse, 400, { erreur: "DATE_INVALIDE", message: "Date incomplète." });
    }
    if (date < L.aujourdhuiParis()) {
      return L.repondre(reponse, 400, { erreur: "DATE_PASSEE", message: "Cette date est passée." });
    }
    if (!lieu) {
      return L.repondre(reponse, 400, { erreur: "LIEU_MANQUANT", message: "Choisissez un lieu." });
    }

    const heures = [];
    (Array.isArray(corps.heures) ? corps.heures : []).forEach(function (brut) {
      const h = L.normaliserHeure(brut);
      if (h && heures.indexOf(h) === -1) heures.push(h);
    });

    try {
      /* Rouvrir une journée déjà ouverte au même endroit ne crée pas de
         doublon : on retombe sur celle qui existe et on lui ajoute les
         horaires. C'est le geste le plus probable sur un téléphone. */
      const existantes = await L.sb("/journees?select=id,statut&date=eq." +
        encodeURIComponent(date) + "&lieu=eq." + encodeURIComponent(lieu));

      let journee = existantes[0];
      if (!journee) {
        const creees = await L.sb("/journees", {
          method: "POST",
          prefer: "return=representation",
          corps: { date: date, lieu: lieu }
        });
        journee = creees[0];
      }

      if (heures.length) {
        await L.sb("/creneaux?on_conflict=journee_id,heure", {
          method: "POST",
          prefer: "resolution=ignore-duplicates,return=minimal",
          corps: heures.map(function (h) { return { journee_id: journee.id, heure: h }; })
        });
      }

      return L.repondre(reponse, 201, { id: journee.id, date: date, lieu: lieu, ajoutes: heures.length });
    } catch (erreur) {
      if (erreur.statut === 409) {
        return L.repondre(reponse, 409, { erreur: "DEJA_OUVERTE", message: "Cette journée existe déjà." });
      }
      if (erreur.statut === 400 && /foreign key|violates/i.test(JSON.stringify(erreur.details || ""))) {
        return L.repondre(reponse, 400, { erreur: "LIEU_INCONNU", message: "Ce lieu n'existe pas." });
      }
      return L.repondre(reponse, 502, { erreur: "ECRITURE_ECHOUEE", message: "La journée n'a pas pu être ouverte." });
    }
  }

  /* -------------------------------------------------------------- PATCH */
  if (requete.method === "PATCH") {
    const id = String(corps.id || "");
    const statut = String(corps.statut || "");
    if (["ouverte", "masquee"].indexOf(statut) === -1) {
      return L.repondre(reponse, 400, { erreur: "STATUT_INVALIDE" });
    }
    try {
      await L.sb("/journees?id=eq." + encodeURIComponent(id), {
        method: "PATCH", prefer: "return=minimal", corps: { statut: statut }
      });
      return L.repondre(reponse, 200, { id: id, statut: statut });
    } catch (erreur) {
      return L.repondre(reponse, 502, { erreur: "ECRITURE_ECHOUEE" });
    }
  }

  /* ------------------------------------------------------------- DELETE */
  const id = p.get("id") || String(corps.id || "");
  const force = p.get("force") === "1" || corps.force === true;
  if (!id) return L.repondre(reponse, 400, { erreur: "ID_MANQUANT" });

  try {
    const creneaux = await L.sb("/creneaux?select=heure,reservations(prenom,nom,telephone)" +
      "&journee_id=eq." + encodeURIComponent(id) + "&reservation_id=not.is.null&order=heure.asc");

    if (creneaux.length && !force) {
      return L.repondre(reponse, 409, {
        erreur: "RESERVATIONS_EN_COURS",
        message: "Cette journée porte " + creneaux.length + " créneau" +
                 (creneaux.length > 1 ? "x réservés" : " réservé") + ".",
        clients: creneaux.map(function (c) {
          return {
            heure: String(c.heure).slice(0, 5),
            nom: c.reservations ? c.reservations.prenom + " " + c.reservations.nom : "",
            telephone: c.reservations ? c.reservations.telephone : ""
          };
        })
      });
    }

    await L.sb("/journees?id=eq." + encodeURIComponent(id), { method: "DELETE", prefer: "return=minimal" });
    return L.repondre(reponse, 200, { supprimee: id, reservationsAnnulees: creneaux.length });
  } catch (erreur) {
    return L.repondre(reponse, 502, { erreur: "SUPPRESSION_ECHOUEE" });
  }
};
