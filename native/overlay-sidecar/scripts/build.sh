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

gen_cursor_png_h() {
  local png="$ROOT/../../assets/cursor.png"
  local out="$ROOT/c/cursor_png.h"
  if [[ ! -f "$png" ]]; then
    echo "missing cursor asset: $png" >&2
    exit 1
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$png" "$out" <<'PY'
import sys
png, out = sys.argv[1], sys.argv[2]
data = open(png, "rb").read()
parts = []
line = []
for b in data:
    line.append("0x%02x" % b)
    if len(line) == 12:
        parts.append(", ".join(line))
        line = []
if line:
    parts.append(", ".join(line))
open(out, "w").write(
    "#ifndef P2P_KIWI_CURSOR_PNG_H\n"
    "#define P2P_KIWI_CURSOR_PNG_H\n"
    "static const unsigned char cursor_png[] = {\n  "
    + ",\n  ".join(parts)
    + "\n};\n"
    "static const unsigned int cursor_png_len = %d;\n"
    "#endif\n" % len(data)
)
PY
    return
  fi
  if command -v xxd >/dev/null 2>&1; then
    {
      echo '#ifndef P2P_KIWI_CURSOR_PNG_H'
      echo '#define P2P_KIWI_CURSOR_PNG_H'
      xxd -i "$png" | sed -e 's/unsigned char .*\[\]/static const unsigned char cursor_png[]/' -e 's/unsigned int .*_len/static const unsigned int cursor_png_len/'
      echo '#endif'
    } > "$out"
    return
  fi
  echo "python3 or xxd required to embed assets/cursor.png" >&2
  exit 1
}

build_darwin() {
  local clang_arch="$1"
  local odin_target="$2"
  local suffix="$3"
  local out_bin="$4"
  local clang="${CC:-clang}"
  local draw_obj="$OUT_DIR/overlay_draw.${suffix}.o"
  local mac_obj="$OUT_DIR/overlay_macos.${suffix}.o"

  "$clang" -arch "$clang_arch" -c "$ROOT/c/overlay_draw.c" -o "$draw_obj" -O2 -I"$ROOT/c"
  "$clang" -arch "$clang_arch" -c "$ROOT/c/overlay_macos.m" -o "$mac_obj" -fobjc-arc -O2 -I"$ROOT/c"
  "$ODIN" build "$ROOT" -target:"$odin_target" -out:"$out_bin" -o:speed \
    "-extra-linker-flags:$draw_obj $mac_obj -arch $clang_arch -framework Cocoa -framework AppKit -framework Foundation -framework ApplicationServices -lm"
}

assert_universal_sidecar() {
  local bin="$1"
  local archs
  archs="$(lipo -archs "$bin")"
  echo "sidecar architectures: $archs"
  if ! echo "$archs" | grep -qw arm64; then
    echo "sidecar missing arm64 slice: $archs" >&2
    exit 1
  fi
  if ! echo "$archs" | grep -qw x86_64; then
    echo "sidecar missing x86_64 slice: $archs" >&2
    exit 1
  fi
}

gen_cursor_png_h

EXTRA_FLAGS=()
UNAME="$(uname -s)"
ARCH="$(uname -m)"
CC="${CC:-cc}"
SKIP_FINAL_BUILD=0

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
    SIDECAR_ARCH="${SIDECAR_ARCH:-host}"
    if [[ "$SIDECAR_ARCH" == "universal" ]]; then
      ARM_BIN="$OUT_DIR/${BIN_NAME}-arm64"
      AMD_BIN="$OUT_DIR/${BIN_NAME}-amd64"
      build_darwin arm64 darwin_arm64 arm64 "$ARM_BIN"
      build_darwin x86_64 darwin_amd64 amd64 "$AMD_BIN"
      lipo -create "$ARM_BIN" "$AMD_BIN" -output "$OUT_DIR/$BIN_NAME"
      rm -f "$ARM_BIN" "$AMD_BIN"
      assert_universal_sidecar "$OUT_DIR/$BIN_NAME"
      echo "built $OUT_DIR/$BIN_NAME (Darwin universal)"
    elif [[ "$ARCH" == "x86_64" ]]; then
      build_darwin x86_64 darwin_amd64 host "$OUT_DIR/$BIN_NAME"
      echo "built $OUT_DIR/$BIN_NAME ($UNAME $ARCH)"
    else
      build_darwin arm64 darwin_arm64 host "$OUT_DIR/$BIN_NAME"
      echo "built $OUT_DIR/$BIN_NAME ($UNAME $ARCH)"
    fi
    SKIP_FINAL_BUILD=1
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    WIN_CC="${WIN_CC:-clang}"

    pushd "$ROOT" >/dev/null

    mkdir -p dist

    "$WIN_CC" \
      -c c/overlay_draw.c \
      -o dist/overlay_draw.obj \
      -O2 \
      -Ic

    "$WIN_CC" \
      -c c/overlay_win32.c \
      -o dist/overlay_win32.obj \
      -O2 \
      -Ic

    BIN_NAME="${BIN_NAME}.exe"

    "$ODIN" build . \
      -out:"dist/$BIN_NAME" \
      -o:speed

    popd >/dev/null

    SKIP_FINAL_BUILD=1
    ;;
esac

if [[ "$SKIP_FINAL_BUILD" -eq 0 ]]; then
  "$ODIN" build "$ROOT" -out:"$OUT_DIR/$BIN_NAME" -o:speed "${EXTRA_FLAGS[@]}"
  echo "built $OUT_DIR/$BIN_NAME ($UNAME $ARCH)"
fi
