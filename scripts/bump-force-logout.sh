#!/usr/bin/env bash
# Erhöht Firestore appSettings/forceLogout.version (alle Clients ausloggen). Siehe functions/tools/bump-force-logout-on-deploy.js
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/functions"
if [[ ! -d node_modules/firebase-admin ]]; then
  echo "bump-force-logout: npm ci in functions …"
  npm ci
fi
node tools/bump-force-logout-on-deploy.js
