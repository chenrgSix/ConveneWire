# ADP-020: Native Codex conversation handoff compatibility

Date: 2026-09-20. Design: [ADR-0072](../adr/0072-hand-off-desktop-codex-sessions.md).
Delivery status remains in [TASKS.md](../TASKS.md).

## Scope and installed binary

These checks run the installed Codex executable against disposable profiles and
an unauthenticated loopback Responses fixture. The source, receiving and returning
clients are test-controlled app-server processes, **not the desktop application's
UI or its existing conversations**. The separate ADP-022 startup check below also
launches the installed desktop with isolated data, without GUI actions. Fixed responses exercise the native provider
protocol without a real model, account credentials or owner configuration.

- Codex: `0.155.0-alpha.9.2`, bundled in the local ChatGPT application.
- Executable SHA-256:
  `9280c0754e8f1f6b72f495d30c8c82a006dbc4995bf0492916fa0901f6bfd1f9`.
- Native initialization reports macOS `26.6.2`, `arm64`.
- Test tools: Node.js `22.23.1`, Go `1.26.7`.

No default daemon was started, owner desktop process stopped, personal conversation
resumed, application installed, public endpoint exposed or paid model invoked.
Each fixture owns and drains its child processes and loopback listener before
removing its temporary home and workspace.

## Experimental local desktop startup

