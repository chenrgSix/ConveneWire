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

The four opt-in cases in
[codex-handoff-compatibility.test.mjs](../../scripts/qa/codex-handoff-compatibility.test.mjs)
passed against that exact binary. Passing the cases records both supported
behavior and reproduced limitations; it does not certify product takeover.

| Case | Actual observation | Product implication |
| --- | --- | --- |
| Discovery, continuation and return | Metadata discovery makes no model call. A receiving process resumes the original ID after the source process exits. Original synthetic context reaches the next provider request; a third process continues that same ID and history after the receiver exits. Exactly three loopback requests. | Same-conversation continuation is technically possible after writer release. Process exit is only fixture evidence, not a desktop release UX. |
| Dynamic tool dependency | A synthetic client registers a dynamic tool, persists a turn and exits. Resume restores the registration, but the receiving client gets `item/tool/call`. Rejecting that callback yields `dynamic tool request failed` in the next provider request. Metadata and resume responses expose no `dynamicTools` inventory. Exactly three loopback requests. | Restoring a Thread does not transfer its desktop tool handlers, and the tested metadata response cannot establish a complete compatibility review. |
| Unsubscribe and writer lifetime | The source receives `{"status":"unsubscribed"}`; an immediate independent resume still fails with `already has an active writer`. Resume succeeds after the owned source process exits. Exactly one loopback request. | Unsubscribe acknowledgment cannot authorize immediate takeover. |
| In-flight contention | While the original request is deliberately held open, another process reads status `{"type":"notLoaded"}` but cannot resume because the original writer is active. The original turn then completes once. Exactly one loopback request. | Another process's status is not global ownership evidence. The provider lock prevents this competing writer. |

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

- Native offline compatibility: four tests passed, zero skipped.
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

The next integration must establish an explicit local connection to the original
desktop tool host with a documented ownership boundary, or prove an eligible
profile's complete capabilities through a supported provider interface. A shared
app-server transport alone does not establish callback routing or exclusive
control. No such route has been validated here. Do not implement adoption by
scraping a private desktop socket, editing stored tool metadata, archiving a
conversation to release its lock, stopping the owner desktop or silently creating
a replacement Thread. Binding and Room actions remain dependent on this boundary.
