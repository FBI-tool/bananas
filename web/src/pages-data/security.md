# Security Policy

## Supported Versions

Versions currently being supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 0.0.x   | :white_check_mark: |

## Encryption

p2p.kiwi is a WebRTC mesh. STUN/TURN and invite URLs still carry connection
metadata (SDP, ICE, IP addresses). That is expected and is not hidden.

Application end-to-end encryption uses MLS (RFC 9420) via ts-mls and SFrame
(RFC 9605) for media. Keys live on the endpoints. A green DTLS indicator is
not an E2EE guarantee. Invite bootstrap secrets are URL fragments and must
never be logged. Removed members lose later epochs.

ts-mls is not a formal audit of this application. Do not treat rooms as
formally audited.

The overlay sidecar never sees WebRTC, MLS secrets, or ciphertext from the
network. Native remote input is not enabled.

See `docs/security/e2ee-threat-model.md` and `docs/security/adr-mls.md`.

## Reporting a Vulnerability

Security vulnerabilities should be communicated with
the maintainers in private.

### GitHub

- @gorillamoe

> (at `GitHub username` + `@github.com`).

### Discord

- gorillamoe
