# QA-070 Complex task comparison

## Delivered evidence

The [Chinese comparison and task evaluation](qa-070-complex-discussion-results.md)
retains every scheduled arm, all nine final answers and criterion-level reasons.
Twelve original arms were each attempted once using 22 actual invocations/Runs:
19 Runs completed and three failed. There are three complete pairs, three
unpaired answers and three failed arms, not six complete pairs. Both real plans
are consumed. No retry, Discussion removal or further model call is authorized.

Across complete pairs, Single scores 45/60 with three Runs and 140.228 seconds;
Discussion scores 22/60 with nine Runs and 202.479 seconds. All nine delivered
answers fail the frozen critical acceptance gate. These coverage scores do not
make an invalid migration plan safe, establish user success rates or isolate
orchestration from the experiment's split evidence and contribution compression.
See the full report before interpreting the totals.

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

## Initial real execution and unstarted remainder

The initial batch used six invocations at clean source `20bfdab` and stopped at
its first failure, as declared. The [raw report](evidence/qa-070-complex-initial-2026-09-06.json)
has SHA-256 `fa57b0eb46ddbbc1a1c7e5a22088f66a442c6dd9ccd27ec0a4eeb2159f3d5df8`.
Review repetition 1 completed both arms. Incident repetition 1's Solver
reported `codex.list_mcp_resources`, which the fixed-reader experiment does not
permit; it read no assigned source. Reviewer completed four reads, but no
Finalizer was created. The failed Discussion has no final answer and is
unscored. Its completed contribution is not substituted for a final. This
is observed tool-use failure, not evidence that Discussion produced a wrong
final answer or that a specific production defect has been established.
The owned root `convene-wire-test-run-urtkkt` is physically absent.

The initial plan is consumed. The Owner's request to test the fixed complex
tasks still covers the never-started arms within the announced 24-call cap.
The [remainder plan](fixtures/qa-070-complex-remaining.json) pins the initial
report and excludes every started `(case, repetition, arm)`, including the
failed arm. It contains nine never-started arms, at most 17 new calls and 23
including the first six. No retry, new task, new model, source, rubric or
tool permission is added. The remaining model-work deadline is 1667 seconds,
deducting the rounded-up 132.480 seconds of initial arm elapsed time from the
original 1800-second allowance. It does not reset the phase budget.

Before resuming, failure handling for this separate remainder is made explicit:
retain a failed scheduled arm and proceed to the next never-started arm, without
retrying the failure. Setup, deadline, quota or observation failures still stop
execution. This changes batch scheduling only; tool rejection and answer
classification remain unchanged. It prevents one failed call from discarding
the rest of the already requested comparison. A synthetic first-arm failure
must prove eight later arms still run exactly once. A completed remainder can
provide at most five complete pairs and one unpaired Single answer; it cannot
retroactively make this a six-complete-pair study. Final reporting must include
the missing Discussion and all failures, rather than selecting only successes.

The remainder passed all 34 benchmark checks, including a complete 17-Run
synthetic remainder and a first-arm failure followed by eight exactly-once
successful arms. The root `convene-wire-test-run-fXyHQJ` is physically absent;
397-file documentation lint and whitespace checks pass. Tool permissions and
installed-CLI configuration are unchanged from the two passing loopback checks.

## Final execution and evidence integrity

The separately pinned remainder ran at clean source `c017243` and processed all
nine never-started arms, using 16 new calls. Its
[raw report](evidence/qa-070-complex-remaining-2026-09-06.json) has SHA-256
`f2536e54caf2ff33b6ea8db0ec3c56eacbe70d06efb0032f92219781073a2a23`.
Planning repetition 1 Discussion and review repetition 2 Single used disallowed
`list_mcp_resources` tools and failed; all later scheduled arms still ran once.
Both failed invocations had read their full assigned sources, unlike the
initial failure. All three failed CLI receipts exited zero without timing out;
the bounded adapter rejected unauthorized tool use. These failures remain
unscored and do not directly measure ordinary production reliability. The
remainder's zero process exit means its schedule finished, not that all Runs
succeeded; its report explicitly retains the arm failures.

The [separate review](evidence/qa-070-complex-review-2026-09-06.json) has SHA-256
`cd2509cb8b6975e70ccff7ad45caf9a4bade090069cd8a977c089ccd26b82a14`.
It binds nine grades to original result indices and final-answer hashes while
leaving both raw reports, answer strings and original null grade fields intact.
The [readable answer export](evidence/qa-070-complex-answers-2026-09-06.txt) has
SHA-256 `de6395524dbca4e35cf5477f7575c9e50dac3bd5809b929eb4e504af1c7308ad`.
The text export strips only line-end whitespace for repository formatting;
its per-answer hashes refer to the unchanged original strings in raw JSON.

Offline integrity checks verified raw capture byte equality, the unchanged
packet, 21 initial and 23 remainder source pins against their own execution
commits, all 12 task-input hashes, exactly-once arm identity, and every accepted
read's ID/digest/role scope. All four completed Finalizers received both entire
contributions in retained Central instructions, with completed Run/output IDs
rejoined. Source facts omitted from a contribution remain distinct from facts
delivered in full but ignored by finalization. Full Bridge-projected stdin is
not retained, so its hash must not be equated to Central instruction bytes.
Final answer ownership was checked during execution by the pinned helper;
there is no fresh database verification after physical cleanup.

Fifteen successful invocations read all assigned documents; four successful
Finalizers used the accepted transcript without new reads. All nine finals are
within 900 approximate whitespace-separated words. Incident repetition 2's
Reviewer contribution is about 676 words and planning repetition 2's Solver
contribution about 650, above the requested 600; both remained fully present.
This deviation is disclosed without adding a post-hoc grading penalty.

Whole-phase arm elapsed time sums to 629.139 seconds, including 122.343 seconds
and five Runs in failed arms, and 164.089 seconds and five Runs in unpaired
successful arms. It is not total project wall time or provider compute time.
Both real owned roots, `convene-wire-test-run-urtkkt` and
`convene-wire-test-run-BLCmCo`, are physically absent. All available finals have
been reviewed; the explicit bounded-failure completion condition applies.

## Closure checks

After consuming both plans, `npm run test:discussion-complex` passed all eight
provider-free checks, including original traversal, remainder traversal and
failure-followed-by-continuation. The full 34-check benchmark preflight and two
installed-CLI loopback checks remain the unchanged-code baseline above.
Both real entrypoints were also exercised with an empty executable PATH:
each rejected its consumed manifest before Runtime setup, with every retained
real report unchanged and no provider invocation. The two closure roots,
`convene-wire-test-run-VPKM7m` and `convene-wire-test-run-boi677`, and all five
earlier owned roots were physically checked absent. All 398 maintained Markdown
files and whitespace checks pass. The module, usage guide and command guidance
now describe the completed evidence and consumed admission boundary; TASKS.md
alone records delivery status.
