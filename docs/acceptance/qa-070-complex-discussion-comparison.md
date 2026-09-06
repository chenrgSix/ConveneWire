# QA-070 Complex task comparison

## Result and evidence

The [detailed Chinese evaluation](qa-070-complex-discussion-results.md) owns
all task descriptions, scores, material errors and interpretation. Twelve
scheduled arms were each attempted once using 22 invocations/Runs: 19 Runs
completed and three failed, yielding nine final answers, three complete pairs
and three unpaired answers. All nine finals fail critical task acceptance.
The experiment is closed under its bounded-failure completion condition;
it is not a six-complete-pair study or evidence to remove Discussion.

The [separate review](evidence/qa-070-complex-review-2026-09-06.json) binds grades
to raw result indices and final-answer hashes. Complete original answers,
contributions, instructions, reads and Run states remain in the
[initial report](evidence/qa-070-complex-initial-2026-09-06.json) and
[remainder report](evidence/qa-070-complex-remaining-2026-09-06.json).
A duplicate text export is unnecessary; the raw reports are the answer source.

## Frozen design

The Owner requested harder tasks and detailed evaluation on 2026-09-06.
The [packet](fixtures/qa-070-complex-cases.json) was committed at `ebe5e74`
before model calls and remains unchanged. It contains three constructed
engineering cases, eight documents and ten 0/1/2-point criteria per case,
with two scheduled repetitions. Task acceptance requires at least 16/20 and
full credit on every critical criterion. Failed arms are unscored.

Request gpt-5.4-mini/low with no provider-attested identity. Both arms receive
the same task, production review checklist and 900-word final-answer allowance.
Single reads all eight sources. Solver and Reviewer each read four disjoint
sources; Reviewer Finalizer uses its four plus both accepted contributions.
This cannot isolate orchestration from evidence allocation/compression.
Ordinary contributions are limited to 600 words, with eight fixed-ID reads per
invocation and no shell, arbitrary files or other tools. Rubrics and reference
answers are excluded from model workspaces. Production policy is unchanged.

The original cap was 24 invocations, 300 seconds per process, 600 seconds per
Discussion and 1800 seconds of model-work allowance. Repetition two reverses
arm order. Each original arm was attempted once; none was retried. Grading is
non-blind Codex task-agent review without another judge call or independent
human evaluation. No generated repair or production change was executed.

## Execution closure

| Phase | Source | Calls | Outcome |
| --- | --- | --- | --- |
| Initial | `20bfdab` | 6 | Stopped at first failure as declared |
| Previously unstarted remainder | `c017243` | 16 | Processed all nine remaining arms, retaining two more failures |

The separately pinned remainder changed scheduling to retain failures and
continue only never-started arms within the original cap and remaining time
allowance. It did not change tools, task text, model, rubric or production
behavior. Its zero process exit means the schedule finished, not that all Runs
succeeded. Both the [initial plan](fixtures/qa-070-complex-plan.json) and
[remainder plan](fixtures/qa-070-complex-remaining.json) are consumed and bind
their reports. No unused capacity authorizes further calls.

## Verification

The final review retains raw report/packet hashes and the integrity audit:
21/23 source pins matched their own execution commits; all 12 task inputs,
exactly-once arm identities and accepted read IDs/digests/scopes were checked.
All four completed Finalizers received both entire contributions. Central
instructions and Bridge-projected stdin hashes are separate boundaries;
retained IDs do not constitute a new database query after physical cleanup.
Output-length deviations and missing/ignored facts are disclosed in the
[detailed evaluation](qa-070-complex-discussion-results.md).

The full 34-check benchmark preflight, two installed-CLI loopback checks and
eight complex-suite closure checks passed. Both consumed real entrypoints
rejected with an empty executable PATH before Runtime/report creation. Seven
owned roots were physically checked absent; no provider call was used for
these offline checks. Current commands are in
[the usage guide](../discussion-usage-guide.md#维护与后续验证).

Source reports and original null grading fields are unchanged. The separate
review and task report remain authoritative for results; Git preserves the
superseded operational narrative. TASKS.md alone tracks delivery status.
