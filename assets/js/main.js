/* ==========================================================================
   Nils Bouchilloux, script commun
   Aucune dépendance. Le site fonctionne sans JavaScript : ce fichier
   n'ajoute que du confort, jamais du contenu. Les réponses aux questions
   sont dans le DOM même quand les panneaux sont fermés.
   ========================================================================== */
(function () {
  "use strict";

  /* ------------------------------------------------------------------------
     Interrupteur de présentation.

     Le site contient des marqueurs [[À CONFIRMER : ...]] partout où un fait
     manque. Rien n'a été inventé. Passer cette valeur à false réaffiche les
     marqueurs, entourés d'une pastille rouge, pour la relecture avec Nils.
     À true, ils disparaissent et les blocs qui deviendraient bancals sans
     leur valeur partent en entier, grâce à l'attribut data-en-attente.
     ------------------------------------------------------------------------ */
  var MASQUER_A_CONFIRMER = true;

  /* ------------------------------------------------------------------------
     Destination du formulaire de réservation.

     Tant que cette valeur est vide, aucun service d'envoi n'est branché : le
     formulaire ne poste nulle part. Plutôt que d'afficher une fausse
     confirmation et de perdre la demande en silence, le script prépare alors
     le message dans WhatsApp, que le visiteur envoie lui-même. C'est un
     dépannage honnête, pas une solution : renseigner ici l'URL du service
     d'envoi (Formspree, Web3Forms, fonction serverless) dès qu'il existe.
     Voir A-COMPLETER.md, section 5.
     ------------------------------------------------------------------------ */
  var ENDPOINT_FORMULAIRE = "";
  var WHATSAPP_SECOURS = "33682377506";

  function appliquerModePresentation() {
    if (!MASQUER_A_CONFIRMER) return;

    /* Les blocs déclarés en attente partent en entier. Une phrase amputée
       de son chiffre serait pire qu'une section absente. */
    document.querySelectorAll("[data-en-attente]").forEach(function (bloc) {
      if (bloc.querySelector(".a-confirmer")) bloc.hidden = true;
    });

    /* Les marqueurs isolés qui restent sont simplement retirés du flux. */
    document.querySelectorAll(".a-confirmer").forEach(function (marqueur) {
      if (marqueur.closest("[data-en-attente]")) return;
      var parent = marqueur.parentNode;
      marqueur.remove();
      /* Un paragraphe ou un li vidé de sa seule substance disparaît aussi. */
      if (parent && !parent.textContent.trim() && !parent.querySelector("img, svg, a, input")) {
        if (/^(P|LI|SPAN|TD|DD)$/.test(parent.tagName)) parent.hidden = true;
      }
    });

    /* Une liste dont tous les éléments sont masqués n'a plus lieu d'être. */
    document.querySelectorAll("ul, ol").forEach(function (liste) {
      var elements = Array.prototype.slice.call(liste.children);
      if (elements.length && elements.every(function (li) { return li.hidden; })) {
        liste.hidden = true;
      }
    });
  }

  /* ------------------------------------------------------------------------
     En-tête collante
     ------------------------------------------------------------------------ */
  function initEntete() {
    var entete = document.querySelector("[data-entete]");
    if (!entete) return;
    var dernier = -1;
    function surDefilement() {
      var y = window.pageYOffset || document.documentElement.scrollTop;
      var collee = y > 8;
      if (collee !== dernier) {
        entete.classList.toggle("est-collee", collee);
        dernier = collee;
      }
    }
    window.addEventListener("scroll", surDefilement, { passive: true });
    surDefilement();
  }

  /* ------------------------------------------------------------------------
     Menu mobile et sous-menus
     ------------------------------------------------------------------------ */
  function initMenus() {
    var burger = document.querySelector("[data-burger]");
    var menuMobile = document.querySelector("[data-menu-mobile]");

    if (burger && menuMobile) {
      burger.addEventListener("click", function () {
        var ouvert = burger.getAttribute("aria-expanded") === "true";
        burger.setAttribute("aria-expanded", String(!ouvert));
        menuMobile.classList.toggle("est-ouvert", !ouvert);
      });

      menuMobile.querySelectorAll("[data-sous-menu-mobile]").forEach(function (bouton) {
        bouton.addEventListener("click", function () {
          var cible = document.getElementById(bouton.getAttribute("aria-controls"));
          var ouvert = bouton.getAttribute("aria-expanded") === "true";
          bouton.setAttribute("aria-expanded", String(!ouvert));
          if (cible) cible.classList.toggle("est-ouvert", !ouvert);
        });
      });
    }

    var declencheurs = document.querySelectorAll("[data-sous-menu]");
    declencheurs.forEach(function (bouton) {
      var cible = document.getElementById(bouton.getAttribute("aria-controls"));
      if (!cible) return;
      var parent = bouton.closest("li");

      function ouvrir(etat) {
        bouton.setAttribute("aria-expanded", String(etat));
        cible.classList.toggle("est-ouvert", etat);
      }

      bouton.addEventListener("click", function () {
        ouvrir(bouton.getAttribute("aria-expanded") !== "true");
      });
      if (parent) {
        parent.addEventListener("mouseenter", function () { ouvrir(true); });
        parent.addEventListener("mouseleave", function () { ouvrir(false); });
      }
      document.addEventListener("keydown", function (evenement) {
        if (evenement.key === "Escape") ouvrir(false);
      });
      document.addEventListener("click", function (evenement) {
        if (parent && !parent.contains(evenement.target)) ouvrir(false);
      });
    });
  }

  /* ------------------------------------------------------------------------
     Accordéons. Le contenu reste dans le DOM, replié par grid-template-rows,
     jamais retiré : c'est ce qui permet aux moteurs de le lire.
     ------------------------------------------------------------------------ */
  function initAccordeons() {
    document.querySelectorAll("[data-accordeon-bouton]").forEach(function (bouton) {
      var panneau = document.getElementById(bouton.getAttribute("aria-controls"));
      if (!panneau) return;
      bouton.addEventListener("click", function () {
        var ouvert = bouton.getAttribute("aria-expanded") === "true";
        bouton.setAttribute("aria-expanded", String(!ouvert));
        panneau.classList.toggle("est-ouvert", !ouvert);
      });
    });
  }

  /* ------------------------------------------------------------------------
     Formulaire de réservation. Validation côté client seulement : il n'y a
     pas encore de service d'envoi branché, voir A-COMPLETER.md.
     ------------------------------------------------------------------------ */
  function initFormulaires() {
    document.querySelectorAll("[data-formulaire]").forEach(function (formulaire) {
      var confirmation = formulaire.parentNode.querySelector("[data-confirmation]");

      function erreurDe(champ) {
        var groupe = champ.closest(".champ");
        return groupe ? groupe.querySelector("[data-erreur]") : null;
      }

      function valider(champ) {
        var sortie = erreurDe(champ);
        var message = "";

        if (champ.validity.valueMissing) {
          message = champ.type === "checkbox"
            ? "Cette case doit être cochée."
            : "Ce champ est nécessaire.";
        } else if (champ.type === "email" && champ.validity.typeMismatch) {
          message = "Cette adresse e-mail semble incomplète.";
        } else if (champ.type === "tel" && champ.value.replace(/[^0-9]/g, "").length < 9) {
          message = "Ce numéro semble trop court.";
        }

        champ.setAttribute("aria-invalid", message ? "true" : "false");
        if (sortie) sortie.textContent = message;
        return !message;
      }

      formulaire.querySelectorAll("input, select, textarea").forEach(function (champ) {
        champ.addEventListener("blur", function () { valider(champ); });
        champ.addEventListener("input", function () {
          if (champ.getAttribute("aria-invalid") === "true") valider(champ);
        });
      });

      formulaire.addEventListener("submit", function (evenement) {
        evenement.preventDefault();
        var valide = true;
        var premier = null;

        formulaire.querySelectorAll("input, select, textarea").forEach(function (champ) {
          if (!valider(champ)) {
            valide = false;
            if (!premier) premier = champ;
          }
        });

        if (!valide) {
          if (premier) premier.focus();
          return;
        }

        if (ENDPOINT_FORMULAIRE) {
          formulaire.submit();
          return;
        }

        /* Pas de service d'envoi : on prépare le message dans WhatsApp.
           La fenêtre s'ouvre pendant le clic, donc elle n'est pas bloquée. */
        var lignes = [];
        formulaire.querySelectorAll("input, select, textarea").forEach(function (champ) {
          if (champ.type === "checkbox") return;
          var etiquette = formulaire.querySelector('label[for="' + champ.id + '"]');
          var nom = etiquette ? etiquette.textContent.replace(/\s*\*\s*$/, "").trim() : champ.name;
          if (champ.value) lignes.push(nom.split("\n")[0].trim() + " : " + champ.value);
        });
        var texte = "Bonjour Nils, je souhaite réserver un cours de golf.\n\n" + lignes.join("\n");
        window.open("https://wa.me/" + WHATSAPP_SECOURS + "?text=" + encodeURIComponent(texte), "_blank", "noopener");

        formulaire.hidden = true;
        if (confirmation) {
          confirmation.classList.add("est-visible");
          confirmation.setAttribute("tabindex", "-1");
          confirmation.focus();
        }
      });
    });
  }

  /* ------------------------------------------------------------------------
     Révélation au défilement
     ------------------------------------------------------------------------ */
  function initRevelation() {
    var reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var blocs = document.querySelectorAll("[data-reveler]");
    if (reduit || !("IntersectionObserver" in window)) {
      blocs.forEach(function (bloc) { bloc.classList.add("est-visible"); });
      return;
    }
    /* Décalage en cascade : les éléments d'une même section apparaissent à
       70 ms d'intervalle. Assez pour donner du mouvement, trop court pour
       qu'on ait le temps de trouver ça lent. */
    document.querySelectorAll("section").forEach(function (section) {
      var enfants = section.querySelectorAll("[data-reveler]");
      enfants.forEach(function (bloc, index) {
        if (index && !bloc.style.getPropertyValue("--retard")) {
          bloc.style.setProperty("--retard", Math.min(index * 70, 210) + "ms");
        }
      });
    });

    var observateur = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (entree) {
        if (entree.isIntersecting) {
          entree.target.classList.add("est-visible");
          observateur.unobserve(entree.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    blocs.forEach(function (bloc) { observateur.observe(bloc); });
  }

  /* ------------------------------------------------------------------------
     Sélecteur de lieu. Le plan et les onglets pilotent la même fiche : on
     clique un point sur la carte ou son onglet, c'est équivalent.
     ------------------------------------------------------------------------ */
  function initSelecteurLieux() {
    var racine = document.querySelector("[data-selecteur]");
    if (!racine) return;

    var lignes = racine.querySelectorAll("[data-onglet]");
    var fiches = racine.querySelectorAll("[data-fiche]");
    var vues = racine.querySelectorAll("[data-vue]");
    var points = racine.querySelectorAll("[data-point]");

    function activer(nom) {
      lignes.forEach(function (ligne) {
        var actif = ligne.getAttribute("data-onglet") === nom;
        ligne.setAttribute("aria-selected", String(actif));
        ligne.classList.toggle("est-actif", actif);
      });
      [fiches, vues].forEach(function (groupe) {
        groupe.forEach(function (bloc) {
          var cle = bloc.getAttribute("data-fiche") || bloc.getAttribute("data-vue");
          var actif = cle === nom;
          bloc.classList.toggle("est-active", actif);
          bloc.hidden = !actif;
        });
      });
      points.forEach(function (point) {
        var actif = point.getAttribute("data-point") === nom;
        point.classList.toggle("est-actif", actif);
        /* Le point actif prend la couleur du drapeau, les autres l'encre claire. */
        var pastille = point.querySelector("circle:nth-of-type(2)");
        var anneau = point.querySelector("circle:nth-of-type(3)");
        if (pastille) {
          pastille.setAttribute("fill", actif ? "#C43D28" : "#EFEFE6");
          pastille.setAttribute("fill-opacity", actif ? "1" : ".8");
        }
        if (anneau) {
          anneau.setAttribute("stroke", actif ? "#C43D28" : "#EFEFE6");
          anneau.setAttribute("stroke-opacity", actif ? ".55" : ".3");
        }
      });
    }

    lignes.forEach(function (ligne) {
      ligne.addEventListener("click", function () { activer(ligne.getAttribute("data-onglet")); });
    });
    points.forEach(function (point) {
      point.addEventListener("click", function () { activer(point.getAttribute("data-point")); });
      point.addEventListener("keydown", function (evenement) {
        if (evenement.key === "Enter" || evenement.key === " ") {
          evenement.preventDefault();
          activer(point.getAttribute("data-point"));
        }
      });
    });
  }

  /* ------------------------------------------------------------------------
     Diagnostic « quelle formule pour vous ». Trois questions, une réponse
     chiffrée, et un lien de réservation qui préremplit le formulaire.

     Aucune formule inventée : les quatre sorties possibles sont exactement
     les quatre formules affichées dans la grille tarifaire.
     ------------------------------------------------------------------------ */
  var FORMULES = {
    heure: { nom: "Cours particulier", prix: "70 €", option: "Cours particulier, 1 h, 70 €" },
    deuxheures: { nom: "Cours particulier de deux heures", prix: "140 €", option: "Cours particulier, 2 h, 140 €" },
    duo: { nom: "Cours à deux", prix: "95 €", option: "Cours à deux, 1 h, 95 €" },
    duoDeuxHeures: { nom: "Cours à deux, deux heures", prix: "190 €", option: "Cours à deux, 2 h, 190 €" }
  };

  var LIEUX = {
    argileyres: { nom: "Golf des Argileyres, à Cestas", option: "Golf des Argileyres, Cestas" },
    par4: { nom: "Par 4 Golf, à Mérignac", option: "Par 4 Golf, Mérignac" },
    barena: { nom: "Barena Golf, à Mérignac", option: "Barena Golf, Mérignac" },
    teynac: { nom: "Golf de Teynac, à Beychac-et-Caillau", option: "Golf de Teynac, Beychac-et-Caillau" }
  };

  function conclure(reponses) {
    var niveau = reponses.niveau, format = reponses.format, duree = reponses.duree;
    var deuxHeures = duree === "deuxheures";
    var formule, lieu, pourquoi;

    if (format === "duo") {
      formule = deuxHeures ? FORMULES.duoDeuxHeures : FORMULES.duo;
      lieu = niveau === "joueur" ? LIEUX.teynac : LIEUX.barena;
      pourquoi = deuxHeures
        ? "Deux heures à deux, soit 95 € chacun. On a le temps de travailler le geste au practice puis de le mettre en situation, ce qu'une heure partagée ne permet pas."
        : "Une heure à deux, soit 47,50 € chacun. Le contenu est le même qu'en individuel : c'est le temps de frappe qui se partage, pas l'enseignement. Et on apprend beaucoup en regardant l'autre se faire corriger sur un défaut qu'on a aussi.";
    } else if (deuxHeures) {
      formule = FORMULES.deuxheures;
      lieu = niveau === "debutant" ? LIEUX.argileyres : LIEUX.teynac;
      pourquoi = niveau === "debutant"
        ? "Deux heures pour une première fois, c'est long mais c'est ce qui permet d'enchaîner le practice et le parcours court dans la même séance, au lieu de s'arrêter juste au moment où ça commence à marcher."
        : "Deux heures, c'est le format qui permet de corriger au practice puis d'aller vérifier sur le parcours dans la foulée. C'est là que le travail tient vraiment.";
    } else {
      formule = FORMULES.heure;
      lieu = niveau === "debutant" ? LIEUX.argileyres : (niveau === "reprise" ? LIEUX.par4 : LIEUX.teynac);
      pourquoi = niveau === "debutant"
        ? "Une heure complète pour poser les bases : la tenue du club, la posture, et assez de balles pour que le geste commence à se répéter."
        : (niveau === "reprise"
          ? "Une heure au radar pour commencer : on voit exactement ce qui a dérivé pendant la pause, plutôt que de le deviner. La suite se fait sur le practice ou sur le parcours."
          : "Une heure sur le parcours plutôt que sur le practice : à votre niveau, ce sont les choix et la gestion de trou qui coûtent des coups, et ça ne se travaille pas sur un tapis.");
    }

    return { formule: formule, lieu: lieu, pourquoi: pourquoi };
  }

  function initDiagnostic() {
    var racine = document.querySelector("[data-diagnostic]");
    if (!racine) return;

    var etapes = racine.querySelectorAll("[data-etape]");
    var jalons = racine.querySelectorAll("[data-etape-num]");
    var resultat = racine.querySelector("[data-resultat]");
    var sortieFormule = racine.querySelector("[data-resultat-formule]");
    var sortiePrix = racine.querySelector("[data-resultat-prix]");
    var sortiePourquoi = racine.querySelector("[data-resultat-pourquoi]");
    var lien = racine.querySelector("[data-resultat-lien]");
    var reponses = {};

    function afficherEtape(numero) {
      etapes.forEach(function (etape) {
        etape.hidden = etape.getAttribute("data-etape") !== String(numero);
      });
      jalons.forEach(function (jalon) {
        var n = Number(jalon.getAttribute("data-etape-num"));
        jalon.classList.toggle("est-active", n === numero);
        jalon.classList.toggle("est-faite", n < numero);
      });
      resultat.classList.remove("est-visible");
    }

    racine.querySelectorAll("[data-choix]").forEach(function (bouton) {
      bouton.addEventListener("click", function () {
        reponses[bouton.getAttribute("data-choix")] = bouton.getAttribute("data-valeur");
        var etapeCourante = Number(bouton.closest("[data-etape]").getAttribute("data-etape"));

        if (etapeCourante < 3) {
          afficherEtape(etapeCourante + 1);
          return;
        }

        var verdict = conclure(reponses);
        sortieFormule.textContent = verdict.formule.nom;
        sortiePrix.textContent = verdict.formule.prix;
        sortiePourquoi.textContent = verdict.pourquoi + " Lieu conseillé : " + verdict.lieu.nom + ".";
        lien.href = "/reserver/?formule=" + encodeURIComponent(verdict.formule.option) +
                    "&lieu=" + encodeURIComponent(verdict.lieu.option);
        etapes.forEach(function (etape) { etape.hidden = true; });
        jalons.forEach(function (jalon) { jalon.classList.remove("est-active"); jalon.classList.add("est-faite"); });
        resultat.classList.add("est-visible");
        resultat.focus();
      });
    });

    var recommencer = racine.querySelector("[data-recommencer]");
    if (recommencer) {
      recommencer.addEventListener("click", function () {
        reponses = {};
        afficherEtape(1);
      });
    }
  }

  /* ------------------------------------------------------------------------
     Préremplissage du formulaire depuis le diagnostic.
     ------------------------------------------------------------------------ */
  function initPreremplissage() {
    if (!window.location.search) return;
    var parametres = new URLSearchParams(window.location.search);
    [["formule", "formule"], ["lieu", "lieu"]].forEach(function (paire) {
      var valeur = parametres.get(paire[0]);
      var champ = document.getElementById(paire[1]);
      if (!valeur || !champ) return;
      Array.prototype.forEach.call(champ.options, function (option) {
        if (option.text === valeur) champ.value = option.value || option.text;
      });
    });
  }

  /* ------------------------------------------------------------------------
     Barre d'appel mobile. Elle n'apparaît qu'une fois le hero dépassé :
     avant, les deux boutons du hero suffisent, et la barre masquerait du
     contenu au moment où le visiteur découvre la page.
     ------------------------------------------------------------------------ */
  function initBarreAppel() {
    var barre = document.querySelector("[data-barre-appel]");
    if (!barre) return;
    var seuil = 420;
    var visible = null;
    function surDefilement() {
      var doit = (window.pageYOffset || document.documentElement.scrollTop) > seuil;
      if (doit !== visible) {
        barre.classList.toggle("est-visible", doit);
        visible = doit;
      }
    }
    window.addEventListener("scroll", surDefilement, { passive: true });
    surDefilement();
  }

  /* ------------------------------------------------------------------------
     Année courante dans le pied de page
     ------------------------------------------------------------------------ */
  function initAnnee() {
    var annee = String(new Date().getFullYear());
    document.querySelectorAll("[data-annee]").forEach(function (element) {
      element.textContent = annee;
    });
  }

  function demarrer() {
    appliquerModePresentation();
    initEntete();
    initMenus();
    initAccordeons();
    initSelecteurLieux();
    initDiagnostic();
    initPreremplissage();
    initFormulaires();
    initBarreAppel();
    initRevelation();
    initAnnee();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", demarrer);
  } else {
    demarrer();
  }
})();
