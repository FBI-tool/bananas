#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PKGNAME="p2p-kiwi"
PKGREL="${PKGREL:-1}"
PKGDEST="${PKGDEST:-$ROOT/dist}"
WORKDIR="$PKGDEST/arch-pkg"

usage() {
  cat <<'EOF'
Usage: ./scripts/build-arch.sh [options] [deb-file]

Build an Arch Linux package (.pkg.tar.zst) from sources or an existing .deb.
Install it with: sudo pacman -U dist/p2p-kiwi-*.pkg.tar.zst

Options:
  --from-source     Build a .deb with electron-builder, then package it
  --deb PATH        Convert an existing .deb
  -h, --help        Show this help

If no .deb is given, sources are built.

Environment:
  VERSION           App version written into package.json before a source build
                    (default: current package.json version)
  PKGREL            Package release number (default: 1)
  PKGDEST           Output directory (default: dist)

Examples:
  ./scripts/build-arch.sh
  ./scripts/build-arch.sh dist/p2p-kiwi_amd64.deb
  ./scripts/build-arch.sh --deb ./p2p-kiwi_amd64.deb
EOF
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: '$1' is required but not installed." >&2
    shift
    if [[ $# -gt 0 ]]; then
      echo "$*" >&2
    fi
    exit 1
  fi
}

host_deb_arch() {
  case "$(uname -m)" in
    x86_64) echo "amd64" ;;
    aarch64) echo "arm64" ;;
    *)
      echo "Error: unsupported host architecture $(uname -m)" >&2
      exit 1
      ;;
  esac
}

deb_to_arch() {
  case "$1" in
    amd64|x86_64) echo "x86_64" ;;
    arm64|aarch64) echo "aarch64" ;;
    i386|i686) echo "i686" ;;
    *)
      echo "Error: unsupported Debian architecture '$1'" >&2
      exit 1
      ;;
  esac
}

sanitize_pkgver() {
  # Arch pkgver cannot contain hyphens.
  echo "$1" | tr '-' '_'
}

quote_single() {
  printf "%s" "$1" | sed "s/'/'\\\\''/g"
}

deb_control_text() {
  local deb="$1"
  local tmp archive
  tmp="$(mktemp -d)"
  bsdtar -C "$tmp" -xf "$deb"
  archive="$(find "$tmp" -maxdepth 1 -name 'control.tar.*' -print | head -n 1)"
  if [[ -z "$archive" ]]; then
    echo "Error: no control.tar.* inside $deb" >&2
    rm -rf "$tmp"
    exit 1
  fi
  local control
  control="$(bsdtar -xOf "$archive" ./control 2>/dev/null || bsdtar -xOf "$archive" control || true)"
  rm -rf "$tmp"
  if [[ -z "$control" ]]; then
    echo "Error: could not read control file from $deb" >&2
    exit 1
  fi
  printf '%s\n' "$control"
}

deb_control_field() {
  local deb="$1"
  local field="$2"
  deb_control_text "$deb" | sed -n "s/^${field}:[[:space:]]*//p" | head -n 1
}

