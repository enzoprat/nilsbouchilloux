/* ==========================================================================
   Nils Bouchilloux — parcours de réservation

   Une seule page qui se déroule vers le bas. Pas d'assistant en quatre
   écrans, pas de bouton « suivant » : chaque choix fait apparaître le
   suivant, et la page descend d'elle-même. Sur un téléphone ouvert depuis
   un SMS, c'est la différence entre trois gestes et douze.

   Le serveur reste seul juge. Ce fichier propose ce qui semble libre ;
   c'est la base qui tranche au moment de valider, et si elle refuse, on le
   dit franchement et on recharge.
   ========================================================================== */
(function () {
  "use strict";

  var doux = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var etat = {
    journees: [],
    formules: [],
    jour: null,
    creneau: null,
    formule: null,
    envoiEnCours: false
  };

  var $ = function (selecteur, racine) {
    return (racine || document).querySelector(selecteur);
  };

  var vues = {
    chargement: $("[data-chargement]"),
    vide: $("[data-vide]"),
    erreur: $("[data-erreur]"),
    erreurMessage: $("[data-erreur-message]"),
    flux: $("[data-flux]"),
    jours: $("[data-jours]"),
    plaque: $("[data-plaque]"),
    heures: $("[data-heures]"),
    formules: $("[data-formules]"),
    formulaire: $("[data-formulaire]"),
    recapLignes: $("[data-recap-lignes]"),
    erreurEnvoi: $("[data-erreur-envoi]"),
    envoyer: $("[data-envoyer]"),
    confirmation: $("[data-confirmation]"),
    confirmationRecap: $("[data-confirmation-recap]"),
    confirmationSuite: $("[data-confirmation-suite]"),
    rappel: $("[data-rappel]"),
    rappelTexte: $("[data-rappel-texte]"),
    rappelPrix: $("[data-rappel-prix]")
  };

  function etape(nom) { return document.querySelector('[data-etape="' + nom + '"]'); }

  function montrer(element, visible) {
    if (element) element.hidden = !visible;
  }

  function versEtape(nom) {
    var bloc = etape(nom);
    if (!bloc) return;
    window.requestAnimationFrame(function () {
      var haut = bloc.getBoundingClientRect().top + window.pageYOffset - 84;
      window.scrollTo({ top: haut, behavior: doux ? "smooth" : "auto" });
    });
  }

  /* ------------------------------------------------------------------ Réseau */
  function appeler(url, options) {
    return fetch(url, Object.assign({ headers: { "content-type": "application/json" } }, options || {}))
      .then(function (reponse) {
        return reponse.json().catch(function () { return {}; }).then(function (corps) {
          return { ok: reponse.ok, statut: reponse.status, corps: corps };
        });
      });
  }

  function charger() {
    montrer(vues.erreur, false);
    montrer(vues.vide, false);
    montrer(vues.chargement, true);

    return appeler("/api/disponibilites").then(function (r) {
      montrer(vues.chargement, false);
      if (!r.ok) {
        vues.erreurMessage.textContent = (r.corps && r.corps.message) ||
          "Le planning est momentanément indisponible.";
        montrer(vues.erreur, true);
        return false;
      }
      etat.journees = r.corps.journees || [];
      etat.formules = r.corps.formules || [];
      if (!etat.journees.length) {
        montrer(vues.vide, true);
        return false;
      }
      montrer(vues.flux, true);
      rendreJours();
      return true;
    }).catch(function () {
      montrer(vues.chargement, false);
      vues.erreurMessage.textContent = "La connexion a échoué.";
      montrer(vues.erreur, true);
      return false;
    });
  }

  /* ------------------------------------------------------------ Les journées */
  var JOURS_COURTS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
  var MOIS_COURTS = ["janv", "févr", "mars", "avr", "mai", "juin",
                     "juil", "août", "sept", "oct", "nov", "déc"];

  /* « 2026-10-12 » est une date de calendrier, pas un instant : on la
     découpe plutôt que de la confier à new Date(chaîne), qui la lirait en
     UTC et reculerait d'un jour une partie de l'année. */
  function morceaux(iso) {
    var p = String(iso).split("-");
    return {
      annee: Number(p[0]), mois: Number(p[1]), jour: Number(p[2]),
      semaine: new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).getUTCDay()
    };
  }

  function rendreJours() {
    vues.jours.textContent = "";
    etat.journees.forEach(function (j) {
      var d = morceaux(j.date);
      var bouton = document.createElement("button");
      bouton.type = "button";
      bouton.className = "jour";
      bouton.setAttribute("data-teinte", j.lieu.teinte || "vert");
      bouton.setAttribute("aria-pressed", "false");
      bouton.setAttribute("aria-label",
        j.dateTexte + ", " + j.lieu.libelle + ", " + j.creneaux.length + " créneaux libres");
      /* Le lieu figure sur la case elle-même : la couleur seule ne suffit
         pas à le dire, et personne ne devrait avoir à cliquer pour savoir
         où il jouerait. */
      bouton.innerHTML =
        '<span class="jour__sem">' + JOURS_COURTS[d.semaine] + '</span>' +
        '<span class="jour__num">' + d.jour + '</span>' +
        '<span class="jour__mois">' + MOIS_COURTS[d.mois - 1] + '</span>' +
        '<span class="jour__lieu">' + echapper((j.lieu.ville || j.lieu.libelle).toUpperCase()) + '</span>' +
        '<span class="jour__marque" aria-hidden="true"></span>';
      bouton.addEventListener("click", function () { choisirJour(j, bouton); });
      vues.jours.appendChild(bouton);
    });
  }

  function choisirJour(journee, bouton) {
    etat.jour = journee;
    etat.creneau = null;
    etat.formule = null;

    Array.prototype.forEach.call(vues.jours.children, function (b) {
      var actif = b === bouton;
      b.classList.toggle("est-choisi", actif);
      b.setAttribute("aria-pressed", actif ? "true" : "false");
    });

    vues.plaque.setAttribute("data-teinte", journee.lieu.teinte || "vert");
    $("[data-plaque-nom]").textContent = journee.lieu.libelle;
    $("[data-plaque-ville]").textContent = journee.lieu.ville;
    $("[data-plaque-reste]").textContent = journee.creneaux.length +
      (journee.creneaux.length > 1 ? " créneaux libres" : " créneau libre");
    montrer(vues.plaque, true);

    rendreHeures();
    montrer(etape("heure"), true);
    montrer(etape("formule"), false);
    montrer(etape("coordonnees"), false);
    majRappel();
    versEtape("heure");
  }

  /* ------------------------------------------------------------ Les horaires */
  function rendreHeures() {
    vues.heures.textContent = "";
    etat.jour.creneaux.forEach(function (c) {
      var bouton = document.createElement("button");
      bouton.type = "button";
      bouton.className = "heure";
      bouton.setAttribute("aria-pressed", "false");
      bouton.setAttribute("aria-label", c.heureTexte + ", " + etat.jour.dateTexte);
      bouton.textContent = c.heure;
      bouton.addEventListener("click", function () { choisirHeure(c, bouton); });
      vues.heures.appendChild(bouton);
    });
    completerGrille();
  }

  /* Le nombre de colonnes dépend de la largeur : on le relit plutôt que de
     le supposer, et on complète la dernière ligne avec des cases muettes. */
  function completerGrille() {
    if (!vues.heures.children.length) return;
    Array.prototype.slice.call(vues.heures.querySelectorAll(".heure--vide"))
      .forEach(function (v) { v.remove(); });
    var colonnes = window.getComputedStyle(vues.heures).gridTemplateColumns.split(" ").length;
    var manquantes = (colonnes - (vues.heures.children.length % colonnes)) % colonnes;
    for (var i = 0; i < manquantes; i++) {
      var vide = document.createElement("span");
      vide.className = "heure heure--vide";
      vide.setAttribute("aria-hidden", "true");
      vues.heures.appendChild(vide);
    }
  }

  var minuteurGrille;
  window.addEventListener("resize", function () {
    clearTimeout(minuteurGrille);
    minuteurGrille = setTimeout(completerGrille, 120);
  });

  function choisirHeure(creneau, bouton) {
    etat.creneau = creneau;
    etat.formule = null;

    Array.prototype.forEach.call(vues.heures.children, function (b) {
      var actif = b === bouton;
      b.classList.toggle("est-choisi", actif);
      b.setAttribute("aria-pressed", actif ? "true" : "false");
    });

    rendreFormules();
    montrer(etape("formule"), true);
    montrer(etape("coordonnees"), false);
    majRappel();
    versEtape("formule");
  }

  /* ------------------------------------------------------------ Les formules */
  function rendreFormules() {
    vues.formules.textContent = "";
    var plafond = etat.creneau.dureeMax;

    etat.formules.forEach(function (f) {
      var possible = f.dureeMinutes <= plafond;
      var bouton = document.createElement("button");
      bouton.type = "button";
      bouton.className = "formule";
      bouton.setAttribute("aria-pressed", "false");
      if (!possible) bouton.disabled = true;

      var lignes =
        '<span class="formule__nom">' + f.libelle + '</span>' +
        '<span class="formule__prix">' + f.prixTexte + '</span>' +
        '<span class="formule__detail">' + f.dureeTexte + ' · ' +
          (f.personnes > 1 ? f.personnes + ' personnes' : '1 personne') + '</span>';

      /* Dire pourquoi c'est barré. Une option grisée sans explication est la
         chose la plus agaçante d'une réservation en ligne. */
      if (!possible) {
        lignes += '<span class="formule__empeche">Impossible à ' + etat.creneau.heure +
          ' : un autre cours suit de trop près. Essayez un autre horaire.</span>';
      }
      bouton.innerHTML = lignes;

      if (possible) bouton.addEventListener("click", function () { choisirFormule(f, bouton); });
      vues.formules.appendChild(bouton);
    });
  }

  function choisirFormule(formule, bouton) {
    etat.formule = formule;
    Array.prototype.forEach.call(vues.formules.children, function (b) {
      var actif = b === bouton;
      b.classList.toggle("est-choisi", actif);
      b.setAttribute("aria-pressed", actif ? "true" : "false");
    });
    majRecap();
    montrer(etape("coordonnees"), true);
    majRappel();
    versEtape("coordonnees");
  }

  /* --------------------------------------------------- Récapitulatif et rappel */
  function ligneRecap(intitule, valeur, chiffre) {
    return '<div class="recap__ligne">' +
      '<span class="recap__intitule">' + intitule + '</span>' +
      '<span class="recap__valeur' + (chiffre ? ' recap__valeur--chiffre' : '') + '">' + valeur + '</span>' +
    '</div>';
  }

  /* Même règle que côté serveur : ne pas écrire « Golf de Cestas, Cestas ». */
  function lieuComplet(lieu) {
    var nom = lieu.libelle || "";
    var ville = lieu.ville || "";
    if (!ville) return nom;
    return nom.toLowerCase().indexOf(ville.toLowerCase()) === -1 ? nom + ", " + ville : nom;
  }

  function echapper(valeur) {
    var noeud = document.createElement("span");
    noeud.textContent = String(valeur == null ? "" : valeur);
    return noeud.innerHTML;
  }

  function majRecap() {
    if (!etat.jour || !etat.creneau || !etat.formule) return;
    vues.recapLignes.innerHTML =
      ligneRecap("Date", echapper(etat.jour.dateLongue)) +
      ligneRecap("Heure", echapper(etat.creneau.heureTexte), true) +
      ligneRecap("Lieu", echapper(lieuComplet(etat.jour.lieu))) +
      ligneRecap("Formule", echapper(etat.formule.libelle + ", " + etat.formule.dureeTexte)) +
      ligneRecap("Tarif", echapper(etat.formule.prixTexte) + " sur place", true);
  }

  function majRappel() {
    if (!etat.jour || !etat.creneau) {
      vues.rappel.classList.remove("est-visible");
      return;
    }
    vues.rappelTexte.textContent = etat.jour.dateTexte + " · " + etat.creneau.heure +
      " · " + etat.jour.lieu.libelle;
    vues.rappelPrix.textContent = etat.formule ? etat.formule.prixTexte : "";
    vues.rappel.classList.add("est-visible");
  }

  /* -------------------------------------------------------------- Validation */
  function sortieErreur(champ) {
    var groupe = champ.closest(".champ");
    return groupe ? groupe.querySelector("[data-erreur-champ]") : null;
  }

  function valider(champ) {
    var message = "";
    if (champ.validity.valueMissing) {
      message = champ.type === "checkbox" ? "Cette case doit être cochée." : "Ce champ est nécessaire.";
    } else if (champ.type === "email" && champ.value && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(champ.value)) {
      message = "Cette adresse e-mail semble incomplète.";
    } else if (champ.type === "tel" && champ.value.replace(/[^0-9]/g, "").length < 9) {
      message = "Ce numéro semble trop court.";
    } else if (champ.id === "prenom" || champ.id === "nom") {
      if (champ.value.trim().length < 2) message = "Deux lettres au minimum.";
    }
    champ.setAttribute("aria-invalid", message ? "true" : "false");
    var sortie = sortieErreur(champ);
    if (sortie) sortie.textContent = message;
    return !message;
  }

  vues.formulaire.querySelectorAll("input, textarea").forEach(function (champ) {
    champ.addEventListener("blur", function () { valider(champ); });
    champ.addEventListener("input", function () {
      if (champ.getAttribute("aria-invalid") === "true") valider(champ);
    });
  });

  /* ------------------------------------------------------------------- Envoi */
  vues.formulaire.addEventListener("submit", function (evenement) {
    evenement.preventDefault();
    if (etat.envoiEnCours) return;
    vues.erreurEnvoi.textContent = "";

    var valide = true, premier = null;
    vues.formulaire.querySelectorAll("input, textarea").forEach(function (champ) {
      if (!valider(champ)) { valide = false; if (!premier) premier = champ; }
    });
    if (!valide) { if (premier) premier.focus(); return; }

    if (!etat.creneau || !etat.formule) {
      vues.erreurEnvoi.textContent = "Choisissez un horaire et une formule.";
      return;
    }

    etat.envoiEnCours = true;
    vues.envoyer.disabled = true;
    vues.envoyer.textContent = "Enregistrement…";

    appeler("/api/reserver", {
      method: "POST",
      body: JSON.stringify({
        creneauId: etat.creneau.id,
        formule: etat.formule.code,
        prenom: $("#prenom").value,
        nom: $("#nom").value,
        email: $("#email").value,
        telephone: $("#telephone").value,
        message: $("#message").value
      })
    }).then(function (r) {
      etat.envoiEnCours = false;
      vues.envoyer.disabled = false;
      vues.envoyer.textContent = "Confirmer ma réservation";

      if (r.ok) { reussite(r.corps); return; }

      var message = (r.corps && r.corps.message) || "La réservation n'a pas pu être enregistrée.";
      vues.erreurEnvoi.textContent = message;

      /* Créneau parti entre-temps : le planning affiché ment désormais. On
         le recharge plutôt que de laisser le visiteur réessayer dans le
         vide, et on le ramène au choix de l'horaire. */
      if (r.statut === 409 || r.statut === 410 || r.statut === 404) {
        charger().then(function (reste) {
          if (!reste) return;
          montrer(etape("heure"), false);
          montrer(etape("formule"), false);
          montrer(etape("coordonnees"), false);
          vues.rappel.classList.remove("est-visible");
          montrer(vues.plaque, false);
          etat.jour = null; etat.creneau = null; etat.formule = null;
          versEtape("jour");
        });
      }
    }).catch(function () {
      etat.envoiEnCours = false;
      vues.envoyer.disabled = false;
      vues.envoyer.textContent = "Confirmer ma réservation";
      vues.erreurEnvoi.textContent =
        "La connexion a échoué. Rien n'a été enregistré : réessayez, ou appelez le 06 82 37 75 06.";
    });
  });

  function reussite(corps) {
    var r = corps.reservation;
    montrer(vues.flux, false);
    /* « Choisir un créneau » n'a plus de sens au-dessus de « votre cours est
       réservé » : l'écran change de sujet, le titre doit suivre. */
    montrer($("[data-intro]"), false);
    vues.rappel.classList.remove("est-visible");

    vues.confirmationRecap.innerHTML =
      '<p class="recap__titre">Votre cours</p>' +
      ligneRecap("Date", echapper(r.dateTexte)) +
      ligneRecap("Heure", echapper(r.heureTexte) + " → " + echapper(r.finTexte), true) +
      ligneRecap("Lieu", echapper(lieuComplet({ libelle: r.lieu, ville: r.ville }))) +
      ligneRecap("Formule", echapper(r.formule + ", " + (r.dureeMinutes / 60) + " h")) +
      ligneRecap("Tarif", echapper(r.prixTexte) + " sur place", true);

    /* Si l'email n'est pas parti, on le dit. Le récapitulatif affiché est
       de toute façon la preuve : la réservation, elle, est enregistrée. */
    var suite = corps.emailClient
      ? "Un e-mail de confirmation vient de partir vers <strong>" + echapper(r.email) +
        "</strong>. S'il n'arrive pas, regardez dans les indésirables."
      : "Votre réservation est bien enregistrée, mais l'e-mail de confirmation n'a pas pu " +
        "partir. Gardez cet écran, ou notez les informations ci-dessus.";

    vues.confirmationSuite.innerHTML = suite +
      '<br><br>Un empêchement, une question, un retard : ' +
      '<a href="tel:+33682377506">06 82 37 75 06</a>.' +
      '<br><br>Prévoyez une tenue souple et des chaussures plates. Le matériel peut être prêté, ' +
      'dites-le avant la séance.';

    montrer(vues.confirmation, true);
    vues.confirmation.focus();
    window.scrollTo({ top: 0, behavior: doux ? "smooth" : "auto" });
  }

  /* ----------------------------------------------------------------- Départ */
  var reessayer = $("[data-reessayer]");
  if (reessayer) reessayer.addEventListener("click", function () { charger(); });

  charger();
})();
