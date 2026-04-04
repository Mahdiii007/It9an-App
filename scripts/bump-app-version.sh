#!/usr/bin/env bash
# Schreibt app-version.json — bei jedem Aufruf ein neuer Wert (Deploy / CI / lokal).
# PWA: index.html vergleicht mit localStorage → Clients leeren SW-Caches und laden neu.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TS="$(date +%s)"

if [[ -n "${GITHUB_SHA:-}" ]]; then
  SHORT_SHA="${GITHUB_SHA:0:7}"
elif SHORT_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null)"; then
  :
else
  SHORT_SHA="nogit"
fi

# Pro Workflow-Lauf eindeutig (GitHub Actions); lokal: PID + Sekunde
if [[ -n "${GITHUB_RUN_ID:-}" ]]; then
  RID="${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}"
else
  RID="local-$$"
fi

VERSION="it9an-${TS}-${RID}-${SHORT_SHA}"
printf '{"version":"%s","builtAt":"%s"}\n' "$VERSION" "$BUILT" > "$ROOT/app-version.json"
echo "app-version.json → $(tr -d '\n' < "$ROOT/app-version.json")"
