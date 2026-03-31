#!/usr/bin/env bash
# Setzt CORS auf den/die Firebase-Storage-Bucket(s). Ohne das blockieren Browser
# fetch() und das Storage-SDK (XHR) von GitHub Pages u. a. mit:
#   «Origin … is not allowed by Access-Control-Allow-Origin»
#
# Voraussetzung: Google Cloud SDK (gcloud / gsutil), eingeloggt mit Projekt-Zugriff.
#
# Nutzung (einmalig nach Bucket-Anlage):
#   chmod +x scripts/apply-storage-cors.sh
#   ./scripts/apply-storage-cors.sh
#
# Manuell:
#   gsutil cors set scripts/storage-cors.json gs://it9an-neu.firebasestorage.app
#   gsutil cors set scripts/storage-cors.json gs://it9an-neu.appspot.com
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORS_FILE="${ROOT}/scripts/storage-cors.json"
for B in "gs://it9an-neu.firebasestorage.app" "gs://it9an-neu.appspot.com"; do
  echo ">>> gsutil cors set … $B"
  gsutil cors set "$CORS_FILE" "$B" || echo ">>> Hinweis: Bucket $B ggf. nicht vorhanden — überspringen oder Namen in Console prüfen."
done
echo "Fertig. Kurz warten, dann Seite neu laden und Sync-Reply erneut testen."
