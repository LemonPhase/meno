#!/usr/bin/env bash
# Dogfood mode with a LOCAL Firestore: real Gemini via Vertex AI (needs
# GCP_PROJECT_ID + ADC), but all data in the Firestore emulator, persisted
# across restarts in .emulator-data/ so Sessions survive like production.
set -euo pipefail

java_major() { "$1" -version 2>&1 | sed -nE 's/.*version "([0-9]+).*/\1/p' | head -1; }
if ! command -v java >/dev/null || [ "$(java_major java)" -lt 21 ]; then
  for jvm in /usr/lib/jvm/java-21-openjdk*; do
    if [ -x "$jvm/bin/java" ]; then
      export JAVA_HOME="$jvm"
      export PATH="$jvm/bin:$PATH"
      break
    fi
  done
fi

mkdir -p .emulator-data
exec npx firebase emulators:exec --only firestore --project demo-meno \
  --import ./.emulator-data --export-on-exit ./.emulator-data \
  "npx next dev"
