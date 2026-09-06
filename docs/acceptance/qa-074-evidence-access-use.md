# QA-074: Fresh evidence access/use screening

## Scope and acceptance

[ADR-0048](../adr/0048-repeat-evidence-screening-with-manipulation-checks.md)
records the Owner's new nine-session authorization. Q1 asks whether fixed
source access helps correct the diagnostic error; Q2 asks whether the frozen
evidence-use requirement adds value beyond access. This remains one historical
mechanism screen, not a new product feature or independent holdout evaluation.

Freeze A/B/C, B/C/A, C/A/B before calls. Reuse QA-072's historical Task/Criteria,
verbatim contributions, evidence identity/version/ranges, neutral base text and
C rule. Generate A from current production rendering again. Start fresh CLI
sessions for all arms using QA-073's repaired reader and diagnostics; never
compare an old A against new B/C. Bind new experiment/Run IDs to the same
owner-approved excerpts. Keep source selection and scoring outside model
control and keep the rubric out of the workspace and reader bundle.

The model remains `gpt-5.4-mini`, reasoning effort `low`, at most 300 seconds
per session, eight reads, 8,192 bytes per return and 32,768 retained answer
bytes. The common answer instruction remains under 450 English words. These
are common limits, not a claim of equal tokens/compute or a provider token cap.
Count nine Finalizer CLI sessions including failures; internal tool turns and
the CLI's transport recovery are not replacement Finalizer invocations.

## Frozen artifacts

- [Fixture](fixtures/qa-074-evidence-access-use.json): new authorization,
  identities/order and preserved diagnostic inputs.
- [Base instruction](fixtures/qa-074-base-instruction.txt): generated from
  current code and required to match the shared A/B input.
- [Scoring and gates](fixtures/qa-074-scoring.json): item criteria, separate
  dimensions, exposure prerequisites and interpretation rules.
- [Freeze](fixtures/qa-074-freeze.json): CLI, reader catalog and source/code pins.
- [Read Receipt v1](fixtures/qa-072-read-receipt.schema.json): reused unchanged.

## Manipulation checks

| Arm | Setup | Reading requirement |
| --- | --- | --- |
| A | No reader catalog/configuration or grant; exact baseline input | Zero reader returns |
| B | Matching catalog observed, valid exact Run/source grant, A-identical input | Optional; no read is not a Run failure |
| C | B's catalog/grant and exact frozen use rule supplied | All manifest sources fully returned before the final answer |

Audit receipt schema, Run/Task/Room/authority/version joins, requested and
returned ranges, hashes, bytes, truncation and timestamps against original
excerpts. Report configuration, catalog observations, successful/denied/failed
returns, full source coverage and substantive evidence use separately. A
server return cannot prove model receipt or comprehension.

Zero valid returns across the experiment yields `manipulation_failed` and no
semantic quality grading. With returns, retain all outputs and grade separate
items; causal interpretation still depends on comparison-specific gates. Q1
requires B exposure; Q2 requires C's required full reading. Failed Runs,
missing/mismatched setup or incomplete repetitions are reported, not removed.
Stable claims require all three newly executed repetitions to meet the relevant
gate and the frozen outcome pattern. No significance or population claim.

Assessment uses answer-hash ordering without treatment labels before joining
the operational metadata. This is limited blinding: the same operator knows
the experiment, and answer text may reveal treatment. No independent grader or
additional model call is claimed. Gate-blocked quality dimensions are marked
`unscorable` with the reason; they are never zero-score refusals.

## Admission and validation

Commit frozen inputs before startup. Create the report exclusively and reserve
each slot durably before launching. Existing reports, altered pins, runtime
drift or more than nine reservations reject admission. Failures consume their
slots; no automatic retry, same-plan resume or mid-experiment code changes.
Per-invocation manipulation failures are retained and do not trigger replacement
or change the scheduled treatments. QA-072 stays consumed.

