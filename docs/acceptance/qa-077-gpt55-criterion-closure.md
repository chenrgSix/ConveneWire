# QA-077: GPT-5.5 criterion-closure screening

Following [ADR-0051](../adr/0051-repeat-criterion-screening-with-gpt55.md), use
the Owner's model-change request to run six fresh `gpt-5.5` / low sessions.
The fixed order is E/F, F/E, E/F, five minutes each, no retries or replacement.
All QA-076 Task/Criteria, synthetic notes, evidence, prompt bytes, schemas and
rubric are reused unchanged. Only requested model and fresh experiment/Run
identities differ; neither arm receives old answers or private grading material.

The [plan](fixtures/qa-077/plan.json) binds the new authorization to the existing
Codex/OpenAI destination. The new freeze must be committed before startup.
The old QA-076 journal is never reopened, reset or overwritten.

Complete delivery requires all eight canonical criteria to pass final-artifact
review; keep critical failures, unsupported additions, missing evidence, reading,
closure overclaims and runtime overhead separate. Persist final-only first
judgments before unmasking tables. The evaluator knows the reference solution;
this is not independent human grading. The original preservation projection
limitation and strict output framing remain in force.

Any comparison with the earlier `gpt-5.4-mini` run is descriptive, not a
contemporaneous randomized model comparison or a new task. If both E/F pass,
that does not establish an incremental benefit from the closure table. Production
Discussion and follow-on experiment authority remain unchanged.

## Frozen preparation

The freeze retains 63 file pins. CLI `0.153.4`, its executable digest, Node
`v22.23.1`, both E/F instruction digests and reader catalog/configuration match
QA-076. Runtime and source/grade code bytes are unchanged. The npm manifest
only adds the new QA-077 commands and retains QA-076's post-run audit test;
its dependencies and other scripts match the historical freeze.

Five new offline checks cover model/input parity, exact authorization, rejected
old Run receipts, exclusive six-slot reservation and the frozen baseline. The
20 QA-076 checks remain passing; documentation and whitespace are checked
before the execution commit. These checks make no external model call.

## Interpretation amendment after wording review

**Current conclusion: all six GPT-5.5 answers handled the critical task
correctly. E has three undisputed complete passes; F has one undisputed
complete pass and two disputed wording judgments. Neither incremental benefit
nor quality harm from the table is established.**

The Owner challenged the two failures after the initial assessment. Both
concern a proposed duplicate-identity regression expectation: “Reject or mark
the manifest unresolved” in answer-5, and “Reject or mark unresolved” in
answer-6. The frozen task requires duplicate-object rejection, but does not
define whether an unresolved manifest may be accepted or executed. The actual
inventory has no duplicate IDs. These are descriptions of hypothetical tests,
not observed duplicate-processing failures.

The first evaluator interpreted unresolved as insufficient rejection. That is
a possible strict contract interpretation, but the wording could also mean
refusing to proceed. It cannot reliably establish a functional defect. The
two derived closure overclaims inherit this dispute; they are not independently
proven false claims. Correct decisions for all twelve objects, correct byte
totals and preserved failed/missing verification remain established in all six
answers.

This amendment changes interpretation, not the frozen experiment. Source
fixtures, prompts, rubric, raw outputs, first judgments, closure review and
derived JSON remain byte-for-byte unchanged. The historical E=3/3, F=1/3
table below is the original strict assessment, not an undisputed current
quality comparison. We also do not silently replace it with six full passes.
The offline audit reproduces those original judgments; it does not settle the
semantic dispute.

The predeclared F signal remains absent even if both disputed items were
accepted: E already passed 3/3. Future acceptance must distinguish concrete
behavioral errors, missing deliverables and wording ambiguity. An ambiguous
item must not be the sole basis for declaring an arm worse. This motivates
the independent [QA-078 design](qa-078-strong-single-discussion.md), rather
than another prompt revision on this retention task.

## Retained result

This section preserves the original assessment. Read its wording-sensitive
failures and derived overclaims with the interpretation amendment above.

**GPT-5.5 produced correct critical decisions in all six attempts. Complete
delivery passed E=3/3 and F=1/3.** E directly answers after evidence use; F adds
the criterion self-assessment table. The predeclared incremental F signal did
not occur. No unsafe proposed deletion, incorrect byte total, unsupported
factual addition or lost failed/missing-verification distinction was found.

The two non-passes concern a narrower regression-test expectation: instead of
requiring rejection of duplicate object identity, F1/F3 permit rejection **or**
marking unresolved. Both alternatives avoid duplicate output, but the latter
does not guarantee the explicitly required rejection. This is a noncritical
test-acceptance gap, not the dangerous classification errors found in QA-076.

The execution freeze is commit `3a51678`. Exactly six fresh sessions completed
in the fixed E/F, F/E, E/F order, with no retry, substitution, output repair or
additional contributor/grading-model call. The one-time journal is consumed.
All evidence catalog/grant/instruction/configuration checks pass; all 24 source
returns are complete, correctly scoped and before the answers. There are zero
failed, denied, invalid or truncated receipts. All six final output schemas
pass, with no E closure contamination; all three F tables have the correct
order, eight criteria and current-Run returned references.

