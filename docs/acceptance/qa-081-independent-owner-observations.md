# QA-081 independent owner observations

This phase asks whether owners can extract the permitted observations without
seeing computed answers, and whether Finalizer can deliver a useful bounded
review when Operations sharing is revoked. See [ADR-0055](../adr/0055-screen-independent-owner-observations.md).

Normal then revoked; each reserves code, security, operations and Finalizer in
that order. Owners run concurrently without seeing each other's output.
Eight GPT-5.5 / low sessions maximum, no retry or replacement. Existing fictional
sources, public criteria and semantic reference remain unchanged. A hidden
verifier runs only after the immutable original owner proposal is retained.

The trial uses fresh Task/Room/Run scopes with the frozen QA-079 source and
disclosure recipe. Its new journal and freeze are QA-081; old consumed plans
are not reopened. The Finalizer uses QA-080's repaired runtime and receives
only published Results plus public availability statuses.

Acceptance distinguishes independent observation correctness, authorized
publication, full and critical final deliverables, preservation, unsupported
claims, unknowns, actual source returns and runtime/time. A withheld source must
stay unknown; a failed session must remain a failure. No program fills an
omitted value. A missing final artifact receives no semantic quality score.

This is a single trusted-host mechanism screening with a task-specific hidden
verifier. It does not establish authenticated independent owners, in-flight
revocation, production Discussion recovery or an advantage over Single Agent.
The [plan](fixtures/qa-081/plan.json) pins the runtime, schedule and assessment
rules. The unchanged [reference](fixtures/qa-079/reference.md) and
[rubric](fixtures/qa-079/scoring.json) remain evaluator-only. Read receipts prove
returned bytes, not comprehension. All original proposals are retained before
the hidden verifier begins; a wrong proposal is rejected as a whole and an
omission stays missing. The first semantic assessment keeps exact quotations
for every pass and grades each released atomic fact separately.

## Commands and authorization

Offline maintenance:

```sh
node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- node --test scripts/bench/independent-owner.test.mjs
node scripts/bench/independent-experiment.mjs --audit-qa081
node scripts/bench/independent-experiment.mjs --assess-qa081
```

The audit/assessment commands require retained results. Freeze once with
`node scripts/bench/independent-experiment.mjs --freeze-qa081` and commit all
pinned inputs before execution. The Owner-approved one-use execution is:

```sh
node scripts/test/run-with-temp-root.mjs --timeout-ms 2160000 -- node scripts/bench/independent-experiment.mjs --execute-qa081-frozen-eight
```

This entrypoint is not a routine test. The exclusive journal consumes permission
before any invocation; interruption or incomplete slots cannot reopen it.
No pilot, retry or additional model grader is authorized. Initial outcome and
all attempted slots stay recorded even when the scenario fails.

## Results

The eight-session authorization is consumed. All eight requested GPT-5.5 / low
sessions completed; no pilot, model grader, retry or replacement was used.
The 296 inputs were committed at `f0cd3c1` before the first invocation. Runtime
is the pinned Codex CLI 0.153.4 and Node.js 22.23.1; telemetry records requested
model identity, not an independent provider-side model attestation.

| Measure | Normal | Operations revoked |
| --- | --- | --- |
| Independent owner observations | 16 correct, 0 wrong, 0 omitted | 16 correct, 0 wrong, 0 omitted |
| Facts authorized for Finalizer | 16 | 9; all 7 Operations facts withheld |
| Facts retained in final answer | 16/16 | 9/9 |
| Full required deliverable | 14 pass | 13 pass, 1 disputed |
| Critical criteria | 10 pass | 9 pass, 1 disputed |
| Unsupported additions / behavior errors | 0 / 0 | 0 / 0 |
| Unknowns and authority boundary | Preserved | Preserved; renewed authorized snapshot requested |
| Source returns / failures | 6 / 0 | 5 / 0 |
| Sessions / runtime failures | 4 / 0 | 4 / 0 |
| Scenario wall time | 79.237 seconds | 76.942 seconds |
| Finalizer time | 42.876 seconds | 48.615 seconds |

Both scenarios retained each owner proposal before its hidden verifier ran.
Each owner reader exposed exactly its own raw source; no local-check receipt,
expected-value catalog or peer contribution was supplied. Wrong-value and
omission behavior is covered by offline negative tests, not by a real-model
mistake in this sample. The source returns are six owner reads and five final
release reads. They prove returned bytes, not understanding by themselves.

The revoked scenario actually denied the buffered Operations publication before
any Central call and emitted only a status notice. Finalizer read both available
releases and produced an informational Result with operational counts, timing
and current readiness left unknown. It did not request raw Operations files.
This real invocation used `read_evidence` directly; it did **not** repeat native
`list_mcp_resources`, whose compatibility evidence remains QA-080's loopback.

### The disputed requirement

The revoked final supplies all three repairs and four concrete regression
scenarios, but its ordered plan says to repair the cutover gate and then permits
the issuer switch after acknowledgements; it describes the retirement-gate
repair afterward. It never explicitly puts successful regression verification
before the switch. The regression section can be read as intended pre-action
verification, so the frozen `criterion_qa079_sequence` is **disputed** for
wording ambiguity, not an observed unsafe execution. Neither full nor critical
acceptance is declared passed for this scenario. The initial grade is retained
without editing the rubric or running another model to obtain cleaner wording.

### Retained evidence and interpretation

The [execution journal](evidence/qa-081-independent-experiment.json) retains all
eight slots, actual source receipts, typed releases, Result storage snapshots
and final answers. The [immutable first assessment](evidence/qa-081-first-assessment.json)
keeps exact quotations for all criteria and individual released facts; the
[derived assessment](evidence/qa-081-assessment.json) is recomputed offline.
The twelve `qa-081-{normal,revoked}-{owner}-{proposal,validation}.json` files in
the same evidence directory are evaluator-only synthetic owner audits. They
are never model inputs or shared Room evidence; the public journal binds their
hashes and ordering.

This removes the observed answer-feeding flaw in this bounded task: owners
actually derived the observations themselves, and withholding one domain no
longer prevented an uncertainty report. It does not establish that an Agent is
necessary for these deterministic facts, that Discussion outperforms Single,
or that authenticated independent Owners/devices have been tested. The reused
QA-079 identifiers describe a pinned recipe; the new journal, fresh database
and fresh Task/Room/Run identities enforce a separate bounded experiment.

The trust anchor remains the trusted host plus authority file and lock, not the
self-carried grant public key. Revocation semantics cover before-send only;
commit-time revocation and production Discussion recovery remain outside this
experiment. No production code changed. QA-079/080 evidence remains unchanged.

### Verification

The combined offline suite passed 36 behavior/history checks before execution;
the freeze and two retained-result checks were exercised at their applicable
stages. The final seven QA-081 checks include freeze, grant/receipt/Result audit
and immutable grade rejoin; all pass without model calls. Documentation lint,
changed-document local links and `git diff --check` pass. Disposable test and
live SQLite/runtime roots were removed by the repository wrapper.
