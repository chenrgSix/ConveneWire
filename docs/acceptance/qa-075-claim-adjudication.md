# QA-075: Evidence-to-claim adjudication screening

This acceptance record follows [ADR-0049](../adr/0049-screen-evidence-to-claim-adjudication.md).
The prior [QA-074](qa-074-evidence-access-use.md) showed complete C reading in
three repetitions but full target correction in only one. Successful reader
returns establish exposure, not understanding. QA-075 tests whether an explicit
claim disposition changes the observable evidence-to-claim-to-final path.

## Frozen design

One historical Windows case, two unchanged contributions, four fixed excerpts.
Six new Runs in C/D, D/C, C/D order. Both arms receive the same frozen target
propositions and full-source reading rule. C supplies a final diagnosis; D first
supplies a structured disposition, then the diagnosis, within one terminal
message. The common target list and final wrapper make this a fresh baseline;
old C answers cannot substitute for new calls.

Requested model `gpt-5.4-mini`, effort `low`, 300-second timeout, eight reader
calls, 8,192 bytes per return and 32,768 terminal bytes remain common. The final
diagnosis is under 450 English words; table and assessment overhead are counted
separately. No equal-token or provider-side model attestation is implied.

## Artifacts and contracts

- [Fixture](fixtures/qa-075-claim-adjudication.json): identities, sources, common
  targets, arm delta, six-slot authorization and runtime limits.
- [Common C instruction](fixtures/qa-075-base-instruction.txt) and
  [freeze](fixtures/qa-075-freeze.json): exact source, runtime and catalog pins.
- [Disposition schema](fixtures/qa-075-disposition.schema.json): closed QA-only
  conclusion artifact; schema validity is not claim verification.
- [Read receipt contract](fixtures/qa-072-read-receipt.schema.json): unchanged
  Run/authority/source/revision/range/content/time identity and failure fields.
- [Private scoring rubric](fixtures/qa-075-scoring.json): separate per-item
  correction, preservation, additions, uncertainty, deliverables and consistency.

The two diagnostic propositions use the existing `criterion_qa072_1`. Exact
text appears equally in C and D, without verdicts or an indicated correct Agent.
All four original sources are required regardless of proposition wording.
Target selection follows the already identified historical dispute; this is
deliberately diagnostic and not an unbiased new-task sample.

## Acceptance and execution

Before execution, freeze and commit the plan, instructions, private rubric,
schema, dependencies, runtime binary and tests. Provider-free checks must cover
arm parity, authorization/range integrity, malformed/duplicate/missing targets,
unread references, output ordering, terminal failures and exclusive six-slot
admission. Each reservation is durable before startup. Any interruption consumes
the plan; do not retry or silently replace an answer.

For each attempt record common setup, four-source coverage, Run outcome and
time. For D also check both targets, schema, actual returned-source bindings,
and table-before-final ordering. Manually grade evidence-to-claim correctness
and claim-to-final consistency with exact spans; never use JSON validity as a
semantic grader. A correct table and contradictory final is a consistency
failure that stays in the comparison. Missing or malformed artifacts stay too.

Grade shuffled diagnosis-only exports first, without treatment labels or tables;
then join table and receipt evidence for the separate consistency review.
Blinding is limited because prose can reveal the treatment and the evaluator
knows this historical case. No extra grading-model call is authorized.

Use `npm run test:discussion-claim-adjudication` for provider-free checks.
`npm run bench:discussion-claim-adjudication` consumes only this six-session
freeze once. It is not a routine or reusable test command.

All six attempts, including inconsistencies, failed reads and incomplete Runs,
remain visible. Interpret only a within-case pattern; no unique inference
about private reasoning and no production-quality or acceptance claim follows.

## Pre-invocation verification

The freeze contains 43 file pins plus CLI executable, version, catalog and
common C/D configuration digests. Eleven new provider-free tests pass; the
retained-run test is deliberately skipped until the new report exists. All
39 existing access/reader/QA-074 checks pass, including installed-CLI loopback
without a model. Markdown lint covers 407 files and whitespace checks pass.

The shared receipt auditor accepts an explicit expected instruction for QA-075;
its default QA-074 behavior is unchanged. Consumed QA-074 source pins are checked
against its recorded source commit, so later experiment additions do not rewrite
historical evidence. No production implementation file is changed.
