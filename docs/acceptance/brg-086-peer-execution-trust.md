# BRG-086: Per-connection Peer execution trust

## Scope

Implements [ADR-0075](../adr/0075-peer-execution-trust.md) for cross-device Agent
sharing. Joined Peer connections default to full-trust Codex execution, including
older connections without a saved preference. The joined-space card provides a
visible, accessible “完全信任此空间” switch; joining and sharing describe the
default and the local opt-out. Explicit off survives restart and synchronization.

Full trust selects `danger-full-access` and `approvalPolicy: never`. Disabled
trust restores the configured restricted sandbox and Participant approval pool.
Changes retire only the affected connector and its approvals, stop running work
and isolate future native sessions by trust revision. Run/process identities,
bilateral scope checks and replay prevention remain unchanged. Pi/generic
runtime permissions and legacy Device opt-in are unchanged.

## Verification

Offline regression coverage includes absent-preference defaults, restart,
idempotent retries, stale revision and foreign membership denial, prohibited
preference reset and Host-supplied join preferences. Native fake Codex children
check actual protocol parameters and file effects, restricted approval/denial,
session separation after disabling and re-enabling, queue/Host-wait changes,
running cancellation, process cleanup, settlement and duplicate suppression.
Connector tests check affected-Peer cancellation and retired approval rejection.
Console tests cover Owner authentication, foreign Origin, missing fields, stale
updates, persisted views and operation without Runtime configuration.

- `npm run test:bridge-ui`: 98 tests pass. After final copy/control placement,
  the affected `peer-spaces.test.mjs` and `peer-sharing.test.mjs` pass all 21 tests.
- `node scripts/test/run-with-temp-root.mjs --timeout-ms 300000 -- npm run test --workspace @convene-wire/contracts`:
  140 Node tests pass, including actual Node/Go decoding of the new private
  preference and integer/unknown-field negatives. Generated-code checks,
  TypeScript compilation and Go fixture tests pass.
- `go test -race ./internal/peer ./internal/console -count=1` through the Bridge
  temporary-root wrapper: the complete Peer package passes (417.650 seconds).
  The first Console run finds one old inventory assertion that allowed only
  five fields. It now requires six, verifies the effective trust value, and
  retains credential/proof disclosure negatives. The complete Console package
  rerun passes with race detection (7.007 seconds).
- After adding the explicit denial side-effect assertion,
  `go test -race ./internal/peer -run '^TestPeerExecutionTrustSeparatesSessionsAcrossModeEpochs$' -count=1 -v`
  passes. Default full trust, restricted denial and re-enabled full trust create
  three separate session records.
- `go vet ./internal/peer ./internal/console ./internal/bridgecore` passes.
  `GOOS=windows GOARCH=amd64 go test -c` for `./internal/peer` passes, with the
  output inside the wrapper's temporary root and removed after verification.
- Documentation lint, changed-document local links and `git diff --check` pass.

The initial focused Go run exposed an incorrect test expectation: Codex may
report an already-consumed process through a terminal event with a nil adapter
error. The assertion now checks the actual child-start marker, so successful
transport return cannot be mistaken for re-execution.

## Limits

The fixtures use temporary private stores, local HTTPS/WebSocket Hosts and
offline Runtime children. They do not invoke a real model, change installed
Owner settings, publish a release or establish physical Windows/LAN acceptance.
Older strict readers reject a store after an explicit preference is saved;
downgrading must use a compatible reader and must not delete the preference.