### Retained evidence and grading

- [Execution journal](evidence/qa-077-gpt55-criterion-closure.json): six
  attempts, configuration identity, terminal/progress records, grants and receipts.
- [Final-only export](evidence/qa-077-final-only.json): hash-sorted artifacts
  without E/F labels or closure tables.
- [First assessment](evidence/qa-077-first-assessment.json): 48 separate
  criterion judgments, exact quotes and explicit grading interpretations, saved
  before opening arm mappings or tables. No first judgment was changed later.
- [Closure review](evidence/qa-077-closure-review.json): all 24 table rows
  checked for source relevance, missing items and agreement with final acceptance.
- [Derived assessment](evidence/qa-077-assessment.json): independently
  recomputable joins and per-Run metrics; no net score or dropped failures.

The same implementation assistant authored the synthetic fixture and graded it,
knowing its reference. The initial arm/table masking does not make this an
independent human evaluation. Semantic grading remains judgment-sensitive.

The first assessment records two interpretations explicitly. A byte-accounting
conservation test over the fully specified current inventory and emitted
decision partition is accepted without a second literal numeric test vector;
the frozen criterion did not require that additional format. Conversely, the
canonical criterion explicitly requires duplicate-object rejection, so an
expectation that also permits unresolved is failed. The concrete two-hop,
UTC-offset equivalent and one-millisecond-before-cutoff cases are present in
all six artifacts. Neither interpretation changes model inputs, rubric bytes or
the retained first judgments after seeing arm identity.

### Separate outcomes

| Metric | E: Evidence Use | F: Use + Criterion Closure |
| --- | --- | --- |
| Scheduled / completed | 3 / 3 | 3 / 3 |
| Complete required deliverable | **3/3** | **1/3** |
| Critical-criteria pass | 3/3 | 3/3 |
| Four complete source returns | 3/3 | 3/3 |
| Final schema / common manipulation pass | 3/3 | 3/3 |
| Frozen P1/P2/P3 criterion projections | All pass | All pass |
| Uncertainty criterion | 3/3 | 3/3 |
| Unsupported factual additions | 0 | 0 |
| False table satisfaction versus final criterion | Not applicable | 2/24 rows |
| Mean / median latency | 50.19 / 49.68 s | 54.69 / 54.93 s |
| Mean closure JSON body | 0 bytes | 1,327 bytes |
| Mean terminal output | 6,103.33 bytes | 7,362.33 bytes |

| Order | Arm | Blind artifact | Complete / critical | Remaining defect | Time |
| --- | --- | --- | --- | --- | --- |
| 1 | E | answer-1 | pass / pass | None under frozen requirements | 49.677 s |
| 2 | F | answer-5 | fail / pass | Duplicate regression permits unresolved instead of requiring rejection | 56.027 s |
| 3 | F | answer-3 | pass / pass | None under frozen requirements | 54.927 s |
| 4 | E | answer-2 | pass / pass | None under frozen requirements | 52.423 s |
| 5 | E | answer-4 | pass / pass | None under frozen requirements | 48.469 s |
| 6 | F | answer-6 | fail / pass | Duplicate regression permits unresolved instead of requiring rejection | 53.118 s |

Every F row says `satisfied` with empty `missing`. Twenty-two rows agree with
the final criterion results; the two regression rows overlook the rejection
expectation gap. Their evidence references are relevant and returned, but those
facts alone do not establish that the criterion is satisfied. F's mean latency
is about 4.50 seconds higher here. Neither this overhead nor the observed E/F
pass-rate difference establishes a population effect at three attempts per arm.

### What this does and does not establish

Compared descriptively with the earlier QA-076 run, complete passes changed
from E=0/3, F=0/3 to E=3/3, F=1/3; critical passes changed from E=1/3, F=0/3
to 3/3 in both arms. The CLI bytes, evidence, prompt and grading code match, but
models were not randomized contemporaneously and the task is already known.
This is evidence of better observed performance on this task after requesting
GPT-5.5, not proof of general model superiority or a causal product improvement.

There is still no predeclared incremental F signal: F is not 3/3 and E exceeds
1/3. Two wording-sensitive noncritical failures should not be exaggerated into
a claim that tables universally hurt reasoning. The new results also do not
compare a strong Single Agent against Discussion, and justify no production
change or automatic new experiment. The frozen whole-criterion preservation
projection remains a limitation rather than a literal fact-loss measurement.

### Maintenance

`npm run test:discussion-gpt55` passes ten provider-free checks, including five
new retained-result tests covering exact source/grade joins, real quotations,
separate complete/critical outcomes, overclaims and non-aggregated measurements.
The twenty QA-076 baseline checks remain passing. Markdown lint covers 411
maintained files and `git diff --check` passes. The live and offline test-owned
temporary roots are physically removed.

The execution command is consumed and cannot be used for maintenance. Recompute
the retained assessment without a model call:

```sh
node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- \
  ./node_modules/.bin/tsx scripts/bench/criterion-gpt55-report.mjs \
  --audit-qa077-assessment
```

The audit requires byte-for-byte agreement with the retained assessment and
never rewrites first judgments or reopens model-call authority.
