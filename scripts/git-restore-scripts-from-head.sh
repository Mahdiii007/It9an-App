#!/usr/bin/env bash
# Stellt deploy-firebase.sh und functions-npm-ci.sh auf den letzten Commit zurück (gegen falsche M/U in der IDE).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git checkout HEAD -- scripts/deploy-firebase.sh scripts/functions-npm-ci.sh
chmod +x scripts/deploy-firebase.sh scripts/functions-npm-ci.sh
git add --renormalize scripts/deploy-firebase.sh scripts/functions-npm-ci.sh || true
git status -sb scripts/
