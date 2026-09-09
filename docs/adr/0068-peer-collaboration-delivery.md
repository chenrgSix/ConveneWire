# ADR-0068: Peer Collaboration Delivery

- Status: Accepted
- Date: 2026-09-10
- Tasks: GOV-045, CON-028, DATA-010, SEC-019, REG-007, BRG-081, RUN-020, DISC-022, WEB-085, OPS-019, OPS-020, QA-091, QA-092
- Extends: ADR-0065, ADR-0067, ADR-0035, ADR-0063
- Supersedes: none

## Authorization and completion boundary

The Owner authorized completion of Node-first V1, including Milestone C, user
interfaces and delivery pipelines. Manual interaction and physical acceptance
for A/B/C are consolidated at the end under QA-092. This replaces the timing
of the A/B manual gate in ADR-0067; it does not waive implementation tests.
TASKS.md is the only delivery register. Real installation, external publication,
independent-owner consent and external model usage retain their specific gates.

The product loop is: create a hosted Team, invite a human to a Team or Room,
accept with an independently authenticated local Owner, publish an explicitly
exported Agent, obtain Host acceptance, complete a remote Run and a mixed-node
Discussion, revoke access and reconcile failures without duplicate execution.
Existing Local Node and Device connectors continue to operate.

## Protocol and identity

Peer control uses versioned `/api/peer` routes; Runtime transport uses
`/ws/peer/runtime`. Peer authentication yields a distinct Peer principal and
never fabricates a Device principal. The adapter supplies a verified immutable
execution binding to the existing delivery core. Unsupported versions, missing
bindings and unsupported capabilities fail closed without Device fallback.

Node keys use Ed25519. Host identity and exact endpoint are pinned independently
of the transport CA. Proofs bind a domain/version, both Node identities and keys,
operation ID, nonce, Team/Room scope, recipient local human subject and expiry.
An invitation is not proof of human membership. The Host assigns its own User,
Member and Peer binding IDs; remote names or user IDs cannot select an existing
Host user. An existing human association is reused only through its exact
previously authenticated binding. A fresh Node association requires explicit
Host-authorized invitation, never display-name matching.

Invitation secrets are 32 random bytes encoded without padding, hashed at rest,
excluded from logs and query strings, and expire within at most 24 hours (one
hour by default). The signed invitation preview includes the exact Host origin
and the separate membership expiry; consuming the invitation cannot substitute
a longer membership. Claim commits consumption, membership and binding atomically.
The claim operation ID and signed semantic recipient intent identify an exact retry;
a lost response returns the original binding without another Member. Retries use
a fresh challenge/proof over the same frozen intent; stale proof nonces do not
authorize credential retrieval. A different
recipient/operation cannot replay a consumed invitation. Replaying a claim after
revocation never restores access. Machine credentials and human sessions are
issued separately with different audiences; neither implies the other.

V1 pins the established key/origin. Same-identity stopped restore is supported;
implicit key rotation, origin relocation and lost-key recovery are rejected.
Changing these pins requires revoking the old association and an explicit fresh
invitation/acceptance. It cannot import old permissions, Sessions or Run ledgers
into another execution namespace or run two writable restored copies.

## Membership and Room ceilings

A Peer membership records an active association and an explicit Team or Room
ceiling. Human credentials retain that ceiling durably. Effective permission
intersects the credential, current membership, Room ACL and requested operation.
Guest membership is never promoted by another full login. Broader rights require
independent Host authorization and a separately issued credential.

Room guests see only their invited Room, permitted Tasks, Results and minimal
Room participant identities. General Team membership/Agent lists, settings,
other Room metadata, aggregate counts, search, previews and event subscriptions
must not leak beyond that ceiling. The same checks apply to direct object routes
and indirect identifiers. Peer machine principals have no human browsing access.
Host administrative actions continue to require full Owner authentication.

## Bilateral export and fresh execution admission

The Participant owns AgentExportGrant; the Host owns RemoteAgentAcceptance.
Each has its own stable ID, monotonic revision, immutable scope/digest, expiry
and revocation history. Projection contains only permitted display/routing data.
Every new Export or changed authorization begins without Host acceptance.
Republishing, changing an Agent/Projection ID or reconnecting cannot undo a
revocation. Host acceptance never changes local Runtime settings or disclosure.

Effective rights intersect membership, Room/Task permission, Export, Acceptance,
Runtime capabilities and Participant policy. Both sides revalidate publication,
eligibility, Run creation, delivery, execution admission and content settlement.
Authorization attestations are signed, nonce-bound and live at most 30 seconds;
clock skew permits at most five seconds and never extends a grant's own expiry.
A Participant must obtain current Host authorization again after any resource
or approval wait, immediately before execution. Unavailable freshness denies
new starts. Local records are rechecked at their own commit/start boundary.
This is bounded freshness, not atomic distributed revocation.

