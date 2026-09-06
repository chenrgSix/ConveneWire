# QA-072: Evidence Access / Evidence Use mechanism screening

## Frozen objective

[ADR-0047](../adr/0047-screen-evidence-access-and-use.md) authorizes at most nine
Finalizer invocations for QA-069's Windows diagnosis. Order: A/B/C, B/C/A,
C/A/B. Contributors are replayed verbatim. Current code generates A's baseline;
the old final answer is never used as a baseline result. All four original
source excerpts are included; C must check all four without answer hints.

## Acceptance

Before the first model invocation, commit the exact fixture, neutral Task
criteria, source/version authorization mapping, receipt schema, common base
instruction, requested model/configuration, output bounds, source-use rule,
item-level scoring guide and interpretation rules. Independently verify source
hashes against pinned Git excerpts and retained contribution bytes against the
historical report. Reject changed pins or consumed execution plans.

Provider-free tests must cover cross-Run/Task/Room/authority rejection, stale
revision and digest, range limits, precise returned-byte receipts, A's denied
access, B/C parity, current instruction generation, order and nine-slot cap.
Only then execute the new bounded plan. Preserve all attempted outcomes,
failures, returns and elapsed times, without retries or per-answer prompt edits.
Review each output separately for the eight dimensions in ADR-0047 and record
the limits of the conclusions. Confirm owned temporary-resource cleanup.

## Production baseline gap

The current evidence-reference resolver checks object existence and Task/Room
scope. `verifiedEvidenceRefs` is neither truth validation nor a read grant.
QA-071's Result evidence index carries structured source identities and exact
candidate-verification associations, but no owner-authorized source reader.
The QA-069 reader maps legacy excerpt IDs to preselected workspace bytes; its
receipts lack Run/revision/range/return bindings. QA-072's reader and receipt
contract are experiment-only. They confer no production access capability.

## Frozen inputs and minimal treatment delta

- [Fixture](fixtures/qa-072-evidence-access-use.json): historical packet/report
  SHA-256, original answer indexes 0/1 from Windows Discussion result 3,
  Task/Room, neutral criteria, progress, all four source pins, common text,
  C's requirement, model/bounds and the exact nine-slot sequence.
- [Scoring guide](fixtures/qa-072-scoring.json): private item definitions and
  interpretation; never materialized for the model or reader.
- [Read receipt schema](fixtures/qa-072-read-receipt.schema.json): closed local
  experiment contract, not a new shared production wire schema.
- [Frozen base instruction](fixtures/qa-072-base-instruction.txt) and
  [freeze manifest](fixtures/qa-072-freeze.json): generated instruction and code,
  fixture, scoring, runtime and dependency identity checked before admission.

| Arm | Base instruction | Registered source reader | Additional text |
| --- | --- | --- | --- |
| A | Current `DiscussionEvidenceService.buildInstruction` | None | None |
| B | Byte-identical to A | Fixed authorized four-source manifest | None |
| C | Byte-identical prefix to B | Identical reader/scopes to B | Frozen all-source checking rule |

The replay adapter supplies the existing renderer with accepted prior Message
records and the existing no-Result criterion projection shape. The historical
contributors did not emit Results, so the index truthfully reports two accepted
Runs without offered current Results; no structured claims are fabricated.
This is a Finalizer input/runtime experiment, not a Server/Bridge scheduling E2E.

A is a fresh current-code, contribution-only baseline for this normalized
fixture, not a byte-for-byte historical invocation. The historical task's
experiment-wide mandatory reading instruction is replaced in **all** arms by
neutral optional-access wording; otherwise B would already contain C's
intervention. The original diagnostic task and participant answers remain
verbatim. Four neutral required criteria express that same task. All arms see
identical source metadata and preserved open questions. This common context
can itself change historical behavior; A's rerun measures that baseline and
all-correct means no demonstrated intervention gain.

## Read authorization and receipt semantics

An owner-authored bundle maps each legacy ID to its original Git commit, path,
source line range, whole-file hash, excerpt hash and allowed excerpt range.
The model supplies only `evidenceRef`, exact `revision`, and optional `range`.
It cannot supply a path, URL, Run, Task, Room or authority. The host separately
binds grants to an active experiment Run, expiration and grant digest. A has no
reader or grant. B/C receive the same source scopes; distinct Run IDs and
expiration times are operational bindings, not different evidence.

Ranges use zero-based UTF-8 byte offsets within the excerpt, with exclusive
end; omitted range requests the full authorized excerpt. The reader rejects
scope/version/digest mismatches and out-of-scope or split-character ranges.
Returned content is capped at 8,192 bytes and never splits a UTF-8 character.
All four actual excerpts fit without truncation. Eight read attempts are
permitted per invocation. Repeated/rejected calls also consume that budget;
limit denials are receipted and the adapter stops excessive tool use.

