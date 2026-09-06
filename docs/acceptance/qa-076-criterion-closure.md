# QA-076: Full criterion closure on an independent task

Following [ADR-0050](../adr/0050-screen-full-criterion-closure.md), test complete
delivery rather than known claim correction. The new case is a synthetic
read-only snapshot-retention review, with new evidence and canonical criteria.
It uses no Windows source, old Task/criterion IDs or historical answer. Two
fixture notes are authored directly, not attributed to real Agent Runs.

## Inputs and authorized arms

- [Packet](fixtures/qa-076/packet.json): Task/Criteria, source identities, frozen
  notes, shared artifact contract and the sole F instruction delta.
- [Sources](fixtures/qa-076/sources): policy, twelve-object inventory,
  verification observations and active pins; all synthetic and path-free.
- [Final artifact schema](fixtures/qa-076/final.schema.json) and
  [closure schema](fixtures/qa-076/closure.schema.json).
- [Private rubric](fixtures/qa-076/scoring.json): every item joins a canonical
  criterion; expected object decisions are not model-visible.
- [Reference artifact](fixtures/qa-076/reference.json): authored feasibility
  witness, never sent to the model or treated as experimental success.
- [Freeze](fixtures/qa-076/freeze.json) and
  [common E instruction](fixtures/qa-076/base-instruction.txt).

E receives evidence use, all canonical criteria and the full final artifact
contract. F receives exactly E plus an all-criterion self-assessment table
before the same final artifact. Both read the same four fixed sources. The
reference answer, private grading rubric and prior QA outcomes are unavailable
to the reader and prompt. Both output the same proposed review manifest; neither
may delete data, run shell commands or claim completed operational changes.

The authorized order is E/F, F/E, E/F, three fresh repetitions each, at most
**six** sessions using the installed Codex CLI and OpenAI/ChatGPT service, model
`gpt-5.4-mini`, low effort, five minutes per session, no retry or same-plan
resume. The Owner replied “是，允许” to this concrete proposal. The authorization
record changes no model-visible input or scoring rule and is refrozen and
committed before startup.

## Acceptance

Primary `fullRequiredDeliverablePass` requires every required canonical
criterion to pass independent final-artifact review, including semantic review.
Neither table `satisfied`, number of table rows, nor an 8/10 subtotal suffices.
An unmet critical criterion independently fails `criticalCriteriaPass`.
Correctly documenting missing verification while holding affected objects can
satisfy the uncertainty-reporting criterion; invented certainty cannot.

The proposal must account for every inventory object exactly once; protect the
newest verified restore points, active pins and dependency closure; respect the
strict age boundary; hold failed/unknown verification; give exact byte totals;
name missing evidence; and propose concrete regression inputs and outcomes.
All policies, required fields and required test conditions are visible in the
Task/Criteria or cited policy, not hidden grading additions.

Check all-source returns, exact criterion coverage, output ordering and
successful-read citation binding separately. A correct table with a contradictory
or incomplete final is retained as a failure, not filtered from the comparison.
Score final-only exports before unmasking F tables. Persist the first item
judgments before joining arm mappings; record changes instead of overwriting
them. Manual semantic review remains fallible and does not prove private thought.

No product improvement follows if full delivery fails. A stable within-task
signal still requires a new independent Single/Discussion experiment with both
sides using the same final verification protocol and a strong Single compute
control. Do not tune this case after model results or automatically start more
calls. These preparations leave production Discussion unchanged.

## Offline preparation evidence

The preparation freezes 58 file pins plus CLI binary/version, both instruction
digests and identical reader catalog/configuration digests. Source `revision`
is the Git blob SHA-1 of each authored UTF-8 source, explicitly labeled
`git_blob_sha1`; it is not a fabricated historical commit. SHA-256 and exact byte
ranges additionally bind content. `authority_qa076_synthetic_sources_v1` is
distinct from the historical excerpt authority. The shared experiment runtime
accepts this fixture authority while retaining its previous default for consumed
plans. No production source or existing acceptance journal changes.

The complete authored reference is 5,679 bytes in compact JSON and 7,195 bytes
as stored, both below the common 16,384-byte final-artifact cap. This proves an
acceptable answer fits; it does not prove a model will produce it. The inherited
runtime word counter is only telemetry here; the common enforced output limits
are the explicit final-artifact and terminal byte caps.

