#!/usr/bin/env bash
# Firebase-Deploy (lokal). Voraussetzung: firebase login oder FIREBASE_TOKEN.
# Debug: DEBUG=1 ./scripts/deploy-firebase.sh  (mehr Firebase-CLI-Log)
# Optional: FIREBASE_ONLY="functions,firestore,storage"
# Optional: FIREBASE_PROJECT=it9an-neu
# Falls „firebase“ abstürzt: npx firebase-tools@latest deploy …
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT="${FIREBASE_PROJECT:-it9an-neu}"
SHA="$(git rev-parse HEAD 2>/dev/null || echo local)"
printf '%s\n' "{\"version\":\"fb-${SHA}\",\"builtAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > app-version.json
echo "Wrote app-version.json"

(cd functions && npm ci)

# Global „firebase“ nutzt oft firepit — bei „unexpected error“: USE_NPX_FIREBASE=1 oder npm i -g firebase-tools@latest
if [[ "${USE_NPX_FIREBASE:-0}" == "1" ]]; then
  FIREBASE_CMD=(npx --yes firebase-tools)
elif command -v firebase >/dev/null 2>&1 && firebase --version >/dev/null 2>&1; then
  FIREBASE_CMD=(firebase)
else
  echo "Hinweis: firebase-CLI fehlt oder antwortet nicht — nutze npx firebase-tools"
  FIREBASE_CMD=(npx --yes firebase-tools)
fi

# Globale Flags zuerst (robuster als am Ende)
FB_BASE=(deploy --project "$PROJECT" --non-interactive)
if [[ -n "${FIREBASE_TOKEN:-}" ]]; then
  FB_BASE+=(--token "$FIREBASE_TOKEN")
fi
if [[ "${DEBUG:-0}" == "1" ]] || [[ "${FIREBASE_DEBUG:-0}" == "1" ]]; then
  FB_BASE+=(--debug)
fi

if [[ -n "${FIREBASE_ONLY:-}" ]]; then
  echo "${FIREBASE_CMD[*]} ${FB_BASE[*]} --only ${FIREBASE_ONLY}"
  "${FIREBASE_CMD[@]}" "${FB_BASE[@]}" --only "${FIREBASE_ONLY}"
else
  echo "${FIREBASE_CMD[*]} ${FB_BASE[*]}"
  "${FIREBASE_CMD[@]}" "${FB_BASE[@]}"
fi
