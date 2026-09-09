# ADR-0065: Node-first Authority Model

- Status: Proposed
- Date: 2026-09-09
- Task: GOV-044, design draft and architecture self-review only
- Owners: Contracts, Security, Registry, Bridge, Persistence, Run, Discussion,
  Team/Room, Web and Operations
- Source baseline: local `main` at `9175e404e3fce0011e6a355297d752f0d750c0a5`
- Supersedes: none
- Proposed amendments/extensions: the explicit relationships below; none take
  effect while this record is Proposed

## Context and decision status

The Owner accepted the Node-first direction and the review's P1 findings, and
requested this draft before implementation. The accepted direction is recorded
here for review; this document's status remains Proposed. It neither changes
current behavior nor starts Local Node packaging, Multi-Authority or Peer work.
Completing GOV-044 means delivering this draft and its self-review, not accepting
the ADR or completing any runtime milestone. Delivery status belongs only in
[TASKS.md](../TASKS.md).

The current Server owns collaboration state; Bridge owns local execution. A
Node composes these capabilities without merging their authorities. Phase 1
reuses TypeScript Server/Hub, Go Bridge/Runtime, Web, Contracts and SQLite. It
does not rewrite Hub in Go or unify languages, processes or business databases.

The code baseline has these relevant properties. These are observations about
the inspected source, not claims that Node-first is implemented or tested:

| Current evidence | Consequence for this design |
| --- | --- |
| [Bridge core](../../bridge/internal/bridgecore/run.go) acquires one data-directory owner and constructs one Client, Inbox, Session store and execution Gate | Adding URLs or starting independent cores cannot implement safe multi-Authority execution |
| [Agent Gate](../../bridge/internal/delivery/agent_execution_gate.go), [Inbox](../../bridge/internal/delivery/inbox.go) and [Session keys](../../bridge/internal/runtime/session_store.go) use existing Agent/Run/context identities | Stable local Agent mapping and Authority partitions are prerequisites, not UUID collision optimizations |
| [Client access authority](../../apps/server/src/security/client-access-authority.ts) is Team-scoped; [Agent publication](../../apps/server/src/registry/agent-service.ts) permits new IDs under Device authority | Room ceiling and bilateral Export cannot reuse these permissions unchanged |
| [Device trust](../../bridge/internal/config/device_trust.go) and [Runtime approval](../../apps/server/src/run/runtime-approval-service.ts) bind exact consent/owner state | Local consent must remain scoped; a Peer cannot inherit Device trust or full-owner login |
| [Discussion orchestration](../../apps/server/src/discussion/discussion-orchestrator.ts) and [repository](../../apps/server/src/discussion/discussion-repository.ts) bind stable Turns/Runs and commit Wave decisions transactionally | Keep one orchestration authority and adapt eligibility, delivery and evidence boundaries |
| [Server entry](../../apps/server/src/server.ts), [migrations](../../apps/server/src/data/migration-runner.ts), [Desktop entry](../../bridge/cmd/convenewire-bridge-desktop/main.go) | Native Hub packaging, lifecycle, identity and upgrade handling remain separate work |
| [Web API](../../apps/web/src/api-client.ts) uses one origin/session context | A unified multi-Space client needs Authority-scoped navigation, storage and asynchronous request ownership |

## Highest-level invariants

> 一个 Authority 对协作状态拥有单一写入权；一个 Participant Node 对自己的 Runtime 执行状态拥有本地主权。Remote collaboration 连接这两个 Authority，但不会把它们合并成一个分布式权威。
>
> 一个 local Agent 无论向多少 Remote Authority 发布，都只有一个本地执行身份。Remote Agent Projection 永远不能成为第二个本地执行身份。

These requirements are independent. Single collaboration authority does not
authorize Host control over Participant execution, and local execution authority
does not authorize Participant commits to Host collaboration state.

| Invariant | Required property |
| --- | --- |
| INV-01: Team authority | Each Team has one `authorityNodeId`; every Room inherits it. An authorized Bob creating a Room in Alice's Team creates it under Alice's authority |
| INV-02: Command boundary | Participants submit authorized commands or execution evidence. Only the Team Authority validates and commits Team/Room/Task/Run/Discussion state |
| INV-03: Local execution sovereignty | Participant owns Runtime processes, credentials, Workspace access, resource admission, consent and local execution receipts; Host cannot override a local refusal |
| INV-04: One local Agent identity | Every projection resolves to one stable `localAgentId` before admission, Gate acquisition, Workspace arbitration, Session selection or approval |
| INV-05: Shared core, isolated contexts | Local and remote connectors share one logical execution core and local resource arbitration. Transport partitions must not instantiate independent execution cores for the same local resources |
| INV-06: Bilateral authorization | Export plus Host Acceptance are necessary at every authorization boundary; Projection, presence or capability declarations cannot grant access |
| INV-07: Identity separation | Node, Device, human Member, human credential and Export credential remain separate. Peer Principal is distinct from Device Principal |
| INV-08: Room ceiling | A Room-invited credential never exceeds its invited Room, even if the associated person has broader rights through another credential |
| INV-09: Scoped trust | Local trust must never implicitly propagate to a Remote Authority. Export, standing policy, interactive approval and full trust do not imply one another |
| INV-10: Namespaced identity | Every remote object, execution record, cancellation, Session, approval, replay and sequence cache binds an authenticated Authority namespace |
| INV-11: Replay identity | Duplicate delivery matches the original execution identity and frozen semantic payload. Reconnect, epoch change or grant renewal cannot create another execution |
| INV-12: Durable truth | Delivery failure does not erase known local completion; possible execution without proof remains `outcome_unknown`, never an automatic retry instruction |
| INV-13: Monotonic orchestration | Only the Host advances Discussion/Wave/Barrier/finalization. Late or duplicated evidence cannot reopen closed work or create another finalization |
| INV-14: No implicit upgrade | Migration, pairing, publication, credential omission and legacy protocol fallback never mint new membership, export, disclosure or execution authority |

