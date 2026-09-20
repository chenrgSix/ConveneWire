# ADP-020: Native Codex conversation handoff compatibility

Date: 2026-09-20. Design: [ADR-0072](../adr/0072-hand-off-desktop-codex-sessions.md).
Delivery status remains in [TASKS.md](../TASKS.md).

## Scope and installed binary

These checks run the installed Codex executable against disposable profiles and
an unauthenticated loopback Responses fixture. The source, receiving and returning
clients are test-controlled app-server processes, **not the desktop application's
UI or its existing conversations**. Fixed responses exercise the native provider
protocol without a real model, account credentials or owner configuration.

- Codex: `0.155.0-alpha.9.2`, bundled in the local ChatGPT application.
- Executable SHA-256:
  `9280c0754e8f1f6b72f495d30c8c82a006dbc4995bf0492916fa0901f6bfd1f9`.
- Native initialization reports macOS `26.6.2`, `arm64`.
- Test tools: Node.js `22.23.1`, Go `1.26.7`.

No default daemon was started, desktop process stopped, personal conversation
resumed, application installed, public endpoint exposed or paid model invoked.
Each fixture owns and drains its child processes and loopback listener before
removing its temporary home and workspace.

## Native observations

The nine opt-in cases in
[codex-handoff-compatibility.test.mjs](../../scripts/qa/codex-handoff-compatibility.test.mjs)
passed against that exact binary. Passing the cases records both supported
behavior and reproduced limitations; it does not certify product takeover.

| Case | Actual observation | Product implication |
| --- | --- | --- |
| Discovery, continuation and return | Metadata discovery makes no model call. A receiving process resumes the original ID after the source process exits. Original synthetic context reaches the next provider request; a third process continues that same ID and history after the receiver exits. Exactly three loopback requests. | Same-conversation continuation is technically possible after writer release. Process exit is only fixture evidence, not a desktop release UX. |
| Dynamic tool dependency | A synthetic client registers a dynamic tool, persists a turn and exits. Resume restores the registration, but the receiving client gets `item/tool/call`. Rejecting that callback yields `dynamic tool request failed` in the next provider request. Metadata and resume responses expose no `dynamicTools` inventory. Exactly three loopback requests. | Restoring a Thread does not transfer its desktop tool handlers, and the tested metadata response cannot establish a complete compatibility review. |
| Unsubscribe and writer lifetime | The source receives `{"status":"unsubscribed"}`; an immediate independent resume still fails with `already has an active writer`. Resume succeeds after the owned source process exits. Exactly one loopback request. | Unsubscribe acknowledgment cannot authorize immediate takeover. |
| In-flight contention | While the original request is deliberately held open, another process reads status `{"type":"notLoaded"}` but cannot resume because the original writer is active. The original turn then completes once. Exactly one loopback request. | Another process's status is not global ownership evidence. The provider lock prevents this competing writer. |
| Shared-service client control | Two WebSocket clients connect to one owned loopback app-server and resume the same Thread. Both receive the same synthetic tool callback, and one fixed client response reaches the provider. After the receiving client's turn, the source can start another turn without any return operation. Exactly four loopback requests. | Sharing a service neither routes callbacks exclusively nor fences the original client. It is not an ownership-transfer mechanism. |
| Shared-service queue without subscription | An initialized second client calls only `thread/queue/add` and `thread/queue/list`, without resuming or subscribing to the Thread. The idle original writer automatically starts a new turn with the original ID and prior context. Only the original client receives the synthetic dynamic tool callback; its fixed result reaches the provider. Exactly three loopback requests. | A queue producer can delegate work to the existing writer without taking over its desktop tool callbacks. This differs from a second resumed client. |
| Independent producer during an active turn | Another process adds a queue entry while the original response is held open. No competing turn starts. After the original turn completes, its writer automatically drains the queue into a distinct turn, retaining the original ID, history and synthetic desktop handler. Exactly three loopback requests. | Durable queue writes can be consumed by the original writer at a turn boundary; they need not steer the active turn. |
| Independent producer while idle | After a completed source turn, another process adds a queue entry. `thread/queue/start` rejects with `resume the thread before starting a queued message`; resume still rejects the active writer. The entry remains pending during the additional 500 ms observation. Deleting that exact entry removes it. Exactly one loopback request. | Shared storage does not itself establish an immediate idle-wakeup route. The bounded test does not claim that future desktop actions cannot drain the entry. |
| Queue retry identity | With the original fixture process stopped, the producer adds an identical request twice and then a changed payload with the same `clientUserMessageId`. Three distinct queue entries persist with that same client ID. None executes. Exactly one loopback request for the original context. | Client message IDs correlate messages but do not deduplicate submission or reject conflicting payloads. Blind retries can execute duplicate work. |

The fixture-created source is classified `vscode` by this binary despite using
app-server directly. Discovery includes the native `vscode`, `appServer` and `cli`
source kinds; that classification is not proof of desktop origin or eligibility.

