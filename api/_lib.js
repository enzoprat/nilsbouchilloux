"use strict";

/* ==========================================================================
   Boîte à outils commune aux fonctions serverless.

   Contrainte de départ : le site n'a ni build, ni package.json, ni la
   moindre dépendance npm, et il n'en gagnera pas pour cette fonctionnalité.
   Supabase et Resend exposent tous les deux une API REST, et Node embarque
   fetch depuis la version 18 : tout tient donc en appels HTTP natifs.

   Rien de ce fichier ne part vers le navigateur. C'est le seul endroit où
   les clés existent.
   ========================================================================== */

const crypto = require("node:crypto");

/* --------------------------------------------------------------------------
   Configuration
   -------------------------------------------------------------------------- */
const CONFIG = {
  supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
  supabaseCle: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  motDePasse: process.env.ADMIN_MOT_DE_PASSE || "",
  resendCle: process.env.RESEND_API_KEY || "",
  expediteur: process.env.EMAIL_EXPEDITEUR || "",
  emailNils: process.env.EMAIL_NILS || "",
  site: (process.env.SITE_URL || "https://www.nilsbouchilloux.fr").replace(/\/+$/, "")
};

/* Le site doit dire ce qui lui manque, pas renvoyer une erreur opaque. */
function manquantes(cles) {
  const noms = {
    supabaseUrl: "SUPABASE_URL",
    supabaseCle: "SUPABASE_SERVICE_ROLE_KEY",
    motDePasse: "ADMIN_MOT_DE_PASSE",
    resendCle: "RESEND_API_KEY",
    expediteur: "EMAIL_EXPEDITEUR",
    emailNils: "EMAIL_NILS"
  };
  return cles.filter((c) => !CONFIG[c]).map((c) => noms[c]);
}

/* « message » est lu par un visiteur, « detail » par la personne qui
   installe. Un élève venu réserver n'a rien à faire d'un nom de variable
   d'environnement ; celui qui déploie, lui, en a besoin tout de suite. */
function exigerBase(reponse, publique) {
  const absentes = manquantes(["supabaseUrl", "supabaseCle"]);
  if (!absentes.length) return true;

  const detail = "Variables d'environnement manquantes sur Vercel : " + absentes.join(", ") + ".";
  console.error("Configuration incomplète. " + detail);

  repondre(reponse, 503, {
    erreur: "CONFIGURATION_INCOMPLETE",
    message: publique
      ? "Les créneaux ne sont pas consultables pour le moment."
      : "La base de données n'est pas configurée. " + detail,
    detail: detail
  });
  return false;
}

/* --------------------------------------------------------------------------
   Réponses HTTP
   -------------------------------------------------------------------------- */
function repondre(reponse, code, corps) {
  reponse.statusCode = code;
  reponse.setHeader("content-type", "application/json; charset=utf-8");
  reponse.setHeader("cache-control", "no-store");
  reponse.end(JSON.stringify(corps));
}

function methodeAutorisee(requete, reponse, methodes) {
  if (methodes.indexOf(requete.method) !== -1) return true;
  reponse.setHeader("allow", methodes.join(", "));
  repondre(reponse, 405, { erreur: "METHODE_NON_AUTORISEE" });
  return false;
}

async function lireCorps(requete) {
  if (requete.body && typeof requete.body === "object") return requete.body;
  if (typeof requete.body === "string" && requete.body) {
    try { return JSON.parse(requete.body); } catch (_) { return {}; }
  }
  const morceaux = [];
  for await (const m of requete) morceaux.push(m);
  if (!morceaux.length) return {};
  try { return JSON.parse(Buffer.concat(morceaux).toString("utf8")); }
  catch (_) { return {}; }
}

/* --------------------------------------------------------------------------
   Supabase, par son API REST (PostgREST)
   -------------------------------------------------------------------------- */