## Node composition and Team authority

```text
ConveneWire Node
  Local Hub Capability          -> authoritative Hosted Team state
  Local Web/Desktop             -> presentation and explicit Owner actions
  Persistence                   -> separated business and execution ownership
  Authority Connectors
    Local Authority Connector --+
    Alice Authority Connector --+--> Shared Runtime Execution Core
    Carol Authority Connector --+      localAgentId / Execution Gate
                                       Workspace arbitration / resource limits
                                       isolated Runtime Sessions / Owner approval
```

An Authority Connector owns authenticated transport and reconciliation for its
binding, not another Runtime executor. A shared core may internally use multiple
processes, but retains one logical admission and ownership mechanism for the
same local Agent and physical resources. Neither process layout nor programming
language is fixed by this ADR.

The public interaction model is Participant command -> Authority validation ->
Authority transaction. Sending a Message, creating a Task or requesting a Run
is a command. Participant execution events are evidence consumed by that
transaction; they are not direct writes to Host state. Command authorization,
idempotency and causal identity remain Host-owned.

One Node may host several Teams and participate in several remote Teams.
`Space` is a UI/local reference to a Hosted or Remote Team, not a new state
authority. Bob's local Hub must not route Alice's request into a second local
Mention/Run/Discussion aggregate. It stores only the execution ledger, local
authorization and permitted remote references needed to execute that request.

Host unavailability makes its remote collaboration unavailable for new commands.
V1 permits offline work in locally Hosted Teams, not offline writes to a remote
Room. Room authority cannot move independently of its Team. No automatic
authority transfer, failover or recovery from a second writable replica exists.

## Identity and reference model

`AuthorityRef<T>` is a conceptual contract requirement, not a handwritten wire
type or a schema change in this task:

```text
AuthorityRef<T> = (authorityNodeId, objectType: T, objectId)

T includes Team, Room, Message, Task, Run, Discussion, Wave, Turn and Result.
TeamRef/RoomRef/RunRef/... are typed specializations of this reference.
Run identity = AuthorityRef<Run>

Execution binding includes:
  authenticated Peer + AuthorityRef<Team> + AuthorityRef<Run>
  AuthorityRef<Room> + projectionAgentId + semanticPayloadDigest
  exportId + grantRevision + acceptedGrantDigest
  acceptanceId + acceptanceRevision + acceptanceDigest + localAgentId
```

Contracts will choose a closed, versioned JSON Schema representation and generate
TypeScript/Go types in CON-027. Identical unqualified IDs from different Hosts
must remain different identities. Type and Team/Room relationships are validated;
possessing a reference is not permission to resolve it. An endpoint is a locator,
not the Authority identity; an origin change never forwards an old credential
without explicit authenticated rebinding.

The namespace comes from the authenticated Connector/Peer binding and is checked
against payload references; a sender cannot choose its authority by asserting an
`authorityNodeId`. Deduplication remains anchored to `AuthorityRef<Run>` and the
existing immutable idempotency key. A new grant or Acceptance revision is not
another deduplication partition in which the same Run may execute again.

| Identity or credential | Owner / issuer | What it establishes | What it does not establish |
| --- | --- | --- | --- |
| Node identity and private key | Local installation/Owner | Node identity after verified proof of key possession | Human identity, Team membership, Agent access or current trust |
| Host Authority identity | Hosting Node, bound to each Team | Which Node may commit that Team's state | Rights over Participant Runtime state |
| Device identity | Existing Host Registry | A machine registration within an exact Team/Owner binding | A global Node identity or human login |
| Human Member | Host Team Authority | A person's explicit Team or Room-scoped association | Ownership of every Device on a Node or all Runtime permissions |
| Remote member binding | Host Authority after explicit binding | An authenticated remote human/Node association to a Host Member | Name-based identity equivalence or Peer-wide rights |
| Human credential | Host authentication authority | An audience-, Member- and ceiling-bound human session | Export publication, machine execution, full Owner login by derivation |
| Peer / Export credential | Explicit control-plane binding | Machine operations within active Export/Acceptance scope | Human impersonation, membership creation or Device-wide authority |
| Local Owner authentication | Participant local Node/Console | The actor allowed to configure local trust and approve local execution | Host Team administration without separate Host credentials |

One person may bind several Nodes to the same Host Member through explicit
proof. One Node may serve different Members/Teams/Hosts; neither Node key nor
display name substitutes for the human binding. In V1 the implementation may
support one local Owner per installation, but must not encode a permanent
Node-to-one-Host-Member identity equivalence.

Inbox entries, cancellation tombstones, result replay routes, retained receipts,
approval requests, runtime context cursors and Web storage use AuthorityRef and
the immutable execution binding. Session partitions additionally retain Task,
local Agent, Workspace, context-policy/configuration and effective trust scope.
One local Agent identity does not mean one shared conversation across Hosts.
Equivalent-looking Task/Workspace IDs never permit automatic Session reuse.

Gate keys use the resolved local identity, not a Host projection ID. Shared
physical Workspace paths retain local arbitration even when different scoped
aliases point to them. Context isolation does not promise isolated filesystem
effects for explicitly shared checkouts. Aliases or transport partitions cannot
increase local concurrency or bypass local resource limits.

## Authority and Hosted/Remote data ownership