`sourceContentSha256` pins the complete authorized excerpt;
`contentSha256` hashes only the bytes actually returned. `returnedRange`,
`returnedBytes` and `truncated` describe those bytes. A failure has no content
hash or returned range, zero bytes and a stable failure reason. Invalid unknown
selectors are not echoed as arbitrary strings. Every successful tool return
contains the receipt and exact content retained by the harness. `observedAt`
is the server return observation, not a model-delivery acknowledgement. A
receipt establishes neither receipt by the model, comprehension, claim truth,
nor criterion acceptance. C compliance separately checks full source returns
before the final answer and substantive comparison in the answer.

## Execution and evaluation rules

The requested model is `gpt-5.4-mini`, reasoning effort `low`, one fresh ephemeral
CLI session per slot, at most 300 seconds per invocation. Shell, web, plugins,
memories, subagents and unrelated tools are disabled. Tool discovery grants no
source access. A/B share exact input bytes; C appends only its frozen rule.
The response instruction is fewer than 450 English words, with a 32,768-byte
retention limit. Word violations are recorded separately. These are common
output controls, not a claim of an enforced provider token cap or equal compute.
Provider-attested model identity and compute are unavailable. The nine-call
cap counts Finalizer CLI invocations, including failures, not internal API
transactions for tools or transport recovery. The harness never retries or
replaces a Finalizer; the installed CLI's built-in transport behavior is shared.

The retained report is created exclusively before first startup. Each slot is
reserved durably before spawning; interrupted or failed attempts consume their
slot. An existing report rejects another execution of this plan, including
incomplete runs. Source/fixture/code/runtime changes reject admission. There
is no automatic continuation. All attempted outputs and diagnostics are
retained without provider secrets or usage counters.

After all calls, grade anonymized answer exports before attaching treatment
labels. Answer wording can reveal reads, so this is limited evaluator blinding.
Use exact excerpts and source IDs for judgments. Two target errors, four
preservation items, three uncertainty items and four deliverables remain
separate; list unsupported additions individually. Receipt compliance, source
success/failure, Run status and elapsed time remain separate dimensions.
Never merge correction and destruction into a net score. No grade is Task or
Result acceptance. Interpret outcomes only using the frozen guide.

`npm run test:discussion-evidence-access` uses synthetic responses and an
installed CLI connected exclusively to an auth-free loopback provider.
`npm run bench:discussion-evidence-access` is the new, single-use authorized
plan. It is not a routine regression command or future execution permission.

## Pre-invocation verification

Eleven focused regressions pass, including all A/B/C paths through the actual
installed CLI against an auth-free loopback provider, real MCP restart/read
limits, grant/Run/Task/Room/authority/expiry fences, source/range checks,
exclusive admission, failed-answer retention, forbidden tools and timeout.
The 47 current Discussion orchestrator regressions also pass. Documentation
lint and whitespace checks pass. No external model call occurred during these
checks. All owned test roots were physically removed by their lifecycle wrapper.
The freeze pins 23 files; the shared rendered base is 11,683 UTF-8 bytes.

## Retained execution

The pre-invocation implementation/freeze commit is `edd19e0`. The new plan
consumed exactly nine reserved Finalizer sessions in the frozen order, without
retry or replacement. The wrapper completed and physically removed its owned
root. Wrapper success means the planned attempts were recorded; it does not
mean all Runs or answers passed.

- [Original report](evidence/qa-072-access-use-2026-09-06.json): all nine
  reservations, configurations/grants, retained texts, Run outcomes and times.
- [Item-level masked review](evidence/qa-072-blind-assessment-2026-09-06.json):
  exact answer hashes, quoted spans, separate judgments and evaluation limits.
- [Joined analysis](evidence/qa-072-analysis-2026-09-06.json): treatment labels,
  all eight dimensions and explicit inconclusive Q1/Q2 verdicts.

| Slot | Arm / repetition | Run | Source returns | Time (seconds) | T1 / T2 |
| --- | --- | --- | --- | --- | --- |
| 1 | A / 1 | completed | 0 | 17.288 | fail / partial |
| 2 | B / 1 | completed | 0 | 16.838 | fail / pass |
| 3 | C / 1 | completed | 0 | 24.200 | fail / pass |
| 4 | B / 2 | completed | 0 | 18.374 | fail / partial |
| 5 | C / 2 | failed | 0 | 9.887 | unscorable / unscorable |
| 6 | A / 2 | completed | 0 | 16.066 | fail / pass |
| 7 | C / 3 | failed | 0 | 9.957 | unscorable / unscorable |
| 8 | A / 3 | completed | 0 | 17.328 | fail / partial |
| 9 | B / 3 | completed | 0 | 17.487 | fail / partial |

