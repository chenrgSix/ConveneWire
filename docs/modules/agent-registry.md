# Agent Registry and Presence Module

- Prefix: `REG`
- Planned location: `apps/server/`
- Owns: Member, Device, Agent publication, capabilities, derived Presence

## Purpose

Registry gives every participant a stable identity and tells the Router whether
an Agent can currently accept work. It separates human ownership, physical
devices, Central-hosted profiles, published Agent roles, and runtime
implementation.

## Responsibilities

- Persist Member and Device ownership.
- Publish, update, disable, and revoke Agents.
- Validate integration mode and Runtime capabilities.
- Bind each managed Agent to exactly one active Device.
- Bind each Hosted Agent to exactly one versioned Central Runtime Profile and
  no Device.
- Derive Presence from Bridge heartbeat, Runtime status, and integration mode.
- Provide stable Agent lookup to Room, Run, MCP, and Web UI.

## Exclusions

- User authentication and device credentials belong to Security.
- Bridge connections and heartbeats are transported by Bridge.
- Run state does not become Agent Presence state.
- Runtime discovery is local Bridge behavior.

## Identity Hierarchy

```text
Member
├── Device
│   └── managed Agent
│       └── local Runtime configuration
└── hosted Agent
    └── Central Runtime Profile
```

An `agentId` is immutable. Name and role are display metadata. Reinstalling a
Device creates a new `deviceId`; it never silently inherits the old device
credential or queued managed work.

## Publication Rules

- Only the Device owner may publish a local Agent.
- `managed` requires an active Bridge and an Adapter that supports start.
- `manual` may exist without an active Bridge.
- `hosted` requires an enabled Central Runtime Profile and must not carry a
  `deviceId`, Workspace reference, or local Runtime policy.
- Capabilities are validated against the Contracts schema.
- A managed Agent that advertises Workspace leases must also publish one opaque
  Workspace reference and observed generation; neither may contain a path.
- Disabled or revoked Agents remain addressable in history but cannot receive
  new Runs.

## Presence

Presence is derived, not directly assigned:

| Status | Derivation |
| --- | --- |
| ready | managed, Bridge heartbeat valid, Adapter available, no active Run |
| busy | managed and at least one accepted active Run |
| degraded | Bridge online but Adapter unavailable or capability reduced |
| manual | integration mode is manual |
| offline | managed with expired or absent Bridge connection |
| ready | hosted, enabled, assigned to a Room, complete profile, no active Run |
| busy | hosted and at least one accepted Hosted Run |
| degraded | hosted with incomplete, revoked, or unavailable provider configuration |

Heartbeat TTL is server-configured. Network jitter may delay an offline
transition but must never produce two active Device bindings for one Agent.
An `agent.status` frame is an authenticated, connection-epoch-scoped Presence
observation for an Agent owned by that exact Device; it never mutates Run
state. A healthy Device heartbeat preserves an existing `busy` projection so
liveness traffic cannot make active work appear ready.

## Failure and Security

- Stale Bridge updates are rejected using connection epoch.
- Device revoke disables all managed Agents on that Device.
- Provider-credential revocation rejects new work for its Hosted Agents but
  never changes managed or manual Agents.
- Capability downgrade is accepted and immediately reflected in routing.
- Registry responses expose only Agents visible to the authenticated Team.

Managed Bridge publications carry a locally persisted stable Agent ID. The
server permits create or update only when Device, Owner, and Team match the
authenticated Device credential; reconnect publication is idempotent.

Managed publication may include the safe Runtime policy summary defined by
`REG-005`. The Registry persists only its closed `filesystemAccess` enum and
returns it to authenticated Team members. Omission means unreported and clears
an older value on republication, preventing a downgraded or older Bridge from
leaving a stale policy label. Unknown policy fields and values are rejected;
local paths, commands, environment variables, tools, Provider data, accounts,
and credentials never enter this projection.

[ADR-0059](../adr/0059-show-agent-configured-models.md) adds the sole model
identifier `configuredModel` to safe publication metadata. Migration 0089 stores
that optional value and `modelReportedAt` separately from Presence; older or
unreported republications clear both. Authorized Team lists also project the
current Hosted profile model and its creation timestamp without credential
resolution. This display information neither proves a Run's model nor changes
model selection, routing or authority (`WEB-076`).

An Owner may disable or re-enable an Agent through
`PATCH /api/agents/:agentId`. Disablement is fenced while that Agent has active
Run or Discussion work, preserves Room assignment and history, and remains
authoritative across subsequent managed Bridge republication.

A newly created enabled Agent is initially assigned to the Team's existing
Rooms. Room ownership may later remove that Agent independently per Room;
republication of the same stable Agent updates metadata and Presence without
silently restoring removed Room assignments.

ADR-0026 deliberately overrides that compatibility default for a newly created
Hosted Agent: it begins with only the exact Rooms selected by the Owner, which
may be an empty set. Enabling a remote provider never silently exports existing
Room history. Later Room roster changes use the same Owner authority as every
other Agent.