`npm run test:discussion-evidence-screening` is provider-free gate/admission
validation. `npm run test:discussion-evidence-access` retains the repaired CLI
HTTP/WebSocket A/B/C loopback and historical audits. The explicit
`npm run bench:discussion-evidence-screening` command consumes only this new
authorization. It is not routine testing or permission for future reruns.

## Evidence boundary

No production Discussion scheduling, storage, completion, acceptance or
participant selection changes. No Targeted Review, extra discussion rounds,
new contribution persistence, selector or heterogeneous model experiment.
Final delivery is the frozen report, manipulation audit, eligible item review,
bounded Q1/Q2 interpretation and physical temporary-root cleanup evidence.

## Pre-invocation evidence

The freeze pins 35 files, the reader definition and normalized invocation
configuration hashes, CLI `0.153.4` executable bytes and Node `22.23.1`.
The rendered shared base is byte-identical to QA-072's 11,683-byte base, but all
nine answers will be new invocations. No model call occurs while freezing.

Eight new gate/admission checks pass; the retained-run audit is explicitly
skipped until the report exists. All 30 repaired reader/CLI and historical
audit checks pass. Documentation lint covers 405 files with zero issues.
The tests cover optional unread B, complete C, incomplete/failed repetitions,
tampered scopes/bytes, returned-range gaps and late reads. Negative-test data
is cloned so a deliberately corrupted grant cannot mutate the next fixture.

## Retained execution and manipulation

The pre-invocation freeze commit is `ed516d3`. Exactly nine fresh sessions ran
in the frozen order, without retry, replacement or mid-run changes. All nine
Runs completed and all nine setup checks passed. QA-074 is now consumed.

- [Original report](evidence/qa-074-access-use-2026-09-06.json): reservations,
  exact outputs, progress, grants, reader lifecycle, tool events and receipts.
- [Manipulation audit](evidence/qa-074-manipulation-2026-09-06.json): validated
  source returns, coverage, setup and comparison-specific eligibility.
- [Masked answer export](evidence/qa-074-blind-answers-2026-09-06.json) and
  [item review](evidence/qa-074-blind-assessment-2026-09-06.json): answer hashes,
  117 separate item judgments, reasons and exact quoted spans.
- [Joined analysis](evidence/qa-074-analysis-2026-09-06.json): all dimensions,
  repetitions, evidence-use compliance and bounded Q1/Q2 conclusions.

| Slot | Arm / repetition | Valid source returns | Required reading | Seconds | T1 / T2 |
| --- | --- | --- | --- | --- | --- |
| 1 | A / 1 | 0 | Not applicable | 17.414 | fail / partial |
| 2 | B / 1 | 0 | Optional | 16.431 | fail / partial |
| 3 | C / 1 | 4 | Complete | 32.004 | fail / pass |
| 4 | B / 2 | 0 | Optional | 17.813 | fail / partial |
| 5 | C / 2 | 4 | Complete | 30.355 | fail / pass |
| 6 | A / 2 | 0 | Not applicable | 16.923 | fail / partial |
| 7 | C / 3 | 4 | Complete | 31.874 | pass / pass |
| 8 | A / 3 | 0 | Not applicable | 19.813 | fail / partial |
| 9 | B / 3 | 0 | Optional | 20.423 | fail / partial |

A had no reader catalog, grant or source return. Every B/C Run had the same
matching reader definition and a valid exact Run/source grant. B never used
the reader. C returned all four complete sources before every final answer:
12 returned receipts, zero denials, source failures, invalid receipts or
truncations. The experiment-wide exposure gate passed. Q1's actual B exposure
gate did not; Q2's three comparison gates passed. Complete C reading satisfies
the read subcondition, not substantive evidence-use compliance.

T1 requires resolving the false claim that the `executableAvailable` body is
missing or an unknown Windows branch remains. T2 requires retaining CLI's
independent execute-bit rejection and Console's pre-probe readiness check.
Both target items passed together in A 0/3, B 0/3 and C 1/3. T2 alone passed
in C 3/3; all A/B answers were partial on that item. These are separate item
observations, not an aggregate quality score.

