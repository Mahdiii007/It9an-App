#!/usr/bin/env bash
# Alles in einem: Git Push → GitHub Pages + Firebase (Functions, Firestore, Storage).
#
# Nutzung:
#   ./scripts/deploy-all.sh
#   ./scripts/deploy-all.sh "feat: Kurzbeschreibung"
#
# Nur Git (kein Firebase):  SKIP_FIREBASE=1 ./scripts/deploy-all.sh
# Nur Firebase (kein Push):    SKIP_GIT=1 ./scripts/deploy-all.sh
#   (dann bleibt u.a. app-version.json oft geändert — kein Auto-Sync ohne Git.)
#
# Firebase ohne interaktives Login (Token von: firebase login:ci):
#   export FIREBASE_TOKEN="…"
#   ./scripts/deploy-all.sh
#
# Hosting liegt bei GitHub Pages; Firebase ohne Hosting (anpassbar):
#   FULL_FIREBASE=1 ./scripts/deploy-all.sh   → komplettes firebase deploy inkl. Hosting
#
# Storage-Deploy schlägt fehl („fetching default storage bucket“)?
#   Standard: nur functions + firestore. Storage-Regeln separat:
#   FIREBASE_ONLY=functions,firestore,storage ./scripts/deploy-all.sh
#   Oder in der Console: Storage einmal einrichten + Bucket prüfen (appspot vs firebasestorage.app).
#
# GitHub Pages: fetch/Storage-SDK braucht CORS auf dem Bucket (sonst «Origin … not allowed»):
#   ./scripts/apply-storage-cors.sh   (gsutil; einmalig, siehe Skriptkopf)
#
# „Error: Can't find the storage bucket region“: in onObjectFinalized kein „bucket:“ setzen (Standard-Bucket).
#   In firebase.json genau EIN Eintrag mit dem echten Default-Bucket (…firebasestorage.app), damit die CLI die Region findet.
#
# „Error Precondition failed“ (v. a. sendQuranReminderScheduled*): Cloud Scheduler — Deploy einfach erneut ausführen oder
#   FIREBASE_DEPLOY_RETRIES=3 ./scripts/deploy-firebase.sh
#
# GitHub Pages startet nur bei einem Push mit neuem Commit auf main/master.
#   Keine lokalen Änderungen? FORCE_GITHUB_PAGES=1 ./scripts/deploy-all.sh
#   (leerer Commit triggert den Workflow erneut.)
#
# Am Ende soll der Arbeitsbaum leer sein (kein M/U in der IDE):
#   Nach Firebase wird alles Relevante mit „git add -A“ committed und gepusht.
#   Abschließend bis zu 3 Sync-Versuche (falls der Editor parallel speichert).
#   Abschalten: SYNC_CLEAN_AFTER_DEPLOY=0
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

on_err() {
  echo ">>> Fehler (Zeile $1)."
  if [[ "${_GIT_PUSH_OK:-0}" == "1" ]]; then
    echo ">>> Git push war erfolgreich — GitHub Pages ggf. unter Actions sichtbar; unten nur Firebase betroffen."
  fi
  echo ">>> Firebase: unset FIREBASE_TOKEN und „firebase login“ ODER Dienstkonto: export GOOGLE_APPLICATION_CREDENTIALS=/pfad/key.json"
  echo ">>> Debug: DEBUG=1 ./scripts/deploy-firebase.sh"
  if [[ -f "${ROOT}/firebase-debug.log" ]]; then
    echo ">>> firebase-debug.log (Auszug):"
    tail -40 "${ROOT}/firebase-debug.log" 2>/dev/null || true
  fi
  exit 1
}
trap 'on_err $LINENO' ERR

cd "$ROOT"

if [[ ! -d .git ]]; then
  echo "=== FEHLER: Hier ist kein Git-Repository (.git fehlt) ==="
  echo "Aktueller Ordner: $ROOT"
  echo "Cursor/VS Code: den geklonten App-Ordner öffnen (…/Github bzw. It9an-App), nicht den übergeordneten „Cursor“-Ordner."
  echo "Oder: It9an-App.code-workspace aus dem Repo doppelklicken. Sonst zeigt die IDE falsche M/U bei scripts/."
  exit 1
fi

