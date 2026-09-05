# ADR-0044: Review final answers and test Discussion value

- Status: Accepted
- Date: 2026-09-06
- Amends: ADR-0042 finalization instructions and bounded evaluation

## Decision and authority

The Owner authorized this iteration after reviewing QA-065 and required the
documentation to define the implementation and acceptance facts. This ADR owns
scope; the Discussion module owns behavior; QA-067 owns fixed experimental
inputs and acceptance. TASKS.md is the only delivery-state register.

Every newly generated finalization instruction, including Reviewer, primary
and ordinal fallback finalizers, requires explicit fact/constraint checking,
coverage of requested deliverables, evidence-supported corrections, retention
of correct content and explicit unresolved uncertainty. Repeated participant
agreement is not evidence. The instruction does not demand a visible reasoning
trace or an invented defect. Ordinary members remain independent parallel
contributors; the Reviewer is not told to inspect unavailable same-Wave replies.

Existing Run instructions, selection snapshots, accepted quorum evidence,
20,000-code-point instruction limits, assessment envelopes and decision-record
proposal authority remain unchanged. No extra review Wave is added. Finalizer
selection remains eligible frozen Reviewer, Task primary, then frozen ordinal.

## Frozen review checklist

The following text is the authoritative checklist. A regression compares it
byte-for-byte with the exported production instruction used by the benchmark.

```text
Check the answer against the task's explicit facts, constraints and requested deliverables. Verify requested calculations and edge cases; fill supported omissions.
Treat participant claims as unverified: repetition or agreement is not evidence. Resolve disagreements only when the supplied evidence supports a resolution.
Correct claims contradicted by the supplied evidence, even when several participants repeat them. Preserve supported correct content; do not invent errors or changes merely to appear critical.
Distinguish established facts from assumptions. Keep unsupported conclusions and unresolved issues explicit instead of guessing.
Return the supported final answer, briefly noting material corrections or remaining uncertainty when relevant. Do not output an internal review transcript.
```

## Experiments

QA-067 first replays three documented, fixed contribution sets with the legacy
and revised finalization task text. The rest of each pair's input is identical.
These six direct Runtime invocations isolate the task-text change; they are
not six product Runs or full Discussion executions.

It then runs six new documented tasks through the real isolated Server/Bridge:
one multi-perspective and one simple control in each of code review, diagnosis
and solution comparison. Each task compares one ordinary Run with two parallel
contributions plus one finalizer. Both arms receive the same complete task
facts, review checklist, requested perspectives, model configuration and output
limit. Ordinary and Discussion role/context framing remains a product-treatment
difference. Labels describe intended task complexity, not a claim that only
multiple Agents can solve it. No facts or rubric answers are hidden from the
single-Agent arm, and rubric solutions are never sent to either arm.

The combined invocation uses at most 30 model processes (six replay calls plus
24 product Runs), 20 minutes of model work and 300 seconds per process. It uses
the existing signed-in Codex CLI with requested OpenAI gpt-5.4-mini, low effort,
ephemeral read-only empty workspaces and no tools. A shared atomic quota bounds
process creation. The first runtime failure stops all later attempts, with no
automatic retry. Synthetic validation cannot invoke a provider. ADR-0043's
removal of token and monetary metrics remains in force.

An offline Broad/Top-N coverage probe uses explicit missing-match fixtures and
keeps required Reviewers. It reports selected members and retained required
expertise only, not actual Run savings, answer quality or a live fallback A/B.
The production broad fallback stays unchanged pending representative evidence.

## Acceptance and conclusions

Reports retain source/input/instruction identity, raw final and intermediate
answers, actual product Run outcomes, replay invocation counts, wall time,
errors and per-criterion review evidence. Correction, preservation of correct
content and requested-item coverage are separate criteria. Do not replace
known failures with retries or tune the rubric after seeing answers. Revised
task wording gets a new identity; QA-065 evidence remains unchanged.

Fixed examples and one attempt per arm cannot establish population success
rates or general superiority. Prompt delivery tests do not prove answer
improvement. A non-blind task-agent review must be labeled as such. User-facing
Discussion guidance remains documented advice and preserves explicit user
choice; no automatic startup gate, router, embeddings, UI control, release or
deployment is included. Guidance must distinguish observed results from
hypotheses and state what a later representative experiment would need to show.
