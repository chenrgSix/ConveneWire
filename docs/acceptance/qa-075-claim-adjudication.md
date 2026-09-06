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

## Retained execution

Frozen source commit: `5f1a4dd4efbf10b9a8f7cda56d5305438ca3f401`.
Exactly six new Finalizer sessions completed, in the frozen order, with no
retry, contributor generation or extra grading invocation. All common setup
checks passed; every Run returned all four complete sources before its terminal
message. There were 24 valid returns and no denied, failed, invalid or truncated
returns. All diagnoses met the 450-word instruction and terminal byte cap.

- [Raw execution journal](evidence/qa-075-claim-adjudication-2026-09-06.json)
- [Recomputed artifact and reading checks](evidence/qa-075-artifacts-2026-09-06.json)
- [Diagnosis-only export](evidence/qa-075-blind-answers-2026-09-06.json)
- [Separate item assessments](evidence/qa-075-blind-assessment-2026-09-06.json)
- [Joined consistency review and analysis](evidence/qa-075-analysis-2026-09-06.json)

| Order | Arm | Repetition | Full sources | Both targets corrected | D structure / semantics | Seconds |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | C | 1 | 4/4 | yes | not applicable | 30.812 |
| 2 | D | 1 | 4/4 | yes | valid / correct and consistent | 29.178 |
| 3 | D | 2 | 4/4 | yes | valid / correct and consistent | 36.801 |
| 4 | C | 2 | 4/4 | yes | not applicable | 26.351 |
| 5 | C | 3 | 4/4 | yes | not applicable | 28.631 |
| 6 | D | 3 | 4/4 | yes | valid / correct and consistent | 36.783 |

D's three tables all reject `claim_body_unknown` using `windows-availability`
and support `claim_cli_console_gate` using enrollment, Console preflight and
availability. All six cited claim judgments match the actual returned evidence;
all six final-answer judgments preserve the corresponding disposition. Thus
all four D manipulation checks pass, including the separately reviewed final
consistency check. Empty table `unresolved` lists concern these two settled
targets only; they do not declare the entire Task free of uncertainty.

No synthesis consistency failure was observed. C and D both correct the two
targets in 3/3 answers, so **incremental adjudication benefit is not
demonstrated**. The historical failure did not reproduce on this fresh common
baseline. Both arms received explicit target propositions and a terminal
wrapper; their contribution may warrant a future control, but this experiment
does not isolate it. Do not compare this C to QA-074 C to claim that target
prompting caused the improvement.

## Separate quality and cost findings

All six preserve the core availability and independent CLI/Console facts (P1,
P2) and unchanged Runtime permissions/proposal boundaries (P4). Unix preservation
P3 is partial in C1, D1 and D3: their proposed checks say `.cmd` remains rejected
on Unix without qualifying absent execute bits. The actual predicate does not
reject an extension on its own. C2's weaker “non-authoritative” wording is read
as an extension alone not sufficing. These are explicit manual judgments and
proposed-test ambiguities, not claimed observations of executed tests.

No unambiguous new material historical fact, completed repair or passed test
unsupported by the supplied materials was identified. This does not make the
repair proposals acceptable: every answer omits a complete regular-file,
bounded case-insensitive Windows policy or required regression cases. D2 resists
unbounded extension expansion, but still omits regular-file and case-matching
details. All six miss explicit no-execute-bit Windows fixtures and negative
extension/directory coverage. Only C1/C2 fully locate the complete D1 gate set;
D2 mentions `.exe`-only candidates but does not explicitly bind discovery itself
to the availability filter. These distinct defects remain in D1/D2/D3 and P3,
without offsetting them against target corrections.

All answers distinguish proposed portable/native checks and resolve the false
body uncertainty (U2/U3), but omit the missing exact user paths/logs (U1 partial).
**No answer meets the complete required deliverable.** Target correction and
schema validity do not establish Result acceptance or product quality.

Median elapsed time is 28.631 seconds for C and 36.783 for D; means are 28.598
and 34.254 seconds respectively. These are descriptive measurements from three
Runs per arm. Every D table body costs 645 UTF-8 bytes. Mean final diagnosis
length is 265.7 words for C and 223.3 for D; mean terminal size is 2,682.7 versus
3,004.7 bytes. The retained runtime's legacy word counter also counts table
content, so QA-075 uses its parsed diagnosis counter for the common word limit.
Neither equal limits nor these output measurements establish equal compute.

## Review and authority limitations

The implementation agent specified all 78 item judgments from the shuffled
diagnosis export before reading arm mappings or D tables. The first assessment
export failed on one answer's paragraph layout; the corrected file was persisted
after unmasking without changing the already declared judgments. There was no
independent scorer or additional grading-model invocation. Blinding is limited,
and exact quotations make the judgments reviewable rather than infallible.
The separate table review checks six evidence-to-claim and six claim-to-final
judgments. Receipts and correct external verdicts do not reveal private thought
processes or uniquely distinguish comprehension, binding and anchoring.

The first automatic approval review rejected startup because historical inputs
could have been private. No process or reservation started. Anonymous downloads
from the public repository at `a271417f0c9fdd9166f35492d4783166e7aa98ea` then
matched the local QA-074 fixture, QA-069 source packet and retained contribution
report byte-for-byte. With this evidence the same bounded command passed
approval; there was no change to sources, destination, limits or reader scope.
The journal now consumes the entire six-session authorization. Any new control,
independent task or further model experiment needs a new bounded plan.

## Post-run verification

All 16 QA-075 tests pass, including recomputation of the six retained Runs,
exact-source receipt checks, 78 rubric-item/quote bindings, six source-verdict
and six verdict-final bindings, and separate summary counts. These integrity
tests do not replace semantic review. All 407 maintained Markdown files lint
clean and `git diff --check` passes. Seven invocation-owned roots from freezing,
offline checks, the live run and audit were physically confirmed absent after
their wrappers completed. Historical QA-072/QA-074 journals and fixtures are
unchanged; production code is unchanged.
