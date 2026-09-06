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
