#!/usr/bin/env bash
# Verifies the signed macOS app and the nested sidecar helper.
# Usage: ci-verify-macos-signature.sh signed|notarized
set -euo pipefail

MODE="${1:-signed}"
APP="${APP:-dist/mac-universal/p2p.kiwi.app}"
DMG="${DMG:-dist/p2p-kiwi_universal.dmg}"
HELPER="${HELPER:-$APP/Contents/Helpers/p2p.kiwi Sidecar.app}"
HELPER_BIN="$HELPER/Contents/MacOS/p2p-kiwi-sidecar"

if [ ! -d "$APP" ]; then
  echo "Error: app bundle not found: $APP"
  exit 1
fi
if [ ! -f "$HELPER_BIN" ]; then
  echo "Error: sidecar helper not found: $HELPER_BIN"
  exit 1
fi

echo "codesign --verify app"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "codesign -dv app"
codesign -dv --verbose=4 "$APP"

echo "codesign -dv helper"
codesign -dv --verbose=4 "$HELPER"

echo "codesign entitlements app"
codesign -d --entitlements - "$APP"

echo "codesign entitlements helper"
HELPER_ENT="$(codesign -d --entitlements - "$HELPER_BIN" 2>&1 || true)"
printf '%s\n' "$HELPER_ENT"

for forbidden in \
  com.apple.security.cs.allow-jit \
  com.apple.security.cs.allow-unsigned-executable-memory \
  com.apple.security.cs.allow-dyld-environment-variables \
  com.apple.security.device.camera \
  com.apple.security.device.audio-input
do
  if printf '%s\n' "$HELPER_ENT" | grep -q "$forbidden"; then
    echo "Error: helper entitlements contain $forbidden"
    exit 1
  fi
done

DISPLAY_OUT="$(codesign -dv --verbose=4 "$HELPER" 2>&1)"
printf '%s\n' "$DISPLAY_OUT"
if ! printf '%s\n' "$DISPLAY_OUT" | grep -q 'runtime'; then
  echo "Error: helper is not signed with hardened runtime"
  exit 1
fi

ARCHS="$(lipo -archs "$HELPER_BIN")"
echo "sidecar architectures: $ARCHS"
if ! printf '%s\n' "$ARCHS" | grep -qw arm64; then
  echo "Error: sidecar missing arm64 slice: $ARCHS"
  exit 1
fi
if ! printf '%s\n' "$ARCHS" | grep -qw x86_64; then
  echo "Error: sidecar missing x86_64 slice: $ARCHS"
  exit 1
fi

if [ "$MODE" = "notarized" ]; then
  echo "spctl --assess app"
  spctl --assess --type execute --verbose=4 "$APP"
  echo "stapler validate app"
  xcrun stapler validate "$APP"
  echo "stapler validate dmg"
  xcrun stapler validate "$DMG"
fi
