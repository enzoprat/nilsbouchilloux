"use strict";

/* ==========================================================================
   /api/admin/lieux — les structures où Nils se déplace.

   GET     la liste, actives et retirées
   POST    ajouter un lieu
   PATCH   en modifier un : nom, ville, teinte, ordre
   DELETE  le retirer

   Même prudence que pour les prestations : les journées du planning
   référencent le lieu. Retirer un lieu le désactive — il quitte les listes
   du site et de l'admin sans effacer les journées déjà tenues là-bas. La
   suppression franche n'est possible que si aucune journée n'y renvoie.

   La teinte n'est pas cosmétique : c'est elle qui distingue les lieux dans
   la bande des journées de la page de réservation. Deux valeurs seulement,
   pour que la page reste lisible.
   ========================================================================== */

const L = require("../_lib.js");

const TEINTES = ["vert", "sable"];

function valider(corps, creation) {
  const e = [];
  const d = {};

  if (creation || corps.libelle !== undefined) {
    const v = String(corps.libelle || "").trim();
    if (v.length < 2 || v.length > 80) e.push("libelle"); else d.libelle = v;
  }
  if (creation || corps.ville !== undefined) {
    const v = String(corps.ville || "").trim();
    if (v.length < 2 || v.length > 60) e.push("ville"); else d.ville = v;
  }
  if (corps.teinte !== undefined) {
    const v = String(corps.teinte || "").trim();
    if (TEINTES.indexOf(v) === -1) e.push("teinte"); else d.teinte = v;
  }
  if (corps.ordre !== undefined) {
    const o = Number(corps.ordre);
    if (!Number.isInteger(o) || o < 0 || o > 999) e.push("ordre"); else d.ordre = o;
  }
  if (corps.actif !== undefined) d.actif = Boolean(corps.actif);

  return { donnees: d, erreurs: e };
}

function enForme(l, journees) {
  return {
    code: l.code,
    libelle: l.libelle,
    ville: l.ville,
    nomComplet: L.lieuComplet(l.libelle, l.ville),
    teinte: l.teinte,
    ordre: l.ordre,
    actif: l.actif,
    journees: journees === undefined ? null : journees
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
      const [lieux, journees] = await Promise.all([
        L.sb("/lieux?select=*&order=ordre.asc,libelle.asc"),
        L.sb("/journees?select=lieu")
      ]);
      const compte = {};
      journees.forEach(function (j) { compte[j.lieu] = (compte[j.lieu] || 0) + 1; });
      return L.repondre(reponse, 200, {
        lieux: lieux.map(function (l) { return enForme(l, compte[l.code] || 0); })
      });
    } catch (e) {
      return L.repondre(reponse, 502, { erreur: "BASE_INJOIGNABLE", message: "Lieux illisibles." });
    }
  }

  const corps = await L.lireCorps(requete);

  /* --------------------------------------------------------------- POST */
  if (requete.method === "POST") {
    const c = valider(corps, true);
    if (c.erreurs.length) {
      return L.repondre(reponse, 400, {
        erreur: "CHAMPS_INVALIDES", champs: c.erreurs,
        message: "Il faut au moins un nom et une ville."
      });
    }
    if (c.donnees.teinte === undefined) c.donnees.teinte = "vert";
    let code = String(corps.code || "").trim() || L.codeDepuis(c.donnees.libelle);

    try {
      const existants = await L.sb("/lieux?select=code");
      const pris = new Set(existants.map(function (l) { return l.code; }));
      if (pris.has(code)) {
        let n = 2;
        while (pris.has(code + "-" + n)) n += 1;
        code = code + "-" + n;
      }
      if (c.donnees.ordre === undefined) c.donnees.ordre = existants.length + 1;

      const crees = await L.sb("/lieux", {
        method: "POST", prefer: "return=representation",
        corps: Object.assign({ code: code }, c.donnees)
      });
      return L.repondre(reponse, 201, { lieu: enForme(crees[0], 0) });
    } catch (e) {
      return L.repondre(reponse, 502, { erreur: "ECRITURE_ECHOUEE", message: "Lieu non enregistré." });
    }
  }

  /* -------------------------------------------------------------- PATCH */
  if (requete.method === "PATCH") {
    const code = String(corps.code || "").trim();
    if (!code) return L.repondre(reponse, 400, { erreur: "CODE_MANQUANT" });
    const c = valider(corps, false);
    if (c.erreurs.length) return L.repondre(reponse, 400, { erreur: "CHAMPS_INVALIDES", champs: c.erreurs });
    delete c.donnees.code;
    if (!Object.keys(c.donnees).length) return L.repondre(reponse, 400, { erreur: "RIEN_A_MODIFIER" });
    try {
      const m = await L.sb("/lieux?code=eq." + encodeURIComponent(code), {
        method: "PATCH", prefer: "return=representation", corps: c.donnees
      });
      if (!m.length) return L.repondre(reponse, 404, { erreur: "LIEU_INTROUVABLE" });
      return L.repondre(reponse, 200, { lieu: enForme(m[0]) });
    } catch (e) {
      return L.repondre(reponse, 502, { erreur: "ECRITURE_ECHOUEE" });
    }
  }

  /* ------------------------------------------------------------- DELETE */
  const code = p.get("code") || String(corps.code || "");
  const definitif = p.get("definitif") === "1";
  if (!code) return L.repondre(reponse, 400, { erreur: "CODE_MANQUANT" });

  try {
    const journees = await L.sb("/journees?select=id&lieu=eq." + encodeURIComponent(code) + "&limit=1");
    if (journees.length && definitif) {
      return L.repondre(reponse, 409, {
        erreur: "LIEU_UTILISE",
        message: "Des journées de planning se tiennent dans ce lieu : il ne peut pas être effacé, seulement retiré."
      });
    }
    if (definitif) {
      await L.sb("/lieux?code=eq." + encodeURIComponent(code), { method: "DELETE", prefer: "return=minimal" });
      return L.repondre(reponse, 200, { supprime: code, mode: "definitif" });
    }
    const m = await L.sb("/lieux?code=eq." + encodeURIComponent(code), {
      method: "PATCH", prefer: "return=representation", corps: { actif: false }
    });
    if (!m.length) return L.repondre(reponse, 404, { erreur: "LIEU_INTROUVABLE" });
    return L.repondre(reponse, 200, { retire: code, mode: "desactive", lieu: enForme(m[0]) });
  } catch (e) {
    return L.repondre(reponse, 502, { erreur: "SUPPRESSION_ECHOUEE" });
  }
};