| Data or action | Single writer / decision owner | What the other side may retain or submit |
| --- | --- | --- |
| Team, Room, Member, Room ACL, Task, Message, sequence | Team Authority | Authorized commands; scoped references and presentation data |
| Run, RunEvents, delivery intent, cancellation intent | Team Authority | Execution ACK/status/evidence; never a second authoritative Run |
| Discussion, Wave, Turn, Barrier, Progress, Budget, Policy, finalization | Team Authority | Participant output and provenance for Host validation |
| Accepted Result, Evidence admission, disclosure record and audit | Team Authority | Exact permitted submissions and original submission receipts; no self-adoption |
| Runtime process lifecycle, local completion/unknown receipt | Participant execution core | Host receives permitted lifecycle evidence; its projection cannot overwrite local process truth |
| Runtime secrets, Git/SSH credentials, paths, Workspace bindings | Participant local Owner/core | Host receives only explicitly permitted opaque references or scoped disclosures |
| AgentExportGrant and local execution policies | Participant local Owner/core | Host receives authenticated scope/revision assertions, not authority to expand them |
| RemoteAgentAcceptance, membership ceiling and Host revocation | Host Authority | Participant retains authenticated decisions for scoped admission/reconciliation |
| RemoteAgentProjection | Host Registry, derived from both sides' permitted data | Participant proposes publication; projection edits never grant rights |
| RemoteSpace directory, local routing and UI state | Local Node | References to remote state, not writable Room replicas |
| Node key and per-Peer trust/credentials | Respective local Node | Public identity and verification material only |
| Inbox, replay ledger, cancellation tombstone, Session, local approval | Participant execution core, partitioned by Authority | Host can send exact commands; these records never acquire Host business-state ownership |

Remote presentation data is transient or explicitly scoped cached data, outside
Hosted business tables. V1 does not maintain replicated Room databases. Any
retained cache is read-only, cannot grant access, and must stop live reads and
pending sends when authorization is revoked. Previously disclosed bytes cannot
be recalled from a recipient. At the Host, no newly fetched bytes may be served
using revoked authorization.

The existing optional Central Hosted model capability keeps its current bounded
provider/credential ownership. It is not silently exported as a Participant
local Runtime or removed by renaming Central to Hub.

## Membership and least-disclosure matrix

Team Membership and Room-scoped Membership/Guest are distinct scopes. A Room
Invite creates a Host-side Member association with a durable Room ceiling; it
does not issue an ordinary Team-wide credential whose landing page is a Room.

For every request, effective scope is the intersection of credential ceiling,
active membership, current Room ACL and operation-specific permissions. For a
Room-invited credential, `effectiveScope` must remain a subset of `invitedRoom`.
Another login's broader permissions cannot widen it. Widening scope requires a
separate explicit authorization and credential; it never mutates the original
invitation ceiling by accident.

Full Web authentication alone cannot promote a Room-scoped Guest association to
Team Membership. Broader access requires independent Host authorization as well
as a credential that permits it.

| Operation / information | Full Host Owner session | Ordinary Team Member | Room-scoped credential | Peer machine credential alone |
| --- | --- | --- | --- | --- |
| Invited Room label, its authorized content and Tasks | Per current Host policy | Only joined/authorized Rooms | Invited Room only | Exact execution input only, no human browsing |
| Team member list | Per current Host policy | Per current Team policy | Denied; only minimal identities participating in the invited Room | Denied |
| Team Agent list | Per current Host policy | Per current Team policy | Denied; only eligible projections in the invited Room | Own scoped publication/result operations only |
| Other Room names, counts or existence | Per current Host policy | Per current Room/Team policy | Denied | Denied |
| Team settings, credentials, membership administration | Owner role and full authentication required | Denied unless an existing explicit permission applies | Denied | Denied |
| Task metadata, search or Result references outside invited Room | Current object permissions required | Current object permissions required | Denied, including indirect search/count/preview leakage | Denied without an independent exact execution/evidence grant |
| Host Team label used to explain the invitation | Allowed | Allowed | Minimal invitation/Room breadcrumb only, no general Team API | Binding metadata only |
| Request a Run / contribute a Result | Existing Task/Room and execution rules | Same | Only allowed Room operations; no automatic execution or evidence grant | Only the exact allowed machine operation |
| Approve Participant Runtime permissions | No authority merely from being Host Owner | No | No | No |

Missing and unauthorized references must not expose foreign metadata through
different error bodies, list totals, autocomplete, links, notifications or long
polls. This is a new Peer/Room-ceiling requirement; it does not relabel legacy
ADR-0035 Team-scoped sessions as already satisfying the ceiling.

## Bilateral Agent Export and Acceptance

Participant owns `AgentExportGrant`: stable `exportId`, `localAgentId`, target
Authority and Team, explicit Room scope, capabilities, expiry, revision and
state. Host owns `RemoteAgentAcceptance`: its own identity/revision, authenticated
Peer and Member binding, accepted Export identity/revision/digest, accepted
scope, expiry and state. Effective capability is their intersection with current
membership, Room/Task rules, supported Runtime capabilities and local policy.

`RemoteAgentProjection` contains display, routing, presence and permitted
capability metadata. Host-assigned projection identity resolves through the
accepted binding; it cannot create a local Agent, mint authorization or select
arbitrary Runtime/Workspace configuration.