Fourteen new provider-free tests cover input/rubric parity, all policy branches,
source authority/read binding, false self-closure, missing regression semantics,
legitimate unknowns, control contamination, invalid manual-review identity and
exclusive admission. Fifty-five historical access/QA-074/QA-075 regressions also
pass, including installed-CLI loopback without an external model. Markdown lint
covers 409 files. The zero-budget live-entry probe fails before journal creation
or provider startup during preparation. This zero-budget check predates the
Owner authorization; it is not a real-model result.

Run `npm run test:discussion-criterion-closure` for offline checks and retained
result audit. The six-call `npm run bench:discussion-criterion-closure` plan is
now consumed; its durable journal blocks retries before provider startup. The
frozen authorization records the historical grant, not an available new budget.

## Retained six-session screening

**Neither arm delivered a complete accepted artifact: E=0/3, F=0/3.** The
predeclared incremental mechanism signal did not occur. This result does not
justify a production closure table, Targeted Review or a claim that Discussion
quality improved. It also does not isolate a unique comprehension, synthesis or
model-capability cause.

The Owner-authorized freeze was committed as `1375c99`. The exact E/F, F/E,
E/F sequence ran once from 13:55:27 to 14:00:48 UTC on 2026-09-06, using pinned
Codex CLI `0.153.4`, requested `gpt-5.4-mini` / low, with no retry or extra
contributor/grading-model invocation. Only the authorization packet and ADR
changed relative to preparation; both model instructions, runtime/configuration,
reader catalog, Task/Criteria, source bytes, notes and rubric stayed unchanged.
Actual provider model identity and equal compute are not independently attested.

Evidence is retained in:

- [Execution journal](evidence/qa-076-criterion-closure.json): all six attempts,
  terminal/progress records, source grants, receipts and returned bytes.
- [Final-only export](evidence/qa-076-final-only.json): artifacts ordered by
  hash, without arm mappings or closure tables.
- [First judgments](evidence/qa-076-first-assessment.json): 48 criterion
  judgments with artifact hashes and exact quotations, persisted before unmasking.
- [Closure review](evidence/qa-076-closure-review.json): subsequent source
  relevance and missing-item review of all 24 F rows, plus the framing diagnostic.
- [Derived assessment](evidence/qa-076-assessment.json): reproducible per-Run
  outcomes and separate metrics joined to those immutable records.

The implementation assistant graded against the frozen rubric and knew the
authored reference task. Hiding arms/tables during first judgments reduces one
source of bias; it is not independent human or fully blinded evaluation. No
first judgment was overwritten after unmasking.

Provenance correction: the frozen ADR calls the fixture notes “human-authored”.
They were actually prepared by the implementation assistant, like the synthetic
task and reference; they are neither independent human input nor real Agent
contributions. The frozen bytes remain unchanged, and this correction narrows
the provenance claim without changing the experiment or its results.

### Manipulation and outcomes

All six Runs completed with observed reader catalogs, valid scoped grants and
four full successful source returns each. There were no denied, failed, invalid
or truncated reads. No E answer emitted a closure table. All three F tables
preceded the final artifact, included all eight canonical criteria in order and
bound their references to successful current-Run returns.

One E answer closed with a literal escaped slash, `<\/final-answer>`, rather
than the required `</final-answer>`. The frozen parser therefore extracted no
final artifact. This is a delivered Run with an output-protocol failure, not a
crash, refusal or access failure. Its first semantic judgments are unscorable;
its scheduled primary outcome remains a non-pass. No parser relaxation, output
repair or replacement call was performed. Consequently, the combined common
manipulation check, which includes final schema validity, passes E=2/3, F=3/3.

| Metric | E: Evidence Use | F: Use + Criterion Closure |
| --- | --- | --- |
| Scheduled / completed Runs | 3 / 3 | 3 / 3 |
| Full required-deliverable pass | **0/3** | **0/3** |
| Critical-criteria pass | 1/3 | 0/3 |
| Four full source returns | 3/3 | 3/3 |
| Valid final artifact protocol | 2/3 | 3/3 |
| Unsupported additions in assessable finals | 2 across 2 finals; 1 unscorable | 5 across 3 finals |
| False `satisfied` versus final criterion | Not applicable | 12/24 rows |
| Mean / median latency | 50.24 / 50.09 s | 56.43 / 56.29 s |
| Mean closure JSON body | 0 bytes | 1,285.67 bytes |
| Mean terminal output | 6,640.67 bytes | 7,873.33 bytes |

Unsupported additions are enumerated claims, not independent statistical
observations or a net quality score. The malformed E artifact is not counted as
having zero additions. F adds about 6.19 seconds mean latency in these attempts;
this small sample cannot establish general overhead or reliability.