async function sb(chemin, options) {
  const o = options || {};
  const reponse = await fetch(CONFIG.supabaseUrl + "/rest/v1" + chemin, {
    method: o.method || "GET",
    headers: Object.assign(
      {
        apikey: CONFIG.supabaseCle,
        authorization: "Bearer " + CONFIG.supabaseCle,
        "content-type": "application/json",
        accept: "application/json"
      },
      o.prefer ? { prefer: o.prefer } : null
    ),
    body: o.corps ? JSON.stringify(o.corps) : undefined
  });

  const texte = await reponse.text();
  let donnees = null;
  if (texte) { try { donnees = JSON.parse(texte); } catch (_) { donnees = texte; } }

  if (!reponse.ok) {
    const e = new Error("Supabase " + reponse.status);
    e.statut = reponse.status;
    e.details = donnees;
    /* PostgREST recopie le message du RAISE dans « message ». C'est par lui
       qu'on reconnaît CRENEAU_PRIS, DUREE_IMPOSSIBLE, etc. */
    e.code = donnees && donnees.message ? String(donnees.message).trim() : null;
    throw e;
  }
  return donnees;
}

/* --------------------------------------------------------------------------
   Session administrateur

   Le mot de passe ne traverse le réseau qu'une fois, à la connexion. Il est
   ensuite échangé contre un jeton signé, déposé dans un cookie HttpOnly :
   un script injecté dans la page ne peut donc pas le relire, contrairement
   à un mot de passe rangé dans localStorage.

   La clé de signature dérive du mot de passe : le changer invalide d'office
   toutes les sessions ouvertes, ce qui est exactement ce qu'on veut.
   -------------------------------------------------------------------------- */
const COOKIE = "nb_admin";
const DUREE_SESSION = 30 * 24 * 60 * 60 * 1000; // 30 jours

function cleSignature() {
  return crypto.createHash("sha256")
    .update("nilsbouchilloux|session|" + CONFIG.motDePasse)
    .digest();
}

