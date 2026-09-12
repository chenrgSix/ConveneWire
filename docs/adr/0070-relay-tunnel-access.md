# ADR-0070: Outbound Relay access with Node-owned HTTPS

- Status: Accepted
- Date: 2026-09-12
- Tasks: FUT-006, GOV-046, CON-029, OPS-022, OPS-023, WEB-090, OPS-024, QA-093
- Extends: ADR-0065, ADR-0068

## Decision and scope

The Owner authorized Relay/Tunnel implementation to reduce onboarding effort.
An operator supplies one reachable Relay service and its domain configuration.
A distribution may include that public service profile. A Local Node Owner then
enables convenient access without opening inbound ports or supplying a domain,
certificate, private key or a third-party tunnel executable. A missing service
profile is shown as unavailable; the product never invents a hosted service.

The implementation provides the Relay daemon, outbound Node connector, automatic
Node certificates, native network controls, distribution configuration and local
end-to-end verification. Public deployment, DNS changes, CA account acceptance,
real certificate issuance, installations and external models retain their own
operation scopes. No such external operation is implied by a fixture test.
TASKS.md alone records delivery status.

## Transport and address ownership

The Relay has a control HTTPS origin and a dedicated Node domain. The operator
routes that domain and its wildcard DNS to the Relay's TCP 80/443 listeners.
Each Node address is `n` plus the first 40 lowercase hexadecimal characters of
SHA-256 over its raw Ed25519 public key, followed by the Node domain. Registration
proves possession of that key. A different key cannot claim the same address.
Addresses are stable across disconnect, disable, restart and stopped restore;
they remain dependent on the operator retaining its domain and routing service.

The Node opens a WSS control connection and one additional outbound WSS per
accepted public connection. The Relay reads a bounded TLS ClientHello, routes
by exact SNI, and forwards the original bytes without terminating Node TLS or
adding headers. TLS terminates in the existing Peer ingress, with its existing
path, Host, Origin, human session and machine authentication checks. Runtime
WebSockets, static Web, browser requests and Peer HTTP use the same transport.
There is no general forwarding target, local Owner/Console proxy or new business
authority. HTTP/3 and ECH routing are outside this increment.

The existing HTTPS origin remains immutable while invitations or memberships
pin it. Enabling Relay on a fresh Node binds the derived address. Existing direct
addresses cannot silently migrate to Relay; the UI explains the existing binding
and retains the established stopped/revoke/reinvite procedure. Turning access off
closes channels and preserves the address and membership history.

## Closed Relay protocol

Relay control uses `/v1/relay/control`; independent binary streams use
`/v1/relay/stream`. Both require WSS in production. JSON Schema owns the versioned
control objects and service profile; Node and Go share validation and signature
vectors. Unknown/duplicate fields, ambiguous JSON and oversized frames fail closed.

The service profile contains `schemaVersion`, `id`, `displayName`, `relayOrigin`,
`nodeDomain`, `acmeDirectoryUrl` and `termsUrl`; it contains no credentials.
Profiles are explicitly supplied by the operator/distribution and cannot be
installed from invitations or a remote Space. Production origins and CA URLs
are HTTPS. A Node requires an explicit Owner decision to use the profile and CA.

1. The Relay sends a `challenge` containing a random 32-byte base64url nonce and
   `expiresAt`, valid for at most 30 seconds and one registration on that socket.
2. The Node sends `register` with `nodeId`, raw `publicKey` and `signature`.
   Ed25519 signs the UTF-8 transcript
   `convenewire.relay.register.v1\n<relayOrigin>\n<nodeDomain>\n<nonce>\n<nodeId>\n<publicKey>\n`.
   The profile, recipient service, Node and current connection challenge are bound.
3. The Relay returns `registered` with the derived `hostname` and an independent
   random `sessionToken`. The token exists only in memory and is never a Peer
   business credential. An already active route rejects another registration.
4. For each public stream, the Relay sends `open` with a random `streamId` and
   `kind` of `tls` or `http01`. The Node opens the stream WSS using the exact
   session token in Authorization and stream ID in `x-convenewire-relay-stream`.
   No credential appears in a query string. Each stream ID is consumed once.

Every control object includes `schemaVersion: 1` and its `type`. A `challenge`
also carries its service origin/domain so clients reject a mismatched profile
before registration. Disconnect invalidates the epoch, pending opens, token and
all attached data sockets. A reconnect uses a new challenge and token; it never
replays bytes or renews business authorization. Ping deadlines, bounded handshake
waits, stream/frame/connection limits and backpressure apply on both sides.
The daemon keeps no Team data, invitation secrets or reusable business tokens.

## Certificates and privacy

Each Node generates separate TLS and ACME account keys in its existing private
data root. HTTP-01 challenges travel through the tunnel to a separate in-process
challenge handler. The public port-80 handler accepts only the exact registered
hostname and `GET /.well-known/acme-challenge/<token>`; it does not forward
cookies, authorization, arbitrary paths or arbitrary destinations.

The Node caches its certificate/account state, obtains only its fixed hostname,
renews before the actual expiry, and changes TLS context without restarting
Runs. An unavailable Relay/CA leaves the local workspace usable and reports a
connecting/retrying/unavailable state. An expired certificate cannot be used to
declare access ready. Retry backoff and CA Retry-After are bounded; shutdown and
disable cancel work and drain owned sockets. No fallback to HTTP or self-signed
browser trust is permitted in production. Test CA injection is fixture-only.

Normal Relay operation forwards encrypted business traffic and never receives
Node TLS keys. The operator can observe addresses, connection timing and volume;
HTTP-01 validation material is public. This is standard domain/CA trust, not
protection against a malicious domain or validation-route operator: such an
operator could obtain another valid domain certificate and actively intercept
TLS. Existing Node proof is not a TLS channel binding. The UI identifies the
service provider; documentation must not claim cryptographic secrecy against it.
Independent origins and host-only secure cookies remain required; sibling
subdomains do not make SameSite a sufficient isolation boundary.

The operator must account for CA issuance limits before scaling. Development
uses a local test CA or explicit staging; automated tests never contact a public
CA. Future stronger provider distrust requires a separate pinned-client/browser
design, not an undocumented change to the existing HTTPS trust model.

## Product and verification

Network settings present convenient access first when a service profile exists,
show the provider and fixed address, and retain manual HTTPS as an advanced mode.
The Owner reviews and explicitly enables/disables the service. Exact retry,
current revision, stale-session and pending-configuration guards remain intact.
Invitations are offered only after reachable transport and valid TLS are ready;
certificate provisioning or a disconnected tunnel must not look ready.

Local acceptance must cover signed registration and route hijack/replay denials,
fragmented ClientHello, unchanged encrypted bytes, stream limits and backpressure,
restart/reconnect without replay, cancellation/cleanup and direct-path regression.
Actual browser/API/Runtime WebSocket requests traverse the real Relay to the
existing Host; Owner/control endpoints remain denied. Two independent Nodes,
scoped invitation, ordinary offline Run, mixed Discussion, revoke and failure
recovery prove the product path. Certificate issuance, reuse, renewal and failure
are exercised against a disposable local CA. UI checks cover enabling, waiting,
ready, unavailable, disable, fixed-address conflicts and keyboard access.
Native bundle/empty-PATH and distribution checks retain exact source evidence;
public deployment and physical-platform evidence are reported separately.

## References

- [ACME HTTP-01 validation](https://www.rfc-editor.org/rfc/rfc8555.html#section-8.3)
- [Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/)
- [Let's Encrypt rate limits](https://letsencrypt.org/docs/rate-limits/)
