# RUN-019 conversation development acceptance

Date: 2026-09-09. Authority:
[ADR-0061](../adr/0061-continue-development-from-conversation.md).
Delivery state lives only in [TASKS](../TASKS.md).

The existing Room composer now reaches authorized development through the
same Agent conversation. The separate development button, form and recovered
form draft are removed. Humans do not select a policy, source commit or verifier,
repeat their goal or manually enter criteria for each request. One owner-local
policy setup remains required before unattended repository execution.

A capable Codex conversation runs read-only. Reading and review produce an
ordinary answer; requested implementation can emit a bounded title/criteria
proposal. Central freezes it against the exact delivered human Run and waits
for successful completion. The original instruction and bounded prior context
become the continuation goal. Existing policy negotiation, device receipt,
isolated execution, Git capture and verification remain the execution path.

Source Task revisions, participation, cancellation and budget remain authoritative.
Reservations prevent concurrent source Runs from spending continuation capacity.
An active or unknown process retains its ceiling at cancellation/expiry. A short
device disconnect waits until the original Run deadline and resumes automatically;
it does not ask the human to submit the same work again. Missing or ambiguous
owner authority is explained inline. Preparation and delivery link back into
the original conversation.

## Verification

- Shared TypeScript and Go contract fixtures cover optional legacy omission,
  exact round trips, malformed bounds and rejection of injected authority fields.
  Node contracts: 118 passed; generated consistency and type checks passed;
  all generated Go packages and contract tests passed.
- Server full regression: 674 cases ran; 671 passed initially. Three historical
  migration fixtures required current migration expectations and historical
  Agent seeding; all 11 tests in the two affected files passed after repair.
  The full run included all 23 development tests covering reading, exact replay,
  restart, offline recovery, failed/late proposals, source cancellation, budget
  reservation and expiry while a child may still run. Server build passed.
- All 324 Web regression tests and production Web build passed. Runtime,
  delivery and connection Go race tests and owning vet passed. All 63 embedded
  Console JavaScript tests passed.
- The macOS subprocess Runtime fixture verifies actual `read-only` and `never`
  thread parameters, full proposal parsing and preserved owner configuration.

The physical temporary-project scenario uses actual Central, Go Bridge, Git and
verification processes with a deterministic Codex protocol fixture. No model is
called and no user repository or installed client is used as test data. One read
request creates no development plan and leaves source files unchanged. Two
ordinary development requests create distinct isolated candidates, with a full
Bridge restart between them. Stable replay cannot duplicate work; revoking the
parent policy revokes derived grants. Source HEAD and checkout remain unchanged.

## Physical browser evidence

The browser-enabled scenario passed in 112.24 seconds, including cold Go setup,
using dedicated Chrome for Testing Headless Shell 152.0.7977.82 with a disposable
profile and its native sandbox enabled. The host execution sandbox initially
denied macOS Mach registration; authorized local test execution resolved that
host restriction without disabling browser isolation.

One policy save through the real local Console allowed two production composer
submissions, two isolated candidate commits, two command passes and two browser
passes. Candidate input, click, text assertion and screenshot all completed.
The final counts were five Runs (one reading, two proposal, two execution), two
authorizations and two checkpoints. See the retained
[receipt summary](assets/run-019/two-task-summary.json).

The [1440-pixel conversation](assets/run-019/room-conversation-ready.png),
[900-pixel conversation](assets/run-019/room-conversation-compact.png),
[delivery report](assets/run-019/room-browser-evidence.png) and
[candidate screenshot](assets/run-019/candidate-1.png) were visually inspected.
The separate development entry is absent; the existing composer and mention
selection remain usable and the report image stays within the viewport.

Installed preview verification remains the final WEB-078 gate. Generated
screenshots are distinct from human acceptance, and deterministic execution does
not validate a live model's interpretation or code quality. Mobile widths below
900 pixels, Windows/Linux, CI and external publication are outside this run.

Reproduce using the
[standing-work browser command](../development-commands.md#standing-work-browser-acceptance).
