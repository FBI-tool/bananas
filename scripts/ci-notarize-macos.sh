#!/usr/bin/env bash
set -euo pipefail

# Notarizes and staples the universal macOS DMG produced by electron-builder.
#
# Requires:
# - AUTH_KEY_PATH: path to App Store Connect API .p8 key
# - KEY_ID: App Store Connect API key ID
# - ISSUER: App Store Connect issuer UUID

if [ -z "${AUTH_KEY_PATH:-}" ]; then echo "Error: AUTH_KEY_PATH is not set"; exit 1; fi
if [ -z "${KEY_ID:-}" ]; then echo "Error: KEY_ID is not set"; exit 1; fi
if [ -z "${ISSUER:-}" ]; then echo "Error: ISSUER is not set"; exit 1; fi

DMG="${DMG:-dist/p2p-kiwi_universal.dmg}"
APP="${APP:-dist/mac-universal/p2p.kiwi.app}"

if [ ! -d "$APP" ]; then
  echo "Error: app bundle not found: $APP"
  ls -l dist/ 2>/dev/null || echo "dist/ directory does not exist"
  exit 1
fi

if [ ! -f "$DMG" ]; then
  echo "Error: DMG not found: $DMG"
  ls -l dist/ 2>/dev/null || echo "dist/ directory does not exist"
  exit 1
fi

SIDECAR="${SIDECAR:-$APP/Contents/Resources/sidecar/p2p-kiwi-sidecar}"
if [ ! -f "$SIDECAR" ]; then
  echo "Error: sidecar not found: $SIDECAR"
  exit 1
fi

ARCHS="$(lipo -archs "$SIDECAR")"
echo "sidecar architectures: $ARCHS"
if ! echo "$ARCHS" | grep -qw arm64; then
  echo "Error: sidecar missing arm64 slice: $ARCHS"
  exit 1
fi
if ! echo "$ARCHS" | grep -qw x86_64; then
  echo "Error: sidecar missing x86_64 slice: $ARCHS"
  exit 1
fi

codesign --verify --strict "$SIDECAR"
DISPLAY_OUT="$(codesign --display --verbose=2 "$SIDECAR" 2>&1)"
echo "$DISPLAY_OUT"
if ! echo "$DISPLAY_OUT" | grep -q '(runtime)'; then
  echo "Error: sidecar is not signed with hardened runtime"
  exit 1
fi

codesign --verify --deep --strict "$APP"

output=$(xcrun notarytool submit "$DMG" \
  --key "$AUTH_KEY_PATH" \
  --key-id "$KEY_ID" \
  --issuer "$ISSUER" \
  --wait)

echo "$output"

if ! echo "$output" | grep -q "status: Accepted"; then
  echo "Error: notarization was not accepted"
  exit 1
fi

xcrun stapler staple "$DMG"
