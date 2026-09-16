# Native overlay sidecar

p2p.kiwi ships an Odin helper (`p2p-kiwi-sidecar`) for always-on-top,
click-through cursor overlays. Electron main is the only process that
starts it. The renderer never executes sidecar commands.

## Capabilities

The sidecar reports what the current desktop can do instead of making
the UI branch on OS names:

- `overlays` - native overlay windows are available
- `clickThrough` - overlays ignore pointer input
- `displayEnumeration` - display list/bounds are available
- Global observation and input injection stay `false` in this release
- Permission probes (`accessibility`, `screenRecording`,
  `inputMonitoring`) are reported without prompting

If `overlays` is false, p2p.kiwi keeps the existing Electron cursor
window. Calls still work.

## Linux compositor notes

Wayland and X11 are separate backends.

**X11 (and XWayland):** override-redirect, always-on-top, empty input
shape. This is the reliable Linux overlay path.

**Wayland:** `zwlr_layer_shell_v1` overlay layer with an empty input
region. Compositors that do not implement layer-shell (typical GNOME
Shell) report `overlays: false`. There is no silent fallback to global
input grabs or X11-on-Wayland hacks.

PipeWire/xdg-desktop-portal are used only for screen capture in
Electron. They are not used to draw overlays.

## Windows

Layered, non-activating, topmost tool window
(`WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOPMOST | WS_EX_TOOLWINDOW`).
Coordinates are per-monitor DPI aware. Display hot-plug remaps the
overlay without restarting the sidecar.

## macOS

Borderless transparent `NSWindow` at a high overlay level,
`ignoresMouseEvents`, no activation, Retina scale. Accessibility and
Input Monitoring status may be reported for future input features; this
release does not prompt for those permissions and does not inject
input.

## Packaging

The binary is an electron-builder extra resource
(`resources/sidecar/p2p-kiwi-sidecar` or `.exe` on Windows), not inside
asar. If the binary is missing (for example Linux arm64 cross-builds),
the app starts without native overlays.

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
- Remote input message types are defined and rejected
- Electron cursor window remains the fallback when overlays are
  unavailable
