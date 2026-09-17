# p2p.kiwi process and protocol boundaries

This note maps the live room, WebRTC, and native surfaces so later
sidecar and E2EE work reuse existing names instead of replacing them.

## Processes

| Process                             | Owns                                                                                                                     | Must not own                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Renderer (`Room` / `WebRTCSession`) | Mesh, `control` channel, chat, votes, media tracks, collaboration state                                                  | Sidecar spawn, OS overlays, long-lived identity secrets |
| Electron main                       | Window lifecycle, screen picker, sidecar supervisor, `safeStorage`                                                       | MLS group state, WebRTC peer connections                |
| Odin overlay sidecar                | Native overlay windows, display geometry, capability probes, input injection, emergency hotkey, controller keyboard grab | Room crypto, signaling, WebRTC, long-term keys          |
| STUN/TURN                           | ICE connectivity                                                                                                         | Application or media plaintext (after media E2EE)       |
| Bonjour (opt-in)                    | SSO, contacts, presence, encrypted offer/answer/ICE/MLS-invite envelopes                                                 | Media, MLS group secrets, sidecar                       |

Clipboard invite URLs (`kiwi://`) carry SDP out of band when Bonjour is off.
When Bonjour is enabled, `Room.startBonjourCall` / `acceptBonjourCall` use
trickle ICE and MLS invite envelopes instead of compact URLs. TURN is optional
and user-configurable.

## Renderer session stack

- Entry / lifecycle: `src/main/index.ts`
- Main IPC: `src/main/ipcMainHandlers.ts`
- Preload: `src/preload/index.ts` (`window.KiwiApi`)
- Session orchestrator: `src/renderer/src/session/room.svelte.ts`
- Peer connection + `control` / `mls` / `remote-input-*` data channels: `src/renderer/src/session/peerLink.ts`
- JSON control schema: `src/renderer/src/session/controlProtocol.ts`
- Invite encoding: `src/renderer/src/Utils.ts`
- Bonjour signaling: `src/main/bonjour/`, `src/renderer/src/session/bonjourSignal.ts`
- Cursor capture (normalized 0..1): `src/renderer/src/SessionStage.svelte`
- Electron cursor fallback window: `src/main/cursors.ts`

Control message types today: `hello`, `roster`, `mesh-offer`,
`mesh-answer`, `vote-start`, `vote-cast`, `vote-result`,
`presenter-changed`, `peer-left`, `coordinator-handoff`,
`session-ended`, `cursor`, `cursor-ping`, `chat`, `camera-state`.

## Sidecar protocol

The sidecar protocol version is **independent of the application
version**. Current value: `2` (`SIDECAR_PROTOCOL_VERSION` in
`src/main/sidecar/protocol.ts` and `native/overlay-sidecar`).

Transport is a local Unix domain socket (Linux/macOS) or a named pipe
(Windows). Messages are little-endian length-prefixed JSON envelopes.
A 256-bit bootstrap token is required at handshake. The sidecar never
opens a network listener.

Remote-input message types exist in the schema and are rejected.

## Cursor path

```
control cursor message
  → Room.onCursor
  → KiwiApi.updateRemoteCursor
  → Electron main validation + coordinate mapping
  → Odin sidecar overlay (or Electron fallback window)
```

The sidecar never sees `RTCPeerConnection` objects or cryptographic
keys.

## Remote-input path

```
controller keyboard (sidecar exclusive grab)
  → captured-key → renderer remote-input-actions (E2EE)
controller mouse (renderer video element)
  → remote-input-motion / remote-input-actions (E2EE)
  → Room grant + generation check
  → Electron main sanitized IPC (`RemoteControlBridge`)
  → host-owned source coordinate mapping
  → Odin InputController
  → native injection
```

Grant/request/revoke messages travel on the `control` channel with the
same `remote-input` application domain. The presenter/host is the only
authority. Grants are ephemeral room state.

The physical emergency hotkey is handled inside the sidecar. The first
disarm and key-release must not depend on Electron responding.

The sidecar has no network listener.

## E2EE insertion points (Phase B)

Application E2EE wraps `control` payloads after parse/before apply.
MLS handshake uses a dedicated `mls` data channel. Media E2EE attaches
to `RTCRtpSender` / `RTCRtpReceiver` in `PeerLink` via encoded
transforms. Overlay IPC still receives only decrypted, sanitized cursor
state.
