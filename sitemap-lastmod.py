#!/usr/bin/env python3
"""Remet les lastmod de sitemap.xml en accord avec l'historique git.

À lancer avant tout commit qui touche une page. Sans ça, la date se fige
et ment : c'est arrivé le 27 septembre 2026, quinze minutes après avoir
corrigé le même défaut à la main. Une règle écrite dans un commentaire ne
suffit pas, il faut une commande.

    python3 sitemap-lastmod.py          affiche ce qui changerait
    python3 sitemap-lastmod.py --ecrire applique

Aucune dépendance, aucune étape de construction : le site reste servi tel
quel.
"""
import re
import subprocess
import sys
import pathlib

RACINE = pathlib.Path(__file__).resolve().parent
SITEMAP = RACINE / "sitemap.xml"
BASE = "https://www.nilsbouchilloux.fr"


def fichier_de(url):
    """L'URL /a-propos/ correspond au fichier a-propos/index.html."""
    chemin = url[len(BASE):].strip("/")
    return RACINE / (chemin + "/index.html" if chemin else "index.html")


def date_git(fichier):
    r = subprocess.run(["git", "log", "-1", "--format=%cs", "--", str(fichier)],
                       cwd=RACINE, capture_output=True, text=True)
    return r.stdout.strip() or None


def main():
    ecrire = "--ecrire" in sys.argv
    texte = SITEMAP.read_text(encoding="utf-8")
    motif = re.compile(r"(<loc>)([^<]+)(</loc><lastmod>)(\d{4}-\d{2}-\d{2})(</lastmod>)")
    ecarts = []

    def remplacer(m):
        url, annoncee = m.group(2), m.group(4)
        f = fichier_de(url)
        if not f.exists():
            print("  ! fichier introuvable pour %s" % url)
            return m.group(0)
        reelle = date_git(f)
        if not reelle:
            print("  ! aucun commit pour %s" % f.relative_to(RACINE))
            return m.group(0)
        if reelle != annoncee:
            ecarts.append((url[len(BASE):] or "/", annoncee, reelle))
        return m.group(1) + url + m.group(3) + reelle + m.group(5)

    sortie = motif.sub(remplacer, texte)

    if not ecarts:
        print("sitemap.xml : les dates sont exactes, rien à faire.")
        return 0

    for url, a, b in ecarts:
        print("  %-40s %s → %s" % (url, a, b))
    if ecrire:
        SITEMAP.write_text(sortie, encoding="utf-8")
        print("%d date(s) corrigée(s) dans sitemap.xml" % len(ecarts))
    else:
        print("%d écart(s). Relancer avec --ecrire pour appliquer." % len(ecarts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
