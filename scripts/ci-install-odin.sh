#!/usr/bin/env bash
set -euo pipefail

if command -v odin >/dev/null 2>&1; then
  odin version
  exit 0
fi

VERSION="${ODIN_RELEASE:-dev-2026-09}"
OS="$(uname -s)"
ARCH="$(uname -m)"
ASSET=""
case "$OS" in
  Linux)
    ASSET="odin-linux-amd64-${VERSION}.zip"
    ;;
  Darwin)
    if [ "$ARCH" = "arm64" ]; then
      ASSET="odin-macos-arm64-${VERSION}.zip"
    else
      ASSET="odin-macos-amd64-${VERSION}.zip"
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    ASSET="odin-windows-amd64-${VERSION}.zip"
    ;;
  *)
    echo "unsupported OS for Odin install: $OS"
    exit 0
    ;;
esac

TMP="$(mktemp -d)"
URL="https://github.com/odin-lang/Odin/releases/download/${VERSION}/${ASSET}"
echo "Downloading $URL"
curl -fsSL "$URL" -o "$TMP/odin.zip"
unzip -q "$TMP/odin.zip" -d "$TMP"
BIN="$(find "$TMP" -type f -name odin -o -name odin.exe | head -n 1)"
if [ -z "$BIN" ]; then
  echo "Odin binary not found in archive"
  exit 1
fi
INSTALL_DIR="${HOME}/.local/bin"
mkdir -p "$INSTALL_DIR"
cp "$BIN" "$INSTALL_DIR/odin"
chmod +x "$INSTALL_DIR/odin"
echo "$INSTALL_DIR" >> "$GITHUB_PATH"
"$INSTALL_DIR/odin" version
