#!/usr/bin/env bash
set -euo pipefail

# Needs to be run in macOS environment
# Imports Apple signing certificate and App Store Connect API key from GitHub secrets
# Creates a temporary keychain and imports the certificate into it
# Sets up outputs for use in later steps
#
# Requires the following secrets to be set and assigned to env in the repository:
# - BUILD_CERTIFICATE_BASE64: Base64 encoded .p12 certificate file
# - P12_PASSWORD: Base64 encoded password for the .p12 certificate
# - AUTH_KEY_BASE64: Base64 encoded .p8 auth key file for notarization

if [ -z "${BUILD_CERTIFICATE_BASE64:-}" ]; then echo "Error: BUILD_CERTIFICATE_BASE64 is not set"; exit 1; fi
if [ -z "${P12_PASSWORD:-}" ]; then echo "Error: P12_PASSWORD is not set"; exit 1; fi
if [ -z "${AUTH_KEY_BASE64:-}" ]; then echo "Error: AUTH_KEY_BASE64 is not set"; exit 1; fi
if [ -z "${RUNNER_TEMP:-}" ]; then echo "Error: RUNNER_TEMP is not set"; exit 1; fi
if [ -z "${GITHUB_OUTPUT:-}" ]; then echo "Error: GITHUB_OUTPUT is not set"; exit 1; fi

CERTIFICATE_PATH=$RUNNER_TEMP/build_certificate.p12
KEYCHAIN_PATH=$RUNNER_TEMP/app-signing.keychain-db
AUTH_KEY_PATH=$RUNNER_TEMP/AuthKey.p8
KEYCHAIN_PASSWORD=$(date +%s | sha256sum | base64 | head -c 32)
P12_PASSWORD=$(echo -n "$P12_PASSWORD" | base64 --decode)

echo -n "$BUILD_CERTIFICATE_BASE64" | base64 --decode -o "$CERTIFICATE_PATH"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

security import "$CERTIFICATE_PATH" -P "$P12_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security list-keychain -d user -s "$KEYCHAIN_PATH"

echo -n "$AUTH_KEY_BASE64" | base64 --decode -o "$AUTH_KEY_PATH"

{
  echo "auth_key_path=$AUTH_KEY_PATH"
  echo "keychain_path=$KEYCHAIN_PATH"
  echo "certificate_path=$CERTIFICATE_PATH"
} >> "$GITHUB_OUTPUT"