| Operation | Participant authority | Host authority | Required denial |
| --- | --- | --- | --- |
| Create or widen Export | Local Owner explicitly authorizes its exact scope | Must independently accept before use | Host cannot enable/widen Export; publication alone cannot activate Acceptance |
| Accept Export | May decline or revoke its Export | Explicit Host authorization within active membership | Neither a Peer credential nor a new projection auto-accepts an Export |
| Publish or update Projection | Submit authenticated allowed metadata | Derive metadata from active Export plus Acceptance | Unknown IDs, stale revision, capability expansion or removed Room rejected |
| Select participant / create or deliver Run | Local execution limits still apply | Current membership, Room/Task, Export and Acceptance required | Cached presence or an old enabled flag is insufficient |
| Accept / start execution | Resolve localAgentId and revalidate local grant, Host evidence, consent, cancellation and expiry | Provides exact, bounded execution binding | Waiting in a Gate cannot preserve expired/revoked permission to start |
| Reconnect | Reconcile existing scoped identities and receipts | Revalidate binding before new operations | No grant restoration, new Run or credential widening |
| Accept Result content | Local release/output policy permits exact submission | Current Export/Acceptance, membership and provenance permit admission | Revoked permission cannot be revived to publish queued content |
| Revoke Export / Acceptance | Revoke local Export and fence local starts | Revoke Host Acceptance and fence Host admission/commit | Neither side restores the other's revoked decision |

Grant and Acceptance changes have separate monotonic revisions. Revoked/expired
instances never become active again through republication. A newly named Agent,
Export or Projection begins without Host Acceptance. Fresh explicit Host consent
is required; aliases cannot escape the Host's retained revocation decision.
Removing a projection does not delete the revocation evidence behind it.

Both sides revalidate at publish, participant eligibility, Run creation, Run
delivery, Run acceptance, reconnect and Result acceptance. Each side checks its
own current authoritative records and authenticated, bounded-freshness evidence
from the other. This is not an atomic transaction spanning two Nodes. Fresh
execution admission fails closed when required remote authorization freshness
cannot be established. Transport/contracts must define the authorization lease
and revalidation protocol before Peer execution starts; cached flags or a
signature with no freshness bound are insufficient.

Private-output disclosure remains independent. Export, Acceptance, Runtime
approval and Task execution permission never grant permission to release local
private evidence. Preserve exact disclosed bytes, scope, provenance and frozen
Finalizer input under ADR-0056/0057. Unsupported remote human-owner binding fails
closed; ordinary shared output and owner-private output cannot be conflated.

## Local and Authority-scoped trust

| Capability | Decision owner | Necessary scope | Does not imply |
| --- | --- | --- | --- |
| Agent Export | Participant local Owner | Authority, Team, Rooms, Agent, capability and revision | Run execution policy, human membership or evidence disclosure |
| Standing execution policy | Participant local Owner | Authority plus existing initiator, resource, action and budget pins | Another Authority's permission, unrestricted execution or full trust |
| Interactive approval | Exact Participant local Owner | One live operation/digest, Authority, Run, local Agent, consent revision, connection and expiry | Future operations, policy amendment, replacement process or disclosure |
| Full trust | Explicit Participant local Owner consent | Exact Authority/binding and local consent revision | Trust for other Hosts, private-output disclosure or authority to perform unrelated user actions |

Bob's personal Authority may have full trust, Alice may require interactive
approval, and Company may be denied or restricted for the same `localAgentId`.
The core must select the request's effective policy before constructing Runtime
arguments or resuming a Session. A broadly trusted Session cannot be reused for
a restricted Authority; scope or permission changes require safe partitioning,
drain or a fresh Session under the applicable context policy.

V1 Peer Runtime approval stays in the Participant local Node/Console. Host
receives only permitted status, not an Owner login or the right to decide.
Approval request retries match immutable content; disconnect, process loss,
consent change, revocation, expiry and terminal Run invalidate continuation.
An approval never starts a new Run or substitutes a new Runtime process.

Existing Device-mode Central approvals under ADR-0063 remain compatible. The
Peer adapter cannot call that path as a substitute for local approval, relax its
full-owner authentication, or forward detailed permission prompts under consent
given only to another Authority. Existing Device full trust and policies retain
their exact bindings; migration does not copy them to Peer mode.

Protocol fields do not transfer Runtime tokens, Git/SSH credentials or arbitrary
local paths. This does not promise that a deliberately full-access Runtime can
never read secrets or include them in output. Safety claims must identify the
effective Runtime mode, local policy and disclosure boundary. Same-OS-user
malicious code is not isolated by an application credential file alone.

## Peer control plane and shared delivery

```text
Peer Control Plane
  Identity / Invite / Membership / Export / Acceptance / Trust / Revocation
        |
Peer Runtime Transport Adapter (Peer Principal, exact execution binding)
        |
Shared Delivery Core
  Inbox / ACK / Replay / Cancellation / Result / Recovery
```

Device Principal continues to serve legacy `/ws/bridge`. Peer Principal is a
different authenticated authority type; an adapter cannot manufacture a Device
principal to inherit Device-wide permissions. Transport validation supplies the
scoped execution identity to shared delivery, not a second implementation of
the reliability algorithms. The endpoint name, including whether to use
`/ws/peer/runtime`, remains a CON-027 decision.

Invite approval must bind authenticated Host identity, target Team/Room scope,
recipient proof, protocol/capabilities, nonce and expiry. One-time secrets are
hashed at rest, excluded from logs and ordinary URL queries, consumed atomically
and revoked explicitly. Exact accept-operation replay after response loss
returns the original binding; it does not consume another invitation or create
another Member. Merely opening an invitation does not install trust or switch
the current identity.

Reuse the existing exact-origin TLS/private-CA, expiry, pairing proof and
idempotency mechanisms where their scopes fit. TLS CA fingerprint, installation
identity and Node signing-key fingerprint are distinct. A claimed public key
must have verified possession bound into the handshake; it never proves current
membership. Secret-bearing traffic rejects origin redirects and insecure
downgrades; remote machine transport retains authenticated TLS even where the
legacy LAN browser uses a separate HTTP entry. No global CA installation or
browser trust follows automatically from a Peer invitation.

