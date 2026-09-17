# End-to-end encryption threat model

p2p.kiwi is a desktop WebRTC mesh. There is no application signaling
server. Invite URLs carry SDP out of band. STUN/TURN may still observe
connection metadata.

## Assets

- Chat, cursor, vote, presenter, kick, camera-state, and remote-input
  messages
- Screen, camera, and microphone media
- Device identity keys
- MLS epoch secrets and exporters
- Invite bootstrap secrets (URL fragments)

## Adversaries

- Anyone who can read the invite URL path/SDP
- A compromised or curious TURN/STUN operator, or a future SFU
- A passive network observer
- A removed peer who still has old epoch material
- A newly joined peer who should not read earlier traffic
- A peer who replays votes, kicks, or grants

## Guarantees

- Application payloads and media keys are held by room members, not by
  TURN or a future SFU.
- Membership changes rotate the MLS epoch. A removed member cannot
  decrypt later application or media traffic.
- A joiner receives current-epoch secrets only.
- Control operations bind epoch, sender, room, and operation id.
- Invite bootstrap secrets stay in the URL fragment and are never
  logged or sent as HTTP query parameters.
- Native overlay IPC receives only decrypted, sanitized cursor state.
- Remote control is never granted automatically. A host grant lets a
  selected peer operate the machine as the logged-in user for the
  current share only.
- The emergency hotkey (`Ctrl+Esc` by default) is implemented in the
  Odin sidecar, outside Electron. Pressing it is a one-way off switch.
- Keyboard grab on the controlling peer is local OS capture. Key events
  still leave that machine only on the E2EE `remote-input` channel.
- The sidecar has no network listener and does not learn room
  membership or MLS state.

## Non-goals

- A compromised endpoint can read plaintext available to that endpoint.
- E2EE does not hide ICE/SDP/TURN metadata.
- An unverified invite can still be socially redirected.
- Screen content is plaintext at the capturing and viewing endpoints.
- The Odin sidecar is part of the trusted local computing base for
  overlay content and for host-authorized remote input injection.
