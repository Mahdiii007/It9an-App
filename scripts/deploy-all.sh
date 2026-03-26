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
set -euo pipefail

on_err() {
  echo ">>> Fehler (Zeile $1). Git ok? Firebase-Login: firebase login  oder FIREBASE_TOKEN setzen."
  echo ">>> Firebase-CLI kaputt? Versuch: npx firebase-tools@latest --version"
  exit 1
}
trap 'on_err $LINENO' ERR

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMMIT_MSG="${1:-chore: deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [[ "${SKIP_GIT:-0}" != "1" ]]; then
  echo "=== Git: add / commit / push ($BRANCH) ==="
  git add -A
  if git diff --staged --quiet; then
    echo "Nichts zu committen — push trotzdem falls lokale Commits fehlen."
  else
    git commit -m "$COMMIT_MSG"
  fi
  git push -u origin "$BRANCH"
  echo "GitHub Pages startet per Workflow nach Push auf $BRANCH."
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

echo "Fertig."
