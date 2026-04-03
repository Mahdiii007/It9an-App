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

# npm 11: veraltete globale/npmrc-Keys (z. B. devdir) → „Unknown env config“
unset NPM_CONFIG_devdir npm_config_devdir 2>/dev/null || true
# firebase-tools → punycode (DEP0040) unter Node 20+
if [[ " ${NODE_OPTIONS:-} " != *" --disable-warning=DEP0040 "* ]]; then
  export NODE_OPTIONS="${NODE_OPTIONS:+${NODE_OPTIONS} }--disable-warning=DEP0040"
fi

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

# npx-Phase: npm warn (EBADENGINE/superstatic, deprecated) unterdrücken — Firebase-Ausgabe unverändert. FIREBASE_NPM_VERBOSE=1 zum Debuggen.
fb_exec() {
  if [[ "${FIREBASE_CMD[0]}" == "npx" ]] && [[ "${FIREBASE_NPM_VERBOSE:-0}" != "1" ]]; then
    NPM_CONFIG_loglevel=error "${FIREBASE_CMD[@]}" "$@"
  else
    "${FIREBASE_CMD[@]}" "$@"
  fi
}

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

# Parallele Cloud-Scheduler-Updates können „Precondition failed“ liefern — optional wiederholen (Standard: 3 Versuche).
FB_RETRIES="${FIREBASE_DEPLOY_RETRIES:-3}"
deploy_log="$(mktemp "${TMPDIR:-/tmp}/fb-deploy-log.XXXXXX")"
cleanup_deploy_log() { rm -f "$deploy_log"; }
trap cleanup_deploy_log EXIT

fb_run_deploy() {
  if [[ -n "${FIREBASE_ONLY:-}" ]]; then
    echo "${FIREBASE_CMD[*]} ${FB_BASE[*]} --only ${FIREBASE_ONLY}"
    fb_exec "${FB_BASE[@]}" --only "${FIREBASE_ONLY}"
  else
    echo "${FIREBASE_CMD[*]} ${FB_BASE[*]}"
    fb_exec "${FB_BASE[@]}"
  fi
}
attempt=1
while true; do
  set +e
  fb_run_deploy 2>&1 | tee "$deploy_log"
  st="${PIPESTATUS[0]}"
  set -e
  if [[ "$st" -eq 0 ]]; then
    # Manche CLI-Versionen beenden mit 0, obwohl einzelne Functions „HTTP 409, unable to queue“ melden.
    if [[ "${FIREBASE_SKIP_409_FUNCTIONS_RETRY:-0}" != "1" ]] && grep -q "HTTP Error: 409" "$deploy_log" 2>/dev/null && { [[ -z "${FIREBASE_ONLY:-}" ]] || [[ "${FIREBASE_ONLY}" == *"functions"* ]]; }; then
      echo ""
      echo "firebase deploy: HTTP 409 bei mindestens einer Function — zweiter Pass nur „functions“ in 35s …"
      sleep 35
      set +e
      echo "${FIREBASE_CMD[*]} ${FB_BASE[*]} --only functions"
      fb_exec "${FB_BASE[@]}" --only functions 2>&1 | tee -a "$deploy_log"
      st409="${PIPESTATUS[0]}"
      set -e
      if [[ "$st409" -ne 0 ]]; then
        echo "Hinweis: Zweiter Pass „functions“ endete mit exit $st409 — bei Bedarf Deploy erneut ausführen."
      fi
    fi
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