| Order | Arm | Blind artifact | Full / critical | Main retained defect | Time |
| --- | --- | --- | --- | --- | --- |
| 1 | E | answer-3 | fail / pass | Required one-millisecond-before-cutoff regression input absent | 49.677 s |
| 2 | F | answer-1 | fail / fail | Boundary object falsely included in newest two; one-hop test and one-second input mislabeled one millisecond | 57.246 s |
| 3 | F | answer-4 | fail / fail | Protected two-hop base proposed for deletion; incorrect category totals; offset-equivalent boundary test absent | 56.292 s |
| 4 | E | answer-2 | fail / fail | Protected base proposed for deletion; totals contradict emitted decisions; two-hop and millisecond cases absent | 50.092 s |
| 5 | E | answer-6 | protocol fail / non-pass | Escaped final closing tag; no extracted artifact for first semantic review | 50.955 s |
| 6 | F | answer-5 | fail / fail | Unprotected old object falsely retained, wrong category totals; offset-equivalent boundary test absent | 55.752 s |

All five schema-valid artifacts fail the required regression criterion. Correct
case names are insufficient: concrete two-hop, millisecond and offset-equivalent
boundary inputs were already canonical requirements in both arms. The malformed
E terminal also visibly omits the concrete two-hop and millisecond cases; that
post-unmask diagnostic neither repairs its artifact nor replaces blind grading.

Both E and F contain an unsafe proposed deletion of `lime-base-01`, which is a
transitive base of protected `lime-delta-03`. One E artifact even reports the
reference totals while its own deletion decisions imply different totals.
One F artifact protects `lime-full-05` under a false blanket protection claim.
These are policy/application failures as well as missing deliverable details;
the new result does not support describing the remaining work as cosmetic.

### Closure and preservation limits

F emits `satisfied` with empty `missing` for every criterion in all three Runs.
The 24 rows cite relevant, actually returned sources, but 12 claim satisfaction
for failed final criteria: 3 in F1, 5 in F2 and 4 in F3. The other 12 match final
passes. No row reports an actual omission. Thus structural closure and relevant
references did not supply reliable self-verification in this case. This is not
evidence that a previously correct intermediate judgment was lost: the table
contains statuses, not independently established correct decisions.

The frozen preservation implementation projects whole criterion outcomes onto
P1/P2/P3. Its per-Run results remain in the assessment, but these projections
cannot establish literal fact loss. For example, F1 correctly retains and names
`lime-full-04` as newest, while its P1 projection fails because the same newest
criterion also falsely includes `slate-full-02`. Likewise, P2 can fail for the
lime dependency error while the named slate dependency remains correctly stated.
No post-result metric rewrite is used to manufacture a signal.

Failed versus missing verification remains correctly distinguished in all five
schema-valid artifacts, with both held objects and object-bound evidence requests
preserved. This yields uncertainty-criterion passes E=2/3, F=3/3; the remaining E
is a protocol non-pass, not demonstrated loss of the raw terminal's uncertainty.

### Interpretation and maintenance

The fixed candidate rule fails: F has no complete pass, contains unsupported
additions and overclaims, and one E artifact also fails the common format gate.
Keep all six outcomes in the comparison. Neither partial coverage nor the F
tables' apparent completeness demonstrates improved product quality. This is
one new synthetic task authored by the evaluator, with only three trials per
arm, not a representative held-out benchmark or a Single/Discussion comparison.

The bounded experiment is finished. Production Discussion scheduling, storage,
completion policy, selection and result acceptance are unchanged. No further
same-case prompt tuning, stronger-model call, review agent or follow-on task
starts under this consumed authorization. Any future experiment needs its own
concrete hypothesis, new frozen plan and Owner-approved budget.

`npm run test:discussion-criterion-closure` passes 20 provider-free checks,
including six new retained-result tests for immutable grading identity/quotes,
receipt scope, false closure, malformed output and separate metrics. The 55
historical access/QA-074/QA-075 checks also pass, including installed-CLI local
loopback with no external model. Markdown lint covers 409 maintained files and
`git diff --check` passes. The live run and all offline wrappers physically
removed their owned temporary roots.

For a read-only recomputation of the assessment, run:

```sh
node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- \
  ./node_modules/.bin/tsx scripts/bench/criterion-closure-report.mjs \
  --audit-qa076-assessment
```

The audit compares existing output byte-for-byte and never changes first
judgments, reopens the call budget or invokes a provider.
