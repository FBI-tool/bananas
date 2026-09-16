#!/usr/bin/env bash
set -euo pipefail

if [ -z "${VERSION:-}" ]; then echo "Error: VERSION is not set"; exit 1; fi
if [ -z "${TARGET_PLATFORM:-}" ]; then echo "Error: TARGET_PLATFORM is not set"; exit 1; fi

update_package_json_version() {
  local tmp
  tmp=$(mktemp)
  jq --arg v "$VERSION" '.version = $v' package.json > "$tmp" && mv "$tmp" package.json
}

sidecar_binary_name() {
  if [ "$TARGET_PLATFORM" = "windows" ]; then
    echo "p2p-kiwi-sidecar.exe"
  else
    echo "p2p-kiwi-sidecar"
  fi
}

require_sidecar_binary() {
  local bin
  bin="native/overlay-sidecar/dist/$(sidecar_binary_name)"
  if [ ! -f "$bin" ]; then
    echo "Error: sidecar binary missing: $bin" >&2
    exit 1
  fi
  if [ "$TARGET_PLATFORM" = "macos" ]; then
    local archs
    archs="$(lipo -archs "$bin")"
    echo "sidecar architectures: $archs"
    if ! echo "$archs" | grep -qw arm64; then
      echo "Error: sidecar missing arm64 slice: $archs" >&2
      exit 1
    fi
    if ! echo "$archs" | grep -qw x86_64; then
      echo "Error: sidecar missing x86_64 slice: $archs" >&2
      exit 1
    fi
  fi
}

update_package_json_version

build_sidecar() {
  mkdir -p native/overlay-sidecar/dist
  local odin="${ODIN:-odin}"
  if ! command -v "$odin" >/dev/null 2>&1 && [[ ! -x "$odin" ]]; then
    echo "Error: odin compiler not found; native sidecar is required for this platform" >&2
    exit 1
  fi
  ODIN="$odin" ./native/overlay-sidecar/scripts/build.sh native/overlay-sidecar/dist
  require_sidecar_binary
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
  SIDECAR_ARCH=universal build_sidecar
  pnpm run build && ./node_modules/.bin/electron-builder --mac --publish never
}

case $TARGET_PLATFORM in
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
    echo "Error: TARGET_PLATFORM $TARGET_PLATFORM is not supported"
    exit 1
    ;;
esac
