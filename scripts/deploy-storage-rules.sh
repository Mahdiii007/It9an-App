#!/usr/bin/env bash
# Nur Storage-Regeln (wenn vollständiger Deploy wegen Bucket-API fehlschlägt).
# Vorher in Firebase Console → Storage einrichten. Bucket-Name in firebase.json anpassen falls nötig.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PROJECT="${FIREBASE_PROJECT:-it9an-neu}"
if [[ "${USE_NPX_FIREBASE:-0}" == "1" ]]; then
  CMD=(npx --yes firebase-tools)
elif command -v firebase >/dev/null 2>&1 && firebase --version >/dev/null 2>&1; then
  CMD=(firebase)
else
  CMD=(npx --yes firebase-tools)
fi
ARGS=(deploy --project "$PROJECT" --non-interactive --only storage)
[[ -n "${FIREBASE_TOKEN:-}" ]] && ARGS+=(--token "$FIREBASE_TOKEN")
[[ "${DEBUG:-0}" == "1" ]] && ARGS+=(--debug)
echo "${CMD[*]} ${ARGS[*]}"
"${CMD[@]}" "${ARGS[@]}"