function memeSecret(a, b) {
  /* Comparaison à durée constante, sur des empreintes de taille fixe pour
     que deux longueurs différentes ne lèvent pas d'exception. */
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function creerJeton() {
  const expiration = Date.now() + DUREE_SESSION;
  const signature = crypto.createHmac("sha256", cleSignature())
    .update(String(expiration)).digest("base64url");
  return expiration + "." + signature;
}

function jetonValide(jeton) {
  if (!jeton || typeof jeton !== "string") return false;
  const point = jeton.indexOf(".");
  if (point < 1) return false;
  const expiration = Number(jeton.slice(0, point));
  const signature = jeton.slice(point + 1);
  if (!Number.isFinite(expiration) || expiration < Date.now()) return false;
  const attendue = crypto.createHmac("sha256", cleSignature())
    .update(String(expiration)).digest("base64url");
  return memeSecret(signature, attendue);
}

function lireCookies(requete) {
  const brut = requete.headers.cookie || "";
  const sortie = {};
  brut.split(";").forEach(function (morceau) {
    const egal = morceau.indexOf("=");
    if (egal < 1) return;
    sortie[morceau.slice(0, egal).trim()] = decodeURIComponent(morceau.slice(egal + 1).trim());
  });
  return sortie;
}

function poserCookie(reponse, jeton) {
  reponse.setHeader("set-cookie",
    COOKIE + "=" + jeton +
    "; Path=/; Max-Age=" + Math.floor(DUREE_SESSION / 1000) +
    "; HttpOnly; Secure; SameSite=Strict");
}

function effacerCookie(reponse) {
  reponse.setHeader("set-cookie",
    COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict");
}

/* Renvoie true si la requête est authentifiée. Sinon elle a déjà répondu. */
function exigerAdmin(requete, reponse) {
  if (!CONFIG.motDePasse) {
    repondre(reponse, 503, {
      erreur: "CONFIGURATION_INCOMPLETE",
      message: "ADMIN_MOT_DE_PASSE n'est pas défini sur Vercel."
    });
    return false;
  }
  if (!jetonValide(lireCookies(requete)[COOKIE])) {
    repondre(reponse, 401, { erreur: "NON_AUTORISE" });
    return false;
  }
  return true;
}

/* --------------------------------------------------------------------------
   Dates, à l'heure de Paris et en français
   -------------------------------------------------------------------------- */
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin",
              "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/* « 2026-10-12 » se lit comme une date de calendrier, pas comme un instant :
   on la découpe, on ne la fait jamais passer par new Date(chaîne). */
function dateEnFrancais(iso, avecJour) {
  const p = String(iso).split("-");
  const annee = Number(p[0]), mois = Number(p[1]), jour = Number(p[2]);
  const jourSemaine = JOURS[new Date(Date.UTC(annee, mois - 1, jour)).getUTCDay()];
  const debut = avecJour === false ? "" : jourSemaine + " ";
  const quantieme = jour === 1 ? "1er" : String(jour);
  return debut + quantieme + " " + MOIS[mois - 1];
}

function dateComplete(iso) {
  const p = String(iso).split("-");
  return dateEnFrancais(iso) + " " + p[0];
}

/* La date du jour telle que Paris la vit. « en-CA » sort du AAAA-MM-JJ,
   qui est justement le format des colonnes date de Postgres. */
function aujourdhuiParis() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

function heureEnFrancais(heure) {
  const p = String(heure).split(":");
  const minutes = p[1] || "00";
  return minutes === "00" ? Number(p[0]) + " h" : Number(p[0]) + " h " + minutes;
}

/* Nils tape sur un téléphone, debout sur un practice. On accepte donc
   « 9 », « 9h », « 9h30 », « 9:30 », « 930 », « 09.30 » — et on refuse le
   reste plutôt que de deviner. Retourne « HH:MM » ou null. */
function normaliserHeure(brut) {
  const nettoye = String(brut == null ? "" : brut).trim().toLowerCase().replace(/\s+/g, "");
  if (!nettoye) return null;
  let h = null, m = 0;
  let trouve = nettoye.match(/^(\d{1,2})[h:.,](\d{1,2})$/);
  if (trouve) { h = Number(trouve[1]); m = Number(trouve[2]); }
  if (h === null && (trouve = nettoye.match(/^(\d{1,2})h$/)))    { h = Number(trouve[1]); m = 0; }
  if (h === null && (trouve = nettoye.match(/^(\d{1,2})$/)))      { h = Number(trouve[1]); m = 0; }
  if (h === null && (trouve = nettoye.match(/^(\d{1,2})(\d{2})$/))) { h = Number(trouve[1]); m = Number(trouve[2]); }
  if (h === null || !Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/* « Golf de Cestas, Cestas » se lit mal : la ville est déjà dans le nom.
   On ne l'ajoute que quand elle manque, comme pour « Barena Golf ». */
function lieuComplet(libelle, ville) {
  var nom = String(libelle || "");
  var v = String(ville || "");
  if (!v) return nom;
  return nom.toLowerCase().indexOf(v.toLowerCase()) === -1 ? nom + ", " + v : nom;
}

function prix(centimes) {
  return (centimes % 100 === 0)
    ? (centimes / 100) + " €"
    : (centimes / 100).toFixed(2).replace(".", ",") + " €";
}

/* --------------------------------------------------------------------------
   Emails, par l'API REST de Resend
   -------------------------------------------------------------------------- */
async function envoyerEmail(message) {
  if (manquantes(["resendCle", "expediteur"]).length) {
    return { envoye: false, raison: "Resend n'est pas configuré." };
  }
  try {
    const reponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: "Bearer " + CONFIG.resendCle,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: CONFIG.expediteur,
        to: message.a,
        subject: message.objet,
        html: message.html,
        text: message.texte,
        reply_to: message.repondreA || undefined
      })
    });
    if (!reponse.ok) {
      const details = await reponse.text();
      return { envoye: false, raison: "Resend " + reponse.status + " " + details.slice(0, 300) };
    }
    return { envoye: true };
  } catch (erreur) {
    return { envoye: false, raison: String(erreur && erreur.message) };
  }
}

function echapper(valeur) {
  return String(valeur == null ? "" : valeur)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = {
  CONFIG, manquantes, exigerBase,
  repondre, methodeAutorisee, lireCorps,
  sb,
  creerJeton, jetonValide, lireCookies, poserCookie, effacerCookie,
  exigerAdmin, memeSecret,
  dateEnFrancais, dateComplete, heureEnFrancais, prix, aujourdhuiParis, normaliserHeure, lieuComplet,
  envoyerEmail, echapper
};