## Minimal recovery state machines

These are semantic states, not new wire enums. Contracts must map them onto
existing delivered/working/completed/failed/canceled/expired/outcome_unknown
semantics without rewriting historical events.

| Counter / identity | Meaning | Never used as |
| --- | --- | --- |
| Run event / delivery sequence | Ordering and deduplication within one `AuthorityRef<Run>`; current `run.accepted` uses sequence 1 | A credential version or reconnect trigger |
| Room message sequence | Host ordering within one `AuthorityRef<Room>`; Task cursors retain Task scope | A globally unique event ID or cross-Authority cursor |
| Connection epoch | Current authenticated transport incarnation | A new execution identity or permission to rerun |
| Authorization revision | Monotonic version of one Export, Acceptance or local consent record; these are separate counters | Transport liveness, event ordering or permission to mutate a frozen request |

Delivery retains the existing single per-Run event sequence. There is no second
competing delivery sequence; retry envelope message IDs and attempt metadata do
not reset the event sequence or replace it as the Run ordering authority.

The semantic payload is frozen at first durable reception. It includes target,
context, instruction and execution/authorization pins, excluding transport-only
retry wrappers. Comparison cannot silently replace old pins with a current
projection or grant. Same identity plus different semantic payload is a protocol
error; same identity plus same payload is a lookup/replay, subject to current
permission to disclose anything in that replay.

| State machine | Allowed transitions / effects |
| --- | --- |
| Membership, Export, Acceptance | Pending -> active through the respective explicit authority; active -> revoked or expired. Restoration requires new explicit authorization, never an in-place stale replay |
| Connector | Disconnected -> authenticating -> reconciling -> ready; failure returns to disconnected/degraded. Ready never bypasses request authorization; revoked binding cannot reconnect to new work |
| Participant execution | Absent -> durably received -> accepted/queued -> possibly started -> known local terminal or outcome_unknown. ACK is emitted only after durable reception and before Runtime invocation |
| Result transport | Local terminal retained -> pending report -> acknowledged or delivery denied. Transport failure does not change a known local terminal outcome |
| Host Run/Discussion | Existing durable intent and Run/Turn -> validated event settlement -> one terminal/Barrier decision; recovery resumes original identities and transactions |

Immediately before Runtime start, after any wait for Gate/Workspace/approval,
recheck authorization, cancellation and expiry. Persist sufficient execution
intent before the possible side effect. A crash between intent and proof of
start/stop is ambiguous, not evidence that execution never occurred. A duplicate
handler never invokes Runtime again; a provably unstarted original request may
resume its existing scheduler entry only under still-valid authority.

The ordinary legacy `accepted` state alone is not proof of no possible start;
its ambiguous restart remains conservative. Finer governed execution journals
may prove a never-started claim. The future shared core must preserve that
distinction instead of treating every persisted ACK as permission to resume.

| Failure / cut point | Participant action | Host / collaboration action |
| --- | --- | --- |
| Duplicate or lost ACK | Match immutable identity/payload and replay permitted ACK/state; reject payload mismatch | Reuse original Run/Turn and delivery intent |
| Crash after reception or ACK, before execution proof | Resume only a provably unstarted original scheduler entry; otherwise preserve ambiguity and do not rerun | Reconcile, do not assume missing ACK means no side effect |
| Participant restart after durable completion | Retain known completion and original output/receipt; replay only if current content authority permits | Idempotent admission into original Run; terminal/closed work never reopens |
| Participant restart after possible execution without proof | Fence surviving processes where supported; persist outcome_unknown | Settle under existing unknown/attention semantics; no automatic retry |
| Authority restart or lost commit response | Reconcile exact original receipt/identity | Recover original Turn/Run/Wave/Decision; a transaction already committed cannot be duplicated |
| Connection loss / epoch replacement | Invalidate pending interactive continuation; retain ledger and frozen request | Reconcile state; no new Run or changed payload merely because epoch changed |
| Host revokes membership or Acceptance | On observed revocation, reject new starts, invalidate approval and attempt cancellation; fresh admission requires current authorization evidence | Immediately fence new reads, publish, eligibility, creation, dispatch, acceptance and content commit after the revocation transaction |
| Participant revokes Export or local consent | Immediately fence local starts and cancel/drain applicable work; retain revocation receipt | On observation, fence new work/content and reconcile in-flight Runs |
| Work is proven never started | Retain cancellation/rejection evidence | Use existing failed/canceled/expired mapping for that cause, without asserting a side effect |
| Accepted work has no trustworthy stop/outcome evidence | Preserve outcome_unknown; do not infer canceled from socket closure | Existing unknown settlement closes or waits according to bounded Discussion policy |
| Late Result or buffered content after revoke/expiry | Do not disclose under stale rights; keep the original local receipt | Reject new unauthorized content/adoption; never reopen Barrier, advance twice or finalize twice |

Revocation and state evidence have different purposes. A narrowly authorized,
content-free reconciliation path for an already bound execution may report
stopped/unknown/delivery-denied status or acknowledge an already committed
receipt. It cannot carry Result text, restore membership, fetch context, mint a
new Run or reauthorize execution. Its authentication, expiry and retention must
be specified before implementation; a revoked general credential cannot simply
be accepted on normal business endpoints. This permits safe settlement without
turning revocation into either silent data disclosure or loss of execution truth.

Host Run termination is not proof that a Participant process or its descendants
have stopped. Local Gate/Workspace availability follows local process evidence.
Unknown surviving work fences the affected resource until safe recovery; a
different Host cannot bypass it with a new Projection. A failed connector must
not revoke other connectors or corrupt their partitions, although genuine shared
resource contention or core failure may affect their availability.

