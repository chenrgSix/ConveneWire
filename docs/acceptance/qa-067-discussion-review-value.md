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

The task packet and rubric are frozen before model execution. Results, source
hashes, verification commands and cleanup observations will be appended here
after they exist. Historical QA-065 results are neither rewritten nor pooled
with this new task set.
