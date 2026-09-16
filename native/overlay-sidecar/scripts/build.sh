#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT/dist}"
BIN_NAME="${SIDECAR_BIN_NAME:-p2p-kiwi-sidecar}"
mkdir -p "$OUT_DIR"

ODIN="${ODIN:-odin}"
if ! command -v "$ODIN" >/dev/null 2>&1; then
  echo "odin compiler not found" >&2
  exit 1
fi

EXTRA_FLAGS=()
UNAME="$(uname -s)"
ARCH="$(uname -m)"
CC="${CC:-cc}"

case "$UNAME" in
  Linux)
    DRAW_OBJ="$OUT_DIR/overlay_draw.o"
    LINUX_OBJ="$OUT_DIR/overlay_linux.o"
    WAYLAND_OBJ="$OUT_DIR/wlr-layer-shell-protocol.o"
    "$CC" -c "$ROOT/c/overlay_draw.c" -o "$DRAW_OBJ" -fPIC -O2 -I"$ROOT/c"
    WAYLAND_FLAGS=()
    if command -v wayland-scanner >/dev/null 2>&1 && pkg-config --exists wayland-client; then
      wayland-scanner client-header \
        "$ROOT/protocol/wlr-layer-shell-unstable-v1.xml" \
        "$ROOT/c/wlr-layer-shell-client-protocol.h"
      wayland-scanner private-code \
        "$ROOT/protocol/wlr-layer-shell-unstable-v1.xml" \
        "$OUT_DIR/wlr-layer-shell-protocol.c"
      "$CC" -c "$OUT_DIR/wlr-layer-shell-protocol.c" -o "$WAYLAND_OBJ" -fPIC -O2 $(pkg-config --cflags wayland-client)
      WAYLAND_FLAGS=(-DHAVE_WAYLAND -I"$ROOT/c" $(pkg-config --cflags wayland-client))
      "$CC" -c "$ROOT/c/overlay_linux.c" -o "$LINUX_OBJ" -fPIC -O2 "${WAYLAND_FLAGS[@]}" $(pkg-config --cflags x11 xfixes xext xrandr 2>/dev/null || true)
      LIBS="$DRAW_OBJ $LINUX_OBJ $WAYLAND_OBJ $(pkg-config --libs x11 xfixes xext xrandr wayland-client 2>/dev/null || echo '-lX11 -lXfixes -lXext -lXrandr -lwayland-client') -lm"
    else
      "$CC" -c "$ROOT/c/overlay_linux.c" -o "$LINUX_OBJ" -fPIC -O2 -I"$ROOT/c" $(pkg-config --cflags x11 xfixes xext xrandr 2>/dev/null || true)
      LIBS="$DRAW_OBJ $LINUX_OBJ $(pkg-config --libs x11 xfixes xext xrandr 2>/dev/null || echo '-lX11 -lXfixes -lXext -lXrandr') -lm"
    fi
    EXTRA_FLAGS+=("-extra-linker-flags:$LIBS")
    ;;
  Darwin)
    DRAW_OBJ="$OUT_DIR/overlay_draw.o"
    MAC_OBJ="$OUT_DIR/overlay_macos.o"
    "$CC" -c "$ROOT/c/overlay_draw.c" -o "$DRAW_OBJ" -O2 -I"$ROOT/c"
    clang -c "$ROOT/c/overlay_macos.m" -o "$MAC_OBJ" -fobjc-arc -O2 -I"$ROOT/c"
    EXTRA_FLAGS+=("-extra-linker-flags:$DRAW_OBJ $MAC_OBJ -framework Cocoa -framework AppKit -framework Foundation -framework ApplicationServices -lm")
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    DRAW_OBJ="$OUT_DIR/overlay_draw.o"
    WIN_OBJ="$OUT_DIR/overlay_win32.o"
    "$CC" -c "$ROOT/c/overlay_draw.c" -o "$DRAW_OBJ" -O2 -I"$ROOT/c"
    "$CC" -c "$ROOT/c/overlay_win32.c" -o "$WIN_OBJ" -O2 -I"$ROOT/c"
    EXTRA_FLAGS+=("-extra-linker-flags:$DRAW_OBJ $WIN_OBJ -lgdi32 -luser32 -ldwmapi")
    BIN_NAME="${BIN_NAME}.exe"
    ;;
esac

"$ODIN" build "$ROOT" -out:"$OUT_DIR/$BIN_NAME" -o:speed "${EXTRA_FLAGS[@]}"
echo "built $OUT_DIR/$BIN_NAME ($UNAME $ARCH)"
