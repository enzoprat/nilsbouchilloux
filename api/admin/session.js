"use strict";

/* ==========================================================================
   /api/admin/session — ouvrir, vérifier et fermer la session de Nils.

   Le mot de passe ne circule qu'ici, une seule fois. Il est ensuite échangé
   contre un jeton signé déposé dans un cookie HttpOnly : le JavaScript de la
   page ne peut pas le relire, et il n'est donc pas exfiltrable par un script
   injecté, contrairement à un mot de passe rangé dans localStorage.

   Limite assumée et à connaître : il n'y a qu'un seul mot de passe, partagé,
   sans second facteur. C'est proportionné à l'enjeu — un planning de cours,
   pas des données bancaires — mais ça suppose un mot de passe long, et ça
   suppose de le changer si un téléphone est perdu. Le changer déconnecte
   d'ailleurs toutes les sessions, puisque la clé de signature en dérive.
   ========================================================================== */

const L = require("../_lib.js");

/* Freinage, au cas où quelqu'un tenterait des mots de passe en série. En
   serverless la mémoire n'est pas partagée entre instances, donc ce compteur
   est une gêne, pas une barrière : la vraie défense reste la longueur du
   mot de passe. Le délai fixe, lui, s'applique toujours. */
const tentatives = new Map();
const FENETRE = 10 * 60 * 1000;
const MAXI = 10;

function trop(ip) {
  const maintenant = Date.now();
  const entree = tentatives.get(ip);
  if (!entree || maintenant - entree.debut > FENETRE) {
    tentatives.set(ip, { debut: maintenant, n: 1 });
    return false;
  }
  entree.n += 1;
  return entree.n > MAXI;
}

module.exports = async function (requete, reponse) {
  if (!L.methodeAutorisee(requete, reponse, ["GET", "POST", "DELETE"])) return;

  if (requete.method === "GET") {
    return L.repondre(reponse, 200, {
      connecte: L.jetonValide(L.lireCookies(requete)[ "nb_admin" ]),
      configure: Boolean(L.CONFIG.motDePasse)
    });
  }

  if (requete.method === "DELETE") {
    L.effacerCookie(reponse);
    return L.repondre(reponse, 200, { connecte: false });
  }

  if (!L.CONFIG.motDePasse) {
    return L.repondre(reponse, 503, {
      erreur: "CONFIGURATION_INCOMPLETE",
      message: "ADMIN_MOT_DE_PASSE n'est pas défini sur Vercel."
    });
  }

  const ip = String(requete.headers["x-forwarded-for"] || "").split(",")[0].trim() || "inconnue";
  if (trop(ip)) {
    return L.repondre(reponse, 429, {
      erreur: "TROP_DE_TENTATIVES",
      message: "Trop d'essais. Réessayez dans quelques minutes."
    });
  }

  const corps = await L.lireCorps(requete);
  await new Promise(function (r) { setTimeout(r, 350); });

  if (!L.memeSecret(String(corps.motDePasse || ""), L.CONFIG.motDePasse)) {
    return L.repondre(reponse, 401, { erreur: "MOT_DE_PASSE_INVALIDE", message: "Mot de passe incorrect." });
  }

  tentatives.delete(ip);
  L.poserCookie(reponse, L.creerJeton());
  return L.repondre(reponse, 200, { connecte: true });
};
