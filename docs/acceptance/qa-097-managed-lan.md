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

Physical Mac/Windows LAN acceptance for the new connection-code flow remains
separate from local two-Node fixtures and hosted native Windows tests. No public Relay, real model, owner Codex session or remote Windows
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

## Final CI and release

[v0.5.7](https://github.com/chenrgSix/ConveneWire/releases/tag/v0.5.7) was published
on 2026-09-23 from clean source
`0fff1d46592297d912eb4812164471ce1b66cdd9`.
[CI 35837982859](https://github.com/chenrgSix/ConveneWire/actions/runs/35837982859)
passes all four jobs and
[Release 35837991840](https://github.com/chenrgSix/ConveneWire/actions/runs/35837991840)
passes all ten jobs. Both include the full repository and Bridge gates, with
managed LAN task execution, restart and revocation additionally under race
checking. Native Windows actually executes the LAN join/restart case and all
eight negative subcases without skipping (8.48 seconds in CI, 8.65 seconds in
Release). Its installer verifies stable v0.5.5 to v0.5.7 upgrade, uninstall and
owner-state retention.

The final-source CI first attempt again hit an existing one-second connection
teardown bound in `TestPreAdmissionCancellationAcknowledgesWithoutStartingRuntime`.
The same-source Release Go gate passed; both cancellation cases passed 20 local
repetitions, and the CI Go job passed on rerun without changing production code
or tests. The initial failure remains recorded in the
[sanitized release receipt](evidence/qa097/release.json).

All twelve Draft files were independently downloaded and checked against their
GitHub SHA-256 digests, names, sizes and seven outer checksum entries. After
publication, all twelve anonymous downloads matched the verified Draft bytes
and asset IDs. License files match the tag, and anonymous Latest resolves to
v0.5.7. Release asset gates also verify package internals and clean source;
this local download receipt does not replace those platform checks.

## Owner macOS installation

The installed v0.5.7 is the public release ZIP. Its source/version, architecture
and all 7,305 Hub inventory files pass. Before replacement, the idle old app was
stopped and a private Node snapshot plus matching v0.5.4 app archive retained.
After replacement, three identity/configuration file digests and all five work
table digests matched their baseline. SQLite quick_check and readiness pass;
exactly one desktop and one Hub process run. The
[installation receipt](evidence/qa097/installation.json) contains no owner data.

Actual installed native navigation passes all three workspace toolbar entries,
the device panel, direct connection/sharing page and paste-code form. After
visiting Codex, the Agent button still opens Agents. Navigation returns to the
workspace; no owner LAN setting, Codex startup or Runtime execution was changed.
The [native UI receipt](evidence/qa097/native-ui.json) distinguishes this from
physical cross-machine LAN acceptance.

[Cleanup](evidence/qa097/cleanup.json) removed this installation's expanded
staging directory, duplicate Draft downloads and twelve obsolete v0.5.4 download
files (230,208,681 bytes). Current v0.5.7 and prior stable v0.5.5 downloads remain,
along with the private stopped v0.5.4 snapshot and matching app ZIP. LaunchServices
readback contains one canonical application registration. No private snapshot
was deleted.

README, Bridge guidance and the public site now identify v0.5.7 and explain the
connection-code path. All fifteen site checks pass. Physical owner Windows
upgrade and new Mac/Windows LAN acceptance remain subsequent owner actions;
public Relay and live-model acceptance remain deferred.

The first site deployment stopped at its copy-boundary test after the new desktop
FAQ omitted the previous Central/browser compatibility sentence. That sentence
was restored with its system-trust boundary; the application tag and published
packages were unchanged.

[Pages 35840791898](https://github.com/chenrgSix/ConveneWire/actions/runs/35840791898)
passes both jobs for documentation/site source
`c3d1d1acb0dde613619541e7ef6d6f4105ac81ea`. All nine public files were fetched
anonymously and match the exact-source local build byte for byte; the empty
`.nojekyll` control is checked separately. The
[website receipt](evidence/qa097/pages.json) records the public digests. This
website revision is distinct from the immutable application source above.
