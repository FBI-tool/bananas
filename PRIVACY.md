# Privacy Policy

Effective Date: 2026-09-16

Your privacy is important to us.
This Privacy Policy outlines how we handle and protect your information when you use
p2p.kiwi Screen Sharing (the "App").

By using the App, you agree to the terms of this Privacy Policy.

### 1. Data Collection

We do not collect, store, or process any personal or usage data from users of the App.
The App functions solely to establish a peer-to-peer connection between users.
No personal information, identifiers, or activity data are transmitted to us or any third-party,
excluding STUN and TURN servers for ICE, and an optional Bonjour server if you enable it.
Invite bootstrap secrets stay in the URL fragment for clipboard invites, or in an
encrypted Bonjour envelope for Bonjour calls. They are not sent as HTTP query
parameters and are not written to debug logs.

### 2. Data Usage

The App interacts with STUN and TURN servers to establish a peer-to-peer connection between users.
SDP and ICE metadata in invite URLs and STUN/TURN traffic can still reveal IP addresses,
ports, and that a session exists. Application chat, votes, and (when enabled) media keys
are held by the endpoints, not by STUN/TURN.

### 3. Third-Party Services

The App uses the official STUN server provided by Google
if not provided by the user.

This is required for the negotiation of connection details like IP addresses and ports,
to establish a peer-to-peer connection between users.

### 4. Security

Although we do not collect any data,
we prioritize security in the development and maintenance of the App to
ensure that your use of it remains safe.

Peer-to-peer is not the same as “no STUN/TURN.” End-to-end encryption means
the endpoints hold application and media keys. The App has not received a
formal cryptography audit.

Device identity keys are stored with the operating system secret store
through Electron `safeStorage` (Keychain, DPAPI, or Secret Service) when
available.

The App only communicates with the STUN or TURN servers
that you can configure yourself,
for the purpose of establishing a peer-to-peer connection.
An optional Bonjour contacts server (off by default) is used only if you enable
it in Settings and sign in. Bonjour stores your SSO identity, username, contact
graph, and presence, and relays encrypted call-signaling blobs. It does not
receive media, MLS group keys, or plaintext SDP.

### 5. User Consent

By using the App,
you consent to the interaction between the configured STUN or TURN servers and the App,
as described in this policy. Enabling Bonjour is a separate, explicit choice.

### 6. Changes to the Privacy Policy

We reserve the right to modify this Privacy Policy at any time.
Any changes will be posted on this page with an updated "Effective Date."

Your continued use of the App after changes to this Privacy Policy indicates
your acceptance of the revised terms.

### 7. Contact Us

If you have any questions or concerns about this Privacy Policy or the App,
please contact us via filing an issue on the
[GitHub repository](https://github.com/dont-be-evil-company/p2p.kiwi/issues/new).
