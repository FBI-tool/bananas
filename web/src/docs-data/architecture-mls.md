---
title: MLS implementation for p2p.kiwi
excerpt: |
  ts-mls (MIT, RFC 9420) behind the `RoomCrypto` interface for
  group membership and epoch key management.

  Media keys and high-frequency application keys are derived with MLS
  exporters and domain-separated labels.
description: |
  ts-mls (MIT, RFC 9420) behind the `RoomCrypto` interface for
  group membership and epoch key management.

  Media keys and high-frequency application keys are derived with MLS
  exporters and domain-separated labels.
order: 3
---

**ts-mls** (MIT, RFC 9420) behind the `RoomCrypto` interface for
group membership and epoch key management.

Media keys and high-frequency application keys are derived with MLS
exporters (`mlsExporter`) and domain-separated labels. The Odin sidecar
does not implement MLS.

## Options considered

| Option                                 | Result                                                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ts-mls                                 | Selected. TypeScript, Electron/Chromium compatible, `mlsExporter`, active maintenance, MIT. Not a formal audit.                                                        |
| OpenMLS (Rust/WASM)                    | Most established MLS library. Official WASM wrapper is experimental. Rejected for the first integration to avoid a second native toolchain beside the overlay sidecar. |
| mls-rs                                 | Strong Rust implementation; same WASM/native packaging cost as OpenMLS.                                                                                                |
| Custom group ratchet / static room AES | Forbidden.                                                                                                                                                             |

## Cipher suite

`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` (classic RFC 9420 suite).

## Compromise

Long-lived identity secrets are stored with Electron `safeStorage` in
the main process. MLS epoch state lives in renderer memory for the
session. If ts-mls performs key operations in the renderer, that
exposure is limited to the running session and is documented here.

## Audit status

ts-mls is not a substitute for a p2p.kiwi security audit. Do not claim
that rooms are formally audited.
