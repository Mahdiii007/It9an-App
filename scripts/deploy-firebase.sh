#!/usr/bin/env bash
# Firebase-Deploy (lokal / CI; Gegenstück: .github/workflows/deploy-firebase.yml).
#
# Nach Umstellung scheduled Functions auf Gen2 (onSchedule): einmal
#   ./scripts/delete-gen1-scheduled-functions.sh
# sonst Firebase: „Upgrading from 1st Gen to 2nd Gen is not yet supported“.
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

# Copy-Paste / .env-Zeilen: Zeilenumbruch im Token → „Bearer … is not a legal HTTP header value“
if [[ -n "${FIREBASE_TOKEN:-}" ]]; then
  FIREBASE_TOKEN="$(printf '%s' "$FIREBASE_TOKEN" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  export FIREBASE_TOKEN
fi

# CI: zweiter Aufruf (z. B. nur storage) soll nicht erneut npm ci ausführen
if [[ "${SKIP_FUNCTIONS_NPM_CI:-0}" != "1" ]]; then
  bash "${ROOT}/scripts/functions-npm-ci.sh"
fi

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

# Parallele Cloud-Scheduler-Updates können „Precondition failed“ liefern — optional wiederholen (Standard: 2 Versuche).
FB_RETRIES="${FIREBASE_DEPLOY_RETRIES:-2}"
fb_run_deploy() {
  if [[ -n "${FIREBASE_ONLY:-}" ]]; then
    echo "${FIREBASE_CMD[*]} ${FB_BASE[*]} --only ${FIREBASE_ONLY}"
    "${FIREBASE_CMD[@]}" "${FB_BASE[@]}" --only "${FIREBASE_ONLY}"
  else
    echo "${FIREBASE_CMD[*]} ${FB_BASE[*]}"
    "${FIREBASE_CMD[@]}" "${FB_BASE[@]}"
  fi
}
attempt=1
while true; do
  set +e
  fb_run_deploy
  st=$?
  set -e
  if [[ "$st" -eq 0 ]]; then
    break
  fi
  if [[ "$attempt" -ge "$FB_RETRIES" ]]; then
    exit "$st"
  fi
  attempt=$((attempt + 1))
  echo "firebase deploy fehlgeschlagen (Versuch $((attempt - 1))/$FB_RETRIES) — erneuter Versuch in 25s (häufig Cloud Scheduler / API)."
  sleep 25
done

SHA="$(git rev-parse HEAD 2>/dev/null || echo local)"
printf '%s\n' "{\"version\":\"fb-${SHA}\",\"builtAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > app-version.json
echo "Wrote app-version.json (nach erfolgreichem Deploy)"
