# ADP-024: Managed Codex protocol output

Verified on Windows with Go 1.26.7 on 2026-09-28, based on main `52e89d56`.

## Behavior

The managed Codex App Server reader no longer imposes cumulative or individual
JSONL event byte limits. It retains the current event rather than the complete
transcript. Memory allocation therefore depends on individual event size.
Malformed/truncated JSON still fails closed; cancellation interrupts pending
reads. Tool payloads remain private, and visible assistant output/final-reply
limits and permission policy are unchanged. There is no wire contract change.

## Verification

`TestCodexAdapterReadsUnboundedProtocolOutput` covers six real child-process
scenarios: 128 tool deltas of 77,824 payload bytes; a single 5,700,000-byte tool
payload; final JSON without a newline; multiple JSON objects on one line;
truncated JSON; and cancellation during an unfinished event after large output.
All six pass and check that tool payloads do not escape to Room events.

The following checks pass from `bridge/`:

```text
go test ./internal/runtime -run '^TestCodexAdapterReadsUnboundedProtocolOutput$' -v -count=1
go test -race ./internal/runtime -run TestCodex -skip '^(TestCodexAdapterMapsAppServerEventsToRuntimeEvents|TestCodexLocalBoundaryProbeRejectsUnboundedLocalInputs)$' -count=1
go test -tags desktop ./cmd/convenewire-bridge-desktop -count=1
go vet ./internal/runtime
go vet -tags desktop ./cmd/convenewire-bridge-desktop
go build -tags desktop,production -trimpath ./cmd/convenewire-bridge-desktop
```

Desktop tests and vet used the repository temporary-root wrapper with a writable
temporary base. Focused checks also used a writable local temporary directory.
The initial default Windows temporary directory caused permission failures;
Desktop tests pass after selecting the writable base.

The two excluded Codex tests fail with the original reader restored through a
Go source overlay as well: the Artifact fixture uses a POSIX path, and the local
boundary fixture cannot remove its protected executable on Windows. These are
baseline failures, not a full-suite pass. No live model call was required.

Maintained Markdown lint and `git diff --check` pass.

## Deployment scope

The source change is isolated from unfinished Room approval work in the older
AgentRoom working directory. The latest repository already uses `ADP-018` for
the Hosted Agent adapter, so this port is registered as `ADP-024`.

Local deployment builds the native Desktop and CLI executables from the committed
source. The existing verified v0.5.8 Hub bundle remains in place. A private
rollback copy is retained before replacement. Since this task runs through the
installed Bridge, activation waits until its Codex process exits, then restarts
the same installation and records binary hashes, process startup and Hub health.
Scheduling activation does not itself prove that the restart succeeded; the
local updater status is the deployment evidence.
