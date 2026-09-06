# ADR-0048: Repeat evidence screening with manipulation checks

- Date: 2026-09-06
- Status: Accepted for one newly authorized experiment
- Owner: Experiment tooling; no production Discussion change

## Decision

The Owner authorizes QA-074 after QA-073's offline reader repair. Run nine fresh
Finalizer sessions in order A/B/C, B/C/A, C/A/B, with no retry, extra contributor
generation, replacement slot or reuse of QA-072 answers. Preserve the diagnostic
Task, Criteria, contributions, four original source excerpts, neutral common
instruction and C rule. Only experiment identity and Run identities change.
The historical Task/Room/criterion IDs remain replay identities, not live
Central records. The existing owner excerpt authority is joined with the new
experiment and Run; an old grant cannot authorize a new Run.

Freeze the repaired reader, CLI executable, requested model, common settings,
dependency lock, generated instruction, catalog definition, scoring guide and
code before invocation. A has no reader; B adds the same fixed-source reader as
C; C alone appends the existing all-source checking rule. No correct answer,
preferred contributor or additional source selection is introduced.

## Manipulation and interpretation

Record setup, returned evidence, Run outcome and content as separate dimensions:

- A: reader configuration/catalog absent, no grant, zero source returns.
- B: reader catalog observed and matching, valid source grant, unchanged A
  instruction. Reading is optional; not reading is not a setup or Run failure.
- C: B's catalog/grant plus exact frozen evidence-use instruction. Separately
  check full coverage of all four sources before its final answer. Combine
  authorized returned byte ranges without inventing unread bytes.

The experiment-wide exposure gate requires at least one valid reader return.
Zero returns means `manipulation_failed`: preserve answers and diagnostics but
do not grade them as evidence of Access/Use quality. Positive returns alone do
not validate every comparison. Q1 requires actual B returns; Q2 requires C's
required reading before its answer. Compare only newly executed arms and show
all three repetitions, including failed or incomplete ones. Do not select only
the successful runs. Setup failures, invalid Runs or partial exposures prevent
a stable three-repetition causal interpretation for the affected comparison.

Reader receipts prove server-returned bytes, not model receipt, understanding
or claim correctness. Live CLI catalog listing is observable; the actual
provider-side catalog remains unobserved. Do not replace these distinctions
with the model's claims about tool availability.

Grade item-level correction, preservation, unsupported additions, uncertainty
and deliverables separately, then join evidence-use compliance, source results
and Run/time. No net score, grading-model call or production acceptance gate.
All-wrong does not isolate synthesis; all-correct means the old error did not
reproduce. Stable patterns support only this diagnostic case. A new independent
case, Targeted Review or any further model invocation needs a separate scope.

## Compatibility, authority and validation

Reuse the QA-073 runtime, reader and diagnostics, existing replay renderer,
Result projection and receipt schema. Add only a new bounded admission journal,
freeze and offline manipulation auditor. QA-072 artifacts and its consumed
plan remain immutable. No production scheduling, storage, completion policy,
participant selection, tools, credentials or authority expansion is granted.

Before execution, commit inputs and pass source/identity, stale pin, cross-Run,
missing catalog, optional B read, C range coverage, zero-return gate, failed Run
and one-use nine-slot tests plus the actual CLI loopback suite. Record execution
and audit evidence in [QA-074](../acceptance/qa-074-evidence-access-use.md).
