#!/bin/bash
rm -f /etc/udev/rules.d/70-p2p-kiwi-input.rules
if command -v udevadm >/dev/null 2>&1; then
  udevadm control --reload-rules || true
fi
