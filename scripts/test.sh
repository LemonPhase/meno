#!/usr/bin/env bash
# The Firestore emulator (firebase-tools) needs Java 21+. If the default
# java is older, fall back to a known JDK 21 install.
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

# Its own port (firebase.test.json), so a dogfooding emulator on the
# default 8792 can keep running while the suite does. The two are already
# namespaced apart — tests are project meno-test, dogfooding is your own —
# so the only thing that ever collided was the port.
exec npx firebase emulators:exec --only firestore --project meno-test \
  --config firebase.test.json "npx vitest ${1:-run}"