## Content preservation and remaining defects

| Arm | Correct content fully retained, by repetition | Unsupported additions | Uncertainty U1/U2/U3 | Deliverables D1/D2/D3/D4 |
| --- | --- | --- | --- | --- |
| A | 2/4, 2/4, 2/4 | 0, 0, 0 | partial/pass/partial; pass/pass/partial; pass/pass/partial | All partial/partial/partial/pass |
| B | 1/4, 2/4, 1/4 | 0, 0, 0 | pass/pass/partial; partial/pass/partial; partial/pass/partial | All partial/partial/partial/pass |
| C | 2/4, 2/4, 4/4 | 0, 2, 0 | pass/pass/partial; partial/pass/partial; partial/pass/pass | partial/partial/partial/pass; pass/partial/partial/pass; partial/partial/partial/pass |

Non-passing preservation items in this table are partial, not averaged into
correction. P3 is partial where the proposed Unix regression would reject a
`.cmd` file solely by extension, even though the historical predicate permits
any regular file with execute bits. Wording that an extension alone is not
authoritative is not treated as that unconditional rejection. Full reasons
and exact language remain in the item review.

C1 first states the correct availability predicate, then says the Windows
implementation is not shown and might already branch by OS. C2 also retains
that false uncertainty despite receiving the complete function. C3 removes
it and preserves uncertainty about the future allowed launcher set instead.
Thus substantive conflict checking passed in only one of the three C answers.

C2 additionally describes CLI enrollment as requiring a regular file, while
the excerpt actually checks `IsDir` plus execute bits. It also generates source
links into an empty temporary workspace, including inconsistent directory
spellings; only the named evidence IDs correspond to supplied sources. These
are two separately recorded unsupported additions. Original text and hashes
are preserved; generated local links are not validated artifact locations.
The inherited missing-body dispute is not double-counted as a new addition.

All nine answers still propose broad OS/PATHEXT launchability rather than the
requested bounded, case-insensitive launcher policy, and omit important
unsupported-extension/directory and caller regression cases. Those policy and
test defects remain D2/D3 partial; they are not recast as fabricated historical
implementation merely because they are proposals. No answer satisfies the
complete required deliverable. C2 locates the `.exe`-only candidate builder,
showing that coverage can improve while correctness remains incomplete.

All outputs stay below the common word instruction under the existing adapter
count. B2 also omits the closing assessment tag; this is recorded independently
and does not retroactively change Run outcome or create an acceptance gate.
No model-generated `goalSatisfied` or criterion label is treated as acceptance.
Attempted elapsed totals are A 54.150 s, B 54.667 s and C 94.233 s; these are
observations for this run, not equal-compute or general efficiency claims.

## Interpretation and closure evidence

**Q1 remains inconclusive about the benefit of obtaining original evidence.**
In this sample, optional Access was configured correctly but never used. It
did not trigger reading; the experiment does not establish that actual access
to source bytes is ineffective.

**Q2 shows a mixed within-case signal.** The explicit rule consistently induced
complete reading and C retained the CLI predicate in all three answers. It
resolved the main missing-body error in only one answer and introduced two
unsupported additions in another. This is not a stable overall improvement,
nor evidence of improved Discussion product quality.

The remaining problem is observable after valid source returns: the Finalizer
can retain a contradiction or an uncertainty that those sources resolve.
Returned completeness has been checked; substantive instruction following and
evidence use remain incomplete. Receipt data alone cannot prove comprehension
or isolate synthesis as the sole cause. No Targeted Review or further real
invocation is authorized by this result.

All nine post-run screening/admission/audit tests pass. A separate artifact
check joins every answer hash, all 117 item IDs/statuses/quoted spans, the
scoring hash and the joined analysis back to the unchanged original report.
Five owned test roots, including the live experiment root, were physically
absent after cleanup. The 35 frozen pins, source inputs and QA-072 artifacts
remain unchanged; no production code changed during this task.