if [[ "${SKIP_GIT:-0}" != "1" && -f .git/index.lock ]]; then
  echo "=== FEHLER: .git/index.lock existiert ==="
  echo "Anderes Git/Cursor-Panel nutzt das Repo, oder ein git ist abgestürzt."
  echo "Wenn sicher kein git mehr läuft: rm -f .git/index.lock"
  exit 1
fi

COMMIT_MSG="${1:-chore: deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# Committet alle getrackten/ungetrackten (nicht ignorierten) Änderungen und pusht, bis status leer oder max n.
sync_worktree_clean() {
  local max="${1:-3}"
  local i=0
  while [[ $i -lt "$max" ]]; do
    i=$((i + 1))
    git add -A
    if git diff --staged --quiet 2>/dev/null; then
      break
    fi
    git commit -m "chore: Arbeitsbaum nach Deploy synchronisieren"
    git push -u origin "$BRANCH"
  done
  if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    echo ""
    echo "=== FEHLER: Git-Arbeitsbaum ist nach Deploy nicht leer ==="
    git status -sb
    echo "Prüfe offene Dateien im Editor, Submodule oder setze SYNC_CLEAN_AFTER_DEPLOY=0 und committe manuell."
    exit 1
  fi
}

if [[ "${SKIP_GIT:-0}" != "1" ]]; then
  echo "=== Git: add / commit / push ($BRANCH) ==="
  if [[ "$BRANCH" != "main" && "$BRANCH" != "master" ]]; then
    echo "Hinweis: Der Pages-Workflow (.github/workflows/deploy-pages.yml) laeuft nur auf „main“ oder „master“."
  fi
  # Vor Commit: app-version.json ins Repo — deploy-firebase schreibt sie erst NACH dem ersten Push (fb-*).
  SHA_PRE="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  printf '%s\n' "{\"version\":\"pre-${SHA_PRE}\",\"builtAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > app-version.json
  echo "→ git add -A …"
  git add -A
  if git diff --staged --quiet; then
    if [[ "${FORCE_GITHUB_PAGES:-0}" == "1" ]]; then
      git commit --allow-empty -m "chore: trigger GitHub Pages redeploy"
      echo "Leerer Commit erzeugt — loest GitHub Actions (Pages) aus."
    else
      echo "Nichts zu committen. „git push“ aktualisiert ggf. nichts — oft startet dann KEIN neues Pages-Deployment."
      echo "Tipp: FORCE_GITHUB_PAGES=1 ./scripts/deploy-all.sh  oder eine Datei aendern und erneut ausfuehren."
    fi
  else
    echo "→ git commit …"
    git commit -m "$COMMIT_MSG"
  fi
  echo "→ git push (bei Rückfrage zu Anmeldung/SSH hier warten) …"
  git push -u origin "$BRANCH"
  _GIT_PUSH_OK=1
  echo "Git push erledigt. Pages: Repository → Actions → „Deploy to GitHub Pages“ pruefen (nur bei neuem Commit auf main/master)."
else
  echo "=== Git übersprungen (SKIP_GIT=1) ==="
fi

if [[ "${SKIP_FIREBASE:-0}" != "1" ]]; then
  echo "=== Firebase ==="
  if [[ "${FULL_FIREBASE:-0}" == "1" ]]; then
    unset FIREBASE_ONLY
  else
    # Ohne storage: vermeidet CLI-Fehler, wenn kein Standard-Bucket/API/Token-Rechte
    export FIREBASE_ONLY="${FIREBASE_ONLY:-functions,firestore}"
  fi
  "$ROOT/scripts/deploy-firebase.sh"
  echo "Firebase fertig."
else
  echo "=== Firebase übersprungen (SKIP_FIREBASE=1) ==="
fi

# app-version.json (fb-*), Zeilenenden, Skript-Modi, usw. — ein Commit, danach leerer Arbeitsbaum
if [[ "${SKIP_GIT:-0}" != "1" && "${SYNC_CLEAN_AFTER_DEPLOY:-1}" == "1" ]]; then
  echo "=== Git: Arbeitsbaum mit Remote abgleichen (soll leer werden) ==="
  sync_worktree_clean 3
  echo "Git: Arbeitsbaum sauber (keine offenen M/U für getrackte/committbare Dateien)."
fi

echo "Fertig."
