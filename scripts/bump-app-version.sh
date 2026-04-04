#!/usr/bin/env bash
# Schreibt app-version.json — bei jedem Aufruf ein neuer Wert (Deploy / CI / lokal).
# Setzt zudem <meta name="it9an-deploy-version"> in index.html (gleicher String) für einen
# synchronen Deploy-Check ohne Netzwerk (Safari/PWA cachen app-version.json sonst zu aggressiv).
# PWA: Clients vergleichen mit localStorage → SW-Caches leeren und neu laden.
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

if [[ -f "$ROOT/index.html" ]] && grep -q 'name="it9an-deploy-version"' "$ROOT/index.html"; then
  export IT9AN_DEPLOY_VER="$VERSION"
  perl -i -pe 's/(<meta\s+name="it9an-deploy-version"\s+content=")[^"]*("\s*\/?\s*>)/$1$ENV{IT9AN_DEPLOY_VER}$2/i' "$ROOT/index.html"
  echo "index.html <meta it9an-deploy-version> → $VERSION"
else
  echo "Hinweis: index.html ohne name=\"it9an-deploy-version\" — Meta-Tag ergänzen für Safari-sicheren Deploy-Kick."
fi
