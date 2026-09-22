#!/bin/bash
set -eu
SRC="/opt/p2p.kiwi/resources/udev/70-p2p-kiwi-input.rules"
DEST="/etc/udev/rules.d/70-p2p-kiwi-input.rules"
if [ -f "$SRC" ]; then
  cp "$SRC" "$DEST"
  chmod 644 "$DEST"
  if command -v udevadm >/dev/null 2>&1; then
    udevadm control --reload-rules || true
    udevadm trigger --subsystem-match=input --subsystem-match=misc || true
  fi
fi