Revocation is immediate at each decision owner's local commit/start boundary,
not a distributed atomic commit or guaranteed instant remote process kill.
Authorization freshness/expiry bounds limit partition exposure but cannot recall
already disclosed context. A Host timeout may remain outcome_unknown even when
the Participant later proves local completion; retain that distinction without
rewriting the terminal Host history or suppressing the local receipt.

## Discussion invariants preserved

The Host retains participant selection, stable Run/Turn binding, Wave ordinals,
Barrier closure, ProgressSnapshot, logical budgets, policy decisions and
finalization. Participant returns output/evidence, not a decision to advance
the aggregate. A remote Agent may execute a Host-selected finalizer Turn, but
cannot commit finalization itself.

Adapt only participant eligibility, execution binding, bilateral authorization,
verified capability, evidence provenance and revoke/deadline settlement. Keep
transactional Wave closure/decision/next-Wave persistence and idempotency keys.
Retain existing all-settled behavior and the separately authorized read-only
quorum rules; this ADR neither enables quorum by default nor removes its gates.

Frozen Wave membership is not rewritten on revocation, and a Turn cannot be
silently reassigned to a new Projection. Settle its existing slot and apply the
existing bounded policy. Preserve the current Discussion handling of Runtime
`input_required` as terminal uncertainty, distinct from ordinary Task human
clarification. Participant-local Runtime permission approval is a separate live
callback path; it must not be implemented by changing that Discussion rule.

Preserve Task context isolation, same-Room explicit Result reuse rules and frozen
Finalizer inputs. Shared local Agent identity cannot merge cross-Host or cross-Task
conversation histories. Owner-private output requires existing exact disclosure
authorization, not Export or Runtime approval. Budget retains Wave/member-slot,
duration and lease semantics; token/monetary accounting removed by ADR-0043 is
not reintroduced.

## Compatibility, migration and prior ADR relationships

All relationships in this table are proposed. No existing Accepted ADR is
superseded or edited by this draft. On acceptance, apply the scoped amendments
explicitly and update owning modules; until then their current rules prevail.

| Prior decision | Proposed relationship | Conflict resolved / rule retained |
| --- | --- | --- |
| [ADR-0035](0035-connect-client-owners-to-team-collaboration.md) | Extend with distinct Peer/Room-ceiling membership and bilateral publication | Its Team-scoped entry and initial-Room Device publication remain legacy behavior, not a Room ceiling or Export grant; separate human proof and Owner ceiling remain |
| [ADR-0060](0060-preauthorize-local-work-policies.md), [ADR-0062](0062-trust-owner-devices-for-central-execution.md) | Amend only the future multi-Authority policy lookup boundary | Existing exact pairing/Owner/revision permissions are not Agent-global; they map to one explicit Authority binding, never automatically to another Host or Peer |
| [ADR-0063](0063-forward-runtime-approvals-to-device-owner.md) | Extend with an explicitly separate Peer approval route | Legacy Device Central approval stays available; Peer V1 approval is Participant-local, not a relaxed full-owner session or silent replacement of existing behavior |
| [ADR-0017](0017-isolate-explicit-bridge-reenrollment.md), [ADR-0033](0033-explicit-client-central-switch.md) | Amend exclusivity only for future multi-connector mode | Explicit legacy replacement stays intact; adding a connector is a new isolated binding, never reuse of another origin's credentials, inbox, sessions or consent |
| [ADR-0011](0011-central-orchestrator-controls-discussion.md) | Amend topology terminology only; Central is each Team's Hub authority | No distributed orchestrator; Agent output does not become policy or state authority |
| [ADR-0012](0012-parallel-discussion-waves.md) | Amend future Remote participant eligibility/binding; preserve single-authority Wave/Barrier semantics | Bilateral Export/Acceptance adds eligibility checks; frozen identity, atomic Wave transitions and existing completion modes remain |
| [ADR-0025](0025-harden-transactional-runtime-and-release-boundaries.md), [ADR-0029](0029-preserve-bridge-results-configuration-and-instance-ownership.md), [ADR-0031](0031-preserve-cross-layer-bridge-recovery.md) | Preserve and extend identity partitions | No new runtime retry on reconnect; known completion survives send failure; frozen delivery, ownership and process recovery fences remain |
| [ADR-0013](0013-task-scoped-agent-continuity.md), [ADR-0064](0064-isolate-task-conversations.md) | Extend Session/ref namespace while preserving context policy | Same local Agent is not permission to reuse a foreign Authority/Task Session or inject remote Room history |
| [ADR-0056](0056-authorize-exact-evidence-disclosure.md), [ADR-0057](0057-admit-authorized-disclosure-to-discussion.md) | Preserve and extend provenance/owner binding to Peer references | Export and execution permissions do not imply private disclosure; release/revoke ordering and frozen evidence remain |
| [ADR-0023](0023-default-public-ca-and-scope-private-bridge-trust.md), [ADR-0040](0040-separate-lan-browser-and-bridge-transports.md) | Preserve and extend verified Peer identity | TLS/browser trust separation remains; Node proof is additional, never a certificate bypass |

The future migration must follow these rules:

1. Legacy Central plus Bridge continues to operate. Host-only and Runtime-only
   deployments remain valid capability configurations; no forced Peer enrollment.
2. Preserve Hosted Team/Room/Run IDs, foreign keys, historical attribution,
   immutable payloads and applied migration checksums. Add explicit Authority
   binding metadata; do not import remote Rooms into local writable tables.