For `SEC-006`, the Registry also exposes durable owner-scoped provisioning
requests. A request reserves one new Agent ID and references one existing
managed template Agent on the same active Device. It is not an Agent, cannot be
mentioned or receive work, and contains no local Runtime configuration. Only
the exact Device may accept or reject it. Acceptance remains pending until that
Device publishes the reserved Agent ID; publication atomically converges the
request to `ready`, including when an acceptance result was lost, while exact
retries preserve the same request and identity. The Agent upsert and request
transition share one immediate transaction. `configuration_failed` may be
redelivered with the same identity; other rejections remain terminal.

## Central Hosted Agent Target

[ADR-0026](../adr/0026-add-optional-central-hosted-agents.md) adds the closed
`hosted` integration mode under `REG-006`. The Registry owns the durable Agent
identity, enabled state, profile binding, explicit Room participation, and
derived Presence; Security owns credential plaintext/envelopes, Runtime
Adapters own the provider HTTP lifecycle, and Run Orchestration owns dispatch
and terminal outcomes.

A Hosted Agent never becomes managed because a Bridge publishes the same ID,
and a managed/manual Agent cannot be converted in place to hosted. Changing
integration mode requires a new Agent identity so history and credential
authority cannot be reinterpreted. Profile replacement is revision-fenced and
new Runs freeze the current revision. Disablement and profile mutation retain
the existing active-work fence.

Provider connectivity is a bounded observation. It can project one Hosted
Agent as degraded, but it is neither a Device heartbeat nor Central health.
Unconfigured installations contain no Hosted Agent and preserve current
Presence behavior.

Only membership in an unarchived Room satisfies Hosted Room availability.
Participant/settings and Room lifecycle mutations refresh affected Hosted
Agents after commit. A transition from no usable Room to a usable Room may
restore ready state, but an unrelated Room edit does not erase a persisted
provider-execution failure.

## Peer offers and Host acceptance

[ADR-0068](../adr/0068-peer-collaboration-delivery.md) assigns Participant Export
and Host Acceptance to separate writers. REG-007 now admits a signed
`PeerAgentOffer` through `POST /api/peer/agents/offers`. The machine credential
and a fresh pinned Participant proof are both required; browser credentials
cannot publish an offer. The immutable offer binds the exact grant plus its
display name and role. Metadata changes require a new grant revision, and V1
rejects owner-private output before an offer is persisted.

The full Host Owner can inspect the Team's current offer heads and explicitly
accept a reviewed offer digest, grant revision/digest, Room subset, capability
subset and expiry. Acceptance uses an expected current Acceptance ID/revision;
concurrent decisions cannot silently overwrite each other. Offer persistence,
acceptance history and operation replay use immediate transactions. Failed
transactions allocate neither partial authority nor a new projection identity.

Migration 0099 retains immutable offers, Host operation results and one stable
projection ID for each Peer/local Agent pair. A projection ID is allocated only
after acceptance. Changed or replaced Exports invalidate the stored authority
intersection; replaying old offers or Host operations only acknowledges history.
Revocation appends a terminal revision. A later explicit acceptance can create
a new Acceptance lineage while retaining the stable projection identity.

The Host signs receipts over the full accepted content, including the projection
and offer digest. These receipts do not replace live admission freshness.
The subsequent registry increment materializes accepted projections as the
independent `peer` integration mode described below. Native sharing actions
remain in BRG-081/WEB-085. No Device is synthesized.

Verification: 25 focused Server tests pass, including protocol routes,
credential separation, signature and scope negatives, duplicate/concurrent
decisions, revoke/republication, interrupted transactions, reopen and upgrade.
All 130 Contracts Node tests, generated/type checks and Go fixtures pass;
the Peer Go race suite (including real TLS Go/Server admission) and vet pass.
Server build, documentation, links and whitespace checks pass. Manual A/B/C
acceptance remains consolidated in QA-092 after the complete implementation.

### Participant export persistence

The Go `Exporter` consumes a resolver owned by the shared core's stable local
Agent map. Explicit Owner review atomically appends the grant and its immutable
operation, display metadata and configuration digest to the private Peer store.
Commands, paths and local configuration are not included in network offers.
Optional `localExports` history preserves compatibility with existing join-only
stores; grants without a matching reviewed entry cannot pass the Exporter check.

Changes to the resolved Agent identity, command, workspace or capabilities fence
the previous grant. Owner-private output and inherited Device trust/central
approval are rejected. Withdrawal needs neither an available Runtime nor a Host
response and remains possible after leaving or expiry. A revoked lineage cannot
be reused; explicit replacement gets a new Export ID and requires new Host
acceptance. Local review reserves history capacity for later withdrawal.

`Client.PublishExport` sends only a durable, current offer after checking the
Host's TLS and pinned Node identity. It rechecks local authority around network
waits and verifies the returned proof over exact grant and metadata digests.
The receipt confirms offer persistence, not acceptance. Actual Go/Server TLS
coverage drops the first offer response after commit, reopens the Participant
store, retries the same offer, verifies no duplicate or automatic acceptance,
then performs an explicit Host acceptance through the fixture's Owner action.

