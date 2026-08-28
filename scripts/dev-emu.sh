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

# The emulator stores data under the project the *client* connects as, so
# this flag must match GCP_PROJECT_ID or the app looks in one namespace
# while the emulator reports another. It is read from .env.local, the same
# file `next dev` reads, rather than hard-coded.
project="$(sed -nE 's/^[[:space:]]*GCP_PROJECT_ID[[:space:]]*=[[:space:]]*"?([^"#[:space:]]+)"?.*/\1/p' .env.local 2>/dev/null | tail -1)"
if [ -z "$project" ]; then
  echo "GCP_PROJECT_ID is not set in .env.local — the app would connect to a" >&2
  echo "different namespace than this emulator reports. Set it and retry." >&2
  exit 1
fi
echo "Emulator project: $project (matching GCP_PROJECT_ID)"

mkdir -p .emulator-data
exec npx firebase emulators:exec --only firestore --project "$project" \
  --import ./.emulator-data --export-on-exit ./.emulator-data \
  "npx next dev"
