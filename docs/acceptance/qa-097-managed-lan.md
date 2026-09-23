# QA-097: Managed LAN Collaboration

The owner requested certificate-free LAN setup and visible collaboration entry
points. [ADR-0073](../adr/0073-managed-lan-collaboration.md) defines the boundary;
[the task register](../TASKS.md#managed-lan-collaboration) owns delivery status.

## Delivered behavior

The workspace toolbar exposes 本机 Agent, Codex 会话 and 设备与协作. The device
panel provides LAN enable/disable, Room-scoped connection codes, direct native
joining/sharing navigation and connected-member controls. Manual HTTPS and Relay
settings and their existing invitation flow remain reachable under advanced
settings when that transport is ready. Native tray Agent configuration still opens Agents,
independently of the last requested native page.

The Hub creates private installation-scoped CA and leaf certificates. The signed
connection code binds Node identity, logical origin, public CA, private IPv4
endpoints and expiry. Go preview uses temporary trust; explicit confirmation
rechecks both review digests and persists protected scoped trust before the
existing durable claim. No private key enters the code. No system CA, public
DNS or domain is needed. Grants, Host acceptance and Runtime approval retain
their existing boundaries.

LAN startup uses a stable saved port. A conflict leaves local work available
with an actionable error. Changing an established LAN origin through advanced
settings is rejected before staging. Disabling LAN closes its sockets without
closing the local workspace. Damaged optional transport cannot hide membership
records or departure controls, and cannot advertise external browser access.

## Local evidence

All 140 contract tests, current generated output, TypeScript types and Go
contract packages pass. The full Web suite passes all 380 tests.
Thirty Server lifecycle, settings, isolation and conflict regressions pass.
The actual Go/Node TLS/WebSocket case covers temporary preview, exact review,
lost committed claim, native recovery, Host restart, listener disable/enable,
endpoint and signature negatives, missing trust and membership revocation.

Nine focused Web tests and all 96 embedded native UI tests pass. Go race checks
for Console, Local Node and Bridge core pass; affected Go vet and desktop-tagged
tests/vet pass. Production Server/Web build passes, with the existing large-chunk
warning. Bundled supervisor checks pass both offline Runtime lifecycle and
retained disabled Relay configuration cases. The bundle was a development build,
not release installation evidence.

The initial combined Peer race run exceeded its nine-minute wrapper bound.
The subsequent diagnostic run exposed the private Host fixture root mismatch,
which was corrected to use native private-file creation. Actual LAN task execution passed both a standalone run and a race run. Host
cancellation and revocation passed. A recovery fixture initially discarded its
LAN endpoint mapping when constructing replacement clients; preserving that
mapping corrected the test setup. The unchanged race assertions then passed
local leave and all three worker recovery cases (Runtime disconnect, Host restart
and participant restart) in 102.197 seconds, with no repeated child side effect.
The diagnostic full Peer run reached its ten-minute timeout; no local full-suite
pass is claimed. CI and Release explicitly run the managed LAN task group under
race detection in addition to their full repository gates.

## Visual review

The actual production workspace was inspected in the in-app browser with an
isolated Owner profile. Both themes and a 390-pixel viewport were checked; the
narrow page had no horizontal overflow. Device identity details are folded away,
and shared controls use the workspace color tokens.

- [Workspace entry](evidence/qa097/workspace-light.png)
- [Light device panel](evidence/qa097/devices-light.png)
- [Dark device panel](evidence/qa097/devices-dark.png)
- [Narrow panel](evidence/qa097/devices-narrow.png)

## Remaining acceptance boundaries

Exact-source CI, native Windows execution, release downloads and owner installation
are pending. Physical Mac/Windows LAN acceptance is separate from local two-Node
fixtures. No public Relay, real model, owner Codex session or remote Windows
installation was used. Nearby discovery is not included; changed addresses need
a fresh reviewed connection code. Managed LAN does not install browser trust or
offer the external-browser Space link.

The unpublished v0.5.6 draft was stopped after compatibility review found a
missing advanced-network invitation entry. Its tag is immutable. The corrected
candidate is v0.5.7; no v0.5.6 installation or public distribution is claimed.
Native Windows CI and Release explicitly execute managed LAN join, trust,
restart, WebSocket and revocation coverage in addition to private-file tests.

The first v0.5.7 CI candidate identified missing explicit bounds on constant
schema-version integers and an onboarding fixture without the new LAN status
service. Both were corrected; full contract and Web suites then passed locally.
An unchanged connection cancellation test also exceeded its one-second teardown
bound; its Bridge gate passed on rerun without changing production code or tests.
