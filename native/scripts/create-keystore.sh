#!/usr/bin/env bash
# Creates a fresh release keystore for signing the PayBox Android app.
# Run once; keep the resulting .jks file in a password manager / safe
# place. Losing it means you can never ship an update to Play Store
# with the same app id.
#
# Usage:
#     ./scripts/create-keystore.sh

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NATIVE_ROOT="$(cd "$HERE/.." && pwd)"
OUT="$NATIVE_ROOT/release.jks"

if [ -f "$OUT" ]; then
  echo "[keystore] $OUT already exists — refusing to overwrite."
  exit 1
fi

if ! command -v keytool >/dev/null 2>&1; then
  echo "[keystore] keytool not found. Install JDK 17+ (brew install openjdk@17)." >&2
  exit 1
fi

echo "[keystore] creating $OUT (Play-compatible RSA 2048, 25-year validity)"
echo
keytool -genkeypair \
  -v \
  -keystore "$OUT" \
  -storetype JKS \
  -alias paybox \
  -keyalg RSA \
  -keysize 2048 \
  -validity 9125

PROPS="$NATIVE_ROOT/android/keystore.properties"
if [ ! -f "$PROPS" ]; then
  cat > "$PROPS" <<EOF
storeFile=../../release.jks
storePassword=REPLACE_WITH_STORE_PASSWORD
keyAlias=paybox
keyPassword=REPLACE_WITH_KEY_PASSWORD
EOF
  echo
  echo "[keystore] wrote $PROPS — edit the two REPLACE_WITH_* values."
fi

echo
echo "[keystore] Next steps:"
echo "  1) Fill in android/keystore.properties with the passwords you just typed."
echo "  2) Run: cd native && npm run sync:android"
echo "  3) Build the AAB: (cd android && ./gradlew bundleRelease)"
echo "  4) Upload native/android/app/build/outputs/bundle/release/app-release.aab to Play Console."
