---
title: Native overlay sidecar
excerpt: |
  p2p.kiwi ships an Odin helper (`p2p-kiwi-sidecar`) for always-on-top,
  click-through cursor overlays. Electron main is the only process that
  starts it. The renderer never executes sidecar commands.
description: |
  p2p.kiwi ships an Odin helper (`p2p-kiwi-sidecar`) for always-on-top,
  click-through cursor overlays. Electron main is the only process that
  starts it. The renderer never executes sidecar commands.
order: 4
---

p2p.kiwi ships an Odin helper (`p2p-kiwi-sidecar`) for always-on-top,
click-through cursor overlays. Electron main is the only process that
starts it. The renderer never executes sidecar commands.

## Capabilities

The sidecar reports what the current desktop can do instead of making
the UI branch on OS names:

- `overlays` - native overlay windows are available
- `clickThrough` - overlays ignore pointer input
- `displayEnumeration` - display list/bounds are available
- `pointerInjection` / `keyboardInjection` - OS input injection is
  available for remote control
- `emergencyHotkey` - the sidecar-native emergency stop is registered
- `keyboardCapture` - exclusive keyboard grab on the **controlling**
  peer so chords reach the host instead of local menus / the compositor
- `globalKeyboardObservation` - physical emergency-chord observation
  (required on Wayland together with injection)
- Permission probes (`accessibility`, `screenRecording`,
  `inputMonitoring`) are reported without prompting unless the user
  explicitly requests Accessibility from the UI

Remote control stays **disarmed by default**. The sidecar never
auto-restores an armed state after restart, IPC loss, or emergency stop.
If injection or the emergency hotkey is unavailable, capabilities stay
false and the app continues without remote control.

If `overlays` is false, p2p.kiwi keeps the existing Electron cursor
window. Calls still work.

## Linux compositor notes

Wayland and X11 are separate backends. Capabilities include an optional
`backend` field (`wayland`, `x11`, or `none`).

**Wayland (preferred):** `zwlr_layer_shell_v1` overlay layer, no keyboard
interactivity, `exclusive_zone = 0`, and an empty `wl_surface` input
region re-applied on every commit. This is the koverlay-equivalent path
on compositors that implement layer-shell (KWin, Hyprland, Sway, and
similar).

**X11 / XWayland (GNOME and other non-layer-shell sessions):**
override-redirect notification window, empty Shape/XFixes input region
after map, ARGB visual. Weaker than layer-shell: stacking and
click-through are best-effort, and XWayland passthrough is compositor-
dependent. Used only when layer-shell is missing but `DISPLAY` works.

There is no fallback to global input grabs. If neither layer-shell nor
X11 is usable, `overlays` is false and Electron keeps the cursor window.

PipeWire/xdg-desktop-portal are used only for screen capture in
Electron. They are not used to draw overlays.

## Windows

Layered, non-activating, topmost tool window
(`WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOPMOST | WS_EX_TOOLWINDOW`).
Coordinates are per-monitor DPI aware. Display hot-plug remaps the
overlay without restarting the sidecar.

## macOS

Borderless transparent `NSWindow` at a high overlay level,
`ignoresMouseEvents`, no activation, Retina scale. Remote input uses
Quartz `CGEvent` injection and a Carbon global hotkey. Both require
Accessibility permission. Capability probes never prompt; the session UI
exposes an explicit action to open the macOS permission dialog.

## Remote input

The sidecar protocol version is **2**. Renderer and Electron main own
peer authorization. Odin owns only:

- armed / allow pointer / allow keyboard
- injection of sanitized desktop coordinates and portable key ids
- tracking of keys/buttons it injected, and `release-all`
- the physical emergency hotkey (`Ctrl+Esc` by default)
- exclusive keyboard capture on the controlling peer
  (`keyboard-capture-arm` / `captured-key`); mouse still comes from the
  renderer video element. Ctrl+Esc still fires the emergency stop while
  capturing (the grab is released immediately).

Emergency disable order inside Odin, without waiting for Electron:

1. latch capture + injection (`emergency_generation`); queued arm
   requests without that generation are rejected
2. `armed = false`
3. release every remotely-held key and button
4. emit `remote-control-disabled` with `generation`

Ctrl+Esc is observed from evdev on a real keyboard **and** from an X11
root grab when `DISPLAY` is available. XTest injects via
`XKeysymToKeycode`, not a hardcoded evdev+8 offset.

### Platform backends

- **Windows:** `SendInput` with `MOUSEEVENTF_ABSOLUTE |
MOUSEEVENTF_VIRTUALDESK`; `RegisterHotKey` on a message-only window
- **macOS:** CoreGraphics event posts; Accessibility-gated
- **Linux X11:** XTest injection and `XGrabKey` on the root window.
  Controller-side capture uses `EVIOCGRAB` when evdev is readable,
  otherwise `XGrabKeyboard`.
- **Linux Wayland:** `/dev/uinput` virtual device (not XWayland fakery)
  plus evdev observation of the physical emergency chord. Remote control
  is not armable unless **both** succeed. Distros may need a udev rule
  granting the user `/dev/uinput` and keyboard `event*` nodes; do not
  run the sidecar as root. The sidecar ignores its own uinput device
  when watching evdev so injected keys cannot trip the emergency chord.
  Controller-side capture requires an evdev `EVIOCGRAB`; XGrabKeyboard
  is not treated as success on Wayland sessions.
- **Linux hybrid (common):** many Wayland sessions still report overlay
  `backend: x11` (XWayland / no layer-shell). Input still prefers
  uinput+evdev, but if those devices are not usable it falls back to
  XTest + `XGrabKey`. That fallback only reaches X11/XWayland windows.

Logs record event types and counters only, never key identities or
typed text.

## Packaging

The binary is an electron-builder extra resource
(`resources/sidecar/p2p-kiwi-sidecar` or `.exe` on Windows), not inside
asar. If the binary is missing (for example Linux arm64 cross-builds),
the app starts without native overlays.

macOS release builds ship a universal (`arm64` + `x86_64`) sidecar
inside the universal DMG. The helper is codesigned with hardened
runtime as part of the app bundle; release CI fails if it is missing,
thin, or unsigned. Local `sidecar:dev` builds remain host-arch.

## Phase A acceptance gate

Phase A is complete when all of the following hold. Cryptography in
Phase B must not start from a sidecar that fails this gate.

- Packaged app starts on Windows, macOS, and Linux with or without the
  sidecar binary
- Protocol version mismatch fails closed for native overlays
- Overlay click-through does not steal focus
- Cursor updates stay smooth (coalesced; renderer is not blocked)
- Display hot-plug or `changeScreen()` remaps the overlay in place
- Peer disconnect, leave, or kick clears that peer's overlay cursor
- Killing the sidecar process does not end the call
- Sidecar restart restores current overlay cursors
- The sidecar has no TCP or other network listener
- Remote control is capability-gated and fail-closed
- Electron cursor window remains the fallback when overlays are
  unavailable
