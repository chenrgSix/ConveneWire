# ADR-0072: Hand off an existing desktop Codex session to a Room Task

- Status: Accepted
- Date: 2026-09-20
- Owner: Native Runtime, Local Node and Web
- Amends: external-session exclusion of FUT-005; existing managed Sessions remain unchanged

## Context

The owner starts work in the Codex desktop application, accumulates context, and
then wants a ConveneWire Room to continue that same conversation. Re-entering
background or silently creating another Thread defeats this use case. Current
Bridge bindings only resume Threads previously created for their own Task and
Agent. The owner authorized design first, followed by implementation.

The installed desktop CLI reports `0.155.0-alpha.9.2`. Its generated protocol and
[official App Server documentation](https://learn.chatgpt.com/docs/app-server)
expose `thread/list`, `thread/read`, `thread/resume`, and `thread/fork`.
Those methods alone do not establish cross-process writer exclusion, desktop
tool compatibility, or support for every persisted history format. Capability
verification precedes product adoption. No active owner conversation is used as
a development fixture.

## Product decision

The first product path is **Room → Connect an existing Codex conversation →
choose a local conversation → review destination and permissions → continue →
return control to Codex**. A selected Thread attaches to exactly one Task and
one local Agent, never a Room-wide shared execution context. The picker shows
local title, project directory and modification time, with explicit unavailable
reasons. It does not require copying a Thread ID or editing configuration.

V1 targets the installed desktop's local persisted conversations and a Room
hosted by the same Local Node. Cloud/remote-host conversations, CLI-specific
UX, multi-Host adoption, Discussion/finalizer use and automated interruption of
an active desktop turn are subsequent work. The owner keeps using the normal
Room message and Run interface after attachment.

Continuation keeps the original Thread ID and provider-maintained history.
Forking, importing a summary, replaying old prompts and creating a replacement
are not success fallbacks. Existing `start_new`/missing-thread recreation policy
must never apply to an adopted conversation. Missing history, busy ownership,
unsupported permissions or missing required tools leave the binding paused and
explain the problem without starting a model turn.

## Control ownership

A local native coordinator owns discovery, review and the provider connection.
The Server owns the destination Task, membership, assignments and Run records.
Neither a remote Room request nor a supplied Thread ID grants local control.
Reuse the Owner Console authentication and native local-control channel; never
expose a general Codex RPC proxy or desktop control socket to a Room or network.

A review binds the actual local Codex executable/profile, Thread ID, latest
history checkpoint, canonical project directory, configuration/tool metadata,
local Agent and qualified Node/Team/Room/Task destination. The destination must
be a fresh Task with no previous Runtime conversation and a current assignment
to the selected local Agent. An opaque local operation ID identifies the exact
review; changed history, destination, configuration or audience requires review
again. Confirmation and retry use the same operation, never another adoption.

The coordinator state is `reviewed → attached → running → attached → released`.
Busy or ambiguous ownership produces `paused`; a confirmed release can complete
from `attached` or `paused`. Releasing during a Run first fences new starts and
waits for that Run to finish or for an explicit owner cancellation to settle.
Release removes ConveneWire control and closes only the connection/process it
owns. It never deletes, archives or rolls back the Codex conversation.

At most one local adoption can reference a canonical Codex profile/Thread pair.
One binding can reference only one Task/Agent. Existing core Workspace scheduling
also applies; no second independent scheduler or alternate Run journal is added.
The native provider must enforce exclusive writing across desktop and Bridge
processes for a running turn. A Bridge-only mutex, `thread/list` status,
`thread/loaded/list`, or a stale PID check cannot establish that property.

Compatibility development must demonstrate this provider boundary before an
attach button becomes executable. If separate clients can write the same Thread
without a supported handoff/ownership mechanism, record the limitation and keep
adoption unavailable on that version. Do not bypass a provider lock, edit its
SQLite/JSONL files, kill the desktop, or present a fork as a takeover.

Each new turn validates the current checkpoint under acquired control. An
unexplained external turn pauses the binding for explicit reconciliation. Do not
feed a stale Room delta into a conversation changed independently in the desktop.
Restart restores binding identity and existing Run settlement, not an instruction
to replay a turn. Uncertain provider acceptance is an unknown outcome until
reconciled; it cannot cause a new `turn/start`.

## Context, permissions and disclosure

Source titles, previews, paths, native IDs and old transcripts stay on the owner
machine. Discovery uses bounded pages and metadata-only reads; it does not scan
or publish arbitrary personal history. The Server receives the adoption's opaque
identifier and operational state, not its native ID or private title.

Confirmation explicitly states that the existing private conversation will inform
future replies visible to the destination Room. Not displaying old history does
not prevent that history influencing or being quoted in new output. The owner
must review the current Room audience and grant this use for the exact Task.
An audience change suspends new adopted turns pending renewed confirmation.
Historical messages are not bulk-copied into Room history; old tool execution is
never replayed as part of importing context. New messages/replies retain normal
Room ACLs and provenance and identify that the Task uses an adopted conversation.

Review reports actual model/provider, working directory, effective execution
permissions and required tool dependencies. Existing personal/desktop approval,
full-access mode or Room membership is not transferred as execution authority.
New Room turns use locally reviewed limits and existing local approval routing.
A desktop-provided dynamic tool requires an available authorized handler; neither
invent a success reply nor silently drop it. Unsupported history/tool/permission
profiles are shown before any turn. Restoring the original Thread does not imply
reproducing every desktop UI feature.

Private adoption records use the existing owner-only storage protections and
qualified Authority partition. They contain immutable scope, review digest,
provider checkpoint, operation identity and status. Existing ordinary Session
records remain backward compatible. An adoption cannot be retargeted by changing
an Agent name, recreating a Task, reconnecting or restoring a stale configuration.

## Delivery sequence

Delivery state is recorded only in [TASKS.md](../TASKS.md).

1. Freeze this decision and observable acceptance. Develop the compatibility
   harness using isolated profiles and an auth-free loopback provider. Verify
   actual installed-binary discovery, resume, history continuity, competing
   writers, close/reopen and tool dependencies. Keep protocol-double results
   separate from actual provider/desktop observations.
2. After compatibility succeeds, implement the local adoption coordinator,
   persistent binding and exact review/confirm/release operations. Integrate with
   existing scheduling and Run settlement, with no-recreation and unknown-outcome
   handling. Add only the required closed local-control/Room status contracts.
3. Add the Room entry, native picker/review and visible attach/pause/release state.
   Reuse the normal composer and Agent routing. Keep the same native window and
   visual system; do not introduce another client.
4. Verify a disposable desktop-origin conversation through room continuation and
   return. Native integration, manual desktop observation, live-model behavior,
   Windows installation and release publication remain separately reported.

## Alternatives

- A summary in a new Thread loses exact conversation continuity and is not the
  requested feature. It may later be a separately labeled user choice.
- Copying or editing Codex's private storage couples us to undocumented layouts
  and can corrupt history or bypass concurrency controls.
- Sending Room prompts to an already active desktop turn changes that turn's
  intent and leaves control ownership ambiguous.
- Rebuilding an entire Agent platform adds no value to this bounded workflow.

## Verification

Acceptance requires the same Thread ID and workspace, prior context available to
the continuation, one new turn per accepted Room request, and a usable conversation
after release. Test stale review, wrong destination/Agent/profile, duplicate
attachment, audience changes, foreign-origin calls, busy writer, absent history,
missing tools, oversized protocol data, cancellation, lost acknowledgments and
restart. A resumed imported Thread must never fall back to `thread/start` or fork.

Compatibility fixtures have disposable homes/workspaces, no real credentials and
only a local deterministic model endpoint. Their owner drains children before
removing roots. Do not use consumed model-experiment permissions. Installing a
candidate, touching an actual ongoing conversation, calling a paid provider or
publishing a release requires the corresponding explicit scope; this development
request does not silently authorize those actions.
