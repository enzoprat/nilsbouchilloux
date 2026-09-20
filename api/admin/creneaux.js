"use strict";

/* ==========================================================================
   /api/admin/creneaux — les horaires d'une journée déjà ouverte.

   POST    ajouter un ou plusieurs horaires d'un coup
   PATCH   corriger un horaire
   DELETE  retirer un horaire

   Un créneau réservé n'est ni déplaçable ni supprimable sans confirmation
   explicite : derrière la ligne, il y a quelqu'un qui a bloqué son samedi.
   ========================================================================== */

const L = require("../_lib.js");

module.exports = async function (requete, reponse) {
  if (!L.methodeAutorisee(requete, reponse, ["POST", "PATCH", "DELETE"])) return;
  if (!L.exigerBase(reponse)) return;
  if (!L.exigerAdmin(requete, reponse)) return;

  const p = new URL(requete.url, "http://local").searchParams;
  const corps = await L.lireCorps(requete);

  /* --------------------------------------------------------------- POST */
  if (requete.method === "POST") {
    const journeeId = String(corps.journeeId || "");
    if (!journeeId) return L.repondre(reponse, 400, { erreur: "JOURNEE_MANQUANTE" });

    const brutes = Array.isArray(corps.heures) ? corps.heures : [corps.heure];
    const heures = [];
    const refusees = [];
    brutes.forEach(function (brut) {
      if (brut === undefined || brut === null || String(brut).trim() === "") return;
      const h = L.normaliserHeure(brut);
      if (!h) { refusees.push(String(brut)); return; }
      if (heures.indexOf(h) === -1) heures.push(h);
    });

    if (!heures.length) {
      return L.repondre(reponse, 400, {
        erreur: "HEURE_INVALIDE",
        message: refusees.length
          ? "Horaire non compris : " + refusees.join(", ") + "."
          : "Aucun horaire fourni."
      });
    }

    try {
      /* ignore-duplicates : réajouter 9 h sur une journée qui l'a déjà ne
         doit rien casser, juste ne rien faire. */
      await L.sb("/creneaux?on_conflict=journee_id,heure", {
        method: "POST",
        prefer: "resolution=ignore-duplicates,return=minimal",
        corps: heures.map(function (h) { return { journee_id: journeeId, heure: h }; })
      });
      return L.repondre(reponse, 201, { ajoutes: heures, refusees: refusees });
    } catch (erreur) {
      return L.repondre(reponse, 502, { erreur: "ECRITURE_ECHOUEE", message: "Horaires non enregistrés." });
    }
  }

  /* -------------------------------------------------------------- PATCH */
  if (requete.method === "PATCH") {
    const id = String(corps.id || "");
    const heure = L.normaliserHeure(corps.heure);
    if (!id) return L.repondre(reponse, 400, { erreur: "ID_MANQUANT" });
    if (!heure) return L.repondre(reponse, 400, { erreur: "HEURE_INVALIDE", message: "Horaire non compris." });

    try {
      const actuels = await L.sb("/creneaux?select=id,journee_id,reservation_id" +
        "&id=eq." + encodeURIComponent(id));
      const actuel = actuels[0];
      if (!actuel) return L.repondre(reponse, 404, { erreur: "CRENEAU_INTROUVABLE" });
      if (actuel.reservation_id) {
        return L.repondre(reponse, 409, {
          erreur: "CRENEAU_RESERVE",
          message: "Ce créneau est réservé. Prévenez le client avant de le déplacer."
        });
      }

      await L.sb("/creneaux?id=eq." + encodeURIComponent(id), {
        method: "PATCH", prefer: "return=minimal", corps: { heure: heure }
      });
      return L.repondre(reponse, 200, { id: id, heure: heure });
    } catch (erreur) {
      if (erreur.statut === 409) {
        return L.repondre(reponse, 409, { erreur: "HEURE_EXISTANTE", message: "Cet horaire existe déjà ce jour-là." });
      }
      return L.repondre(reponse, 502, { erreur: "ECRITURE_ECHOUEE" });
    }
  }

  /* ------------------------------------------------------------- DELETE */
  const id = p.get("id") || String(corps.id || "");
  const force = p.get("force") === "1" || corps.force === true;
  if (!id) return L.repondre(reponse, 400, { erreur: "ID_MANQUANT" });

  try {
    const trouves = await L.sb("/creneaux?select=id,heure,reservation_id," +
      "reservations(prenom,nom,telephone)&id=eq." + encodeURIComponent(id));
    const creneau = trouves[0];
    if (!creneau) return L.repondre(reponse, 404, { erreur: "CRENEAU_INTROUVABLE" });

    if (creneau.reservation_id && !force) {
      const r = creneau.reservations || {};
      return L.repondre(reponse, 409, {
        erreur: "CRENEAU_RESERVE",
        message: "Ce créneau est réservé par " + ((r.prenom || "") + " " + (r.nom || "")).trim() + ".",
        client: { nom: ((r.prenom || "") + " " + (r.nom || "")).trim(), telephone: r.telephone || "" }
      });
    }

    await L.sb("/creneaux?id=eq." + encodeURIComponent(id), { method: "DELETE", prefer: "return=minimal" });
    return L.repondre(reponse, 200, { supprime: id });
  } catch (erreur) {
    return L.repondre(reponse, 502, { erreur: "SUPPRESSION_ECHOUEE" });
  }
};