The owner accepts an explicit initial setup/restart. The selected implementation
is the [Go local startup entry](../../bridge/cmd/convenewire-codex-desktop/main.go)
and its [private plan validation](../../bridge/internal/desktopcodex/plan.go).
It uses `CODEX_CLI_PATH` only for an explicit launch, retains stdio and the existing
profile, and does not expose a network service. An ordinary app launch restores
the ordinary executable selection. This does not install another app or enable
Room binding. Invocation and rollback are in
[Development and Operations Commands](../development-commands.md#experimental-codex-desktop-startup).

The opt-in
[desktop startup case](../../scripts/qa/codex-desktop-startup.test.mjs)
builds that Go entry and prepares a protected plan for the installed app. A
synthetic conversation is persisted through the proxy and its source exits.
The actual desktop then launches with a fresh `CODEX_HOME`, workspace and desktop
user-data directory. Its diagnostic stream confirms that it spawned the Go entry
and completed native initialization over stdio. A second explicit launch request
is rejected while the app is running. After the owned instance exits, another
proxy client resumes the same Thread ID and continues with the original synthetic
context. Exactly two auth-free loopback model requests occur, before and after
the desktop launch; initialization itself starts no model turn.

Tested desktop: `26.915.31945`, executable SHA-256
`dfe5654498e939d355702fa66e6e2400e55ec0ade61048e19e264f4bdc70b847`.
The archive/provider pins are recorded below and in the fixture diagnostics.
The test drains its owned processes, removes its temporary profile, and removes
only native-tool sockets announced by that process with matching file identity.
It performs no actions through the Codex GUI. This verifies startup and retained
conversation continuity, not a desktop UI turn, desktop tool execution, Room
adoption or activation in the owner's normal profile.

Preliminary probes also initialized the actual desktop through a loopback
WebSocket override, but that global override can affect other host routes. The
attempted Unix WebSocket URL did not initialize: the installed desktop routed it
through an unavailable proxy. Those routes were not selected. A sandboxed GUI
launch failed at macOS process communication; the isolated real-desktop check
passed with the required GUI process access. No owner desktop was restarted.

## Original-connection mediator

ADP-023 adds a [bounded stdio mediator](../../bridge/internal/desktopcodex/mediator.go)
to the experimental startup entry. There is one native provider connection.
Desktop request IDs are restored on replies; coordinator replies never enter
the desktop response stream. Native server requests and their original desktop
responses keep their IDs and connection. The mediator creates no listener or
second native client. Its control interface is in-process Go only, with no Room
or Owner Console exposure yet.

The [native mediator cases](../../scripts/qa/codex-desktop-mediator.test.mjs)
use an inherited pipe to an isolated test driver and the installed native Codex
binary, with the same auth-free provider fixture. Both scenarios passed:

- An original synthetic turn is continued under the same Thread ID. While the
  local fence is held, desktop start/steer/resume/queue/archive requests are
  rejected. The original client receives exactly one synthetic dynamic tool
  callback. The mediator returns only the new turn's reply, returns the same
  result on an exact operation retry without a new model request, rejects a
  changed retry, and lets the original client continue after release. Four
  loopback requests cover three turns, including the tool-result continuation.
- A busy source turn cannot be fenced. Release during a continuation is refused.
  Another native process can still enqueue a private message, which the native
  writer executes after the reviewed turn. That extra turn pauses the fence;
  its reply is not returned as the reviewed result, and another mediated start
  is rejected until reconciliation. Three loopback requests. The native queue
  is therefore an external interference source, not an exclusive control gate.

The owning Go tests also exercise interleaved IDs and server callback IDs,
forged/released handles, nonselected Threads, unknown mutations, completions
before acknowledgments, duplicate items, stale private-turn output, ambiguous
acknowledgments, caller cancellation and blocked-I/O cleanup. All owning tests
pass with the race detector and `go vet`. A subprocess lifecycle test verifies
that desktop EOF terminates the owned provider group including a lingering child.

The actual installed desktop startup case above was rerun through this mediator
and passed with unchanged executable/archive/provider pins. Startup owns and
drains a native child group; version checks still directly execute the provider.
This proves actual desktop initialization, not desktop GUI tool use or a Room
round trip. No normal owner profile was activated.

The transport's text continuation uses read-only sandbox and `never` approval;
it does not certify or grant desktop dynamic-tool permissions. A provisional
fence is not adoption consent. Complete queue/history/tool/permission review,
exact audience checks, durable operation settlement and a closed coordinator
channel remain ADP-021 work. Operation deduplication here is bounded and lasts
only for the current fence/connection; it is not restart recovery.

## Native observations

The fourteen opt-in cases in
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
| Native queue CLI, default route | `codex queue --thread ID --message TEXT` exits successfully and reports an entry ID, but the original idle writer does not execute it during the 500 ms observation. The exact entry is visible and can be deleted. Exactly one loopback request. | Calling the public CLI does not remove the independent-process idle-wakeup limitation; acknowledgment is not completion. |
| Native queue CLI, explicit shared route | The same command with `--remote` pointing to the owned loopback service causes the idle original writer to execute exactly one additional turn. Its provider input includes original context and the queued text. Exactly two loopback requests. | The explicit shared route can wake the original writer through the installed CLI. This does not configure or connect to the actual desktop. |
| Lost acknowledgment recovery | The fixture drops the queue-add response and closes the producer connection after the native server has replied. The original writer still completes the queued turn. A fresh, unsubscribed client reads a bounded `thread/turns/list` page with `itemsView: full`, matches `userMessage.clientId` and text, and retrieves the exact completed turn and reply. Exactly two loopback requests. | An ambiguous add can be reconciled without replay when matching native evidence exists. Queue absence alone cannot establish non-execution. |
| Pending cancellation | While the original turn is held, the producer enqueues and deletes one exact entry. After the source finishes, a subsequent original-client turn succeeds and no provider input contains the deleted message. Exactly two loopback requests. | Confirmed deletion before consumption prevents this queued prompt from running without interrupting the original turn. |
| Cancellation after consumption | The queued turn has reached the provider and is held open. Deleting its former entry returns `deleted: false`; releasing the fixture response lets that turn complete normally. Exactly two loopback requests. | Queue deletion is not turn cancellation. A missing entry must be reconciled to the running/completed turn before reporting cancellation. |

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

- Native offline compatibility: fourteen tests passed, zero skipped, including
  native CLI queueing, lost acknowledgment recovery and cancellation before/after
  consumption. The default run without an explicit executable skips all fourteen.
- ADP-022 actual installed desktop startup: the isolated proxy-initialization,
  duplicate-launch refusal and original-ID/context continuation case passed.
  Without the desktop/provider opt-in variables it skips. Owning startup package
  tests, `go test -race` and `go vet` passed, including changed-binary, recursive
  provider, unsafe plan, non-stdio invocation and conflicting-override negatives.
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

Read-only inspection of the installed desktop archive (SHA-256
`1f7939c1c781887c167043c4d1d307af3400d324685cfc315dfe2f80e634f483`)
finds the normal local child-process route and a
`CODEX_APP_SERVER_WS_URL` connection override. This override is **not** listed in
the [stable public environment variable reference](https://learn.chatgpt.com/docs/config-file/environment-variables),
and its presence in bundled code is not proof of supported desktop integration.
The [App Server transport documentation](https://learn.chatgpt.com/docs/app-server)
describes explicit listeners; it does not establish access to an already-running
desktop's private child process. No internal socket was connected, owner profile
changed, or desktop restarted during these checks. The default and explicit
`--remote` CLI cases above make that distinction observable.

The owner subsequently accepted an explicit, version-specific initial
setup/restart. The tested local CLI override and reversible startup entry above
replace the proposed global WebSocket activation. This remains experimental;
neither override is established as a stable public desktop integration contract.

The local startup interception and original-connection mediator are now verified.
Source input fencing and exact-turn result isolation pass in the native fixtures.
The product still needs a closed coordinator channel for the Room, checkpoint and
audience validation at execution time, cancellation settlement, durable recovery
and complete permission/tool review. A local
operation journal must reconcile uncertain submissions; the native queue's
`clientUserMessageId` is not an idempotency key. Do not retry an ambiguous add or
assume an accepted queue entry has executed. Sharing an app-server and resuming
the Thread remains a different, unsuitable route: that test broadcasts callbacks
to both subscribed clients and leaves source-client authority active.

Recovery may use bounded native turn/item pages locally after exact adoption
authorization. Match both the client ID and accepted payload, then settle the
exact native turn. Missing, conflicting, incomplete or out-of-range evidence
leaves the outcome unknown; it does not authorize a retry. Previous private turns
returned in a page must not be published to the Room. Deleting a queued entry can
only settle pending cancellation when deletion is confirmed before consumption;
it cannot establish cancellation of an already running turn.

No complete desktop handoff route has been validated here. Do not implement adoption by
scraping a private desktop socket, editing stored tool metadata, archiving a
conversation to release its lock, stopping the owner desktop or silently creating
a replacement Thread. Binding and Room actions remain dependent on this boundary.
