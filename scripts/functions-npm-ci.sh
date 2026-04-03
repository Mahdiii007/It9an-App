#!/usr/bin/env bash
# Sauberes npm ci in functions/: altes node_modules per mv aus dem Weg (wird von deploy-firebase.sh aufgerufen).
# Wichtig: Kein paralleles rm -rf während npm ci (sonst I/O-Stau → „hängt“).
# Nicht nach $TMPDIR mv-en: von iCloud-Desktop aus kann das eine vollständige Kopie sein (wirkt „hängend“).
# Stattdessen nur im functions/-Ordner umbenennen (gleiches Volume → meist sofort).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FUNCS="${ROOT}/functions"
cd "$FUNCS"

unset NPM_CONFIG_devdir npm_config_devdir 2>/dev/null || true
export NPM_CONFIG_AUDIT=false
# Falls weiter „Unknown env config devdir“: npm config delete devdir -g (veralteter Eintrag in ~/.npmrc)
TRASH=""

run_ci() {
  echo "functions-npm-ci: npm ci (Registry … kann 1–3 Min. dauern)"
  npm ci --no-fund --progress=false --fetch-timeout=120000 --fetch-retries=3 "$@"
}

cleanup_trash() {
  if [[ -z "$TRASH" || ! -d "$TRASH" ]]; then
    return 0
  fi
  echo "functions-npm-ci: entferne altes node_modules im Hintergrund: ${TRASH}"
  ( rm -rf "$TRASH" ) &
}

if [[ -d node_modules ]]; then
  TRASH="${FUNCS}/node_modules.__trash_$(date +%s)_$$"
  echo "functions-npm-ci: benenne node_modules um (lokal, gleicher Ordner) → $(basename "$TRASH")"
  if ! mv node_modules "$TRASH" 2>/dev/null; then
    echo "functions-npm-ci: mv nicht möglich — rm -rf node_modules"
    rm -rf node_modules
    TRASH=""
  else
    echo "functions-npm-ci: umbenennen ok."
  fi
fi

if ! run_ci; then
  echo "functions-npm-ci: npm ci fehlgeschlagen — entferne Rest und wiederhole."
  rm -rf "${FUNCS}/node_modules"
  TRASH=""
  run_ci
fi

cleanup_trash
echo "functions-npm-ci: fertig."
