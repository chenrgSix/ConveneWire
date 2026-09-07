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

Execution records and results will be appended after the frozen plan is consumed.