3. Bind old local execution records to exactly one proven legacy Authority.
   If configuration/history cannot establish that mapping, stop migration for
   explicit resolution; do not guess from current URL, display name or first
available connection. Retain source records and tombstones.
4. Preserve existing local Agent identities for the original binding where safe.
   Add projection-to-local mapping; upgrading or aliasing cannot manufacture a
   second execution identity. Legacy Central switching does not become automatic
   adoption of the old binding as a concurrently authorized Peer.
5. Copy no human grant, full trust, standing policy, private evidence disclosure,
   CA trust or Runtime Session across Authorities. New Peer capabilities are
   default-denied; omission or old-client fallback cannot weaken required scope.
6. Namespace Web navigation, async responses, credentials, drafts, pending sends,
   retry acknowledgements and sequence caches. Keep separate Web contexts/origins
   until a unified client can preserve the same isolation. Unassignable cached
   drafts require explicit handling, never automatic sending to a selected Host.
7. Local Node packaging supplies native Node/SQLite dependencies and migration
   resources, stable Owner identity, explicit owner-local data paths and safe
   Supervisor lifecycle. A new port/origin must not silently create a new Owner.
8. Upgrades use one database owner, verified compatible resources and recoverable
   backups. Old binaries cannot blindly open a newer schema. Windows native
   storage permissions require their own evidence; POSIX chmod is insufficient.
9. Restore is not live Authority migration. Never run the same Authority identity
   and restored business database as two writable installations. An intentional
   clone needs a fresh identity and explicit rebinding; V1 does not provide a
   distributed fencing/failover service or protect against an Owner deliberately
   operating copied private keys concurrently.

## Milestone boundaries

These are architectural sequence and exit requirements, not delivery status or
authorization to start tasks. Follow-up IDs below are reserved planning names;
only GOV-044 is registered by this draft. Create their delivery rows in
[TASKS.md](../TASKS.md) when the corresponding work is authorized.

| Milestone | Reserved task scope | Exit boundary |
| --- | --- | --- |
| A: Local Node | GOV-044, OPS-018, DATA-008, BRG-079, QA-090 | Install -> open -> create local Team -> add local Agents -> normal Run -> Discussion -> restart recovery, without user-installed Docker/npm or a separately deployed Central |
| B: Multi-Authority Runtime Foundation | CON-027, DATA-009, BRG-080, WEB-084 | Local plus multiple Authority connectors share one core; Agent/Workspace arbitration and Session/approval/cancel/result isolation survive duplicate IDs, crashes and one Authority's failure |
| C: Peer Collaboration | SEC-019, REG-007, RUN-020, DISC-022, QA-091, OPS-019 | Invite human -> establish scoped membership -> export -> explicit Host acceptance -> remote Run -> cross-Node Discussion with authenticated transport and bounded recovery |

Milestone A is an independently releasable increment, with no Peer prerequisite.
Milestone B proves isolation using disposable authenticated fixtures before
Invite UI or real remote membership; fixtures cannot bypass admission by running
independent execution cores. Milestone C depends on that foundation and the
resolved control-plane/security contracts.

Offline Local Node means local collaboration is available without a remote
Central. Offline inference is a separate Runtime capability. QA-090 must use an
explicitly offline-capable fixture/local model for disconnected orchestration;
live Codex/Pi tests record their network/provider requirements and separately
bounded model authorization. Local tests, real model tests, native packaging,
physical-owner/platform acceptance, CI and release publication remain separate.

## V1 non-goals and alternatives

V1 excludes CRDT, multi-master Rooms, Raft/Paxos, distributed Discussion
consensus, DHT, Gossip, Blockchain, Room replicas, automatic Authority migration,
automatic failover, Room-specific authority transfer and language unification.
Self-developed NAT traversal and A2A are not Node-first prerequisites. A future
Relay may transport encrypted traffic but never own Team/Room/Run/Discussion
state or Agent credentials. Those features require demonstrated need and a
separate ADR.

| Alternative | Why it is not selected |
| --- | --- |
| One independent Bridge execution core per remote Host | Duplicates Agent/Workspace arbitration and can bypass local resource ownership |
| One shared unqualified Inbox/Session for every Host | Conflates execution identities, cancellation, secrets and conversation context |
| Extend ordinary Device Principal with every Peer permission | Conflates human, machine, membership and export authority; creates unsafe legacy fallback |
| Implement a second Peer Run/recovery stack | Duplicates ACK, replay and crash semantics already present in delivery |
| Writable Remote Room replicas or a distributed orchestrator | Adds state authority/merge problems unnecessary for Hosted collaboration |
| Rewrite Hub in Go before Local Node | Delays an independent product milestone without resolving trust or delivery boundaries |

## Architecture self-review

### Unresolved questions and decision gates

The following are unresolved implementation-contract choices within the accepted
direction. They do not reopen the invariants and are not reasons to begin code
with an implicit default.

| Question | Decision required before | Constraint already fixed |
| --- | --- | --- |
| Node ID/key lifecycle, proof transcript, rotation, endpoint rebinding and lost-key recovery | CON-027 and SEC-019 | Verified Node possession is separate from TLS and current membership; no silent credential forwarding or dual writable restore |
| Freshness lease, clock-skew bound and exact dual-sided revoke/revalidation protocol | CON-027, then RUN-020 | No unbounded cached grant, no distributed atomic-revoke claim; stale/unverifiable fresh admission fails closed |
| Canonical semantic payload/digest, accepted-grant digest, conflict/error mapping and revision rollover | CON-027 and DATA-009 | Original execution identity/payload never rewritten; renewal does not rerun work |
| Authentication and retention of content-free settlement after business authorization ends | CON-027 and RUN-020 | No Result text or new work via a revoked credential; known execution truth and cancellation evidence remain recoverable |
| One local Owner versus multiple isolated local Owners, stable identity bootstrap and port strategy | DATA-008 and BRG-079 | Node/Member separation, owner-local storage and unchanged historical Team ownership |
| Shared-core resource fairness, process fencing and Session transition across trust revisions | BRG-080 and RUN-020 | Projection aliases never bypass local identity or Workspace locks; foreign trust/context is never resumed |
| Exact remote human-owner binding for private disclosure | SEC-019/REG-007 and DISC-022 | ADR-0056/0057 disclosure stays independent; unsupported paths fail closed |
| Unified SPA versus separate origin-bound views; route name and capability negotiation | WEB-084 and CON-027 | Every cache/action/response belongs to an Authority; Peer Principal never falls back to Device authority |