All Peer Go race tests and vet pass, including concurrent local review,
configuration/private/trust negatives, immutable history, clock rollback,
withdrawal without a Runtime and explicit replacement. All 130 Contracts Node
checks, Go fixtures, generation/types, Server build and docs/link checks pass.
Native callers and multi-revision synchronization remain in the active delivery
chain; this transport helper does not yet run a
background connector or execute work.

### Peer Agent registry materialization

Migration 0100 adds the distinct `peer` Agent mode and preserves the existing
Agent foreign-key graph. The migration temporarily uses connection-local
legacy rename semantics for the table rebuild, restores them before completion,
and runs the migration runner's foreign-key verification. Version-99 accepted
projections retain their original IDs, metadata and current scope on upgrade;
stale/revoked grants do not restore access. Failed rebuilds roll back schema
and data together.

Only explicit Host acceptance materializes the registry record and approved
Room participation. A Peer Agent has its bound Participant Member, no Device,
no local paths/runtime policy and no manual MCP authority. Generic publication,
enablement and identity conversion cannot rewrite it. Newly created Rooms do
not automatically include Peer Agents. Database checks enforce the current
membership, Room ACL and exact bilateral grant intersection when adding a
Peer Agent to a Room.

Changed current Exports or Acceptances disable and remove the prior projection
from Rooms until an explicit valid decision materializes it again. Membership
revocation removes projected Room access; removing the Peer human from a Room
also removes its Agents there. Historical retries do not rematerialize Agents
or restore manually removed participation. `peer_agent_room_authority` exposes
the stored current intersection and its expiry; it does not replace fresh
Participant Run admission. Peer Presence remains offline until the transport
integration. The in-process executor rejects Peer targets, and fake adapter
dispatch is confined to fake Agents.

The full Server regression passes 732 tests, including projection lifecycle,
negative identity/MCP/Room checks, in-process execution denial, version-99
upgrade/rollback and populated legacy Agent graph preservation. The final
Team-archive view restriction also passes all five focused projection tests. Server build
and actual Go/Server TLS recovery with the Peer Go race suite pass. Docs,
local links and whitespace checks pass. Runtime transport, native/UI calls
and end-to-end collaboration acceptance retain their own task gates.

### Offline Export synchronization

The authenticated `POST /api/peer/agents/sync` accepts one complete reviewed
local Agent history, with a fresh Participant proof over its ordered content.
This endpoint has the bounded 1 MiB Peer limit for recovery; individual offers
and admission requests keep their smaller limits. Oversized Peer bodies return
HTTP 413 with a closed error code.

The Host verifies all identities, immutable offer metadata and contiguous
lineages in one transaction. Expired or withdrawn prefixes cannot become
temporarily active, and the final Host head must exactly match the signed local
head. Unexpired active final grants still need current Room permission. Failed
history or metadata writes restore the old projection, acceptance and Room
state together. Reordered retired IDs, skipped revisions and stale Participant
heads cannot roll back Host authority.

The Go Exporter supplies only reviewed history and validates current Runtime
configuration for a live head. Withdrawal can still sync when that Runtime is
gone. The client rechecks local history around network waits, verifies the
receipt's whole-history and final-head digests, and retains the same grant
identities after response loss. The actual TLS fixture drops the first sync
response after a multi-revision withdrawal commits, reopens the Participant,
retries without a Runtime and verifies no reactivation or duplicate acceptance.

Verification passes 21 focused Server tests, 130 Contracts Node checks plus
generated/types/Go fixtures, all Peer Go race tests, vet, Server build and
docs/link checks. The preceding complete Server run passed 732 checks; this
increment adds five synchronization tests. Host acceptance-history delivery
and local effective-projection validation remain in REG-007 before native
controller and Runtime integration.

## Registry verification

- Reconnect converges publication without duplicate Agents.
- Expired heartbeat produces offline status.
- Revoked Device cannot publish or renew Presence.
- Same display name remains unambiguous through Agent IDs.
- Managed/manual/hosted capability combinations are validated.
- A Hosted Agent has no Device, no implicit Room access, and no Bridge
  heartbeat; credential revocation and provider degradation cannot affect
  Central readiness or another integration mode.

## Task Mapping

`REG-001` through `REG-005`, with pairing in `BRG-002` and `SEC-001`.
`REG-006` adds the ADR-0026 Hosted identity and Presence boundary.

## Dependencies

Contracts, Persistence, and Security. Bridge heartbeats are inputs, not registry
state authority.

## Member-aware Device ownership

ADR-0035 separates the pairing issuer from the Device owner. Explicit approval binds an existing member or atomically creates one ordinary member; multiple Devices can reuse that immutable membership. New Agents from member-aware Devices receive only the approved initial Room defaults. Existing Device/Agent attribution is not silently rewritten.
