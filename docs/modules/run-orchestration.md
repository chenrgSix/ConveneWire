# Run Orchestration Module

RUN-020 implements the separate bilateral Peer execution path defined by
[ADR-0068](../adr/0068-peer-collaboration-delivery.md). Its first increment is the
[closed Peer request and semantic digest](contracts.md#peer-collaboration-contracts).
Transport attempts do not alter execution identity; changing content or bilateral
pins for the same qualified Peer Run must conflict with retained evidence.
The native factory delivered by BRG-081 supplies shared physical resources,
private Peer Sessions and local approval. Fresh signed admission, private
Participant journals and the Host delivery/event/settlement transport now exist.
Native connector polling, durable event replay and execution coordination remain
in progress; Host transport and native SDK checks are not a complete Peer Run.

The Host `PeerRunAuthority` now freezes an already-authorized local Run into one
immutable Peer request in migration 0103. It derives execution and context from
the Host Run, captured context fence and existing planner. It does not accept
caller-supplied prompts or copy Device policy into a Peer manifest. Replay and
reopen return the original request, including after expiry, solely as historical
evidence. Current delivery/admission must separately check that exact binding.

Fresh admission accepts a closed, Participant-signed `PeerAdmission` for that
retained binding and returns a Host signature with the same operation and nonce,
valid for at most 30 seconds. In one synchronous Host transaction it checks the
machine audience, both Nodes, current bilateral revision/digests, Room and Task
participation, current requester membership, cancellation, Run state and deadline.
Ordinary Task assignment and scheduling remain required. The originating Member
is read from the persisted Run, including its current Peer ceiling when present;
no synthetic browser session or Device principal is created. This authority
service supplies admission; the separate delivery service described below owns
Host content and settlement transactions.
Discussion requests are explicitly refused until DISC-022 supplies frozen Wave
and Finalizer context, preserving its existing exclusion rules.

The separate machine-only `POST /api/peer/runs/admit` now exposes fresh
authorization for an existing frozen request. Its strict `PeerAdmission` body
contains only the binding and Participant proof. Browser/Owner credentials,
cookies, Origin, Device headers, query aliases, changed pins and additional
content are rejected. The native HTTPS ingress exposes this same handler and
uses the native installation signer; a central database key cannot stand in for
that native key.

The Go client proves the pinned Host before sending a machine bearer, rechecks
local identity/membership after that wait, signs the immutable binding, and
validates the exact Host response and its <=30 second lifetime. It rechecks local
state before returning; the native Runtime factory must also recheck current
local Export/Acceptance. Lost responses can refresh only the same frozen binding.
Actual Go-to-Host TLS tests cover expiry/refresh, lost response, Host revoke,
native identity loss before bearer transmission, local leave during the request
and changed responses. The actual native HTTPS listener passes positive signed
admission and negative browser/control checks. Fourteen owning HTTP/authority
tests, seven native-ingress tests, full Peer race/vet and Hub build/bundle pass.
Native polling and Run/approval lifecycle wiring remain RUN-020.

The Participant retains the exact validated request in its immutable Peer
Runtime partition. Separate private receive, possible-start and outcome files
keep one namespace for the qualified Run across retries, revisions and restart.
Request-only SDK receipt requires a fresh Host admission and current local
membership. An authenticated network delivery instead atomically retains its
request and settlement capability, including when permission was withdrawn after
the poll. This permits denied-delivery settlement without granting execution.
The one-time start claim always requires fresh Host admission and current local
membership. Historical reads and exact receipt retries grant no execution rights.
Local Export/Acceptance checks remain the native factory's responsibility
immediately before execution and after waits.

The start claim rejects a second caller, including after cold reopen with no
known outcome. Reconciliation lists that retained ambiguity without resetting it
to queued. A known local outcome can be retained after leave/expiry; its Reply
is private local evidence and cannot be sent using settlement authority.
Outcomes are immutable, and denied-before-start, terminal and unknown states
cannot reopen a Run. Requests are limited to 512 KiB and local replies to
256 KiB; oversized data fails before a new journal record is accepted.
The native partition retains the journal observer across core replacements.
Observed rollback/deletion, changed ownership, malformed JSON, copied Peer pins
and linked paths fail closed. OS process fencing remains independently required;
the journal does not prove that a child has stopped. The native worker still
must compose these records with actual process and approval lifecycles.

Each delivered Run now also has a private atomic transport checkpoint. Events
retain their closed payload and original sequence before transmission; retries
cannot replace an event or skip a sequence. Host signatures authenticate ordered
acknowledgment progress. A content-free settlement derives only from an immutable
local outcome, with one durable operation ID surviving loss and restart. Its Host
receipt is validated against that exact operation. Historical signature checks
preserve evidence after proof expiry; they never supply fresh admission.

The checkpoint is limited to 4,096 events and 1 MiB, with 8 KiB reserved for final
receipts. Overflow preserves previous evidence and still permits settlement.
Private-file, ownership, closed-shape and observed append-only history checks
reject corruption, missing/linked files and rollback. Actual TLS regression
reopens the Participant after lost event and settlement acknowledgments and
verifies one Host reply/settlement without a new start. Native adapters are not
invoked by these transport-journal tests; worker composition remains required.

The Host `PeerRunDeliveryService` uses migration 0104 and the shared SQLite
transaction boundary. `POST /api/peer/runs/poll` requires the exact active,
mutually proven Peer connection plus a fresh signed intent. It freezes pending
Host Runs and commits a delivery before returning content. A lost response or
Host reopen reproduces the original capability and expiry; only its hash and
metadata are stored. Known Run/digest pairs suppress duplicate offers without
creating a new execution identity. Changed pins fail closed.

`POST /api/peer/runs/events` verifies the machine audience, Participant signature,
capability and current binding before a new ordered event can commit. The event
digest, sanitized Run event and Room reply projection commit together. Duplicate
events acknowledge the original digest; conflicting or out-of-order sequences
and late content are rejected. Exact terminal acknowledgments may be reproduced
under current membership/Room/bilateral authority without reopening the Run.
The shared transaction boundary publishes notifications only after commit;
failure of a receipt insert also rolls back the event, message and notification.

`POST /api/peer/runs/settle` instead requires the separately issued settlement
token and the retained Participant key. A business token cannot substitute after
revocation. One exact sequence-one terminal/unknown/denied receipt is retained
per delivery, within the original seven-day expiry. It can record known local
completion without Result text and cannot read context, start work, extend the
capability or revive membership. A late receipt preserves the Host's existing
terminal/unknown state while retaining the Participant's evidence.

Requester cancellation before delivery is final. Any durable delivery is
possibly received, so cancellation immediately fences admission/content and
waits up to 30 seconds for evidence before becoming `outcome_unknown`. Grant or
membership loss enters the same bounded path. Neither a Host terminal state nor
these records prove local process termination; native cancellation and process
fencing remain required. All three routes reject browser/control credentials,
Origin, cookies and query aliases and use the same native HTTPS ingress.

Actual Go-to-Host TLS and Peer WebSocket checks verify the production routes,
lost-response identity, fractional assessment, exact duplicate events and
post-revocation content-free settlement with one Host reply and receipt.
Native execution and reconnect/crash replay remain the next RUN-020 increment.

The native Go transport client now verifies signed polls against its exact live
connection, Host and current local membership. It publishes only caller-retained
closed events and rechecks actual local authority after the Host identity wait.
Settlement instead checks immutable membership history and the original bounded
capability, so local leave and revoked business access do not erase known truth.
All responses bind the exact request, sequence and digest; lost acknowledgments
never change the event or settlement operation. Actual TLS tests cover changed
delivery proofs, identity/configuration loss during waits, large fractional
assessment replies, duplicate acknowledgments and post-leave settlement expiry.

Continuous traffic has separate pre-authentication IP limits: 600 Host identity
challenges and 1,200 combined Run poll/admit/event/settlement requests per minute.
Invitation admission keeps its existing limit. These bounded buckets prevent
ordinary Runtime traffic from consuming the invitation budget; body limits and
every signature, current-authority and audience check still apply. The native
worker must pace event publication and retain a failed request for retry.

[ADR-0062](../adr/0062-trust-owner-devices-for-central-execution.md) adds an
owner-local full-trust choice for Codex execution, mirrored to Central and pinned
per Run. Default-off consent, local revocation, pairing/revision checks and
ordinary task authority remain mandatory.

Ordinary Runs on a fully trusted device freeze its current consent revision and
execute directly through the existing conversation. They skip the read-only
proposal/work-policy negotiation path. Reconnect requires fresh authenticated
publication; revoked queued pins fail before dispatch. Existing Room authority,
Run budget and cancellation still apply. Governed Runs keep scoped manifests.
See [SEC-016 evidence](../acceptance/sec-016-device-execution-trust.md).

[ADR-0061](../adr/0061-continue-development-from-conversation.md) binds a capable
Codex Agent's read-only development proposal to the exact original human Run.
Central retains one immutable proposal, waits for successful completion and
reserves the source Task budget before creating a policy-governed continuation.
Missing authority is reported in the source conversation. Reading, Discussion,
handoff and private-output Runs cannot implicitly create development plans.

[ADR-0036](../adr/0036-add-governed-software-team-execution.md) adds governed
execution manifests and a common admission port. Plan dispatch still creates
one ordinary Run and uses the existing Delivery/inbox, retry and ambiguity
contracts. Direct Messages, handoffs, retries, Discussions and manual paths must
not bypass an active plan's gates. Unsupported Bridges reject governed work
without degrading it to a prompt-only ordinary Run.

The additive wire carrier is `contextManifest.execution`, defined by CON-021.
It freezes one exact version-1 manifest rather than duplicating execution fields
beside the existing context snapshot. RUN-018 now admits one owner-dispatched,
approved implementation node with no unresolved required inputs, stages an
immutable SQL admission, freezes its exact capture manifest and isolated lease,
and sends it through the ordinary durable Delivery path. EXEC-004 still owns
automatic scheduling, while EXEC-003 owns predecessor input selection. Both
must preserve ordinary Run identity, inbox deduplication, cancellation and
explicit unknown-outcome retry.

RUN-018 now has its first additive delivery field: a governed execution manifest
may freeze one `capture` intent containing the stable repository operation ID,
root Task ID, and selected output slot descriptions. Each selected output has
bounded title/summary text and either a portable repository-relative report path
or `null` for patch/commit content. The intent is covered by the manifest digest
and remains optional for old manifests; its presence is data, not local Git
permission, process-stop proof, Artifact publication authority or a Result. The
production Server derives it only from approved patch/commit slots and the
production Bridge still requires its independent local grant, process-stop and
current Server checks before consuming `capture`.

- Prefix: `RUN`
- Planned location: `apps/server/`
- Owns: Run lifecycle, durable delivery, status sequencing, cancellation,
  offline queue, handoff

## Purpose

Run Orchestration converts an authorized structured Agent Mention into one
bounded unit of work. It is the only component allowed to route work between
Agents; Agents and Bridges never route directly to one another.

Run Orchestration executes one bounded unit of work. Multi-Agent progress,
budgets, Wave barriers, and next-Wave decisions belong to Discussion
Orchestration. One ordinary Discussion Wave may request one Run per member, but
it cannot bypass Run delivery, idempotency, or cancellation rules.

Every Run belongs to one durable Agent Task. Task Collaboration owns the
long-lived goal and shared result state; Run Orchestration continues to own only
the bounded attempt, delivery, event sequence, and terminal result.

## Responsibilities

- Create one Run per valid target Mention on the normal message path, or per
  persisted Discussion member Turn on the Wave path.
- Persist delivery before pushing to a Bridge.
- Retry unacknowledged delivery with the same Run ID.
- Apply sequenced Bridge status, output, activity, and reply events.
- Manage cancellation, expiry, offline queue, and terminal outcomes.
- Validate and create child Runs for handoff.
- Publish Run projections for Web and MCP.
- Bind an optional `orchestrationKey` to one Run for aggregate-owned recovery.
- Preserve the authoritative `taskId` across Mention routing, Discussion Waves,
  handoff, retry, and recovery.
- Pin content-bearing canonical Artifact metadata into the existing immutable
  Delivery payload; never resolve live upload or Workspace state on retry.
- Persist safe Task clarification requests and create one authorized
  continuation Run after a Room answer.
- Persist one Central Hosted invocation intent before outbound HTTPS and
  recover any ambiguous accepted call without automatic replay.

## State Machine

```text
queued
  → delivered
  → working
      ├── input_required
      ├── completed
      ├── failed
      ├── canceled
      ├── expired
      └── outcome_unknown
```

`transport_lost` is connection metadata, not a Run state. Terminal states do
not transition. A Runtime that may have executed but lacks a trustworthy
outcome becomes `outcome_unknown` and is never automatically rerun.

### Task/Run/Result attempt contract

[ADR-0022](../adr/0022-make-task-run-and-result-the-primary-work-model.md)
keeps this state machine authoritative. `connection_lost`, Delivery progress,
context preparation, Runtime startup, tool activity, and Result submission are
diagnostic phase projections from durable Delivery and Run events, never new
Run states inferred from current presence. A legacy or absent phase is unknown.

Every new attempt has a new Run ID, monotonic Task-local attempt number, and
optional `retryOfRunId`. Normal unaccepted Delivery retry continues to reuse the
same Run and Delivery identity. A terminal `outcome_unknown` Run never creates a
new attempt automatically; a Task or Team Owner must acknowledge the ambiguity
in an audited request before another Run may start or the Task may become
terminal. The acknowledgement preserves `outcome_unknown` and never asserts
whether an external side effect occurred.

`GET /api/runs/:runId/ambiguity-acknowledgement` authorizes current Room
membership and returns `{ acknowledgement: record | null }` with `no-store`.
It reads the exact Run, not the Task's highest-priority attention summary. The
Web uses this additive read to explain a prior confirmation after refresh;
only the existing authorized POST operations acknowledge or create a new Run.

ADR-0026 applies the same rule to a Hosted provider call. Once its durable
intent crosses to `dispatching`, a process restart or lost provider outcome is
ambiguous even when the provider has no tools: blindly retrying could duplicate
charges and disclose the prompt twice. Recovery records `outcome_unknown` and
requires the existing audited acknowledgement before a new Run.

Run creation atomically validates Task lifecycle,
scheduling state, budget, Agent assignment, and expected Task revision; records
the budget admission and Task/definition/criteria/context fences; and persists
Run plus Delivery. Generic Run pause is unsupported. Pausing a Task prevents new
scheduling and does not claim to suspend an already accepted provider process.

Migration 0044 gives every new Run a frozen redacted Context Manifest captured
from its Task/definition/criteria/context fences and admission-time target
policy rather than current live state. The exact stored object is carried by
managed `run.requested` Delivery and projected by the Bridge as the frozen
goal, criteria, permission summary and intentionally omitted categories. It
names the bounded source identities and revisions used for admission, plus the
safe Agent, Device and Workspace alias projection. It excludes credentials,
paths, commands, environments, provider sessions, hidden reasoning, tool
payloads, and unrelated context. Missing legacy fields render as
`not_recorded`; the Web does not guess them.

`WEB-047` adds authorized `GET /api/tasks/:taskId/runs` and
`GET /api/runs/:runId` reads over this repository. Both revalidate current Room
membership; Task listing is ordered by creation time and opaque Run ID and does
not derive a new state or diagnostic phase. Events and the frozen Context
Manifest remain separate bounded reads.

Offline managed Runs remain `queued` and are delivered when the target Device
publishes or heartbeats. A queued Run that reaches its persisted deadline moves
to terminal `expired` and is never delivered on a later reconnect.

Device revocation durably disables the Device before reconciling its active
Runs. A Delivery that the Bridge has not accepted becomes terminal `failed`
with `RUN_DEVICE_REVOKED`. A Delivery already accepted, including the
conservative case where the Run advanced beyond `queued`, becomes
`outcome_unknown` with `RUN_DEVICE_REVOKED_OUTCOME_UNKNOWN`; it is never
reported as canceled or retried. When the active Agent advertises interrupt
support, the Server sends one best-effort `run.cancel_requested` before closing
the Device socket. Startup recovery repeats the idempotent Run reconciliation
for any revoked Device left behind by a crash after the durable security
mutation.

### Durable managed cancellation

Canceling a queued or `input_required` Run remains one direct Central terminal
transition. For an accepted managed Run, Central first commits one immutable
cancellation intent containing the stable command message ID, exact Run/Agent,
the accepted Delivery's frozen Device, requester, bounded reason and
acknowledgement deadline. Socket delivery is only a replayable side effect.
Startup, a one-second bounded sweep, and authenticated hello/publish/heartbeat
all resend the same command identity until a terminal Run event resolves the
intent.

The existing sequenced terminal status is the acknowledgement; protocol 1.0
does not gain a second competing ACK authority. While an intent is pending,
only its frozen Device may provide the terminal event even if the Agent is
later published elsewhere. The Bridge validates Run, trace and Agent identity,
cancels an active Runtime, and durably records the resulting event before send.
If the network loses that terminal write after local completion, a repeated
cancel command replays only the matching terminal inbox record and never starts
the Runtime again. Active, missing, non-terminal or mismatched records fail
closed rather than fabricate an outcome.

If no terminal event arrives by the durable deadline, Central resolves the Run
as `outcome_unknown` with `RUN_CANCEL_ACK_TIMEOUT`; it never reports a remote
cancellation merely because a socket write succeeded. Duplicate user requests,
restarts and reconnects retain one intent and one terminal Run history.

## Delivery Contract

1. For a governed Task, validate the exact approved node and current
   same-epoch Agent grant, then atomically persist the immutable admission, Run,
   one-time manifest seal and isolated workspace lease. Ordinary Runs retain
   their existing creation path.
2. Persist the delivery record only after the governed admission is sealed.
3. Select the currently active target Bridge connection.
4. Immediately revalidate the governed manifest digest against one exact
   current Agent grant; a downgrade, expiry or scope drift remains pending and
   is not sent.
5. Send `run.requested` with Run ID, delivery attempt ID, and the exact stored
   Context Manifest when present.
6. Bridge durably records Run ID before returning `run.accepted`.
7. Retry on missing ACK without changing Run ID.
8. Stop retrying after acceptance, cancellation, expiry, or Agent revocation.

Delivery is at least once; execution is idempotent through the Bridge inbox.
Reported Runtime scope is validated against that Run's immutable Delivery
session, not a later Agent publication. Replaying a persisted result after a
Workspace/configuration change must remain valid without weakening Device,
trace, sequence or evidence-page validation. Scoped reports without matching
Delivery evidence fail closed; legacy unscoped events remain compatible.
Room context consumption receipts likewise validate against that Delivery's
frozen `roomContextBundle`, never the Agent's current coverage capability.
Removing or omitting the capability cannot invalidate an already-delivered
bundle, and enabling it cannot authorize a receipt for a Run without one.
Checkpoint, raw interval, coverage, disposition and identity checks still apply
to first-time and duplicate terminal reports. New Deliveries continue to use
the current advertised capability when deciding whether to include a bundle.
An unaccepted Delivery row remains an immutable transport fact after its Run
becomes terminal, but it is no longer actionable backlog. Queue and oldest
pending-delivery metrics therefore count only `pending` Deliveries whose Run is
still `queued`; reconnect dispatch uses the same fence and never sends a
canceled or expired attempt.

When result evidence contains bound snapshot content, the Delivery payload also
contains its canonical Artifact revision, content identity, size, media type,
digest, and logical alias. The target Bridge may fetch only content named by its
Run Delivery. It stages and verifies required bytes before Runtime invocation.
Staging failure is a deterministic pre-invocation failure; it is not
`outcome_unknown`. Applying staged content to a configured Workspace is outside
Run delivery and requires a separate Workspace write lease.

Result-evidence consumption still advances only after the Runtime accepts the
turn under the existing Task Session contract. An ambiguous provider acceptance
does not advance the cursor, even when staging completed locally.

`RUN-011` persists that descriptor only for a target Agent that advertised
Artifact materialization support. The Device-authenticated content endpoint
authorizes against the stored pending or accepted Delivery payload, exact Run,
Artifact, content ID, Team, and target Device. It then reads the immutable
content row and verifies the sealed Blob's size and digest. It never consults a
live publication operation, so retry and Server reopen preserve the same
payload hash and access decision. A legacy Agent receives the ordinary
reference-only projection and cannot use its Device credential to infer or
download the content.

`BRG-029` extends that endpoint with exact bounded byte ranges for restartable
downloads. Delivery acceptance validates either the complete set of receipts
against the frozen descriptors or the single closed non-retryable
materialization error; partial, forged, duplicate, mixed success/error, and
content-free failure acknowledgements are rejected. Only after that check does
sequence 1 move the Run to `delivered`.

The triggering Message creates the authoritative `traceId`. The Run, Delivery,
Bridge request, Runtime events, projected Agent reply, and any child handoff
Run inherit it. Bridge-supplied trace values cannot replace this authority.

The server persists one Delivery payload per managed Run before the first send.
Retries increment `sendCount` but preserve the attempt ID, idempotency key, and
payload bytes. A valid `run.accepted` sequence 1 moves the Run to `delivered`;
duplicate ACKs are idempotent.

Discussion member Turns use their stable `turnId` as `orchestrationKey`. The
key is unique independently of `(triggerMessageId, targetAgentId)`, so recovery
finds the exact Run even when several Wave members share one input Message or a
later Wave reuses a participant. Creating the same keyed Run returns its
existing identity instead of starting another Runtime.

An ordinary Discussion Run inherits the Wave deadline, which is the earlier of
the Discussion deadline and `waveTimeoutSeconds`. At the deadline, a queued Run
becomes `expired`; a delivered, working, or otherwise accepted Run becomes
`outcome_unknown` because the Runtime may have executed. Finalization uses its
separate bounded reserve deadline.

## Central Hosted Invocation Contract

`RUN-015` adds a second durable execution transport without changing managed
Delivery. An authorized Run whose target integration mode is `hosted` does not
create or send a Bridge Delivery. It follows this boundary instead:

1. validate the enabled Agent, explicit Room assignment, profile revision,
   credential revision, Task/Discussion fences, deadline, and concurrency;
2. persist one unique `prepared` invocation intent for the exact Run, including
   only provider/model identity, frozen revisions, prompt digest, deadline, and
   idempotency identity;
3. commit `dispatching` before the Hosted Adapter may open the provider HTTPS
   request;
4. apply ordered bounded output and one final reply through the existing Run
   event transaction boundary; and
5. commit a terminal intent outcome with the Run, or reconcile every unfinished
   post-dispatch intent to `outcome_unknown` on startup.

The intent never stores credential plaintext or a duplicate prompt. The Run,
Messages, frozen Context Manifest, and authorized context projections remain
the content authorities. Exact dispatch retry before step 3 returns the same
intent. There is no automatic dispatch retry after step 3, including timeout,
connection loss, malformed stream, abort, Server restart, or response-loss
ambiguity.

Dispatch revalidates the current active Team/Room and exact Agent membership,
including when a previously prepared intent is recovered. A removed Agent
fails locally before its prompt reaches HTTPS; an already expired queued Run
settles any prepared intent in the same process rather than waiting for another
restart.

Definite validation, TLS, or HTTP rejection before provider acceptance may
fail the Run with a closed safe code. Raw URL, headers, response body, provider
request ID, quota/account detail, prompt, credential, and stack trace never
enter Run error detail. Provider reachability changes only Hosted Agent
Presence; it cannot make Central unready.

Ordinary Mention, exact reply handoff, and Discussion member planning all use
this same target-mode dispatch after their existing authorization. Hosted text
may trigger the existing exact-name handoff parser, but it cannot directly
create a child Run or bypass Room policy. The first version has no formal
Result-submission principal.

## Event Ordering

Each accepted Run has a Bridge-generated monotonic `sequence`. The server
persists an event only when its sequence is greater than the last accepted
value. Duplicate and stale events are acknowledged but do not alter state.

The server accepts contiguous `run.status`, `run.output_delta`, `run.activity`,
and `run.reply` events only from the Device that owns the target Agent. Events
persist in `run_events`; output and activity advance the Run sequence without
changing its state or appending a Room Message. `RUN-014` applies a reply through
one immediate transaction that advances the Run, inserts the event and existing
handoff-routing intent, allocates the Room sequence, appends one Agent-authored
Message linked to its trigger, and records the immutable reply-to-Message
mapping. Managed Bridge, manual MCP, in-process Fake Runtime, and Central Hosted
Runtime paths all use that repository boundary. Duplicate events do not create
duplicate output or replies, and the first terminal state remains
authoritative. A terminal Run rejects later output exactly as it rejects any
other late event.

Authorized Room members may read persisted Run events after a sequence cursor
to reconstruct provisional output and activity after refresh or reconnect.
Applying either wakes the existing Team change channel with the owning Room ID;
the browser then fetches only unseen events. Reset deltas replace the provisional text before their content is
appended. Seeing a final reply discards the provisional projection, while the
durable Room Message remains the only completed conversation entry.

The Bridge also stores emitted event envelopes in its durable inbox before
network send. Reconnect replays these envelopes idempotently; a Bridge process
restart converts any unfinished local execution to `outcome_unknown` before
replay, so the central projection cannot remain falsely `working`.

Hosted execution has no second durable inbox. Its SQLite invocation intent is
the recovery fence; a Server restart never reconstructs provider output or
replays a post-dispatch request.

Before delivery, the server resolves each context sender's current display
name and includes enabled peer Agents assigned to the Room. These names help a
Runtime emit complete exact `@Agent name` commands, but the stable IDs and
Room policy used by the server remain authoritative. Bridge adapters bound the
prompt projection independently of the larger transport allowance.

For a Discussion Wave, `input_required` is an intermediate Run report rather
than an immediately resumable barrier state. The Orchestrator writes a terminal
unknown outcome with durable reason `input_required`, waits for the other Wave
members, and only then applies Discussion policy. This preserves the all-settled
rule and prevents restart from stranding the barrier.

For an ordinary Task Run, `input_required` may carry a closed Task
clarification. The Server atomically persists the status, an Agent-authored
question Message, and a `waiting` clarification record. The Bridge treats that
event as a durable local execution boundary and replays it after reconnect or
restart without starting the Runtime again. It does not keep a process waiting
for a remote answer.

The first authorized Room answer appends one idempotent member Message in the
same Task, terminalizes the requesting Run as `outcome_unknown` with reason
`TASK_CLARIFICATION_CONTINUED`, and creates one new bounded continuation Run
for the same Agent. The continuation has a new Run ID but the same `taskId`, so
the Task-scoped Bridge binding resumes the same logical/native Session. A
repeated answer returns the existing Message and continuation; it cannot create
a second Run. Discussion Runs retain the Wave behavior above and cannot open
this ordinary-Run clarification flow.

The question does not outlive its authority. Canceling an `input_required` Run
is a direct central terminal transition; reaching the Run deadline expires it.
Any terminal Run transition atomically changes a still-waiting clarification to
`canceled` with `run_canceled`, `run_expired`, or `run_terminal`. Startup and
read/answer reconciliation also detects a terminal Task, unavailable Agent,
invalid Room assignment, or orphaned question scope, closes the Run safely,
and records the exact reason. Only `waiting -> resumed` creates continuation
work.

Clarification answers are collaboration context only. They cannot approve a
filesystem, shell, network, tool, sandbox, or Runtime request. Codex App Server
interactive requests still receive a local protocol error, and all Runtime
permission policy stays on the Bridge host.

## Handoff

A handoff request contains parent Run, target Agent, summary, and optional
context references. The server validates Room access, target availability,
lineage, the Room's configured maximum depth from 1 through 4, maximum unique
Agents 5, and maximum Run duration 20 minutes before creating a child Run.
`allowAgentMentions=false` rejects both explicit MCP handoffs and automatic
reply routing before a child Run is created.

After an ordinary Run persists its Agent reply, the Server parses the content
as exact commands against current Room Agent names. A complete `@Agent name`
may create one child handoff, and exact `@all` may fan out to the remaining
eligible Agents only when the Room allows it. Prefix, substring, ambiguous
same-name, source-Agent, disabled, unassigned, over-depth, and lineage-revisit
targets do not route. Reply parsing is best effort after the parent result is
durable: one rejected candidate cannot erase the reply or cancel valid sibling
handoffs. Replies owned by a structured Discussion do not enter this parser,
because the Discussion Orchestrator alone schedules its next Wave.

The MCP caller must be the parent Run's target Agent. Child Runs inherit the
root trigger and deadline, use a new durable Run ID, and cannot revisit an Agent
already present in their lineage.

Handoff remains a delegation DAG. Its no-revisit rule must not be relaxed to
model `Agent A -> Agent B -> Agent A`; that interaction is a Discussion with
separate loop, progress, and budget controls.

## Cancellation Races

- A queued Run cancels without delivery.
- An accepted Run sends one interrupt request.
- The Bridge persists and reports its first terminal outcome; the server accepts
  the first valid terminal event for the Run.
- A later conflicting terminal event is retained as diagnostic evidence but
  cannot replace the result.

Discussion controls operate at the Wave boundary. Stop-after-Wave, finish, and
pause allow every active member to settle before policy advances. Immediate
cancellation requests an interrupt for every active member Run; each Run still
resolves its own first-terminal race under the rules above.

## Verification

- ACK loss and reconnect never execute a Run twice.
- Out-of-order events never regress state.
- Offline delivery runs once after reconnect.
- Cancellation and completion races are deterministic.
- Hosted intent crash cuts issue at most one automatic provider call and
  converge every unfinished post-dispatch Run to `outcome_unknown`.
- Hosted output and reply use the existing sequence/projection transaction and
  cannot create a Bridge Delivery or formal Result.
- Handoff loop, depth, and unique-Agent limits are enforced.
- Room policy rejects disabled handoffs, applies the configured depth, and
  exact reply parsing never routes fuzzy or ambiguous Agent names.
- A Discussion Wave fans out all planned member Runs without serial dispatch.
- `orchestrationKey` recovery recreates neither duplicate Runs nor duplicate
  Runtime executions.
- Cancel-all and mixed terminal outcomes preserve each Run independently for
  the Discussion all-settled barrier.
- Deadline tests distinguish queued `expired` from accepted
  `outcome_unknown`; `input_required` does not advance policy before the
  barrier.
- Task clarification recovery replays one valid question, accepts one
  Room-authorized answer, closes the original Run, and creates one same-Task
  continuation Run; cancellation, expiry, and invalid scope converge instead
  to one reasoned terminal record with no continuation.

## Task Mapping

`RUN-001` through `RUN-010` implement delivery, recovery, handoff and
clarification behavior. `RUN-012` implements ADR-0022 attempt lineage, audited
ambiguous-outcome acknowledgement, semantic retry, and frozen Context
Manifests. The in-process harness is `QA-001`, recovery tasks are
`DATA-003` and `QA-004`, and parallel Wave verification is `QA-010`.
`RUN-015` implements the ADR-0026 Hosted invocation and recovery boundary.

## Dependencies

Contracts, Team/Room, Registry, Bridge delivery, Runtime Adapters, Persistence,
and Security. Discussion Orchestration consumes Runs through this public
boundary.
