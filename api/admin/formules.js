"use strict";

/* ==========================================================================
   /api/admin/formules — les prestations que Nils vend.

   GET     la liste, actives et retirées
   POST    créer une prestation
   PATCH   en modifier une : libellé, durée, prix, nombre de personnes, ordre
   DELETE  la retirer

   Une prestation ne se supprime pas à la légère : la table des réservations
   la référence. On la désactive par défaut — elle disparaît du site, les
   réservations passées restent lisibles. La suppression franche n'est
   possible que si personne ne l'a jamais réservée.

   Et un changement de prix ne touche pas le passé : chaque réservation a
   figé son tarif et sa durée au moment où elle a été prise.
   ========================================================================== */

const L = require("../_lib.js");

function valider(corps, creation) {
  const e = [];
  const d = {};

  const libelle = String(corps.libelle || "").trim();
  if (creation || corps.libelle !== undefined) {
    if (libelle.length < 2 || libelle.length > 80) e.push("libelle");
    else d.libelle = libelle;
  }

  if (creation || corps.personnes !== undefined) {
    const n = Number(corps.personnes);
    if (!Number.isInteger(n) || n < 1 || n > 12) e.push("personnes");
    else d.personnes = n;
  }

  if (creation || corps.duree !== undefined) {
    const m = L.minutesDe(corps.duree);
    if (m === null || m < 15 || m > 480) e.push("duree");
    else d.duree_minutes = m;
  }

  if (creation || corps.prix !== undefined) {
    const c = L.centimesDe(corps.prix);
    if (c === null || c > 500000) e.push("prix");
    else d.prix_centimes = c;
  }

  if (corps.ordre !== undefined) {
    const o = Number(corps.ordre);
    if (!Number.isInteger(o) || o < 0 || o > 999) e.push("ordre");
    else d.ordre = o;
  }

  if (corps.actif !== undefined) d.actif = Boolean(corps.actif);

  return { donnees: d, erreurs: e };
}

function enForme(f) {
  return {
    code: f.code,
    libelle: f.libelle,
    personnes: f.personnes,
    dureeMinutes: f.duree_minutes,
    dureeTexte: f.duree_minutes % 60 === 0
      ? (f.duree_minutes / 60) + " h"
      : Math.floor(f.duree_minutes / 60) + " h " + (f.duree_minutes % 60),
    prixCentimes: f.prix_centimes,
    prixTexte: L.prix(f.prix_centimes),
    prixSaisie: (f.prix_centimes / 100).toString().replace(".", ","),
    ordre: f.ordre,
    actif: f.actif
  };
}

module.exports = async function (requete, reponse) {
  if (!L.methodeAutorisee(requete, reponse, ["GET", "POST", "PATCH", "DELETE"])) return;
  if (!L.exigerBase(reponse)) return;
  if (!L.exigerAdmin(requete, reponse)) return;

  const p = new URL(requete.url, "http://local").searchParams;

  /* ---------------------------------------------------------------- GET */
  if (requete.method === "GET") {
    try {
      const f = await L.sb("/formules?select=*&order=ordre.asc,libelle.asc");
      return L.repondre(reponse, 200, { formules: f.map(enForme) });
    } catch (e) {
      return L.repondre(reponse, 502, { erreur: "BASE_INJOIGNABLE", message: "Prestations illisibles." });
    }
  }

  const corps = await L.lireCorps(requete);

  /* --------------------------------------------------------------- POST */
  if (requete.method === "POST") {
    const c = valider(corps, true);
    if (c.erreurs.length) {
      return L.repondre(reponse, 400, {
        erreur: "CHAMPS_INVALIDES", champs: c.erreurs,
        message: "Vérifiez le libellé, la durée, le prix et le nombre de personnes."
      });
    }
    /* Le code est dérivé du libellé et de la durée : deux prestations de
       même nom mais de durées différentes ne se télescopent pas. */
    const duree = c.donnees.duree_minutes;
    const suffixe = duree % 60 === 0 ? (duree / 60) + "h" : duree + "min";
    let code = String(corps.code || "").trim() || L.codeDepuis(c.donnees.libelle, suffixe);

    try {
      const existantes = await L.sb("/formules?select=code");
      const prises = new Set(existantes.map(function (f) { return f.code; }));
      if (prises.has(code)) {
        let n = 2;
        while (prises.has(code + "-" + n)) n += 1;
        code = code + "-" + n;
      }
      if (c.donnees.ordre === undefined) {
        c.donnees.ordre = existantes.length + 1;
      }
      const creees = await L.sb("/formules", {
        method: "POST", prefer: "return=representation",
        corps: Object.assign({ code: code }, c.donnees)
      });
      return L.repondre(reponse, 201, { formule: enForme(creees[0]) });
    } catch (e) {
      return L.repondre(reponse, 502, { erreur: "ECRITURE_ECHOUEE", message: "Prestation non enregistrée." });
    }
  }

  /* -------------------------------------------------------------- PATCH */
  if (requete.method === "PATCH") {
    const code = String(corps.code || "").trim();
    if (!code) return L.repondre(reponse, 400, { erreur: "CODE_MANQUANT" });
    const c = valider(corps, false);
    if (c.erreurs.length) {
      return L.repondre(reponse, 400, { erreur: "CHAMPS_INVALIDES", champs: c.erreurs });
    }
    delete c.donnees.code;
    if (!Object.keys(c.donnees).length) {
      return L.repondre(reponse, 400, { erreur: "RIEN_A_MODIFIER" });
    }
    try {
      const m = await L.sb("/formules?code=eq." + encodeURIComponent(code), {
        method: "PATCH", prefer: "return=representation", corps: c.donnees
      });
      if (!m.length) return L.repondre(reponse, 404, { erreur: "FORMULE_INTROUVABLE" });
      return L.repondre(reponse, 200, { formule: enForme(m[0]) });
    } catch (e) {
      return L.repondre(reponse, 502, { erreur: "ECRITURE_ECHOUEE" });
    }
  }

  /* ------------------------------------------------------------- DELETE */
  const code = p.get("code") || String(corps.code || "");
  const definitif = p.get("definitif") === "1";
  if (!code) return L.repondre(reponse, 400, { erreur: "CODE_MANQUANT" });

  try {
    const usages = await L.sb("/reservations?select=id&formule=eq." + encodeURIComponent(code) + "&limit=1");
    if (usages.length && definitif) {
      return L.repondre(reponse, 409, {
        erreur: "FORMULE_UTILISEE",
        message: "Des réservations portent cette prestation : elle ne peut pas être effacée, seulement retirée du site."
      });
    }
    if (definitif) {
      await L.sb("/formules?code=eq." + encodeURIComponent(code), { method: "DELETE", prefer: "return=minimal" });
      return L.repondre(reponse, 200, { supprimee: code, mode: "definitif" });
    }
    const m = await L.sb("/formules?code=eq." + encodeURIComponent(code), {
      method: "PATCH", prefer: "return=representation", corps: { actif: false }
    });
    if (!m.length) return L.repondre(reponse, 404, { erreur: "FORMULE_INTROUVABLE" });
    return L.repondre(reponse, 200, { retiree: code, mode: "desactivee", formule: enForme(m[0]) });
  } catch (e) {
    return L.repondre(reponse, 502, { erreur: "SUPPRESSION_ECHOUEE" });
  }
};