find_built_deb() {
  local want_arch="$1"
  local candidates=("$ROOT/dist/${PKGNAME}_${want_arch}.deb")
  if [[ "$want_arch" == "amd64" ]]; then
    candidates+=("$ROOT/dist/${PKGNAME}_x64.deb")
  fi
  local f
  for f in "${candidates[@]}"; do
    if [[ -f "$f" ]]; then
      echo "$f"
      return 0
    fi
  done
  shopt -s nullglob
  local matches=("$ROOT/dist"/*.deb)
  shopt -u nullglob
  if [[ ${#matches[@]} -eq 1 ]]; then
    echo "${matches[0]}"
    return 0
  fi
  echo "Error: could not find a .deb in dist/ (looked for ${PKGNAME}_${want_arch}.deb)" >&2
  ls -l "$ROOT/dist" || true
  exit 1
}

build_deb_from_source() {
  local want_arch="$1"
  need_cmd pnpm "Install pnpm, then run: pnpm install && pnpm run install:electron"
  need_cmd jq "Install jq (pacman -S jq)"
  if [[ ! -x "$ROOT/node_modules/.bin/electron-builder" ]]; then
    echo "Error: electron-builder is missing. Run: pnpm install" >&2
    exit 1
  fi

  local version="${VERSION:-$(jq -r .version package.json)}"
  VERSION="$version" ./scripts/set-version.sh

  local eb_arch=(--x64)
  if [[ "$want_arch" == "arm64" ]]; then
    eb_arch=(--arm64)
  fi

  echo "Building Linux .deb from sources (version $version, arch $want_arch)..."
  pnpm run build
  ./node_modules/.bin/electron-builder --linux deb --publish never "${eb_arch[@]}"
}

write_pkgbuild() {
  local pkgver="$1"
  local arch="$2"
  local deb_name="$3"
  local deb_sha="$4"
  local license_sha="$5"
  local pkgdesc="$6"
  local maintainer="$7"
  local url="$8"

  cat > "$WORKDIR/PKGBUILD" <<EOF
# Maintainer: ${maintainer}

pkgname=${PKGNAME}
pkgver=${pkgver}
pkgrel=${PKGREL}
pkgdesc='$(quote_single "$pkgdesc")'
arch=('${arch}')
url='$(quote_single "$url")'
license=('MIT')
depends=(
  'alsa-lib'
  'at-spi2-core'
  'gtk3'
  'libnotify'
  'libsecret'
  'libxss'
  'libxtst'
  'nss'
  'xdg-utils'
)
options=('!strip' '!debug')
source=('${deb_name}' 'LICENSE')
noextract=('${deb_name}')
sha256sums=('${deb_sha}' '${license_sha}')

package() {
  cd "\$srcdir"
  bsdtar -xf "${deb_name}"
  bsdtar -xf data.tar.* -C "\$pkgdir"

  local sandbox
  sandbox="\$(find "\$pkgdir" -name chrome-sandbox -type f | head -n 1 || true)"
  if [[ -n "\$sandbox" ]]; then
    chmod 4755 "\$sandbox"
  fi

  if [[ ! -e "\$pkgdir/usr/bin/${PKGNAME}" ]]; then
    local exec_path
    exec_path="\$(find "\$pkgdir/opt" -maxdepth 2 -type f \\( -name '${PKGNAME}' -o -name 'p2p.kiwi' \\) | head -n 1 || true)"
    if [[ -n "\$exec_path" ]]; then
      install -dm755 "\$pkgdir/usr/bin"
      ln -s "\${exec_path#"\$pkgdir"}" "\$pkgdir/usr/bin/${PKGNAME}"
    fi
  fi

  install -Dm644 "\$srcdir/LICENSE" "\$pkgdir/usr/share/licenses/${PKGNAME}/LICENSE"
}
EOF
}

DEB=""
FROM_SOURCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --from-source)
      FROM_SOURCE=1
      shift
      ;;
    --deb)
      if [[ $# -lt 2 ]]; then
        echo "Error: --deb requires a path" >&2
        exit 1
      fi
      DEB="$2"
      shift 2
      ;;
    *.deb)
      DEB="$1"
      shift
      ;;
    *)
      echo "Error: unknown argument '$1'" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -n "$DEB" && "$FROM_SOURCE" -eq 1 ]]; then
  echo "Error: use either --from-source or a .deb, not both" >&2
  exit 1
fi

need_cmd bsdtar "Install libarchive (pacman -S libarchive)"
need_cmd makepkg "Install base-devel (pacman -S --needed base-devel)"
need_cmd sha256sum
need_cmd jq "Install jq (pacman -S jq)"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Error: makepkg cannot run as root. Run this script as a normal user." >&2
  exit 1
fi

if [[ -z "$DEB" ]]; then
  FROM_SOURCE=1
fi

if [[ "$FROM_SOURCE" -eq 1 ]]; then
  build_deb_from_source "$(host_deb_arch)"
  DEB="$(find_built_deb "$(host_deb_arch)")"
fi

if [[ ! -f "$DEB" ]]; then
  echo "Error: .deb not found: $DEB" >&2
  exit 1
fi

DEB="$(cd "$(dirname "$DEB")" && pwd)/$(basename "$DEB")"

deb_arch_raw="$(deb_control_field "$DEB" Architecture)"
if [[ -z "$deb_arch_raw" ]]; then
  echo "Error: could not read Architecture from $DEB" >&2
  exit 1
fi
arch="$(deb_to_arch "$deb_arch_raw")"

deb_version="$(deb_control_field "$DEB" Version)"
if [[ -z "$deb_version" ]]; then
  deb_version="$(jq -r .version package.json)"
fi
pkgver="$(sanitize_pkgver "$deb_version")"

pkgdesc="$(jq -r .description package.json)"
url="$(jq -r .homepage package.json)"
maintainer="$(jq -r '"\(.author.name) <\(.author.email)>"' package.json)"

deb_name="${PKGNAME}-${pkgver}.deb"
mkdir -p "$WORKDIR" "$PKGDEST"
rm -rf "${WORKDIR:?}/"*
cp "$DEB" "$WORKDIR/$deb_name"
cp "$ROOT/LICENSE" "$WORKDIR/LICENSE"

deb_sha="$(sha256sum "$WORKDIR/$deb_name" | awk '{print $1}')"
license_sha="$(sha256sum "$WORKDIR/LICENSE" | awk '{print $1}')"

write_pkgbuild "$pkgver" "$arch" "$deb_name" "$deb_sha" "$license_sha" "$pkgdesc" "$maintainer" "$url"

echo "Building Arch package (pkgname=$PKGNAME pkgver=$pkgver arch=$arch)..."
makepkg_flags=(-f --clean)
if [[ "$(uname -m)" != "$arch" ]]; then
  echo "Warning: host is $(uname -m) but the .deb is $arch; using makepkg --ignorearch" >&2
  makepkg_flags+=(-A)
fi

(
  cd "$WORKDIR"
  PKGDEST="$PKGDEST" makepkg "${makepkg_flags[@]}"
)

shopt -s nullglob
artifacts=("$PKGDEST/${PKGNAME}-${pkgver}-${PKGREL}-${arch}".pkg.tar.*)
shopt -u nullglob
if [[ ${#artifacts[@]} -eq 0 ]]; then
  echo "Error: makepkg finished but no package was found in $PKGDEST" >&2
  exit 1
fi

echo
echo "Arch package ready:"
for artifact in "${artifacts[@]}"; do
  echo "  $artifact"
done
echo
echo "Install with:"
echo "  sudo pacman -U ${artifacts[0]}"
