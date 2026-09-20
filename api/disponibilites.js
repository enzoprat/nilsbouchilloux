"use strict";

/* ==========================================================================
   GET /api/disponibilites

   Ce que le client voit : les journées à venir que Nils a ouvertes, et pour
   chacune les créneaux encore libres.

   Une subtilité mérite d'être expliquée. Comme le client choisit une durée,
   un créneau libre ne suffit pas à autoriser un cours de deux heures : il
   faut aussi que rien ne soit déjà réservé dans les deux heures qui suivent.
   On calcule donc, pour chaque créneau, la durée maximale encore tenable —
   la distance jusqu'au prochain créneau DÉJÀ PRIS de la journée. Le
   navigateur s'en sert pour n'afficher que les formules réellement
   possibles ; la base revérifie de toute façon au moment de réserver.
   ========================================================================== */

const L = require("./_lib.js");

const DUREE_PLAFOND = 240; // au-delà, plus aucune formule n'est concernée

function minutes(heure) {
  const p = String(heure).split(":");
  return Number(p[0]) * 60 + Number(p[1]);
}

module.exports = async function (requete, reponse) {
  if (!L.methodeAutorisee(requete, reponse, ["GET"])) return;
  if (!L.exigerBase(reponse, true)) return;

  try {
    const [lieux, formules, creneaux] = await Promise.all([
      L.sb("/lieux?actif=eq.true&select=code,libelle,ville,teinte&order=ordre.asc"),
      L.sb("/formules?actif=eq.true&select=code,libelle,personnes,duree_minutes,prix_centimes&order=ordre.asc"),
      L.sb("/v_creneaux_publics?select=journee_id,date,lieu,creneau_id,heure,pris&order=date.asc,heure.asc")
    ]);

    const parLieu = {};
    lieux.forEach(function (l) { parLieu[l.code] = l; });

    /* Regroupement par journée, en conservant les créneaux pris : ils ne
       sont pas proposés, mais ils plafonnent la durée des précédents. */
    const journees = [];
    const index = {};
    creneaux.forEach(function (c) {
      let j = index[c.journee_id];
      if (!j) {
        j = index[c.journee_id] = {
          id: c.journee_id,
          date: c.date,
          dateTexte: L.dateEnFrancais(c.date),
          dateLongue: L.dateComplete(c.date),
          lieu: parLieu[c.lieu] || { code: c.lieu, libelle: c.lieu, ville: "", teinte: "vert" },
          tous: []
        };
        journees.push(j);
      }
      j.tous.push(c);
    });

    const sortie = journees.map(function (j) {
      const pris = j.tous.filter(function (c) { return c.pris; }).map(function (c) { return minutes(c.heure); });
      const libres = j.tous.filter(function (c) { return !c.pris; }).map(function (c) {
        const debut = minutes(c.heure);
        let plafond = DUREE_PLAFOND;
        pris.forEach(function (t) {
          if (t > debut) plafond = Math.min(plafond, t - debut);
        });
        return {
          id: c.creneau_id,
          heure: String(c.heure).slice(0, 5),
          heureTexte: L.heureEnFrancais(c.heure),
          dureeMax: plafond
        };
      });
      return {
        id: j.id,
        date: j.date,
        dateTexte: j.dateTexte,
        dateLongue: j.dateLongue,
        lieu: j.lieu,
        creneaux: libres
      };
    }).filter(function (j) { return j.creneaux.length > 0; });

    L.repondre(reponse, 200, {
      journees: sortie,
      formules: formules.map(function (f) {
        return {
          code: f.code,
          libelle: f.libelle,
          personnes: f.personnes,
          dureeMinutes: f.duree_minutes,
          dureeTexte: f.duree_minutes >= 120 ? (f.duree_minutes / 60) + " heures" : "1 heure",
          prixCentimes: f.prix_centimes,
          prixTexte: L.prix(f.prix_centimes)
        };
      })
    });
  } catch (erreur) {
    L.repondre(reponse, 502, {
      erreur: "BASE_INJOIGNABLE",
      message: "Les disponibilités n'ont pas pu être chargées."
    });
  }
};