T1 is the missing/unknown `executableAvailable` body discrepancy. T2 is retention
of CLI's independent execute-bit rejection and Console's pre-probe readiness
check. Neither dimension is a total score. All seven substantive answers leave
T1 unresolved; T2 varies as shown. The two failed C attempts retain only
progress statements about finding tools/resources, not diagnostic answers or
reasonable refusals. The raw adapter field `finalAnswer` holds the last Agent
message even on failure; the assessment labels these `progress_only` and does
not misrepresent them as delivered finals.

| Arm | Correct content fully retained, per repetition | New unsupported assertions | Uncertainty | Deliverable coverage |
| --- | --- | --- | --- | --- |
| A | 2/4, 3/4, 2/4; other items partial | 1, 2, 0 | U1 pass/fail/pass; U2 all pass; U3 partial/fail/partial | All three answers: D1-D3 partial, D4 pass |
| B | 3/4, 2/4, 2/4; other items partial | 0, 0, 0 | U1 fail/pass/partial; U2 all pass; U3 all partial | All three answers: D1-D3 partial, D4 pass |
| C | 3/4, unscorable, unscorable | 0, unscorable, unscorable | C1: U1 fail, U2 pass, U3 partial; others unscorable | C1: D1-D3 partial, D4 pass; others unscorable |

The A additions include asserting an existing shared availability policy and
strengthening CLI's observed non-directory check into a regular-file predicate;
A2 also promotes proposed launcher forms into an evidence-backed minimum.
Broad proposed OS/PATHEXT acceptance and Unix extension rejection are recorded
as policy concerns separately from new asserted facts. None of the substantive
answers identifies known-directory discovery's `.exe`-only candidates. All
seven substantive answers obey the common word instruction (257–301 words).

## Evidence-use and causal limits

A has no new reader and evidence-use compliance is not applicable. All three B
sessions have the authorized reader configuration but make no recorded read;
optional access is unused. C1 acknowledges inability to read but makes no
reader call, so it does not comply with the all-source requirement. C2/C3 end
when the adapter observes an MCP tool outside its permitted identity. There
are **zero successful, denied or failed calls at the evidence reader itself**;
these two failures are Runtime/tool-boundary failures, not failed source reads.
No read receipts are fabricated for an unattempted read.

The decisive manipulation check is therefore unresolved: the experiment does
not establish that the live model correctly discovered its configured evidence
reader. The offline CLI test proves the transport can serve an explicitly
selected reader; its simulated provider deliberately chooses that tool. It
cannot prove live-model exposure/discovery or actual use. The live adapter
records `mcp_tool_call` and `unapproved_tool`, but does not retain the rejected
started call's server/tool identity. We cannot identify that rejected tool or
separate discovery failure from model choice using the retained telemetry.
The model's statements that the reader was unavailable are not independent
proof of tool availability. These limitations prevent a unique causal claim.

Q1 and Q2 are **inconclusive**. The shared baseline reproduces the missing-body
problem, but there is no source return with which to test the intended access
or evidence-use mechanism. Do not call B ineffective, infer a synthesis-only
bottleneck, count the failed C attempts as reasonable refusals, or infer a
product-quality improvement. Total attempted elapsed times are A 50.682 s,
B 52.699 s and C 44.044 s; C's early failures make the last number unsuitable
as an efficiency comparison.

The justified follow-up is an offline diagnostic of tool advertisement,
discovery and the rejected tool identity, plus explicit separation of progress
messages from terminal answers. It must preserve this report and the frozen
implementation. No extra external-model call, amended fixture, same-plan rerun
or independent new case is authorized by the consumed QA-072 plan. Targeted
Review and all other ADR scope exclusions remain outside this stage.

## Post-execution verification

Two read-only audit checks pass: all nine results match the 23 frozen pins,
exact treatment instructions, source grants and original answer hashes; every
item quote exists verbatim and masked/unmasked judgments agree. Run them with
`node scripts/test/run-with-temp-root.mjs -- node --test scripts/bench/evidence-access-report.test.mjs`.
The report is never rewritten by this audit. Production Discussion sources,
contracts, storage and policy files retain their pre-experiment bytes.
Final physical inspection confirms all eleven named owned test roots from this
stage are absent; the three task-owned fixture/grading helper files were also
removed. No unrelated temporary state was removed.
