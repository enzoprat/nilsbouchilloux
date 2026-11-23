/* ==========================================================================
   Nils Bouchilloux — espace de gestion du planning

   Cet écran est fait pour être utilisé debout, une main sur le téléphone,
   entre deux élèves. Conséquences sur chaque décision :

   - aucune navigation : une seule page, tout est visible en descendant ;
   - la saisie des horaires accepte ce qu'on tape vraiment sur un clavier
     de téléphone (« 9h », « 930 », « 14h30 »), et une série remplit une
     journée entière d'un geste ;
   - ce qui est réservé se lit sans cliquer : nom, téléphone, formule ;
   - rien de destructeur ne part sans confirmation nommant le client.
   ========================================================================== */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };

  var vues = {
    connexion: $("[data-connexion]"),
    connexionFormulaire: $("[data-connexion-formulaire]"),
    connexionErreur: $("[data-connexion-erreur]"),
    espace: $("[data-espace]"),
    message: $("[data-message]"),
    lieux: $("[data-lieux]"),
    nouvelle: $("[data-nouvelle]"),
    planning: $("[data-planning]"),
    planningVide: $("[data-planning-vide]"),
    listeFormules: $("[data-liste-formules]"),
    compteFormules: $("[data-compte-formules]"),
    formuleNouvelle: $("[data-formule-nouvelle]"),
    listeLieux: $("[data-liste-lieux]"),
    compteLieux: $("[data-compte-lieux]"),
    lieuNouveau: $("[data-lieu-nouveau]"),
    plages: $("[data-plages]"),
    semaineCompte: $("[data-semaine-compte]"),
    plageNouvelle: $("[data-plage-nouvelle]"),
    plageLieux: $("[data-plage-lieux]")
  };

  var etat = { lieux: [], journees: [], formules: [], tousLieux: [], plages: [] };

  /* ------------------------------------------------------------------ Réseau */
  function appeler(url, options) {
    var o = Object.assign({ headers: { "content-type": "application/json" } }, options || {});
    o.credentials = "same-origin";
    return fetch(url, o).then(function (reponse) {
      return reponse.json().catch(function () { return {}; }).then(function (corps) {
        return { ok: reponse.ok, statut: reponse.status, corps: corps };
      });
    });
  }

  function dire(texte, estErreur) {
    vues.message.className = "message-outil" + (estErreur ? " message-outil--erreur" : "");
    vues.message.innerHTML = "<p>" + echapper(texte) + "</p>";
    vues.message.hidden = false;
    if (!estErreur) {
      clearTimeout(dire.minuteur);
      dire.minuteur = setTimeout(function () { vues.message.hidden = true; }, 4000);
    }
  }

  function echapper(valeur) {
    var noeud = document.createElement("span");
    noeud.textContent = String(valeur == null ? "" : valeur);
    return noeud.innerHTML;
  }

  /* Une session expirée en pleine saisie ne doit pas ressembler à une panne. */
  function gererSession(r) {
    if (r.statut === 401) {
      montrerConnexion();
      dire("Session expirée, reconnectez-vous.", true);
      return true;
    }
    return false;
  }

  /* -------------------------------------------------------------- Connexion */
  function montrerConnexion() {
    vues.connexion.hidden = false;
    vues.espace.hidden = true;
  }

  function montrerEspace() {
    vues.connexion.hidden = true;
    vues.espace.hidden = false;
    chargerPlanning();
    chargerReglages();
    chargerSemaine();
  }

  vues.connexionFormulaire.addEventListener("submit", function (e) {
    e.preventDefault();
    var champ = $("#motdepasse");
    vues.connexionErreur.textContent = "";
    if (!champ.value) { vues.connexionErreur.textContent = "Mot de passe nécessaire."; return; }

    var bouton = vues.connexionFormulaire.querySelector("button");
    bouton.disabled = true;
    bouton.textContent = "Vérification…";

    appeler("/api/admin/session", {
      method: "POST",
      body: JSON.stringify({ motDePasse: champ.value })
    }).then(function (r) {
      bouton.disabled = false;
      bouton.textContent = "Entrer";
      champ.value = "";
      if (r.ok) { montrerEspace(); return; }
      vues.connexionErreur.textContent = (r.corps && r.corps.message) || "Mot de passe incorrect.";
    }).catch(function () {
      bouton.disabled = false;
      bouton.textContent = "Entrer";
      vues.connexionErreur.textContent = "La connexion a échoué.";
    });
  });

  $("[data-deconnexion]").addEventListener("click", function () {
    appeler("/api/admin/session", { method: "DELETE" }).then(montrerConnexion);
  });

  /* ------------------------------------------------------- Lecture d'horaires */
  /* Même grammaire que côté serveur, pour que ce qui est accepté ici le soit
     aussi là-bas. Le serveur reste l'autorité : il revalide tout. */
  function normaliserHeure(brut) {
    var n = String(brut == null ? "" : brut).trim().toLowerCase().replace(/\s+/g, "");
    if (!n) return null;
    var h = null, m = 0, t;
    if ((t = n.match(/^(\d{1,2})[h:.,](\d{1,2})$/)))  { h = +t[1]; m = +t[2]; }
    else if ((t = n.match(/^(\d{1,2})h$/)))            { h = +t[1]; m = 0; }
    else if ((t = n.match(/^(\d{1,2})$/)))             { h = +t[1]; m = 0; }
    else if ((t = n.match(/^(\d{1,2})(\d{2})$/)))      { h = +t[1]; m = +t[2]; }
    if (h === null || h < 0 || h > 23 || m < 0 || m > 59) return null;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  function lireHoraires(texte) {
    var bonnes = [], mauvaises = [];
    String(texte || "").split(/[\s,;]+/).forEach(function (morceau) {
      if (!morceau) return;
      var h = normaliserHeure(morceau);
      if (!h) { mauvaises.push(morceau); return; }
      if (bonnes.indexOf(h) === -1) bonnes.push(h);
    });
    bonnes.sort();
    return { bonnes: bonnes, mauvaises: mauvaises };
  }

  /* Une plage de disponibilité en liste d'horaires : « de 10 h à 15 h toutes
     les heures » donne 10:00, 11:00 … 15:00. Retourne null et prévient si la
     saisie n'a pas de sens, plutôt que de produire une liste absurde. */
  function serie(debutBrut, finBrut, pas, muet) {
    var plainte = function (t) { if (!muet) dire(t, true); return null; };
    var debut = normaliserHeure(debutBrut), fin = normaliserHeure(finBrut);
    if (!debut || !fin) return plainte("Indiquez un début et une fin.");
    var m = function (h) { var p = h.split(":"); return +p[0] * 60 + +p[1]; };
    var debutM = m(debut), finM = m(fin);
    if (finM <= debutM) return plainte("La fin doit venir après le début.");
    if (!pas || pas < 5) pas = 60;
    if ((finM - debutM) / pas > 40) return plainte("Cela ferait plus de quarante créneaux.");
    var sortie = [];
    for (var t = debutM; t + pas <= finM; t += pas) {
      sortie.push(String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"));
    }
    return sortie;
  }

  /* ------------------------------------------------------- Plages du jour

     Une journée se dit rarement d'un trait : « de 10 h à 12 h, puis de
     13 h à 17 h » est la forme normale dès qu'il y a une coupure. On
     empile donc des plages, et l'aperçu les fond en une seule liste
     d'horaires, dédoublonnée et triée.
     ---------------------------------------------------------------------- */
  var DUREES = [[30, "30 minutes"], [45, "45 minutes"], [60, "1 heure"], [90, "1 h 30"], [120, "2 heures"]];

  function ajouterPlageJour(debut, fin, pas) {
    var hote = $("[data-plages-jour]");
    var ligne = document.createElement("div");
    ligne.className = "plage-jour";
    ligne.innerHTML =
      '<label><span>De</span><input type="time" data-debut value="' + (debut || "10:00") + '"></label>' +
      '<label><span>à</span><input type="time" data-fin value="' + (fin || "15:00") + '"></label>' +
      '<label><span>Durée d\u2019un cours</span><select data-pas>' +
        DUREES.map(function (d) {
          return '<option value="' + d[0] + '"' + (d[0] === (pas || 60) ? " selected" : "") + '>' + d[1] + '</option>';
        }).join("") +
      '</select></label>' +
      '<button class="plage-jour__retirer" type="button" aria-label="Retirer cette plage">&times;</button>';

    ligne.querySelector(".plage-jour__retirer").addEventListener("click", function () {
      if (hote.children.length <= 1) { dire("Il faut au moins une plage.", true); return; }
      ligne.remove(); majApercu();
    });
    ligne.querySelectorAll("input, select").forEach(function (e) {
      e.addEventListener("input", majApercu);
      e.addEventListener("change", majApercu);
    });
    hote.appendChild(ligne);
    majApercu();
  }

  /* Toutes les plages fondues en une liste d'horaires. Deux plages qui se
     chevauchent ne produisent pas deux fois la même heure. */
  function horairesDuJour() {
    var toutes = [], souci = null;
    $("[data-plages-jour]").querySelectorAll(".plage-jour").forEach(function (l) {
      var sortie = serie(l.querySelector("[data-debut]").value,
                         l.querySelector("[data-fin]").value,
                         Number(l.querySelector("[data-pas]").value), true);
      if (!sortie) {
        var d = l.querySelector("[data-debut]").value, f = l.querySelector("[data-fin]").value;
        souci = (d && f) ? "Sur une plage, la fin ne vient pas après le début." :
                           "Indiquez une heure de début et une heure de fin.";
        return;
      }
      sortie.forEach(function (h) { if (toutes.indexOf(h) === -1) toutes.push(h); });
    });
    toutes.sort();
    return { horaires: toutes, souci: souci };
  }

  function majApercu() {
    var cible = $("[data-apercu]");
    var libres = lireHoraires($("#horaires").value);
    if (libres.bonnes.length) {
      cible.textContent = libres.bonnes.length +
        (libres.bonnes.length > 1 ? " créneaux : " : " créneau : ") + libres.bonnes.join(" · ");
      return;
    }
    var lu = horairesDuJour();
    if (lu.souci && !lu.horaires.length) { cible.textContent = lu.souci; return; }
    cible.textContent = lu.horaires.length
      ? lu.horaires.length + (lu.horaires.length > 1 ? " créneaux : " : " créneau : ") + lu.horaires.join(" · ")
      : "Indiquez une heure de début et une heure de fin.";
  }

  $("[data-ajouter-plage]").addEventListener("click", function () {
    var dernieres = $("[data-plages-jour]").querySelectorAll(".plage-jour");
    var derniere = dernieres[dernieres.length - 1];
    /* La plage suivante démarre une heure après la fin de la précédente :
       c'est la coupure déjeuner dans la plupart des cas. */
    var apres = derniere ? derniere.querySelector("[data-fin]").value : "13:00";
    var h = normaliserHeure(apres);
    var debut = h ? String(Math.min(23, +h.slice(0, 2) + 1)).padStart(2, "0") + ":" + h.slice(3) : "13:00";
    var fin = String(Math.min(23, +debut.slice(0, 2) + 4)).padStart(2, "0") + ":" + debut.slice(3);
    ajouterPlageJour(debut, fin, derniere ? Number(derniere.querySelector("[data-pas]").value) : 60);
  });

  $("#horaires").addEventListener("input", majApercu);
  ajouterPlageJour("10:00", "15:00", 60);

  /* ------------------------------------------------------- Lieu express

     Le panneau « Mes lieux » existe plus bas, mais il est replié et loin.
     Nils découvre une structure le jour où il y donne son premier cours :
     il doit pouvoir la créer sans quitter le formulaire qu'il remplit. */
  function basculerLieuExpress(ouvrir) {
    $("[data-lieu-express]").hidden = !ouvrir;
    $("[data-lieu-plus]").textContent = ouvrir ? "\u00d7" : "+";
    $("[data-lieu-plus]").setAttribute("aria-label", ouvrir ? "Fermer" : "Ajouter un lieu");
    if (ouvrir) $("#lx-nom").focus();
  }

  $("[data-lieu-plus]").addEventListener("click", function () {
    basculerLieuExpress($("[data-lieu-express]").hidden);
  });
  $("[data-lieu-annuler]").addEventListener("click", function () {
    $("#lx-nom").value = ""; $("#lx-ville").value = "";
    basculerLieuExpress(false);
  });

  $("[data-lieu-creer]").addEventListener("click", function () {
    var nom = $("#lx-nom").value.trim(), ville = $("#lx-ville").value.trim();
    if (nom.length < 2 || ville.length < 2) { dire("Il faut un nom et une ville.", true); return; }
    /* La teinte alterne : deux lieux voisins ne doivent pas porter le même
       repère de couleur sur la page de réservation. */
    var teinte = (etat.tousLieux.filter(function (l) { return l.teinte === "vert"; }).length >
                  etat.tousLieux.filter(function (l) { return l.teinte === "sable"; }).length)
      ? "sable" : "vert";
    appeler("/api/admin/lieux", {
      method: "POST", body: JSON.stringify({ libelle: nom, ville: ville, teinte: teinte })
    }).then(function (r) {
      if (gererSession(r)) return;
      if (!r.ok) { dire(messageErreur(r, "Lieu non créé."), true); return; }
      var code = r.corps.lieu.code;
      $("#lx-nom").value = ""; $("#lx-ville").value = "";
      basculerLieuExpress(false);
      dire("« " + r.corps.lieu.libelle + " » ajouté et sélectionné.");
      /* On recharge, puis on sélectionne le lieu tout juste créé. */
      Promise.all([appeler("/api/admin/lieux"), appeler("/api/admin/semaine")]).then(function (rr) {
        if (rr[0].ok) { etat.tousLieux = rr[0].corps.lieux || []; rendreLieux(); remplirLieux(); }
        if (rr[1].ok) remplirPlageLieux(rr[1].corps.lieux || []);
        vues.lieux.value = code;
      });
    });
  });

  /* ---------------------------------------------------- Ouvrir une journée */
  vues.nouvelle.addEventListener("submit", function (e) {
    e.preventDefault();
    var date = $("#date").value;
    var lieu = $("#lieu").value;
    if (!date) { dire("Choisissez une date.", true); return; }
    if (!lieu) { dire("Choisissez un lieu.", true); return; }

    var horaires = lireHoraires($("#horaires").value);
    if (horaires.mauvaises.length) {
      dire("Horaire non compris : " + horaires.mauvaises.join(", ") + ".", true);
      return;
    }
    /* Sans saisie libre, c'est la plage qui fait foi. */
    if (!horaires.bonnes.length) {
      var lu = horairesDuJour();
      if (!lu.horaires.length) { dire(lu.souci || "Indiquez au moins une plage.", true); return; }
      if (lu.souci) { dire(lu.souci, true); return; }
      horaires = { bonnes: lu.horaires, mauvaises: [] };
    }

    var bouton = vues.nouvelle.querySelector('button[type="submit"]');
    bouton.disabled = true;
    bouton.textContent = "Enregistrement…";

    appeler("/api/admin/journees", {
      method: "POST",
      body: JSON.stringify({ date: date, lieu: lieu, heures: horaires.bonnes })
    }).then(function (r) {
      bouton.disabled = false;
      bouton.textContent = "Ouvrir cette journée";
      if (gererSession(r)) return;
      if (!r.ok) { dire((r.corps && r.corps.message) || "Échec de l'enregistrement.", true); return; }
      $("#horaires").value = "";
      majApercu();
      dire(horaires.bonnes.length
        ? "Journée ouverte, " + horaires.bonnes.length + " créneaux en ligne."
        : "Journée ouverte. Ajoutez-lui des horaires.");
      chargerPlanning();
    }).catch(function () {
      bouton.disabled = false;
      bouton.textContent = "Ouvrir cette journée";
      dire("La connexion a échoué.", true);
    });
  });

  /* -------------------------------------------------------------- Planning */
  function chargerPlanning() {
    appeler("/api/admin/journees").then(function (r) {
      if (gererSession(r)) return;
      if (!r.ok) { dire((r.corps && r.corps.message) || "Planning indisponible.", true); return; }
      etat.lieux = r.corps.lieux || [];
      etat.journees = r.corps.journees || [];
      remplirLieux();
      rendrePlanning();
      if (!etat.formules.length) chargerReglages();
    }).catch(function () { dire("La connexion a échoué.", true); });
  }

  function remplirLieux() {
    /* La source est la liste des réglages quand elle est chargée, sinon
       celle du planning : ainsi un lieu ajouté est immédiatement
       sélectionnable sans recharger la page. */
    var source = etat.tousLieux.length
      ? etat.tousLieux.filter(function (l) { return l.actif; })
      : etat.lieux;
    var choix = vues.lieux.value;
    vues.lieux.textContent = "";
    source.forEach(function (l) {
      var option = document.createElement("option");
      option.value = l.code;
      option.textContent = (l.libelle || "").toLowerCase().indexOf((l.ville || "").toLowerCase()) === -1
        ? l.libelle + ", " + l.ville : l.libelle;
      vues.lieux.appendChild(option);
    });
    if (choix) vues.lieux.value = choix;
  }

  /* ==========================================================================
     Le planning, en colonnes de jours.

     Une liste verticale oblige à faire défiler pour répondre à « qu'est-ce
     que je fais jeudi ? ». Une colonne par jour répond d'un coup d'œil, et
     c'est la forme du planning papier que Nils utilise déjà.

     Les jours sans journée ouverte apparaissent quand même, en repos : leur
     absence est une information, pas un trou.
     ========================================================================== */

  var JOURS_SEM = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  var MOIS_COURTS = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
  var HORIZON = 14;

  function dateIso(decalage) {
    var d = new Date();
    d.setDate(d.getDate() + decalage);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris",
      year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }

  function morceaux(iso) {
    var p = String(iso).split("-");
    return { annee: +p[0], mois: +p[1], jour: +p[2],
      semaine: new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() };
  }

  function minutesDe(h) { return +String(h).slice(0, 2) * 60 + +String(h).slice(3, 5); }

  /* La durée la plus longue réellement réservable sur ce créneau : la
     distance jusqu'au prochain créneau DÉJÀ PRIS, confrontée aux formules
     que Nils propose. C'est ce chiffre qui manquait pour savoir, d'un coup
     d'œil, si quelqu'un peut encore poser deux heures ici. */
  function dureeMax(journee, creneau) {
    var debut = minutesDe(creneau.heure);
    var plafond = 240;
    journee.creneaux.forEach(function (c) {
      if (!c.reserve) return;
      var t = minutesDe(c.heure);
      if (t > debut) plafond = Math.min(plafond, t - debut);
    });
    var tenables = (etat.formules || []).filter(function (f) {
      return f.actif !== false && f.dureeMinutes <= plafond;
    });
    if (!tenables.length) return null;
    var max = Math.max.apply(null, tenables.map(function (f) { return f.dureeMinutes; }));
    return max % 60 === 0 ? (max / 60) + " h max" : max + " min max";
  }

  function rendrePlanning() {
    vues.planning.textContent = "";
    vues.planningVide.hidden = etat.journees.length > 0;

    var parDate = {};
    etat.journees.forEach(function (j) { (parDate[j.date] = parDate[j.date] || []).push(j); });

    /* L'horizon couvre deux semaines, et s'étend si des journées sont
       ouvertes plus loin : on ne cache jamais une journée déjà créée. */
    var dates = [];
    for (var i = 0; i < HORIZON; i++) dates.push(dateIso(i));
    Object.keys(parDate).forEach(function (d) { if (dates.indexOf(d) === -1) dates.push(d); });
    dates.sort();

    var grille = document.createElement("div");
    grille.className = "semainier";
    var aujourdhui = dateIso(0);

    dates.forEach(function (date) {
      var journees = parDate[date] || [];
      var col = document.createElement("section");
      col.className = "jourcol" + (journees.length ? "" : " est-vide") +
        (date === aujourdhui ? " est-aujourdhui" : "");

      var m = morceaux(date);
      var tete = document.createElement("div");
      tete.className = "jourcol__tete";
      tete.innerHTML =
        '<span class="jourcol__nom">' + JOURS_SEM[m.semaine] +
          (date === aujourdhui ? " · aujourd\u2019hui" : "") + '</span>' +
        '<span class="jourcol__date">' + m.jour + ' <span style="font-size:.6em;font-weight:600">' +
          MOIS_COURTS[m.mois - 1] + '</span></span>';
      col.appendChild(tete);

      if (!journees.length) {
        var repos = document.createElement("div");
        repos.className = "jourcol__repos";
        repos.innerHTML = 'Repos<br><button class="outil outil--doux" type="button" style="margin-top:9px">Ouvrir</button>';
        repos.querySelector("button").addEventListener("click", function () {
          $("#date").value = date;
          $("#date").scrollIntoView({ behavior: "smooth", block: "center" });
          $("#date").focus();
        });
        col.appendChild(repos);
        grille.appendChild(col);
        return;
      }

      journees.forEach(function (j) {
        var lieu = document.createElement("div");
        lieu.className = "jourcol__tete";
        lieu.style.borderTop = "1px solid var(--bord)";
        lieu.style.paddingTop = "10px";
        var libres = j.creneaux.filter(function (c) { return !c.reserve; }).length;
        lieu.innerHTML = '<span class="jourcol__lieu"><span class="plage__pastille" data-teinte="' +
          echapper(j.lieu.teinte || "vert") + '"></span>' + echapper(j.lieu.libelle) +
          ' · ' + libres + (libres > 1 ? " libres" : " libre") + '</span>';

        var outils = document.createElement("div");
        outils.style.cssText = "display:flex;gap:6px;margin-top:9px";
        var masquer = document.createElement("button");
        masquer.type = "button"; masquer.className = "outil";
        masquer.textContent = j.statut === "masquee" ? "Afficher" : "Masquer";
        masquer.addEventListener("click", function () { basculerJournee(j); });
        var supprimer = document.createElement("button");
        supprimer.type = "button"; supprimer.className = "outil outil--danger";
        supprimer.textContent = "Supprimer";
        supprimer.addEventListener("click", function () { supprimerJournee(j); });
        outils.appendChild(masquer); outils.appendChild(supprimer);
        lieu.appendChild(outils);
        col.appendChild(lieu);

        var corps = document.createElement("div");
        corps.className = "jourcol__corps";
        j.creneaux.forEach(function (c) { corps.appendChild(carteCreneau(j, c)); });
        col.appendChild(corps);

        var ajout = document.createElement("form");
        ajout.className = "jourcol__ajout";
        ajout.innerHTML = '<input type="text" data-horaires placeholder="14h  15h30" ' +
          'aria-label="Horaires à ajouter" autocomplete="off">' +
          '<button class="outil" type="submit">Ajouter</button>';
        ajout.addEventListener("submit", function (e) {
          e.preventDefault();
          var champ = ajout.querySelector("[data-horaires]");
          var lecture = lireHoraires(champ.value);
          if (lecture.mauvaises.length) { dire("Horaire non compris : " + lecture.mauvaises.join(", ") + ".", true); return; }
          if (!lecture.bonnes.length) { dire("Aucun horaire saisi.", true); return; }
          appeler("/api/admin/creneaux", { method: "POST",
            body: JSON.stringify({ journeeId: j.id, heures: lecture.bonnes }) })
            .then(function (r) {
              if (gererSession(r)) return;
              if (!r.ok) { dire(messageErreur(r, "Ajout refusé."), true); return; }
              champ.value = "";
              dire(lecture.bonnes.length + " horaire" + (lecture.bonnes.length > 1 ? "s ajoutés" : " ajouté") + ".");
              chargerPlanning();
            });
        });
        col.appendChild(ajout);
      });

      grille.appendChild(col);
    });

    vues.planning.appendChild(grille);
  }

  function carteCreneau(journee, creneau) {
    var carte = document.createElement("div");
    carte.className = "creneau " + (creneau.suite ? "est-suite" : (creneau.reserve ? "est-reserve" : "est-libre"));

    var heure = document.createElement("span");
    heure.className = "creneau__heure";
    heure.textContent = creneau.heure;
    carte.appendChild(heure);

    var etatTexte = document.createElement("span");
    etatTexte.className = "creneau__etat";
    if (creneau.suite) etatTexte.textContent = "suite du cours";
    else if (creneau.reserve) etatTexte.textContent = creneau.client ? creneau.client.nom : "réservé";
    else etatTexte.textContent = dureeMax(journee, creneau) || "aucune formule ne tient";
    carte.appendChild(etatTexte);

    if (!creneau.suite) {
      var retirer = document.createElement("button");
      retirer.type = "button";
      retirer.className = "creneau__retirer";
      retirer.setAttribute("aria-label", "Retirer le créneau de " + creneau.heure);
      retirer.innerHTML = "&times;";
      retirer.addEventListener("click", function () { supprimerCreneau(journee, creneau); });
      carte.appendChild(retirer);
    }

    if (!creneau.reserve) return carte;

    /* Un créneau réservé porte quelqu'un : son nom, son téléphone et sa
       formule doivent se lire sans cliquer. */
    var bloc = document.createElement("div");
    bloc.appendChild(carte);
    if (creneau.client) {
      var c = creneau.client;
      var fiche = document.createElement("div");
      fiche.className = "client";
      fiche.innerHTML =
        '<div class="client__ligne"><a href="tel:' + echapper(c.telephone.replace(/[^0-9+]/g, "")) + '">' +
          echapper(c.telephone) + '</a></div>' +
        '<div class="client__ligne">' + echapper(c.formule) + ', ' + echapper(c.dureeTexte) +
          ' · ' + echapper(c.prixTexte) + '</div>' +
        (c.message ? '<div class="client__ligne">« ' + echapper(c.message) + ' »</div>' : '');
      bloc.appendChild(fiche);
    }
    return bloc;
  }

  /* ---------------------------------------------------------------- Actions */
  function modifierHeure(creneau) {
    var saisie = window.prompt("Nouvel horaire pour " + creneau.heure, creneau.heure);
    if (saisie === null) return;
    var heure = normaliserHeure(saisie);
    if (!heure) { dire("Horaire non compris.", true); return; }

    appeler("/api/admin/creneaux", {
      method: "PATCH",
      body: JSON.stringify({ id: creneau.id, heure: heure })
    }).then(function (r) {
      if (gererSession(r)) return;
      if (!r.ok) { dire((r.corps && r.corps.message) || "Modification refusée.", true); return; }
      dire("Horaire déplacé à " + heure + ".");
      chargerPlanning();
    });
  }

  function supprimerCreneau(journee, creneau) {
    if (!creneau.reserve) {
      if (!window.confirm("Retirer le créneau de " + creneau.heure + " ?")) return;
      envoyerSuppression(creneau.id, false);
      return;
    }
    /* Derrière une ligne réservée il y a quelqu'un : on le nomme avant de
       laisser Nils décider. */
    var c = creneau.client || {};
    var message = "Le créneau de " + creneau.heure + " est réservé par " + (c.nom || "un client") +
      (c.telephone ? " (" + c.telephone + ")" : "") +
      ".\n\nLe retirer annule la réservation. Prévenez-le d'abord.\n\nRetirer quand même ?";
    if (!window.confirm(message)) return;
    envoyerSuppression(creneau.id, true);
  }

  function envoyerSuppression(id, force) {
    appeler("/api/admin/creneaux?id=" + encodeURIComponent(id) + (force ? "&force=1" : ""), {
      method: "DELETE"
    }).then(function (r) {
      if (gererSession(r)) return;
      if (!r.ok) { dire((r.corps && r.corps.message) || "Suppression refusée.", true); return; }
      dire("Créneau retiré.");
      chargerPlanning();
    });
  }

  function basculerJournee(journee) {
    var statut = journee.statut === "masquee" ? "ouverte" : "masquee";
    appeler("/api/admin/journees", {
      method: "PATCH",
      body: JSON.stringify({ id: journee.id, statut: statut })
    }).then(function (r) {
      if (gererSession(r)) return;
      if (!r.ok) { dire("Changement refusé.", true); return; }
      dire(statut === "masquee"
        ? "Journée masquée : elle n'apparaît plus aux clients."
        : "Journée de nouveau visible.");
      chargerPlanning();
    });
  }

  function supprimerJournee(journee) {
    if (!window.confirm("Supprimer le " + journee.dateTexte + " à " + journee.lieu.libelle + " ?")) return;

    appeler("/api/admin/journees?id=" + encodeURIComponent(journee.id), { method: "DELETE" })
      .then(function (r) {
        if (gererSession(r)) return;

        /* Le serveur refuse une première fois si des clients sont concernés,
           et renvoie leur liste. On la montre avant de redemander. */
        if (r.statut === 409 && r.corps && r.corps.clients) {
          var liste = r.corps.clients.map(function (c) {
            return "  " + c.heure + " — " + c.nom + (c.telephone ? " (" + c.telephone + ")" : "");
          }).join("\n");
          var message = "Cette journée porte des réservations :\n\n" + liste +
            "\n\nLa supprimer les annule sans prévenir personne.\nSupprimer quand même ?";
          if (!window.confirm(message)) return;
          appeler("/api/admin/journees?id=" + encodeURIComponent(journee.id) + "&force=1", { method: "DELETE" })
            .then(function (r2) {
              if (gererSession(r2)) return;
              if (!r2.ok) { dire("Suppression refusée.", true); return; }
              dire("Journée supprimée.");
              chargerPlanning();
            });
          return;
        }

        if (!r.ok) { dire((r.corps && r.corps.message) || "Suppression refusée.", true); return; }
        dire("Journée supprimée.");
        chargerPlanning();
      });
  }

  /* ==========================================================================
     Les réglages : prestations et lieux.

     Ces deux tables étaient jusqu'ici figées dans le schéma SQL, modifiables
     seulement en rejouant un fichier dans Supabase. Elles se pilotent
     maintenant d'ici. La page publique les relit à chaque chargement : un
     prix changé est en ligne à la seconde suivante, sans redéploiement.

     Une ligne retirée n'est pas effacée. Les réservations et les journées
     passées la référencent ; on la désactive, elle quitte le site et garde
     son histoire.
     ========================================================================== */

  function chargerReglages() {
    Promise.all([appeler("/api/admin/formules"), appeler("/api/admin/lieux")])
      .then(function (reponses) {
        var rf = reponses[0], rl = reponses[1];
        if (gererSession(rf) || gererSession(rl)) return;
        if (rf.ok) { etat.formules = rf.corps.formules || []; rendreFormules(); }
        if (rl.ok) { etat.tousLieux = rl.corps.lieux || []; rendreLieux(); remplirLieux(); }
        /* Le planning affiche la durée réservable de chaque créneau, qui se
           calcule à partir des formules. Les deux chargements partent en
           parallèle : si les formules arrivent après, il faut redessiner,
           sinon chaque créneau libre annonce « aucune formule ne tient ». */
        if (rf.ok && etat.journees.length) rendrePlanning();
        if (rl.ok && etat.plages.length) rendrePlages();
      })
      .catch(function () { dire("Les réglages n'ont pas pu être chargés.", true); });
  }

  /* Une ligne de réglage : l'état lisible, et un formulaire d'édition replié
     dessous. On ne passe pas par window.prompt : cinq champs ne se saisissent
     pas dans une boîte de dialogue, encore moins sur un téléphone. */
  function ligneReglage(options) {
    var ligne = document.createElement("div");
    ligne.className = "reglage" + (options.actif ? "" : " est-retire");

    var resume = document.createElement("div");
    resume.className = "reglage__resume";
    resume.innerHTML =
      '<div class="reglage__nom">' + echapper(options.nom) +
        (options.actif ? "" : ' <span class="reglage__retire">retiré</span>') + '</div>' +
      '<div class="reglage__detail">' + options.detail + '</div>';
    ligne.appendChild(resume);

    var outils = document.createElement("div");
    outils.className = "reglage__outils";

    var editer = document.createElement("button");
    editer.type = "button"; editer.className = "outil"; editer.textContent = "Modifier";
    outils.appendChild(editer);

    var bascule = document.createElement("button");
    bascule.type = "button"; bascule.className = "outil";
    bascule.textContent = options.actif ? "Retirer" : "Remettre";
    if (options.actif) bascule.className += " outil--danger";
    bascule.addEventListener("click", options.surBascule);
    outils.appendChild(bascule);

    resume.appendChild(outils);

    var edition = document.createElement("form");
    edition.className = "reglage__edition";
    edition.hidden = true;
    edition.innerHTML = options.champs +
      '<p class="reglage__actions">' +
      '<button class="outil" type="submit">Enregistrer</button>' +
      '<button class="outil" type="button" data-annuler>Annuler</button></p>';
    edition.addEventListener("submit", function (e) { e.preventDefault(); options.surEnregistrer(edition); });
    edition.querySelector("[data-annuler]").addEventListener("click", function () { edition.hidden = true; });
    ligne.appendChild(edition);

    editer.addEventListener("click", function () {
      edition.hidden = !edition.hidden;
      if (!edition.hidden) { var p = edition.querySelector("input"); if (p) p.focus(); }
    });
    return ligne;
  }

  function champ(etiquette, nom, valeur, attributs) {
    return '<label class="reglage__champ"><span>' + echapper(etiquette) + '</span>' +
      '<input data-champ="' + nom + '" value="' + echapper(valeur) + '" ' +
      (attributs || "") + ' autocomplete="off"></label>';
  }

  function lire(edition, nom) {
    var e = edition.querySelector('[data-champ="' + nom + '"]');
    return e ? e.value : undefined;
  }

  /* ------------------------------------------------------------ Prestations */
  function rendreFormules() {
    vues.listeFormules.textContent = "";
    var actives = etat.formules.filter(function (f) { return f.actif; }).length;
    vues.compteFormules.textContent = actives + (actives > 1 ? " actives" : " active");

    etat.formules.forEach(function (f) {
      vues.listeFormules.appendChild(ligneReglage({
        nom: f.libelle,
        actif: f.actif,
        detail: echapper(f.dureeTexte) + " · " +
                (f.personnes > 1 ? f.personnes + " personnes" : "1 personne") +
                ' · <strong>' + echapper(f.prixTexte) + "</strong>",
        champs:
          champ("Nom", "libelle", f.libelle, 'type="text"') +
          champ("Personnes", "personnes", f.personnes, 'type="number" min="1" max="12" inputmode="numeric"') +
          champ("Durée", "duree", f.dureeMinutes >= 60 && f.dureeMinutes % 60 === 0
            ? (f.dureeMinutes / 60) + "h" : f.dureeMinutes, 'type="text"') +
          champ("Prix", "prix", f.prixSaisie, 'type="text" inputmode="decimal"'),
        surBascule: function () { basculerFormule(f); },
        surEnregistrer: function (edition) {
          appeler("/api/admin/formules", {
            method: "PATCH",
            body: JSON.stringify({
              code: f.code,
              libelle: lire(edition, "libelle"),
              personnes: Number(lire(edition, "personnes")),
              duree: lire(edition, "duree"),
              prix: lire(edition, "prix")
            })
          }).then(function (r) {
            if (gererSession(r)) return;
            if (!r.ok) { dire(messageErreur(r, "Prestation non modifiée."), true); return; }
            dire("« " + r.corps.formule.libelle + " » enregistrée à " + r.corps.formule.prixTexte + ".");
            chargerReglages();
          });
        }
      }));
    });
  }

  function basculerFormule(f) {
    if (f.actif && !window.confirm("Retirer « " + f.libelle + " » du site ?\n\nElle disparaît des formules proposées. Les réservations déjà prises ne bougent pas.")) return;
    var action = f.actif
      ? appeler("/api/admin/formules?code=" + encodeURIComponent(f.code), { method: "DELETE" })
      : appeler("/api/admin/formules", { method: "PATCH", body: JSON.stringify({ code: f.code, actif: true }) });
    action.then(function (r) {
      if (gererSession(r)) return;
      if (!r.ok) { dire(messageErreur(r, "Changement refusé."), true); return; }
      dire(f.actif ? "Prestation retirée du site." : "Prestation remise en ligne.");
      chargerReglages();
    });
  }

  vues.formuleNouvelle.addEventListener("submit", function (e) {
    e.preventDefault();
    appeler("/api/admin/formules", {
      method: "POST",
      body: JSON.stringify({
        libelle: $("#f-libelle").value,
        personnes: Number($("#f-personnes").value),
        duree: $("#f-duree").value,
        prix: $("#f-prix").value
      })
    }).then(function (r) {
      if (gererSession(r)) return;
      if (!r.ok) { dire(messageErreur(r, "Prestation non créée."), true); return; }
      $("#f-libelle").value = ""; $("#f-duree").value = ""; $("#f-prix").value = "";
      dire("« " + r.corps.formule.libelle + " » ajoutée à " + r.corps.formule.prixTexte + ".");
      chargerReglages();
    });
  });

  /* ------------------------------------------------------------------ Lieux */
  function rendreLieux() {
    vues.listeLieux.textContent = "";
    var actifs = etat.tousLieux.filter(function (l) { return l.actif; }).length;
    vues.compteLieux.textContent = actifs + (actifs > 1 ? " actifs" : " actif");

    etat.tousLieux.forEach(function (l) {
      vues.listeLieux.appendChild(ligneReglage({
        nom: l.libelle,
        actif: l.actif,
        detail: '<span class="reglage__teinte" data-teinte="' + echapper(l.teinte) + '"></span>' +
                echapper(l.ville) +
                (l.journees ? " · " + l.journees + (l.journees > 1 ? " journées" : " journée") : " · aucune journée"),
        champs:
          champ("Nom", "libelle", l.libelle, 'type="text"') +
          champ("Ville", "ville", l.ville, 'type="text"') +
          '<label class="reglage__champ"><span>Repère</span>' +
          '<select data-champ="teinte">' +
          '<option value="vert"' + (l.teinte === "vert" ? " selected" : "") + '>Vert</option>' +
          '<option value="sable"' + (l.teinte === "sable" ? " selected" : "") + '>Sable</option>' +
          '</select></label>',
        surBascule: function () { basculerLieu(l); },
        surEnregistrer: function (edition) {
          appeler("/api/admin/lieux", {
            method: "PATCH",
            body: JSON.stringify({
              code: l.code,
              libelle: lire(edition, "libelle"),
              ville: lire(edition, "ville"),
              teinte: edition.querySelector('[data-champ="teinte"]').value
            })
          }).then(function (r) {
            if (gererSession(r)) return;
            if (!r.ok) { dire(messageErreur(r, "Lieu non modifié."), true); return; }
            dire("« " + r.corps.lieu.libelle + " » enregistré.");
            chargerReglages(); chargerPlanning();
          });
        }
      }));
    });
  }

  function basculerLieu(l) {
    if (l.actif && !window.confirm("Retirer « " + l.libelle + " » ?\n\nIl disparaît du site et de la liste des journées. Les journées déjà tenues là-bas restent dans votre planning.")) return;
    var action = l.actif
      ? appeler("/api/admin/lieux?code=" + encodeURIComponent(l.code), { method: "DELETE" })
      : appeler("/api/admin/lieux", { method: "PATCH", body: JSON.stringify({ code: l.code, actif: true }) });
    action.then(function (r) {
      if (gererSession(r)) return;
      if (!r.ok) { dire(messageErreur(r, "Changement refusé."), true); return; }
      dire(l.actif ? "Lieu retiré." : "Lieu remis en service.");
      chargerReglages(); chargerPlanning();
    });
  }

  vues.lieuNouveau.addEventListener("submit", function (e) {
    e.preventDefault();
    appeler("/api/admin/lieux", {
      method: "POST",
      body: JSON.stringify({
        libelle: $("#l-libelle").value,
        ville: $("#l-ville").value,
        teinte: $("#l-teinte").value
      })
    }).then(function (r) {
      if (gererSession(r)) return;
      if (!r.ok) { dire(messageErreur(r, "Lieu non créé."), true); return; }
      $("#l-libelle").value = ""; $("#l-ville").value = "";
      dire("« " + r.corps.lieu.libelle + " » ajouté.");
      chargerReglages(); chargerPlanning();
    });
  });

  function messageErreur(r, defaut) {
    if (r.corps && r.corps.message) return r.corps.message;
    if (r.corps && r.corps.champs) return "Champ incorrect : " + r.corps.champs.join(", ") + ".";
    return defaut;
  }

  /* ==========================================================================
     La semaine type.

     Ce n'est pas une règle de disponibilité permanente, et la nuance est
     volontaire : c'est un gabarit qu'on applique pour fabriquer de vraies
     journées. Nils peut ensuite annuler un jeudi, décaler une heure, sans
     toucher au gabarit — et le planning reste une suite de journées
     concrètes, pas une abstraction à interpréter.
     ========================================================================== */

  var NOMS_JOURS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

  function chargerSemaine() {
    appeler("/api/admin/semaine").then(function (r) {
      if (gererSession(r)) return;
      if (!r.ok) { dire(messageErreur(r, "Semaine type illisible."), true); return; }
      etat.plages = r.corps.plages || [];
      remplirPlageLieux(r.corps.lieux || []);
      rendrePlages();
    }).catch(function () { dire("La connexion a échoué.", true); });
  }

  function remplirPlageLieux(lieux) {
    if (!vues.plageLieux) return;
    var choix = vues.plageLieux.value;
    vues.plageLieux.textContent = "";
    lieux.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l.code;
      o.textContent = (l.libelle || "").toLowerCase().indexOf((l.ville || "").toLowerCase()) === -1
        ? l.libelle + ", " + l.ville : l.libelle;
      vues.plageLieux.appendChild(o);
    });
    if (choix) vues.plageLieux.value = choix;
  }

  function rendrePlages() {
    vues.plages.textContent = "";
    var actives = etat.plages.filter(function (p) { return p.actif; });
    var total = actives.reduce(function (n, p) { return n + p.creneaux; }, 0);
    vues.semaineCompte.textContent = actives.length
      ? actives.length + (actives.length > 1 ? " plages" : " plage") + " · " + total + " créneaux par semaine"
      : "aucune plage";

    if (!etat.plages.length) {
      vues.plages.innerHTML = '<p class="semaine__note" style="margin:0">' +
        'Aucune plage pour l\u2019instant. Ajoutez vos fenêtres de disponibilité ci-dessous.</p>';
      return;
    }

    etat.plages.forEach(function (p) {
      var ligne = document.createElement("div");
      ligne.className = "plage" + (p.actif ? "" : " est-inactive");
      var teinte = (etat.tousLieux.find(function (l) { return l.code === p.lieu; }) || {}).teinte || "vert";
      ligne.innerHTML =
        '<span class="plage__jour">' + echapper(p.jourNom) + '</span>' +
        '<span class="plage__heures">' + echapper(p.debut) + ' → ' + echapper(p.fin) + '</span>' +
        '<span class="plage__lieu"><span class="plage__pastille" data-teinte="' + echapper(teinte) +
          '"></span>' + echapper(p.lieuNom) + '</span>' +
        '<span class="plage__compte">' + p.creneaux + ' × ' +
          (p.pas % 60 === 0 ? (p.pas / 60) + " h" : p.pas + " min") + '</span>';

      var outils = document.createElement("div");
      outils.className = "plage__outils";
      var retirer = document.createElement("button");
      retirer.type = "button"; retirer.className = "outil outil--danger"; retirer.textContent = "Retirer";
      retirer.addEventListener("click", function () {
        if (!window.confirm("Retirer la plage du " + p.jourNom + " " + p.debut + " → " + p.fin + " ?\n\nLes journées déjà fabriquées ne bougent pas.")) return;
        appeler("/api/admin/semaine?id=" + encodeURIComponent(p.id), { method: "DELETE" })
          .then(function (r) {
            if (gererSession(r)) return;
            if (!r.ok) { dire(messageErreur(r, "Suppression refusée."), true); return; }
            dire("Plage retirée de la semaine type.");
            chargerSemaine();
          });
      });
      outils.appendChild(retirer);
      ligne.appendChild(outils);
      vues.plages.appendChild(ligne);
    });
  }

  vues.plageNouvelle.addEventListener("submit", function (e) {
    e.preventDefault();
    appeler("/api/admin/semaine", {
      method: "POST",
      body: JSON.stringify({
        jour: Number($("#p-jour").value),
        lieu: $("#p-lieu").value,
        debut: $("#p-debut").value,
        fin: $("#p-fin").value,
        pas: Number($("#p-pas").value)
      })
    }).then(function (r) {
      if (gererSession(r)) return;
      if (!r.ok) { dire(messageErreur(r, "Plage non ajoutée."), true); return; }
      dire("Plage du " + r.corps.plage.jourNom + " ajoutée : " + r.corps.plage.creneaux + " créneaux.");
      chargerSemaine();
    });
  });

  $("[data-appliquer]").addEventListener("click", function () {
    var semaines = Number($("#p-semaines").value) || 4;
    var bouton = $("[data-appliquer]");
    bouton.disabled = true; bouton.textContent = "Fabrication…";
    appeler("/api/admin/semaine?appliquer=" + semaines, { method: "POST" })
      .then(function (r) {
        bouton.disabled = false; bouton.textContent = "Fabriquer les journées";
        if (gererSession(r)) return;
        if (!r.ok) { dire(messageErreur(r, "Application refusée."), true); return; }
        dire(r.corps.journeesCreees + " journée" + (r.corps.journeesCreees > 1 ? "s créées" : " créée") +
             " sur " + r.corps.semaines + " semaines. Les horaires déjà présents n\u2019ont pas bougé.");
        chargerPlanning();
      })
      .catch(function () {
        bouton.disabled = false; bouton.textContent = "Fabriquer les journées";
        dire("La connexion a échoué.", true);
      });
  });

  /* ----------------------------------------------------------------- Départ */
  var demain = new Date();
  demain.setDate(demain.getDate());
  $("#date").min = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(demain);

  majApercu();

  appeler("/api/admin/session").then(function (r) {
    if (r.ok && r.corps && r.corps.connecte) montrerEspace();
    else montrerConnexion();
  }).catch(montrerConnexion);
})();
