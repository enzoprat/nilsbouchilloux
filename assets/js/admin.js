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
    lieuNouveau: $("[data-lieu-nouveau]")
  };

  var etat = { lieux: [], journees: [], formules: [], tousLieux: [] };

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
  function serie(debutBrut, finBrut, pas) {
    var debut = normaliserHeure(debutBrut), fin = normaliserHeure(finBrut);
    if (!debut || !fin) { dire("Indiquez un début et une fin.", true); return null; }
    var m = function (h) { var p = h.split(":"); return +p[0] * 60 + +p[1]; };
    var debutM = m(debut), finM = m(fin);
    if (finM <= debutM) { dire("La fin doit venir après le début.", true); return null; }
    if (!pas || pas < 5) pas = 60;
    if ((finM - debutM) / pas > 40) { dire("Cela ferait plus de quarante créneaux.", true); return null; }
    var sortie = [];
    for (var t = debutM; t <= finM; t += pas) {
      sortie.push(String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"));
    }
    return sortie;
  }

  $("[data-serie]").addEventListener("click", function () {
    var sortie = serie($("#serie-debut").value, $("#serie-fin").value, Number($("#serie-pas").value));
    if (sortie) $("#horaires").value = sortie.join("  ");
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

  function rendrePlanning() {
    vues.planning.textContent = "";
    vues.planningVide.hidden = etat.journees.length > 0;

    etat.journees.forEach(function (j) {
      var bloc = document.createElement("section");
      bloc.className = "jour-admin" + (j.statut === "masquee" ? " est-masquee" : "");
      bloc.setAttribute("data-teinte", j.lieu.teinte || "vert");

      var libres = j.creneaux.filter(function (c) { return !c.reserve; }).length;
      var pris = j.creneaux.length - libres;

      var entete = document.createElement("div");
      entete.className = "jour-admin__entete";
      entete.innerHTML =
        '<span class="jour-admin__pastille" aria-hidden="true"></span>' +
        '<span class="jour-admin__identite">' +
          '<span class="jour-admin__date">' + echapper(j.dateTexte) + '</span>' +
          '<span class="jour-admin__lieu">' + echapper(j.lieu.libelle) + ' · ' +
            libres + ' libre' + (libres > 1 ? 's' : '') +
            (pris ? ' · ' + pris + ' réservé' + (pris > 1 ? 's' : '') : '') + '</span>' +
        '</span>';

      var outils = document.createElement("div");
      outils.className = "jour-admin__outils";

      var masquer = document.createElement("button");
      masquer.type = "button";
      masquer.className = "outil";
      masquer.textContent = j.statut === "masquee" ? "Afficher" : "Masquer";
      masquer.addEventListener("click", function () { basculerJournee(j); });

      var supprimer = document.createElement("button");
      supprimer.type = "button";
      supprimer.className = "outil outil--danger";
      supprimer.textContent = "Supprimer";
      supprimer.addEventListener("click", function () { supprimerJournee(j); });

      outils.appendChild(masquer);
      outils.appendChild(supprimer);
      entete.appendChild(outils);
      bloc.appendChild(entete);

      j.creneaux.forEach(function (c) { bloc.appendChild(ligneCreneau(j, c)); });

      /* Ajout d'horaires à une journée déjà ouverte. */
      var ajout = document.createElement("form");
      ajout.className = "ajout-creneaux";
      ajout.innerHTML =
        '<div class="ajout-creneaux__ligne">' +
          '<input type="text" data-horaires placeholder="10h30  14h  16h" ' +
            'aria-label="Horaires à ajouter" autocomplete="off">' +
          '<button class="outil" type="submit">Ajouter</button>' +
        '</div>' +
        '<div class="ajout-creneaux__plage">' +
          '<span class="tech">Plage</span>' +
          '<input type="time" data-plage-debut value="10:00" aria-label="Début de la plage">' +
          '<span class="tech">à</span>' +
          '<input type="time" data-plage-fin value="15:00" aria-label="Fin de la plage">' +
          '<select data-plage-pas aria-label="Intervalle">' +
            '<option value="30">30 min</option>' +
            '<option value="45">45 min</option>' +
            '<option value="60" selected>1 h</option>' +
            '<option value="90">1 h 30</option>' +
            '<option value="120">2 h</option>' +
          '</select>' +
          '<button class="outil" type="button" data-plage-remplir>Remplir</button>' +
        '</div>';

      ajout.querySelector("[data-plage-remplir]").addEventListener("click", function () {
        var sortie = serie(ajout.querySelector("[data-plage-debut]").value,
                           ajout.querySelector("[data-plage-fin]").value,
                           Number(ajout.querySelector("[data-plage-pas]").value));
        if (!sortie) return;
        ajout.querySelector("[data-horaires]").value = sortie.join("  ");
      });
      ajout.addEventListener("submit", function (e) {
        e.preventDefault();
        var champ = ajout.querySelector("[data-horaires]");
        var lecture = lireHoraires(champ.value);
        if (lecture.mauvaises.length) {
          dire("Horaire non compris : " + lecture.mauvaises.join(", ") + ".", true);
          return;
        }
        if (!lecture.bonnes.length) { dire("Aucun horaire saisi.", true); return; }
        appeler("/api/admin/creneaux", {
          method: "POST",
          body: JSON.stringify({ journeeId: j.id, heures: lecture.bonnes })
        }).then(function (r) {
          if (gererSession(r)) return;
          if (!r.ok) { dire((r.corps && r.corps.message) || "Ajout refusé.", true); return; }
          champ.value = "";
          dire(lecture.bonnes.length + " horaire" + (lecture.bonnes.length > 1 ? "s ajoutés" : " ajouté") + ".");
          chargerPlanning();
        });
      });
      bloc.appendChild(ajout);

      vues.planning.appendChild(bloc);
    });
  }

  function ligneCreneau(journee, creneau) {
    var ligne = document.createElement("div");
    ligne.className = "ligne-creneau" +
      (creneau.suite ? " est-suite" : (creneau.reserve ? " est-reserve" : ""));

    var heure = document.createElement("span");
    heure.className = "ligne-creneau__heure";
    heure.textContent = creneau.heure;
    ligne.appendChild(heure);

    var etatCase = document.createElement("div");
    etatCase.className = "ligne-creneau__etat";

    if (creneau.suite) {
      etatCase.textContent = "Suite du cours précédent";
    } else if (creneau.client) {
      var c = creneau.client;
      /* Une ligne d'information par ligne d'écran. Tout mettre sur une seule
         ligne séparée par des points médians tient sur un ordinateur et se
         casse n'importe comment sur un téléphone. */
      etatCase.innerHTML =
        '<div class="ligne-creneau__client">' + echapper(c.nom) + '</div>' +
        '<div class="ligne-creneau__detail">' +
          '<a href="tel:' + echapper(c.telephone.replace(/[^0-9+]/g, "")) + '">' + echapper(c.telephone) + '</a>' +
        '</div>' +
        '<div class="ligne-creneau__detail">' +
          echapper(c.formule) + ', ' + echapper(c.dureeTexte) + ' · ' + echapper(c.prixTexte) +
        '</div>' +
        (c.message ? '<div class="ligne-creneau__detail">« ' + echapper(c.message) + ' »</div>' : '');
    } else {
      /* « Libre » plutôt que « Disponible » : le mot doit tenir sur la ligne
         à côté des deux boutons, sur un écran de 360 px. */
      etatCase.innerHTML = '<span class="ligne-creneau__libre">Libre</span>';
    }
    ligne.appendChild(etatCase);

    var outils = document.createElement("div");
    outils.className = "ligne-creneau__outils";

    if (!creneau.reserve) {
      var modifier = document.createElement("button");
      modifier.type = "button";
      modifier.className = "outil";
      modifier.textContent = "Heure";
      modifier.addEventListener("click", function () { modifierHeure(creneau); });
      outils.appendChild(modifier);
    }

    if (!creneau.suite) {
      var retirer = document.createElement("button");
      retirer.type = "button";
      retirer.className = "outil outil--danger";
      retirer.textContent = "Retirer";
      retirer.addEventListener("click", function () { supprimerCreneau(journee, creneau); });
      outils.appendChild(retirer);
    }

    ligne.appendChild(outils);
    return ligne;
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

  /* ----------------------------------------------------------------- Départ */
  var demain = new Date();
  demain.setDate(demain.getDate());
  $("#date").min = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(demain);

  appeler("/api/admin/session").then(function (r) {
    if (r.ok && r.corps && r.corps.connecte) montrerEspace();
    else montrerConnexion();
  }).catch(montrerConnexion);
})();
