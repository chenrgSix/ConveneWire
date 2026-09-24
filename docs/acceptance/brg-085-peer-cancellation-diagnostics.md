# BRG-085: Peer cancellation diagnosis and offline verification

## Scope and baseline

The independent checkout starts at v0.5.7 commit
`0fff1d46592297d912eb4812164471ce1b66cdd9`.
The installed Windows Bridge, CLI helper and Local Node helper were inspected
before implementation: all report v0.5.7 with that clean embedded source revision.
The installed Codex binary reports 0.155.0-alpha.16.
At inspection, the Bridge and Hub remained running from 2026-09-23 17:15:10 and
17:15:11 respectively. Their continued presence does not prove uninterrupted
Peer connectivity. No installation, real configuration, service or model task
was changed or restarted during this work.

## Historical evidence

All times below are Asia/Shanghai (UTC+08:00), on 2026-09-23. The underlying
Windows journals use UTC. Run IDs are reduced to prefixes; conversation content
and credentials are omitted. End times are Windows outcome write times and may
precede the Mac display time by several seconds.

| Run prefix | Windows start | Outcome written | Outcome | Additional observation |
| --- | --- | --- | --- | --- |
| RVNQT9 | 17:18:40.297 | 17:19:15.768 | CODEX_CANCELED | No pending escalation found in the inspected task |
| 2YXmxd | 17:22:30.858 | 17:22:38.477 | completed | A short response with no tool call |
| XSZGPd | 17:24:30.835 | 17:29:13.822 | CODEX_CANCELED | Escalation requested at 17:24:47.275; no result before cancellation |
| g3sWZe | 17:31:08.844 | 17:31:49.916 | CODEX_CANCELED | Escalation requested at 17:31:36.981; no result before cancellation |

All four retained terminal streams were eventually acknowledged and settled.
This proves eventual delivery, not continuous connectivity. None reached its
20-minute Run deadline. The Mac-side empty cancellation intent tables and
unchanged membership/share revisions are user-provided Host findings.

Windows events inspected for 17:10-17:40 showed the upgrade shutdown/startup
around 17:14-17:15, but no matching sleep, network or crash event for the three
cancellations. The retained configuration timestamp preceded these Runs, and
local membership/export/acceptance evidence showed active revision 1. Absence
of an event cannot exclude a transient socket or HTTP failure.

The later Peer connecting/export-sync failure is a current observation, not
proof of the cause of an earlier cancellation. File-picker cancellation text
was excluded from Run evidence.

## Confirmed mechanism and remaining uncertainty

The Runtime adapter maps canceled Run contexts to CODEX_CANCELED. The Run
inherits the Runtime WebSocket lifetime; a connection close ends it. The
execution watcher also cancels on an authorization recheck error every two
seconds. Earlier connection code and HTTP helpers discarded useful details.
Thus CODEX_CANCELED alone cannot establish that the user canceled anything.

Two failed tasks were waiting for local escalation, but their wait lengths
differed and the first failed task had no such pending request. The evidence
does not establish an approval timeout, firewall problem, model failure,
network loss or authorization withdrawal as the historical root cause.
The missing evidence is the first cancellation source, classified HTTP/WS
failure and local approval transition for the same Run and time.

## Minimal diagnostic change

See [ADR-0074](../adr/0074-peer-cancellation-diagnostics.md). Each future Run
can retain a private diagnostics.json beside its existing received/start/outcome
records. Classified failures include their UTC creation time; observed approval
transitions and final process cleanup are recorded separately. The first
context cause survives cleanup. HTTP status and endpoint category contain no
URL, request body, credential or error text. Approval observations are bounded
at 32 entries; overflow is counted and cancellation has a separate field.

The sidecar is not an authority record and is ignored by original journal
readers. Failure to write it leaves execution policy intact. Abrupt process
termination can still leave partial or absent evidence. No new wire fields,
permission relaxation, automatic model retry or replacement Runtime were added.

## Verification

Windows verification used portable Go 1.26.7, LLVM MinGW and Node 22.23.1.
Dependencies were locked and checked against go.sum; all subprocesses and
fixtures ran under the repository temporary-root wrapper. Local module caches
were used after the public Go proxy could not be reached directly.

- Final focused Peer race regression: **20 top-level tests passed**, or 44
  including subtests, in 82.35 seconds. All **8 new diagnostic groups** passed.
  The selection includes approval decisions, HTTP classification/redaction,
  actual WebSocket loss, missing heartbeat acknowledgments, connector isolation,
  proof rechecks, revocation, successful execution and duplicate recovery.
- `go vet ./...` in Bridge passed; the final `go vet ./internal/peer` also
  passed after the last source change.
- Full `go test ./...` was run and **did not pass**: 16 packages passed and
  15 failed. Windows-incompatible path/POSIX permission/symlink assumptions and
  fixture timing/cleanup failures remain outside this diagnostic patch.
- The pristine exact v0.5.7 Peer/Runtime comparison had 175 passing and 28
  failing top-level tests. It reproduced 34 of the 36 failing test/subtest
  entries in those packages from the modified full run. The remaining two
  entries were the central approval timing test and its allow subtest; their
  separate race rerun passed. This is a targeted comparison, not proof that
  every unrelated failure in the full Bridge suite has been diagnosed.
- The full Peer/Runtime race suites were also run and retain fixture/platform
  failures. Separate checks passed central approval, Codex deadline handling
  and both local approval groups. The configured-model probe still failed in
  race mode and the exact pristine baseline reproduced that failure. Runtime
  package source was not changed. Full-suite green acceptance is not claimed. No race detector warning appeared
  in the completed race runs.

Markdown lint, gofmt, local document target checks and git diff --check passed.
The installed Bridge and Hub were rechecked after verification and retained
their original process IDs and startup times.

Final focused command (from the repository root, with the portable toolchain
on the process-local PATH):

```powershell
node scripts/test/run-with-temp-root.mjs --cwd bridge --timeout-ms 300000 -- go test -race ./internal/peer -run '^(TestPeerDiagnostics|TestPeerApproval|TestPeerRunExecutionSettlesRevocationAfterActualProcessStops|TestPeerRunExecutionUsesActualHostAndRestrictedNativeChild|TestGoRuntime|TestPeerClient|TestNativePeerConnectors)' -count=1
```

The fake Codex test verifies that a real test Host socket close during approval
still produces CODEX_CANCELED externally, while diagnostics retain the socket
failure and approval interruption. It verifies process cleanup, no unapproved
file write and no second execution during recovery. This demonstrates the
mechanism, not the historical cause. Sidecar corruption leaves the legacy
journal readable, write failure is best effort, and unknown error text or
non-contract denial codes never enter diagnostics.

## Subsequent validation

The tests use temporary Hosts and test executables that speak the Codex
app-server protocol. Fault injection closes the actual test WebSocket, withholds
heartbeat acknowledgments and returns classified HTTP failures. No real model
is called. A future installed diagnostic build should correlate its private
sidecar with the Host Run ID/time before selecting a behavior fix. Network
recovery, authorization rejection and approval expiry require different fixes;
automatically retrying an ambiguous started Run is not an acceptable substitute
for identifying its cause.
