"use strict";

/* ==========================================================================
   /api/admin/semaine — la semaine type de Nils.

   GET     les plages de disponibilité récurrentes
   POST    en ajouter une
   PATCH   en modifier une
   DELETE  en retirer une
   POST ?appliquer=N   fabriquer les journées des N prochaines semaines

   Un mot sur le parti pris, parce qu'il est contre-intuitif.

   La semaine type n'est PAS une règle lue à la volée. C'est un gabarit
   qu'on applique, et qui fabrique de vraies journées avec de vrais
   créneaux. Le planning reste donc une suite de journées concrètes, que
   Nils peut corriger une par une — annuler un jeudi, décaler une heure —
   sans toucher au gabarit.

   L'inverse, une règle permanente interprétée à la lecture, obligerait à
   gérer des exceptions partout et rendrait impossible la question la plus
   simple : « qu'est-ce que je fais jeudi ? »

   Appliquer n'écrase jamais rien : les horaires déjà présents sont ignorés,
   les créneaux réservés ne bougent pas.
   ========================================================================== */

const L = require("../_lib.js");

const JOURS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

function valider(corps, creation) {
  const e = [];
  const d = {};

  if (creation || corps.jour !== undefined) {
    const j = Number(corps.jour);
    if (!Number.isInteger(j) || j < 1 || j > 7) e.push("jour"); else d.jour = j;
  }
  if (creation || corps.lieu !== undefined) {
    const v = String(corps.lieu || "").trim();
    if (!v) e.push("lieu"); else d.lieu = v;
  }
  if (creation || corps.debut !== undefined) {
    const h = L.normaliserHeure(corps.debut);
    if (!h) e.push("debut"); else d.debut = h;
  }
  if (creation || corps.fin !== undefined) {
    const h = L.normaliserHeure(corps.fin);
    if (!h) e.push("fin"); else d.fin = h;
  }
  if (corps.pas !== undefined) {
    const p = Number(corps.pas);
    if (!Number.isInteger(p) || p < 15 || p > 240) e.push("pas"); else d.pas_minutes = p;
  }
  if (corps.actif !== undefined) d.actif = Boolean(corps.actif);

  if (d.debut && d.fin && d.fin <= d.debut) e.push("fin");
  return { donnees: d, erreurs: e };
}

function minutes(h) { return Number(String(h).slice(0, 2)) * 60 + Number(String(h).slice(3, 5)); }
function hhmm(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }

function horaires(plage) {
  const sortie = [];
  const fin = minutes(plage.fin);
  for (let t = minutes(plage.debut); t < fin; t += plage.pas_minutes) sortie.push(hhmm(t));
  return sortie;
}

function enForme(p, lieux) {
  const l = (lieux || []).find(function (x) { return x.code === p.lieu; });
  return {
    id: p.id,
    jour: p.jour,
    jourNom: JOURS[p.jour],
    lieu: p.lieu,
    lieuNom: l ? l.libelle : p.lieu,
    debut: String(p.debut).slice(0, 5),
    fin: String(p.fin).slice(0, 5),
    pas: p.pas_minutes,
    actif: p.actif,
    creneaux: horaires({ debut: p.debut, fin: p.fin, pas_minutes: p.pas_minutes }).length
  };
}

/* La date du prochain « jour » (1 = lundi) à partir d'aujourd'hui inclus. */
function prochaines(jour, semaines) {
  const dates = [];
  const auj = L.aujourdhuiParis().split("-").map(Number);
  const curseur = new Date(Date.UTC(auj[0], auj[1] - 1, auj[2]));
  const isodow = curseur.getUTCDay() === 0 ? 7 : curseur.getUTCDay();
  let ecart = jour - isodow;
  if (ecart < 0) ecart += 7;
  curseur.setUTCDate(curseur.getUTCDate() + ecart);
  for (let i = 0; i < semaines; i++) {
    dates.push(curseur.toISOString().slice(0, 10));
    curseur.setUTCDate(curseur.getUTCDate() + 7);
  }
  return dates;
}

