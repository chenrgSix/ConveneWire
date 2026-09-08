# EXEC-012 preauthorized Room development evidence

Date: 2026-09-08. Design:
[ADR-0060](../adr/0060-preauthorize-local-work-policies.md).
Delivery status remains in [the task register](../TASKS.md).

## Bridge negotiation

Physical local policy/source observation feeds configured-Agent Runtime and
verifier profile resolution. Only that ready subset is advertised. The Bridge
checks Device, connection epoch, offered policy, exact request identity and a
five-minute maximum negotiation deadline before deriving the grant. A bounded
worker processes requests independently of the Run cancellation reader. It
publishes the current grant inventory before returning the authorization
receipt; reconnect and exact replay retain immutable issuance.

The local identity helper now delegates to the shared canonical wire function.
Connected resource tests caught and removed a double-JSON-encoding difference
in the earlier local helper. No installed-client grants were created by this
development work.

Verification:

- Focused existing admission/resource and client regressions plus owning Go vet
  passed before adding the new connected tests.
- `node scripts/test/run-with-temp-root.mjs --cwd bridge -- sh -c 'go test -race ./internal/repository ./internal/admission ./internal/connection -run "TestWorkPolicy|TestWorkAuthorization|TestTaskGrant" -count=1 && go vet ./internal/repository ./internal/admission ./internal/connection ./internal/bridgecore'`
  passed: repository 17.207 s, admission 5.411 s, connection 4.420 s.
- Disposable physical Git/profile fixtures verify offer-versus-grant separation,
  exact replay, publishable derived grants, parent revocation and negative
  Device/deadline/scope/profile cases. Runtime probing in these fixtures uses
  the existing deterministic probe, with no model invocation.
- A real loopback WebSocket fixture completes two negotiations on one connection,
  observes publication before each receipt and preserves the first grant during
  the second publication. Epoch, Device and unoffered-policy rejection occur
  before the authorization callback.

## Central admission and recovery

Authenticated Room members explicitly initiate development using one current
matching device offer. Central freezes the goal, criteria, authenticated human,
source commit, finite budget and one-node plan, compiles a ready child Task and
durably records its exact negotiation. Reusing an operation with changed intent
fails; reconnect and restart replay the original request. The scheduler and all
governed admission paths require a matching successful receipt even if a grant
publication arrives first. Receipts must match the current Device connection and
published grant inventory. Expired or canceled requests cannot be resurrected.

Verification:

- Server TypeScript build passed.
- Eight new disposable Server/WebSocket tests passed: two distinct Tasks,
  publication-before-receipt scheduling gate, command/source/initiator rejection,
  expiry, cancellation, restart replay, stale epoch, changed request digest and
  unpublished grant rejection. No model was invoked.
- Existing execution-plan approval and Bridge WebSocket suites passed 55 tests.
- Governed admission and migration regression run passed 47 existing tests;
  the remaining stale migration-version fixture was corrected and its focused rerun passed.
  The eight new tests were rerun separately after fixing fixture startup readiness.

## Remaining evidence

Room UI, local policy setup/revocation UI and browser verification are pending.
The Bridge fixtures do not establish the complete unattended product flow,
live Runtime execution, installed-client migration, CI or physical-platform
acceptance.
