#!/usr/bin/env bash
# Start: bash scripts/apply-storage-cors.sh  (nicht: sh … — <<< u. a. bricht dann ab.)
#
# CORS nur auf die Firebase-User-Buckets des Projekts (…firebasestorage.app + …appspot.com),
# nicht auf interne gcf-*-Buckets von Cloud Functions.
# Ohne das: «Origin https://mahdiii007.github.io is not allowed by Access-Control-Allow-Origin»
#
# Voraussetzung: Google Cloud SDK (gcloud), Konto mit Rechten auf Projekt it9an-neu (Owner/Storage Admin).
#
#   gcloud auth login
#   gcloud config set project it9an-neu
#   cd …/Github && ./scripts/apply-storage-cors.sh
#
# Prüfen (nach dem Skript):
#   gsutil cors get gs://it9an-neu.firebasestorage.app
# Erwartung: JSON mit "origin" und github.io bzw. "*"
#
# Nur mit gsutil (falls gcloud storage fehlt):
#   gsutil cors set scripts/storage-cors.json gs://it9an-neu.firebasestorage.app
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORS_FILE="${ROOT}/scripts/storage-cors.json"
PROJECT="${FIREBASE_PROJECT:-it9an-neu}"

if [[ ! -f "$CORS_FILE" ]]; then
  echo "FEHLER: $CORS_FILE fehlt."
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1 && ! command -v gsutil >/dev/null 2>&1; then
  echo ""
  echo "=== FEHLER: Weder gcloud noch gsutil ist installiert oder im PATH ==="
  echo "Ohne eines der beiden Tools kann CORS nicht gesetzt werden."
  echo ""
  echo "macOS (Homebrew):"
  echo "  brew install --cask google-cloud-sdk"
  echo "Dann Terminal neu starten (oder: source \"\$(brew --prefix)/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/path.bash.inc\")"
  echo ""
  echo "Oder Installer: https://cloud.google.com/sdk/docs/install"
  echo "Danach:  gcloud auth login && gcloud config set project $PROJECT"
  echo "Und erneut:  bash scripts/apply-storage-cors.sh"
  echo ""
  echo "Ohne CLI: Google Cloud Console → Cloud Storage → Bucket wählen → Konfiguration → CORS"
  echo "Dort den JSON-Inhalt einfügen aus:"
  echo "  $CORS_FILE"
  echo ""
  exit 1
fi

echo "=== Projekt: $PROJECT ==="
echo "=== CORS-Datei: $CORS_FILE ==="

apply_gsutil() {
  local uri="$1"
  echo ""
  echo ">>> gsutil cors set $uri"
  if gsutil cors set "$CORS_FILE" "$uri"; then
    echo ">>> OK: $uri"
    gsutil cors get "$uri" 2>/dev/null | head -40 || true
  else
    echo ">>> FEHLGESCHLAGEN: $uri (Bucket-Name prüfen oder Rechte)"
  fi
}

# Nur die beiden typischen Firebase-Storage-Bucket-Namen (kein Durchlauf aller gcf-*-Buckets).
for bname in "${PROJECT}.firebasestorage.app" "${PROJECT}.appspot.com"; do
  uri="gs://$bname"
  if command -v gcloud >/dev/null 2>&1; then
    if gcloud storage buckets describe "$uri" --project="$PROJECT" &>/dev/null; then
      echo ""
      echo ">>> Bucket: $uri"
      if gcloud storage buckets update "$uri" --cors-file="$CORS_FILE" --project="$PROJECT"; then
        echo ">>> gcloud OK: $uri"
      else
        echo ">>> gcloud fehlgeschlagen; versuche gsutil: $uri"
        apply_gsutil "$uri"
      fi
    else
      echo ">>> Übersprungen (Bucket existiert nicht — bei neuen Projekten normal): $uri"
    fi
  elif command -v gsutil >/dev/null 2>&1; then
    if gsutil ls "$uri" >/dev/null 2>&1; then
      apply_gsutil "$uri"
    else
      echo ">>> Übersprungen (Bucket existiert nicht): $uri"
    fi
  fi
done

echo ""
echo "=== Fertig ==="
echo "Browser: Hard-Reload (Cache leeren). Bei PWA: App neu starten."
echo "Wenn Fehler bleibt: In Google Cloud Console → Cloud Storage → Bucket → Konfiguration → CORS prüfen."
