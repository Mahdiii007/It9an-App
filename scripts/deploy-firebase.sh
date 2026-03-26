#!/usr/bin/env bash
# Firebase-Deploy (lokal). Voraussetzung: firebase login oder FIREBASE_TOKEN.
# Optional: FIREBASE_ONLY="functions,firestore,storage" (Standard bei deploy-all.sh)
# Optional: FIREBASE_PROJECT=it9an-neu
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT="${FIREBASE_PROJECT:-it9an-neu}"
SHA="$(git rev-parse HEAD 2>/dev/null || echo local)"
printf '%s\n' "{\"version\":\"fb-${SHA}\",\"builtAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > app-version.json
echo "Wrote app-version.json"

(cd functions && npm ci)

FB_ARGS=(--project "$PROJECT" --non-interactive)
if [[ -n "${FIREBASE_TOKEN:-}" ]]; then
  FB_ARGS+=(--token "$FIREBASE_TOKEN")
fi

if [[ -n "${FIREBASE_ONLY:-}" ]]; then
  echo "firebase deploy --only ${FIREBASE_ONLY} --project ${PROJECT}"
  firebase deploy --only "${FIREBASE_ONLY}" "${FB_ARGS[@]}"
else
  echo "firebase deploy (alles laut firebase.json) --project ${PROJECT}"
  firebase deploy "${FB_ARGS[@]}"
fi
