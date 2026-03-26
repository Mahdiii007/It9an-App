#!/usr/bin/env bash
# Firebase-Deploy (lokal / CI).
#
# Authentifizierung (eine Variante):
#   - firebase login   (lokal, ohne Token)
#   - GOOGLE_APPLICATION_CREDENTIALS=/pfad/zu/dienstkonto.json  (empfohlen für CI)
#   - FIREBASE_TOKEN=…   (firebase login:ci — kann bei Firestore/Storage mit „unexpected error“ ausfallen)
#
# Debug: DEBUG=1 ./scripts/deploy-firebase.sh
# System-weites „firebase“ erzwingen: USE_SYSTEM_FIREBASE=1
# CLI-Version pinnen: FIREBASE_TOOLS_VERSION=13.34.0 (Standard: Major 13)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT="${FIREBASE_PROJECT:-it9an-neu}"

(cd functions && npm ci)

FT_VER="${FIREBASE_TOOLS_VERSION:-13}"
if [[ "${USE_SYSTEM_FIREBASE:-0}" == "1" ]] && command -v firebase >/dev/null 2>&1 && firebase --version >/dev/null 2>&1; then
  FIREBASE_CMD=(firebase)
  echo "Nutze systemweites firebase ($(command -v firebase))"
else
  FIREBASE_CMD=(npx --yes "firebase-tools@${FT_VER}")
  echo "Nutze npx firebase-tools@${FT_VER} (stabiler als manche globale firepit-Installationen)"
fi

FB_BASE=(deploy --project "$PROJECT" --non-interactive)

if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]]; then
  echo "Auth: GOOGLE_APPLICATION_CREDENTIALS=${GOOGLE_APPLICATION_CREDENTIALS}"
elif [[ -n "${FIREBASE_TOKEN:-}" ]]; then
  FB_BASE+=(--token "$FIREBASE_TOKEN")
  echo "Auth: FIREBASE_TOKEN (bei Fehlern Dienstkonto oder firebase login probieren)"
else
  echo "Auth: interaktives firebase login (kein Token gesetzt)"
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

SHA="$(git rev-parse HEAD 2>/dev/null || echo local)"
printf '%s\n' "{\"version\":\"fb-${SHA}\",\"builtAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > app-version.json
echo "Wrote app-version.json (nach erfolgreichem Deploy)"
