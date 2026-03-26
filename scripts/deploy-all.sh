#!/usr/bin/env bash
# Alles in einem: Git Push → GitHub Pages + Firebase (Functions, Firestore, Storage).
#
# Nutzung:
#   ./scripts/deploy-all.sh
#   ./scripts/deploy-all.sh "feat: Kurzbeschreibung"
#
# Nur Git (kein Firebase):  SKIP_FIREBASE=1 ./scripts/deploy-all.sh
# Nur Firebase (kein Push):    SKIP_GIT=1 ./scripts/deploy-all.sh
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
# GitHub Pages startet nur bei einem Push mit neuem Commit auf main/master.
#   Keine lokalen Änderungen? FORCE_GITHUB_PAGES=1 ./scripts/deploy-all.sh
#   (leerer Commit triggert den Workflow erneut.)
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

COMMIT_MSG="${1:-chore: deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [[ "${SKIP_GIT:-0}" != "1" ]]; then
  echo "=== Git: add / commit / push ($BRANCH) ==="
  if [[ "$BRANCH" != "main" && "$BRANCH" != "master" ]]; then
    echo "Hinweis: Der Pages-Workflow (.github/workflows/deploy-pages.yml) laeuft nur auf „main“ oder „master“."
  fi
  # Vor Commit: app-version.json ins Repo — deploy-firebase schreibt sie erst NACH dem ersten Push (fb-*).
  SHA_PRE="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  printf '%s\n' "{\"version\":\"pre-${SHA_PRE}\",\"builtAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > app-version.json
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
    git commit -m "$COMMIT_MSG"
  fi
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
  # deploy-firebase setzt app-version.json auf fb-<SHA> — zweiter Push, damit GitHub die Datei wirklich hat
  if [[ "${SKIP_GIT:-0}" != "1" ]]; then
    if [[ -n "$(git status --porcelain -- app-version.json 2>/dev/null || true)" ]]; then
      git add app-version.json
      git commit -m "chore: app-version.json nach Firebase-Deploy"
      git push -u origin "$BRANCH"
      echo "app-version.json (fb-*) als zweiter Commit gepusht."
    fi
  fi
else
  echo "=== Firebase übersprungen (SKIP_FIREBASE=1) ==="
fi

echo "Fertig."
