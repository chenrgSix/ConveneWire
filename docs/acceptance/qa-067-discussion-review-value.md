# QA-067 Finalizer review and balanced Discussion comparison

## Source of truth and frozen acceptance

[ADR-0044](../adr/0044-review-final-answers-and-test-discussion-value.md) defines
the Owner-authorized behavior, review checklist and experiment limits.
The machine-readable [task packet](fixtures/qa-067-discussion-cases.json) owns
the exact six task payloads, three fixed replay inputs and scoring criteria.
The runner loads this document directly; there is no duplicate task list in
code. Delivery state is recorded only in TASKS.md.

Acceptance requires production Reviewer/primary/ordinal finalizers to receive
the documented checklist, retain bounded instructions and execution-plan and
assessment boundaries, and leave ordinary parallel contribution semantics
unchanged. Focused regressions, workspace build, documentation validation and
the isolated synthetic Server/Bridge path must pass before real invocation.

For each fixed replay, compare legacy versus revised task text with identical
facts and contributions, alternate pair order, retain every answer and score
each declared criterion. For each of the six balanced tasks, compare one
ordinary Run with a two-member Discussion plus finalizer; keep inputs,
review requirements, output limit, runtime/model and available information
matched. Role/context wrappers remain part of the product treatment. Record
runtime success separately from rubric coverage and full-task success.

## Data transfer and execution ceiling

The command is `npm run bench:discussion-review`. Its required offline gate is
`npm run test:discussion-benchmark`; normal `npm test` invokes only synthetic
model executables. Real review-suite execution requires a clean committed tree.

The outgoing payload is limited to the fixed facts/contributions in the linked
packet, a common English answer-under-350-words/no-tools instruction, the
documented review checklist, generated isolated Discussion framing and earlier
answers from that task. Rubrics are retained locally and are not prompt input.
No existing Team, customer data or repository checkout is supplied. The existing
Codex account authenticates the CLI; credentials are not prompt or report data.

The requested destination/model remains OpenAI gpt-5.4-mini with low effort.
The combined cap is 30 invocations: six fixed replay calls and 24 product Runs,
with no automatic retries, 300 seconds per invocation and 20 minutes of model
work overall. The original QA-065 command retains its 12-call cap. Actual
provider model identity is reported only if observed; token and monetary
accounting remain removed. Successful execution does not imply rubric success.

## Interpretation rules

The review must retain corrections, omissions and harmful changes separately.
A score describes coverage of the predeclared items, not an estimate of real
user success. Reviewer self-reported approval is not a grade. Explicitly label
whether answer review is independent and blinded. Record incomplete or failed
attempts instead of discarding them.

The offline fallback probe reports only deterministic member selection and
required-expertise coverage. It does not simulate model answers or prove that
broad or Top-N improves quality. Discussion startup recommendations remain
advice based on the observed sample and clearly labeled hypotheses. This
iteration adds no automatic routing or startup authority.

## Execution evidence

The task packet and rubric were frozen before model execution. Results, source
hashes, verification commands and cleanup observations are retained below.
Historical QA-065 results are neither rewritten nor pooled with this new task
set.

Production prompt verification passes 78 Discussion checks and Server build.
Tests bind the exact ADR checklist, all six output modes, actual Reviewer and
primary finalizers, existing ordinal selection, bounded/truncated instructions,
plan-proposal restrictions and assessment framing. Ordinary contribution Runs
do not acquire the finalization checklist. The owned test root was removed.
These checks establish instruction delivery and compatibility, not model quality.

Before real execution, the offline benchmark gate passed nine checks:
four adapter checks, three document-packet checks, the original 12-Run fixture
and the new six-replay/24-Run fixture. Both use real isolated Server/Bridge
components with synthetic responses, and the shared owned root is physically
removed. Quota exhaustion at 12/30 and unsupported limits start no provider
process. The packet tests verify pair identity, balanced categories, no rubric
leakage and the offline fallback coverage result. Full workspace build and
392 maintained Markdown files pass. These are synthetic/runtime checks only.

The real invocation exposed a report bug on a failed Finalizer: the source
runner used the last Agent message as `finalAnswer`, which was actually the
Reviewer's contribution. The repaired runner requires an exact completed
finalization Turn, completed Run and matching author-bound output Message.
Missing or failed finalization produces null, never a substitute contribution.
Two added regressions cover failure, absent output, mismatched author, unknown
Run outcome and later unrelated messages. The final offline gate passes eleven
checks, including both complete synthetic suites, and removes its owned root.
This report repair does not change or rerun the real model invocation.

## Retained real result

