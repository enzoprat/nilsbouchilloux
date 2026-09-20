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
    planningVide: $("[data-planning-vide]")
  };

  var etat = { lieux: [], journees: [] };

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

  /* Générateur de série : remplir « 9 h à 17 h toutes les heures » sans
     taper neuf horaires à la main. */
  $("[data-serie]").addEventListener("click", function () {
    var debut = normaliserHeure($("#serie-debut").value);
    var fin = normaliserHeure($("#serie-fin").value);
    var pas = Number($("#serie-pas").value) || 60;
    if (!debut || !fin) { dire("Indiquez un début et une fin.", true); return; }

    var m = function (h) { var p = h.split(":"); return +p[0] * 60 + +p[1]; };
    var debutM = m(debut), finM = m(fin);
    if (finM <= debutM) { dire("La fin doit venir après le début.", true); return; }
    if ((finM - debutM) / pas > 40) { dire("Cela ferait trop de créneaux.", true); return; }

    var sortie = [];
    for (var t = debutM; t <= finM; t += pas) {
      sortie.push(String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"));
    }
    $("#horaires").value = sortie.join("  ");
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
    if (vues.lieux.options.length === etat.lieux.length && vues.lieux.options.length) return;
    vues.lieux.textContent = "";
    etat.lieux.forEach(function (l) {
      var option = document.createElement("option");
      option.value = l.code;
      option.textContent = (l.libelle || "").toLowerCase().indexOf((l.ville || "").toLowerCase()) === -1
        ? l.libelle + ", " + l.ville : l.libelle;
      vues.lieux.appendChild(option);
    });
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
      ajout.innerHTML = '<input type="text" placeholder="10h30  14h  16h" ' +
        'aria-label="Horaires à ajouter" autocomplete="off">' +
        '<button class="outil" type="submit">Ajouter</button>';
      ajout.addEventListener("submit", function (e) {
        e.preventDefault();
        var champ = ajout.querySelector("input");
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
