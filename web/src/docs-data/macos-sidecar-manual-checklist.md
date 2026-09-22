---
title: macOS sidecar manual checklist
excerpt: |
  Interactive checks for overlays, permissions, and emergency stop on
  a Mac. Signing and notarization are enforced in GitHub Actions.
description: |
  What to click through on a real Mac after a signed build. Gatekeeper
  and staple checks are not in this list.
order: 5
---

Signing, Gatekeeper, and notarization checks run in
GitHub Actions via `scripts/ci-verify-macos-signature.sh` on
`macos-latest`.

This list is the interactive behavior that CI cannot
click through.

Record the macOS version, architecture, and whether the build was a
signed DMG. Keystrokes are not recorded.

- Fresh signed install launches Electron and `p2p.kiwi Sidecar`. No
  Accessibility or Input Monitoring prompt appears until you use remote
  control or press the permission button in Settings.
- Cursor overlay with Accessibility still not granted: the overlay is
  click-through and does not take focus, where the OS allows the window.
- Accessibility denied or revoked in System Settings: injection stops
  and stays unavailable. Chat and view-only still work.
- Input Monitoring unavailable: the helper reports that state, and
  remote control stays disarmed because the emergency stop is not
  available.
- Screen Recording denied: screen share fails. Chat and view-only still
  work. The sidecar does not ask for Screen Recording.
- A mouse-only grant rejects keyboard events. A keyboard-only grant
  rejects pointer events.
- Two displays, a Retina display, and a display with a negative origin
  place the overlay and injected pointer on the shared display.
- Fullscreen and Spaces: note what stayed on top. The lock screen and
  some fullscreen Spaces are expected gaps.
- Disconnect or revoke while a modifier or button is held: the host
  releases that injected state.
- Emergency stop while the p2p.kiwi window is unfocused or minimized:
  injection stops without waiting for the network.
- Kill the sidecar and let it restart: control is not armed again until
  the host grants it again.
- Update or reinstall: confirm System Settings still shows
  `p2p.kiwi Sidecar` (`kiwi.p2p.desktop.sidecar`) and whether macOS
  asked for the same permissions again.
