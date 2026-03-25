#!/usr/bin/env bash
# Vor „firebase deploy“ ausführen, damit Clients die neue Version erkennen (wenn kein GitHub Actions-Deploy).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
printf '{"version":"fb-%s","builtAt":"%s"}\n' "$(date +%s)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ROOT/app-version.json"
echo "app-version.json → $(cat "$ROOT/app-version.json")"