### Security risks

| Risk | Design control and remaining verification |
| --- | --- |
| Host relabels a request or gains broader local trust | Exact binding, local policy intersection and Session partition; test cross-Host IDs, policies, approval decisions and shared Agent aliases |
| Participant recreates a revoked projection/export | Explicit Host Acceptance for every new authorization plus retained revocation records; test new IDs, old revisions and reconnect publication |
| Room guest learns other Team data | Durable ceiling with scoped list/search/event projections; negative tests must include counts, errors, previews, links and long polls |
| Stolen Node key is treated as human or membership proof | Separate Member/credential checks and key recovery protocol; cryptography alone does not answer current authorization |
| Partition or delayed revoke allows stale start/content | Local commit/start fences and bounded authenticated freshness; in-flight cross-Node race cannot be removed by this ADR |
| Full-access Runtime or shared OS user exposes private data | Explicit scoped consent and disclosure controls; no unsupported universal sandbox or secret-noninterference claim |
| Cleanup/reconciliation channel becomes a revoked-user bypass | Exact immutable execution scope, minimal metadata and independent bounded authentication; no business content or execution capabilities |

### Migration risks

Unqualified historical IDs, prior Central switches and copied data directories
may make origin mapping ambiguous; migration must preserve records and stop
rather than choose an Authority heuristically. Unifying Web origins can expose
previously isolated credentials/drafts. Changing local Agent/Session keys can
either resurrect mixed context or lose continuity. Native Hub packaging and
database upgrades introduce platform permission, backup and downgrade risks.
None is resolved merely by adding an Authority column or a URL list.

Historical full trust, standing policy and Central approval are especially
sensitive: retaining the old exact binding is compatible; migrating them as
Agent-global settings is a privilege expansion. Fresh Peer authorization must
remain an explicit independent action. Legacy implementations without required
namespace/provenance capabilities cannot be silently admitted to Peer mode.

### Assumptions that still depend on current code

The source baseline must be rechecked before each implementation milestone:

| Assumption | Evidence to revisit |
| --- | --- |
| Server can be packaged as a local Hub without a Docker business dependency | Server entry, static Web composition, native SQLite dependency, migrations and graceful shutdown |
| One original Bridge binding can be explicitly retained during migration | Credential/configuration files, reenrollment backups, local identities and data-directory ownership |
| Delivery durability survives factoring transport away from execution | Inbox payload hash, ACK/start ordering, replay, cancellation tombstones and process fences |
| Discussion transitions remain one local transaction | Turn/Run orchestration keys, Wave/decision/next-Wave commit, private evidence and late callback handling |
| Existing trust and human-entry paths are distinguishable without widening rights | ADR-0035/0060/0062/0063 implementation, credential audiences and full-owner approval guards |
| Task and evidence context remain isolated across a new namespace | ADR-0064 Session policy, frozen delivery, Artifact-consumption cursors and Web pending state |

This draft does not report those future refactors as tested. Existing one-Host
tests demonstrate assets to preserve, not multi-Authority acceptance.

### Decisions expensive to reverse

The Team-level Authority boundary determines every business reference and
availability expectation. Stable local Agent identity determines execution locks
and long-lived Session mapping. AuthorityRef serialization, key identity and
origin rebinding affect all persisted records and credentials. The separation of
Export, Acceptance and local trust determines revocation lineage and auditability.
Room credential ceilings determine what previously disclosed information cannot
be recovered. Choosing which metadata may survive revoked authorization affects
both recovery and privacy. These require explicit contract review before schema
or protocol implementation; consensus, replication or global identities are not
substitutes for resolving them.

### Self-review outcome

The direction is compatible with existing collaboration/execution separation.
No whole Accepted ADR needs superseding. The scoped changes and the legacy/Peer
approval distinction above resolve the identified semantic conflicts at design
level. This is a reviewable Proposed draft, not a claim that key lifecycle,
revocation freshness or the settlement credential is implementation-ready.
GOV-044 can finish as a documentation task; further task authorization and the
relevant contract decisions remain required before any runtime work.

## Verification

For GOV-044, verify the accepted requirements against the invariant/matrix and
recovery sections, audit the prior-ADR relationships, and run documentation lint,
changed local-link/anchor checks and whitespace checks. Only documentation and
its task/module routing may change. No executable example, generated contract,
schema migration, runtime configuration, installation or model call is part of
this draft.

Future evidence must cover the failure transitions above at durable cut points,
same IDs from two hostile Authority fixtures, local plus two remote requests for
one Agent/Workspace, revoked credentials/new IDs/old revisions, wrong-owner
approval, frozen Session and Result provenance, mixed legacy/new versions and
both native platforms. Protocol changes require TypeScript/Go contracts and
interoperability; runtime/concurrency changes require focused regression/race
coverage. Milestone evidence must separate deterministic fixtures from real
models, physical devices, independent human owners and release admission.