The [reviewed report](evidence/qa-067-discussion-review-2026-09-06.json) binds
clean source `6e0d371a6bda4950b7172f1ae44310c12d91a474`, requested
`gpt-5.4-mini` at low effort, CLI `0.153.3`, the committed task packet and
instruction/source hashes. It retains all available raw answers and inputs.
The original report remains under ignored `var/discussion-benchmark/`; its
SHA-256 is `483116541d3070f3a90e64d24f4db555dfe271207e0b520b8d511a0fa819f201`.
The reviewed copy documents the single report correction explicitly: the
misclassified contribution is retained separately and the failed final answer
is null. No model answer text is rewritten.

The Codex task agent reviewed each available final answer directly against
the predeclared rubric. Review was not blind or independent human review, and
used no extra model calls. Runtime completion and rubric coverage remain
separate. The failed Finalizer's contribution messages are not scored as its
final answer. No unstarted arm is assigned a score.

| Fixed replay | Legacy criteria passed | Revised criteria passed | Observation |
| --- | --- | --- | --- |
| Repeated candidate-boundary error | 1/3 | 3/3 | Revised prompt rejects the repeated nonparticipant claim and supplies the requested fallback tests |
| Omitted Discussion wall duration | 3/3 | 3/3 | Both state 30 seconds and preserve terminal wall time |
| Correct timing control | 3/3 | 3/3 | Both preserve 17/25-second calculations and the deadline decision |
| Total | 7/9 | 9/9 | Two added covered items in one fixed case; not a general improvement estimate |

Legacy replay wall time totals 49.026 seconds; revised replay wall time totals
51.590 seconds. These are six direct Runtime invocations, not six Discussion
Runs. A limitation remains even where rubric items pass: the revised wall-time
answer labels an already-correct contribution as an "Important correction" and
overstates what Discussion timestamps establish about execution duration. Both
answers also attribute retained Run states to terminalAt without separate
timestamp evidence. These observations are recorded outside the fixed scoring
items; 9/9 coverage is not a claim that the revised answers contain no errors.

| Balanced task | Single Agent | Discussion |
| --- | --- | --- |
| Grant review across implementation/security/operations | 1 completed Run; 16.457 s; 4/4 criteria | 3 completed Runs; 36.837 s; 4/4 criteria |
| Simple selector review | Not started after failure | 2 completed contribution Runs, 1 outcome_unknown Finalizer; 317.573 s; no final-answer score |
| Restart diagnosis across state/operations/user impact | Not started | Not started |
| Simple usage diagnosis | Not started | Not started |
| Transport comparison across security/operations/UX | Not started | Not started |
| Simple schedule comparison | Not started | Not started |

The Finalizer in the second balanced task remained working until approximately
the 300-second per-process ceiling and ended `outcome_unknown`. The retained
evidence cannot locate the delay inside the provider, network or CLI. The
predeclared first-failure rule stopped all later attempts; no retry occurred.
The invocation used 13 of 30 reserved slots: six completed replays and seven
product Runs, of which six completed and one had unknown outcome. Nine balanced
arms were never started. The command exited unsuccessfully after 481.6 seconds
including setup. That runtime failure is part of the result, not a passing
live-suite claim. The bounded experiment is closed by its declared stop rule;
the complete six-pair quality comparison remains unmeasured.

Only one balanced pair is complete. It shows equal fixed-rubric coverage with
three versus one Run and 36.837 versus 16.457 seconds. This cannot establish a
cross-category benefit, predict user task success or show that all multi-domain
tasks need Discussion. No results are pooled with the different QA-065 prompts.

## Fallback coverage and documentation outcome

The two document-owned probes call the actual unmatched production selector
and compare it with an isolated ordinal Top-N alternative retaining Reviewer.
With Implementation, Docs, Security, Reviewer in that order and limit 2, broad
selection retains all four, while Top-N selects Implementation and Reviewer
and misses the fixture's required Security expertise. When Security is first,
Top-N retains Security and Reviewer. Both retain the required Reviewer.
The required-expertise labels are fixture premises, not observed model needs.
No model or Run was executed by these probes, and no answer quality was measured.
They demonstrate order-sensitive coverage, not a reason to change production
fallback. The live Broad/Top-N quality A/B remains a future evidence gate.

The [Discussion usage guide](../discussion-usage-guide.md) separates the
observed results from advisory startup criteria and future hypotheses. It
preserves explicit user choice and contains no automatic startup or routing
policy. The production broad fallback, finalizer order and ADR-0043 metric
removal remain unchanged.

The live runner reported cleanup, its exact owned temporary root
`/private/tmp/convene-wire-test-run-XUu7Uc` is physically absent, and a read-only
process check found no remaining benchmark processes. The final synthetic root
is also physically absent. Original and reviewed reports are retained without
keeping temporary Team data, credentials or Runtime processes.

Final consistency checks verify the original report digest, all eight source
hashes against the recorded commit, all nine attempted prompt hashes, rubric
decisions, Run counts and the declared-only report transformation. The frozen
packet, historical QA-065 evidence and ADR-0043 remain unchanged. All 393
maintained Markdown files and whitespace checks pass after adding the guide.
