# QA-070 Complex task comparison

## Authority and question

On 2026-09-06 the Owner requested harder tasks, another real comparison and a
detailed evaluation of task results. This authorizes a new bounded experiment;
it does not reopen any consumed QA-069 plan or authorize Discussion removal.
ADR-0045's maintenance freeze remains; hold the proposed retirement decision
until this new evidence is reviewed. TASKS.md alone tracks delivery state.

Test whether the earlier small tasks understated the value of the existing
two-contributor plus Reviewer Finalizer Discussion. Use three new constructed
engineering cases: cross-module code review, distributed incident reconstruction,
and constrained migration/capacity planning. These are synthetic engineering
challenges, not real customer incidents or additional historical replay. The
packet contains only invented code, records and requirements, with no account,
credential, private repository source or customer input.

## Frozen design

`fixtures/qa-070-complex-cases.json` owns all task text, eight documents per case,
source hashes, disjoint Solver/Reviewer assignments and ten two-point criteria
per case. Every task requires joining multiple documents and producing concrete
findings, calculations, tests or a feasible plan. Facts include safe controls,
misleading hypotheses and unresolved states, so finding more alleged defects
does not automatically score better. The rubric and reference answers never
enter the model-readable workspaces.

Single Agent can read the exact union of both contributors' evidence. Both arms
receive the same task, production review checklist and final-answer allowance
(900 English words). Ordinary Discussion contributions are limited to 600 words
each to fit the production finalization context. Each invocation may make eight
fixed-ID reads. The model has no shell, arbitrary paths, browser or other tools.
The existing production Discussion policy, prompts and selector are unchanged.
Different role/context framing and split evidence remain treatment differences.

Run each case twice in fresh ephemeral CLI conversations: six complete pairs,
12 final answers, at most 24 CLI invocations and product Runs (6 Single, 18
Discussion). Reverse arm order in the second repetition; record invocation
identity so repeats cannot be confused with retries. Request the unchanged
gpt-5.4-mini model at low effort. Provider-attested model identity remains
unavailable. Stop later attempts on the first Runtime failure, retain its
evidence and never automatically retry. A 300-second process cap, 600-second
Discussion limit and 30-minute phase model-work deadline bound the larger task.
This new authorization is consumed when the invocation completes or stops.

## Evaluation and delivery

Freeze each criterion's full-credit and partial-credit requirements before real
calls. Score 2 for full coverage, 1 for the specified partial coverage and 0
otherwise. A task result is acceptable for this packet only if it scores at
least 16/20 and fully covers every marked critical criterion. This is a
diagnostic/plan acceptance judgment; no proposed code or production change is
executed. Runtime failure without a delivered final is unscored, never 0/20.

Review all available finals directly, without an additional judge model. Label
the assessment as non-blind Codex task-agent review, not independent human
evaluation. Retain per-criterion reasons, exact final-answer hashes, material
errors, unsupported claims, useful contributor evidence, omissions introduced
by finalization and quality differences between repetitions. Check whether
both complete contributions reach each Finalizer's retained instruction;
record any truncation instead of assuming context delivery.

Deliver a Chinese comparison report with task definitions/difficulty, raw answers,
per-task and per-repetition scores, acceptance outcomes, actual Run states,
arm elapsed times and failed attempts. Do not pool scores with QA-065/067/068/069,
measure token/money, fabricate user rework rates, or equate longer answers and
more reads with better work. Two repetitions and one requested model still do
not establish a population success rate. Update usage guidance according to
the results, including when evidence is mixed or contradicts earlier advice.

Completion requires all six paired results or an explicitly retained bounded
execution failure, review of every available final, faithful incomplete-result
labels, relevant synthetic/adapter/packet checks, source/input/read identity,
physical cleanup, updated documentation and a commit. An incomplete batch
cannot be called a completed six-pair comparison.

## Preflight evidence

Task packet and grading requirements were committed at `ebe5e74` before any
real answer. Packet SHA-256 is
`a20930527f86484503764dbd17a79117910a71830c21881e64ce6ef45c63043e`.
The separate plan pins these bytes and refuses absent/consumed authorization.
The live entrypoint additionally requires committed clean source. The shared
reader accepts eight immutable IDs at most; the adapter adds only the bounded
24-invocation quota and keeps the same model, low effort and tool restrictions.

`npm run test:discussion-benchmark` passed all 31 checks, retaining the legacy,
review, continuation and historical workspace flows and adding packet/reference
checks plus the complete new 24-Run synthetic traversal. Two explicit installed
Codex CLI loopback checks passed with no external model. Both owned roots,
`convene-wire-test-run-ApaCSG` and `convene-wire-test-run-hhXxf1`, are physically
absent. All 397 maintained Markdown files and whitespace checks pass.

The reference calculation proves at least one feasible planning solution:
relative intervals A 0–6, C 0–4, E 4–7, B 6–11, D 7–11, F 11–13 satisfy
memory, concurrency and precedence; total window is 21 minutes. This is a
reference example, not a requirement to reproduce this exact schedule or a
claim that 13 minutes is globally optimal. The fixed rubric accepts any
auditable feasible job schedule within 14 minutes. Backlog is 4800 jobs, peak
queue delay about 26.667 seconds and drain time 120 seconds. These references
remain outside model inputs, together with all full/partial-credit criteria.
