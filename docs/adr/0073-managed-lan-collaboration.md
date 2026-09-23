# ADR-0073: Managed LAN connections and visible collaboration controls

- Status: Accepted
- Date: 2026-09-23
- Owner: Local Node, Peer transport and Web

## Context

The owner requested LAN collaboration without generating or importing
certificates and reported that collaboration, sharing and native settings are
too difficult to find. Public Relay acceptance remains deferred.

## Decision

Expose **Devices and collaboration** beside the ordinary workspace actions.
It contains LAN status, inviting another device, joining by connection code,
connected members, Agent sharing and local Agent settings. Keep manual HTTPS
and public Relay in advanced network settings. Opening a native page selects
that page in the existing window through a closed target enum.

The initial connection uses an explicit, one-use connection code copied from
the Host. It contains the existing scoped invitation and public LAN transport
material. The recipient previews the proven Host and Room scope, then confirms
joining. Neither multicast discovery nor automatic acceptance is required.

The Hub creates a per-installation CA and renewable server certificate inside
the supervisor-protected private installation root. It opens its LAN listener only after the local Owner
enables it. Enabling and disabling take effect without restarting the app.
The listener uses the existing Peer request classification and authentication;
it does not expose local Owner, supervisor or Device administration.

Logical Host origin and Node identity remain immutable. LAN dialing uses
explicit private IPv4 endpoints from the connection code while TLS verifies
the logical Host name with a Peer-scoped CA. An existing manual/Relay origin
is retained. A fresh installation uses a reserved, Node-derived logical name;
it requires neither public DNS nor domain registration. Endpoint changes need
a fresh reviewed connection code in this increment. No system/browser trust
store is modified and external browser access is not advertised for managed
LAN connections.

## Compatibility and security

Existing invitations and manually configured Peer trust remain readable.
LAN transport data is a closed, bounded contract. Preview uses temporary trust;
it never persists a CA. Confirmation rechecks the invitation digest and exact
transport digest before persisting scoped trust, then uses the existing durable
claim/recovery journal. Conflicting Host keys, origins or CA pins fail closed.
Trust is not Room membership, an Agent export, Host acceptance or local Runtime
approval. Those existing bilateral checks and revocation paths still apply.

Only private literal IPv4 endpoints are dialed; DNS, redirects, public addresses
and loopback are not accepted from connection codes. HTTPS and fresh Node
proofs remain mandatory before credentials are sent. Private keys never enter
connection codes, browser responses or logs. Native trust files retain protected owner/SYSTEM DACLs through the existing
native private-file implementation. Hub TLS material inherits the protected
installation directory, as with the existing Relay certificate store.

## Alternatives and consequences

Disabling HTTPS would remove confidentiality and identity checks. Installing a
system CA would grant unnecessary trust outside the app. Both are rejected.
Automatic nearby discovery can be added separately; explicit connection codes
work even when multicast is unavailable and keep this change bounded.

## Verification

Require closed TypeScript/Go contracts and actual cross-language HTTPS/WS
interoperability, temporary-preview/persistent-confirmation and trust-conflict
negative cases, restart/reconnect/revoke recovery, listener shutdown and Owner
isolation, native Windows private-file checks, UI navigation and visual checks.
CI, packaged installations and physical two-device acceptance remain distinct.
