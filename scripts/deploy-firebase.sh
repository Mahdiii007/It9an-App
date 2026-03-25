#!/usr/bin/env bash
# Vollständiges Firebase-Deploy (lokal). Voraussetzung: firebase login, Projekt it9an-neu.
# Optional: FIREBASE_ONLY="functions,firestore,storage" wenn Hosting nur über GitHub Pages läuft.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SHA="$(git rev-parse HEAD 2>/dev/null || echo local)"
printf '%s\n' "{\"version\":\"fb-${SHA}\",\"builtAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > app-version.json
echo "Wrote app-version.json"

(cd functions && npm ci)

if [[ -n "${FIREBASE_ONLY:-}" ]]; then
  echo "firebase deploy --only ${FIREBASE_ONLY}"
  firebase deploy --only "${FIREBASE_ONLY}"
else
  firebase deploy
fi
