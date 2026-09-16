#!/usr/bin/env bash

if [ -z "$VERSION" ]; then echo "Error: VERSION is not set"; exit 1; fi
if [ -z "$PLATFORM" ]; then echo "Error: PLATFORM is not set"; exit 1; fi

update_package_json_version() {
  local tmp
  tmp=$(mktemp)
  jq --arg v "$VERSION" '.version = $v' package.json > "$tmp" && mv "$tmp" package.json
}

update_package_json_version

build_sidecar() {
  mkdir -p native/overlay-sidecar/dist
  if command -v odin >/dev/null 2>&1; then
    ./native/overlay-sidecar/scripts/build.sh native/overlay-sidecar/dist || {
      echo "Warning: sidecar build failed; continuing with Electron overlay fallback"
    }
  else
    echo "Warning: odin not found; packaging without native sidecar"
  fi
}

build_windows() {
  build_sidecar
  pnpm run build && ./node_modules/.bin/electron-builder --win --publish never
}

build_linux() {
  build_sidecar
  pnpm run build && ./node_modules/.bin/electron-builder --linux --publish never
}

build_linux_arm64() {
  mkdir -p native/overlay-sidecar/dist
  echo "Skipping native sidecar on linux-arm64 cross-build; Electron overlay fallback remains"
  pnpm run build && ./node_modules/.bin/electron-builder --linux deb --publish never --arm64 && \
    pnpm run build && ./node_modules/.bin/electron-builder --linux flatpak --publish never --arm64 && \
    pnpm run build && ./node_modules/.bin/electron-builder --linux appimage --publish never --arm64
}

build_linux_debug() {
  build_sidecar
  pnpm run build && ./node_modules/.bin/electron-builder --linux deb --publish never
}

build_macos() {
  build_sidecar
  pnpm run build && ./node_modules/.bin/electron-builder --mac --publish never
}

case $PLATFORM in
  "linux")
    build_linux
    ;;
  "linux-arm64")
    build_linux_arm64
    ;;
  "linux-debug")
    build_linux_debug
    ;;
  "macos")
    build_macos
    ;;
  "windows")
    build_windows
    ;;
  *)
    echo "Error: PLATFORM $PLATFORM is not supported"
    exit 1
    ;;
esac