module.exports = async function (requete, reponse) {
  if (!L.methodeAutorisee(requete, reponse, ["GET", "POST", "PATCH", "DELETE"])) return;
  if (!L.exigerBase(reponse)) return;
  if (!L.exigerAdmin(requete, reponse)) return;

  const p = new URL(requete.url, "http://local").searchParams;

  /* ---------------------------------------------------------------- GET */
  if (requete.method === "GET") {
    try {
      const [plages, lieux] = await Promise.all([
        L.sb("/semaine_type?select=*&order=jour.asc,debut.asc"),
        L.sb("/lieux?select=code,libelle,ville,teinte&order=ordre.asc")
      ]);
      return L.repondre(reponse, 200, {
        plages: plages.map(function (x) { return enForme(x, lieux); }),
        lieux: lieux
      });
    } catch (e) {
      return L.repondre(reponse, 502, { erreur: "BASE_INJOIGNABLE", message: "Semaine type illisible." });
    }
  }

  const corps = await L.lireCorps(requete);

  /* ------------------------------------------- POST ?appliquer=N semaines */
  if (requete.method === "POST" && p.get("appliquer")) {
    const semaines = Math.min(12, Math.max(1, Number(p.get("appliquer")) || 4));
    try {
      const plages = await L.sb("/semaine_type?select=*&actif=eq.true&order=jour.asc,debut.asc");
      if (!plages.length) {
        return L.repondre(reponse, 400, {
          erreur: "SEMAINE_VIDE", message: "Ajoutez d'abord au moins une plage à votre semaine type."
        });
      }

      /* Les journées existantes, pour ne pas en créer de doublon. */
      const depuis = L.aujourdhuiParis();
      const existantes = await L.sb("/journees?select=id,date,lieu&date=gte." + encodeURIComponent(depuis));
      const index = {};
      existantes.forEach(function (j) { index[j.date + "|" + j.lieu] = j.id; });

      let journeesCreees = 0, creneauxAjoutes = 0;
      for (const plage of plages) {
        for (const date of prochaines(plage.jour, semaines)) {
          let id = index[date + "|" + plage.lieu];
          if (!id) {
            const creees = await L.sb("/journees", {
              method: "POST", prefer: "return=representation",
              corps: { date: date, lieu: plage.lieu }
            });
            id = creees[0].id;
            index[date + "|" + plage.lieu] = id;
            journeesCreees += 1;
          }
          const heures = horaires(plage);
          if (heures.length) {
            await L.sb("/creneaux?on_conflict=journee_id,heure", {
              method: "POST", prefer: "resolution=ignore-duplicates,return=minimal",
              corps: heures.map(function (h) { return { journee_id: id, heure: h }; })
            });
            creneauxAjoutes += heures.length;
          }
        }
      }
      return L.repondre(reponse, 200, {
        semaines: semaines, journeesCreees: journeesCreees, creneauxProposes: creneauxAjoutes
      });
    } catch (e) {
      return L.repondre(reponse, 502, { erreur: "APPLICATION_ECHOUEE", message: "La semaine type n'a pas pu être appliquée." });
    }
  }

  /* --------------------------------------------------------------- POST */
  if (requete.method === "POST") {
    const c = valider(corps, true);
    if (c.erreurs.length) {
      return L.repondre(reponse, 400, {
        erreur: "CHAMPS_INVALIDES", champs: c.erreurs,
        message: "Vérifiez le jour, le lieu et les heures de début et de fin."
      });
    }
    if (c.donnees.pas_minutes === undefined) c.donnees.pas_minutes = 60;
    try {
      const creees = await L.sb("/semaine_type", {
        method: "POST", prefer: "return=representation", corps: c.donnees
      });
      const lieux = await L.sb("/lieux?select=code,libelle");
      return L.repondre(reponse, 201, { plage: enForme(creees[0], lieux) });
    } catch (e) {
      return L.repondre(reponse, 502, { erreur: "ECRITURE_ECHOUEE", message: "Plage non enregistrée." });
    }
  }

  /* -------------------------------------------------------------- PATCH */
  if (requete.method === "PATCH") {
    const id = String(corps.id || "");
    if (!id) return L.repondre(reponse, 400, { erreur: "ID_MANQUANT" });
    const c = valider(corps, false);
    if (c.erreurs.length) return L.repondre(reponse, 400, { erreur: "CHAMPS_INVALIDES", champs: c.erreurs });
    if (!Object.keys(c.donnees).length) return L.repondre(reponse, 400, { erreur: "RIEN_A_MODIFIER" });
    try {
      const m = await L.sb("/semaine_type?id=eq." + encodeURIComponent(id), {
        method: "PATCH", prefer: "return=representation", corps: c.donnees
      });
      if (!m.length) return L.repondre(reponse, 404, { erreur: "PLAGE_INTROUVABLE" });
      const lieux = await L.sb("/lieux?select=code,libelle");
      return L.repondre(reponse, 200, { plage: enForme(m[0], lieux) });
    } catch (e) {
      return L.repondre(reponse, 502, { erreur: "ECRITURE_ECHOUEE" });
    }
  }

  /* ------------------------------------------------------------- DELETE */
  const id = p.get("id") || String(corps.id || "");
  if (!id) return L.repondre(reponse, 400, { erreur: "ID_MANQUANT" });
  try {
    await L.sb("/semaine_type?id=eq." + encodeURIComponent(id), { method: "DELETE", prefer: "return=minimal" });
    return L.repondre(reponse, 200, { supprimee: id });
  } catch (e) {
    return L.repondre(reponse, 502, { erreur: "SUPPRESSION_ECHOUEE" });
  }
};
