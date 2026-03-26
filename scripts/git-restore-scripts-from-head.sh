#!/usr/bin/env bash
# Stellt deploy-firebase.sh und functions-npm-ci.sh auf den letzten Commit zurück (gegen falsche M/U in der IDE).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d .git ]]; then
  echo "Kein .git in: $ROOT — bitte den Repo-Ordner (…/Github) öffnen, nicht nur den übergeordneten Cursor-Ordner."
  exit 1
fi

git fetch origin 2>/dev/null || true
git merge --ff-only "origin/$(git rev-parse --abbrev-ref HEAD)" 2>/dev/null || true

git checkout HEAD -- scripts/deploy-firebase.sh scripts/functions-npm-ci.sh
chmod +x scripts/deploy-firebase.sh scripts/functions-npm-ci.sh
git add --renormalize scripts/deploy-firebase.sh scripts/functions-npm-ci.sh 2>/dev/null || true

echo "Status scripts/:"
git status -sb scripts/

if [[ -z "$(git status --porcelain -- scripts/deploy-firebase.sh scripts/functions-npm-ci.sh 2>/dev/null)" ]]; then
  echo "OK: deploy-firebase.sh und functions-npm-ci.sh entsprechen HEAD."
else
  echo "Hinweis: noch Änderungen an diesen Dateien — ggf. git diff und committen."
fi