The immutable execution binding includes both Nodes, Peer binding, qualified
Team/Room/Run, Projection and stable local Agent, Export and Acceptance IDs,
revisions and digests, and the semantic request digest. The semantic request
includes execution/context/authorization pins and excludes transport attempt,
connection epoch and renewal nonce. RFC 8785 canonical JSON UTF-8 plus SHA-256
provides the Peer semantic digest. Duplicate keys, invalid Unicode and
non-finite numbers are rejected; authorization counters are safe integers.
Cross-language golden vectors are required. Legacy Device Inbox digest bytes
remain unchanged. A new revision is never a new deduplication namespace for an
existing Run; changed payload/pins for the same Run are a conflict.

## Local execution, approval and settlement

All Peer and Device connectors share the delivered stable local Agent map,
resource scheduler and durable orphan fencing. Context, approval, private output,
Result replay and Sessions remain Authority-scoped. Peer trust starts restricted;
no existing Device/personal full trust, standing policy or disclosure consent
is copied. Interactive Peer approval stays in the Participant local Console and
binds the exact live process, request, Run, consent revision and expiry.
Disconnect/revoke/terminal state invalidate pending continuations.

Host revocation immediately fences Host reads, admission and content commits.
Participant revocation immediately fences local starts, invalidates approval and
attempts cancellation. Neither socket loss nor a Host terminal state proves the
local process stopped. Known local completion is retained; ambiguous execution
remains outcome_unknown, with resource fencing until safe cleanup. Reconnect
reconciles the same immutable Run and never starts another copy.

A distinct settlement capability is issued only for an already durably bound
execution, scoped to its exact identity/digest and receipt. It permits only
bounded content-free terminal/unknown/cancellation evidence and exact receipt
acknowledgment. It expires within seven days of issue, cannot be renewed through
revoked business credentials and cannot start work, read context, publish Result
text or restore a membership. The existing business credential is never accepted
as settlement authority after revocation. After capability expiry, the Participant
retains local truth and the Host retains its bounded unknown/terminal state.

Owner-private output continues to require exact independent disclosure consent
and a verified remote human-owner binding. Export, Acceptance and execution
approval cannot release private output. Unsupported private/governed Runtime
paths fail closed and expose their limitation before an Agent is offered;
ordinary output is never substituted for private output. Supported private
Discussion integration preserves ADR-0056/0057 and frozen Finalizer input.

## Discussion, product and network

The Host remains the sole writer of Discussion/Wave/Turn/Barrier/Progress/Budget
and finalization. Adapt eligibility, execution binding, bilateral validation,
capabilities and evidence provenance. Frozen Wave slots survive revoke; late
callbacks cannot reopen a Barrier, advance twice or finalize twice. Reuse current
transactional orchestration and delivery rather than another consensus stack.

Local UI supports invitation review, remote Space membership, Agent export,
Host acceptance and withdrawal with clear scope and disabled/expired states.
A Space remains a remote reference with independent human authentication;
local Owner, machine credentials, drafts and callbacks are never forwarded to
another origin. One-use browser entry must derive from current explicit human
membership rather than the Peer machine credential alone.

OPS-019 supplies an explicitly enabled reachable Peer/browser entry over existing
HTTPS/private-network trust mechanisms. The Local Node supervisor/control and
Owner bootstrap remain loopback-only and cannot be exposed through a generic
proxy. Host/Origin validation and redirect denial apply to all secret-bearing
traffic. LAN/private-network/public HTTPS do not require a new NAT/Relay service.
OPS-020 wires the native Hub bundle into existing macOS/Windows build, upgrade
and release verification without silently altering an installed profile.

## Verification and consequences

Each implementation has focused positive/negative and cross-language checks.
QA-091 combines actual independently authenticated Hosts and one shared Go core
with offline protocol fixtures: scoped invites, deny-by-default exports, collisions,
revoke/replay, offline/retry/cancel/out-of-order events, both restart directions,
local approval, exact disclosure and one Discussion finalization. Fixtures own
all processes and remove temporary data only after draining their children.

QA-092 retains previous evidence and collects remaining A/B/C manual desktop,
independent browser/owner and platform observations only after implementation.
Local checks, native package creation, physical platform results, CI execution
and publication are reported separately. CRDT, Room replicas, automatic Authority
migration/failover, language unification and a new NAT/Relay service remain V1
non-goals under ADR-0065.

Canonical serialization follows [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html).