The [official App Server documentation](https://learn.chatgpt.com/docs/app-server)
describes restored dynamic tool registrations, client-owned tool callbacks, and
delayed unloading after unsubscribe. The tests verify immediate contention; they
do not wait for or certify the documented 30-minute inactivity expiration.
Generated stable and experimental schemas from this executable have no complete
tool inventory in `ThreadReadResponse` or `ThreadResumeResponse`, and no
`dynamicTools` replacement field in `ThreadResumeParams`. A documentation phrase
about restoring tools therefore cannot establish a supported replacement path
for this installed version.

## Implemented local discovery foundation

[codex_conversations.go](../../bridge/internal/runtime/codex_conversations.go)
adds bounded metadata-only list/read operations for the configured local Codex
Agent's exact workspace. It projects only ID, title, workspace, modification time
and history format. Private previews, transcript contents, storage paths and
misleading process-local status are omitted. Unknown and paginated histories are
reported distinctly; metadata availability never means permission to resume.

Requests use a fixed method allowlist, a five-second deadline, a 1 MiB output
bound and the existing owned-process cleanup. Invalid inputs, foreign workspace,
wrong selection, duplicate rows, excessive pages, malformed/oversized responses
and provider tool requests fail without returning raw provider errors. Discovery
does not start/resume a Thread or grant approval. No Console, Room or remote API
exposes this inventory yet.

## Verification

Commands and opt-in variables are recorded in
[Development and Operations Commands](../development-commands.md).

- Native offline compatibility: nine tests passed, zero skipped, including four
  queue cases added after the shared-service boundary check. The default run
  without an explicit executable skips all nine cases.
- Focused metadata regression with the installed-binary option: `go test -race`
  passed, including isolated native empty-list and absent-Thread reads.
- Owning Runtime package: `go test ./internal/runtime` and
  `go vet ./internal/runtime` passed.
- Documentation lint, changed local links and `git diff --check` passed.

These results are local protocol and package evidence. They do not cover the
actual desktop-to-Room UI, live model behavior, Windows, installation, CI or
release publication.

## Acceptance finding and fixture repair

A subsequent owner-requested acceptance on the same source found two metadata
race-test timeouts; an isolated rerun still failed the notification case. The
client UI and production callers also confirmed that adoption/binding/release
were not implemented. That acceptance did not pass the product feature.

Startup diagnostics identified the timeout source: the protocol double was the
entire Runtime test executable. Before its fixture `init` could reply, generated
contract package initialization compiled all validators. `GODEBUG=inittrace=1`
measured approximately 490 MB of cumulative allocation and 6.5 million allocations
per child. Even an otherwise responsive double spent 1.4–2.4 seconds initializing
in a separate diagnostic run; the failed acceptance reached the five-second
deadline. This was not evidence of an installed Codex metadata-query timeout.

The double now uses a
[standalone standard-library executable](../../bridge/internal/runtime/testdata/codex-metadata/main.go),
built inside the owned test directory before the query starts. The production
timeout remains five seconds, and the actual metadata reader and process cleanup
still run under `go test -race`. Negative cases assert the complete request
sequence, so a child that never initializes cannot falsely satisfy a malformed
reply test. Cancellation waits until the child receives the hanging query before
cancelling it.

Repair validation: the complete focused metadata suite with the installed-binary
option and `-race -count=3` passed all three iterations; owning Runtime unit tests
and `go vet` for Runtime plus the standalone fixture passed. The diagnostic and
test roots were removed. This repairs the timeout finding only; the following
desktop integration requirements are still unfulfilled.

## Unresolved integration boundary

The tested independent app-server route cannot yet deliver the designed desktop
handoff: a supported per-conversation release action and desktop callback handler
route are still missing. A complete tool inventory is also required before the
owner can review capability changes. A tool appearing in old history is not a
complete inventory, and a successful resume is not a successful tool check.

The owner reconfirmed the original Thread ID as the preferred outcome. The new
queue evidence supports investigating delegation to the **original writer**:
the Room-side producer submits a message without resuming/subscribing, and the
source retains its tools. The shared-service fixture proves idle execution and
callback isolation for that exact route. The separate-process case proves
continuation at a turn boundary, but does not supply idle wakeup.

A supported way to reach the real desktop's service is still required. These
fixtures do not expose or connect to it. Source input fencing, checkpoint and
audience validation at execution time, private result correlation, cancellation
settlement, and complete permission/tool review are also unresolved. A local
operation journal must reconcile uncertain submissions; the native queue's
`clientUserMessageId` is not an idempotency key. Do not retry an ambiguous add or
assume an accepted queue entry has executed. Sharing an app-server and resuming
the Thread remains a different, unsuitable route: that test broadcasts callbacks
to both subscribed clients and leaves source-client authority active.

No complete desktop handoff route has been validated here. Do not implement adoption by
scraping a private desktop socket, editing stored tool metadata, archiving a
conversation to release its lock, stopping the owner desktop or silently creating
a replacement Thread. Binding and Room actions remain dependent on this boundary.
