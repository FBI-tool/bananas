<div align="center">

![p2p.kiwi logo](logo.png)

# `p2p.kiwi` - P2P Screen Sharing

[![Downloads](https://img.shields.io/github/downloads/dont-be-evil-company/p2p.kiwi/total.svg?style=for-the-badge)](https://p2p.kiwi/)
[![GitHub release (latest by date)](https://img.shields.io/github/v/release/dont-be-evil-company/p2p.kiwi?style=for-the-badge)](https://github.com/dont-be-evil-company/p2p.kiwi/releases/latest)

[Install](#install) • [Website](https://p2p.kiwi/) • [Privacy Policy](./PRIVACY.md) • [Terms of Service](./TOS.md) • [Code of Conduct](./CODE_OF_CONDUCT.md)

<p></p>

`p2p.kiwi` P2P Screen Sharing is a simple and
easy-to-use screen sharing tool for Mac, Windows, and Linux.

It utilizes a peer-to-peer connection to share your screen with others,
without the need for an account. STUN and optional TURN servers are still
used to exchange ICE connectivity information. That is not a signaling
server for chat or media keys.

End-to-end encryption is application-level MLS (RFC 9420) plus SFrame
(RFC 9605). DTLS-SRTP alone is not the E2EE indicator. Invite secrets live
in the `kiwi://` URL fragment and are never logged. Rooms whose invite has
no fragment stay visibly unencrypted. ts-mls is not a formal audit of
p2p.kiwi.

<p></p>

</div>

## Install

Grab the latest release from the
[GitHub releases page](https://github.com/dont-be-evil-company/p2p.kiwi/releases/latest).
