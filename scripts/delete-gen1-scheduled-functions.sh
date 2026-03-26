#!/usr/bin/env bash
# Einmalig ausführen, wenn scheduled Functions von Gen1 (pubsub.schedule) auf Gen2 (onSchedule) umgestellt wurden.
# Firebase erlaubt kein In-Place-Upgrade: „Upgrading from 1st Gen to 2nd Gen is not yet supported“.
# Danach: ./scripts/deploy-firebase.sh
#
# Auth wie deploy-firebase.sh: firebase login, GOOGLE_APPLICATION_CREDENTIALS oder FIREBASE_TOKEN.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT="${FIREBASE_PROJECT:-it9an-neu}"
REG="${FIREBASE_FUNCTIONS_REGION:-europe-west3}"

if [[ -n "${FIREBASE_TOKEN:-}" ]]; then
  FIREBASE_TOKEN="$(printf '%s' "$FIREBASE_TOKEN" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  export FIREBASE_TOKEN
fi

FT_VER="${FIREBASE_TOOLS_VERSION:-13}"
if [[ "${USE_SYSTEM_FIREBASE:-0}" == "1" ]] && command -v firebase >/dev/null 2>&1 && firebase --version >/dev/null 2>&1; then
  FIREBASE_CMD=(firebase)
else
  FIREBASE_CMD=(npx --yes "firebase-tools@${FT_VER}")
fi

FB_BASE=(--project "$PROJECT")
if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]]; then
  :
elif [[ -n "${FIREBASE_TOKEN:-}" ]]; then
  FB_BASE+=(--token "$FIREBASE_TOKEN")
fi

NAMES=(
  restoreStudentRecordingNotificationsScheduled
  sendQuranReminderScheduled1
  sendQuranReminderScheduled2
  sendQuranReminderScheduled3
  sendQuranReminderScheduled4
  sendQuranReminderScheduled5
  sendQuranReminderScheduled6
)

echo "Lösche Gen1 scheduled Functions in ${REG} …"
for name in "${NAMES[@]}"; do
  echo "→ $name"
  "${FIREBASE_CMD[@]}" functions:delete "$name" --region "$REG" "${FB_BASE[@]}" --force \
    || echo "   (nicht gelöscht — schon weg, Gen2, oder Berechtigung prüfen)"
done
echo "Fertig. Jetzt: ./scripts/deploy-firebase.sh"
