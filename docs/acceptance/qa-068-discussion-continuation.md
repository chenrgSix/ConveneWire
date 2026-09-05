# QA-068 Complete the remaining balanced Discussion pairs

## Authority and fixed scope

The Owner requested continuation after reviewing QA-067's incomplete real
comparison. [ADR-0044](../adr/0044-review-final-answers-and-test-discussion-value.md)
continues to own the production prompt and evaluation boundaries. This record
owns the separately authorized continuation; TASKS.md alone tracks delivery.
Task wording, rubric and provider configuration remain fixed. The reproduced
Runtime defect and its necessary ADP-019 repair are recorded below.

The [continuation manifest](fixtures/qa-068-discussion-continuation.json) pins
the original task packet and reviewed evidence by SHA-256. It selects the five
cases without a complete successful pair. The successful grant-review pair
and all six fixed replays are reused from QA-067 without new calls. The failed
selector Discussion remains recorded there; this continuation starts both arms
of that case afresh and does not rewrite its failure into success.

## Execution and acceptance

The command is `npm run bench:discussion-continuation`. It requires a clean
committed tree and a passing `npm run test:discussion-benchmark` synthetic gate.
Its new atomic quota allows at most 20 model invocations, 300 seconds per
process and 20 minutes of model work. The first runtime failure stops later
attempts; there is no automatic retry. The requested model remains
`gpt-5.4-mini`, low effort, with the same empty read-only ephemeral workspace,
closed inputs, no tools and answer-length instruction as QA-067. Credentials
and existing Team data are never task input or report output. Token and
monetary metrics remain removed.

All five pairs use the original packet order and alternate arms according to
their original six-case ordinal. Each Single Agent receives the same complete
facts and review checklist as Discussion. A Discussion uses two contributions
and one Finalizer. Final-answer scoring requires completed finalization and
the exact author-bound output; contributions cannot replace failed output.

Retain new raw answers, source/input hashes, actual Run states, elapsed time,
errors and per-criterion review evidence. Review each answer against the
unchanged four-item rubric, labeling the non-blind Codex task-agent review.
Report any unsupported claims beyond those criteria separately. Do not change
scores or wording to obtain a preferred outcome.

Completion requires five complete new pairs plus the already completed pair,
with runtime completion distinguished from criterion coverage. If execution
fails, preserve incomplete evidence and leave the complete-comparison gate
open. A combined six-case table must identify which invocation supplied each
pair and retain the earlier failed attempt separately. This is continuation
across two invocation times, not an independent fresh six-case replication.

Update the usage guide from the completed evidence, preserving explicit user
choice and the production broad fallback. No automatic startup policy, routing
algorithm, live Broad/Top-N quality A/B, release or deployment is included.
Verify manifest/source/report consistency, relevant regressions, documentation
lint and physical cleanup before committing the result.

## Execution evidence

The manifest and acceptance were frozen before continuation model calls.
Results are retained below; prior QA-067 evidence remains immutable.

The preflight passes 14 checks: four adapter tests, seven packet/answer/
continuation tests and three complete synthetic Server/Bridge suites (legacy,
review and continuation). The new continuation executes exactly 20 synthetic
Runs in original arm order. Changed input/evidence pins, omitted cases, changed
model and expanded quota are rejected before Runtime setup; exhausted 12/20/30
quotas start no provider process. Its owned temporary root is physically absent.
All 394 maintained Markdown files and whitespace checks pass.

## Retained first continuation failure and repair

The [first raw continuation report](evidence/qa-068-continuation-attempt-1-2026-09-06.json)
retains clean source `196032b8877be460ea1806065f2e81bd4949e117`, three invocations
and the selector Discussion's unknown Finalizer outcome. The command stopped
at its first failure after 327.5 seconds; no later arm was started. Its owned
temporary root was removed. This failed attempt is never scored as a complete
pair or replaced by the next run.

A [read-only observation before cleanup](evidence/qa-068-finalizer-assessment-failure-2026-09-06.json)
establishes the local/central split. The Bridge retained the Finalizer reply
and local completion at 17:19:20 UTC, about 19 seconds after startup; Central
remained working at sequence 2. The reply's optional assessment contains
`recommendation: "stop"`, while the authoritative wire enum allows only
`continue`, `finish` and `wait_human`. The generated TypeScript validator rejects
that exact retained reply; changing only that enum to `finish` validates it.
This diagnostic comparison does not alter any stored answer or retry a write.
The following completion cannot bridge the missing reply sequence. Thus this
attempt's 300-second wait was not a model generation timeout. QA-067 lacks this
local observation, so its similar symptom alone does not establish the same cause.

ADP-019 validates optional assessment JSON against the existing generated Go
wire validator before emitting it. JSON decoding alone accepted unsupported
enums and omitted other schema bounds. Invalid metadata retains the existing
reply-only fallback; it never becomes structured approval and is never changed
from `stop` to `finish`. Valid metadata and canonical Server validation remain
unchanged. Runtime tests cover enum, range, uniqueness, size, null and nested
field failures plus valid boundaries. The complete synthetic continuation now
deliberately returns `stop` metadata and must complete all 20 Runs through real
Server/Bridge components without structured invalid evidence.

Under the Owner's request to continue through completion, one further run is
authorized after this reproduced defect is repaired and verified. It has a new
report/source identity and the same per-invocation 20-call/20-minute ceiling,
same five pairs, model, prompts and rubric. Combined with the three calls in
the retained failed attempt, this continuation phase is capped at 23 calls.
There is no automatic retry or unbounded loop. The prior failure, partial local
answer and failed lifecycle remain separately retained and unscored.

The repair passes the Runtime package, full Bridge `go test ./...`,
`go vet ./...`, Runtime `go test -race ./internal/runtime` and all 14 benchmark
checks, including the complete 20-Run invalid-metadata synthetic continuation.
Their owned roots are physically removed. These checks remain separate from
real answer quality.

## Completed real comparison

The [reviewed continuation](evidence/qa-068-discussion-continuation-2026-09-06.json)
retains clean source `1b9b16f6d09d7d3e57e21c4f00df519a066f329c`, 14 source hashes,
ten task-input hashes and all ten final answers plus intermediate contributions.
The original raw report SHA-256 is
`0227ef9c5c08ab83e81e08b4eb3877554edb1ddd95d3231c27f92303358423b9`.
The reviewed copy adds only fixed-rubric decisions/evidence and review metadata;
answer text, prompts, states and timings are unchanged. Requested model and CLI
remain `gpt-5.4-mini`, low effort and `codex-cli 0.153.3`; provider model identity
is not independently attested.

All 20 new Runs completed across five pairs. The command exited successfully
after 292.3 seconds including setup; the live owned root was physically removed.
The two QA-068 invocations used 3 + 20 = 23 calls with no automatic retry.
The task agent reviewed all answers directly; review is neither independent
nor blinded and consumed no additional provider calls.

| Task | Source | Single criteria | Discussion criteria | Single wall s | Discussion wall s |
| --- | --- | --- | --- | --- | --- |
| Cross-domain grant review | QA-067 | 4/4 | 4/4 | 16.457 | 36.837 |
| Simple selector review | Repaired QA-068 | 4/4 | 4/4 | 14.897 | 34.670 |
| Cross-domain restart diagnosis | Repaired QA-068 | 4/4 | 4/4 | 18.738 | 43.526 |
| Simple usage diagnosis | Repaired QA-068 | 2/4 | 2/4 | 23.327 | 41.223 |
| Cross-domain transport comparison | Repaired QA-068 | 4/4 | 4/4 | 14.707 | 38.463 |
| Simple schedule comparison | Repaired QA-068 | 4/4 | 4/4 | 13.191 | 31.600 |
| Total | Two source invocations | 22/24 | 22/24 | 101.317 | 226.319 |

Each Single arm creates one Run and each Discussion arm creates three. The
completed comparison therefore uses six versus eighteen Runs. Both arms fully
pass five of six cases; multi-perspective cases cover 12/12 items and simple
controls cover 10/12. The usage task fails the duration and late-completion
criteria in both arms: answers give 120 seconds instead of the required
createdAt-to-terminalAt 30 seconds. Both Discussion contributors make that
error and the Finalizer repeats it. The rubric was not changed to excuse it.

Successful-pair totals exclude two separately retained failed selector
Discussions, one in QA-067 and one in QA-068. Together those attempts add six
created Runs (four completed, two outcome_unknown) and 635.073 seconds of arm
wall time. They are not quality successes and are not removed from the record.
The original six fixed replays are direct invocations, not product Runs, and
are not rerun or pooled into this table.

Four repaired Discussion final answers retain `recommendation: "stop"` as
ordinary reply text under existing malformed-envelope behavior; it never
becomes structured approval. This demonstrates the real delivery repair and
also leaves a visible formatting limitation. The restart Discussion adds a
conditional idempotency alternative absent from the supplied facts and claims
exactly one lookup in its test. These observations are retained outside the
frozen four-item rubric rather than hidden by a coverage score.

There is no observed Discussion quality gain in these six fixed cases. The
local successful-arm elapsed total is about 2.23 times Single, with three times
the Runs. This is not a latency guarantee or a general model comparison:
timings come from one local execution with background verification, one model,
fixed closed inputs and a task-agent review. The first pair predates the
metadata repair, while all remaining pairs share the repaired source within
each comparison. The result completes the missing evidence without being a
fresh independent six-case replication or proving that Discussion never helps.

The [updated usage guide](../discussion-usage-guide.md) recommends checking
Single Agent coverage first when facts are complete. Independent information,
different workspaces or multi-party workflow requirements remain explicitly
unmeasured candidate reasons for Discussion. Production broad fallback and
manual choice remain intact; a live Broad/Top-N quality experiment is still
outside this continuation.

Final consistency checks verify all 14 source hashes against the recorded
commit, ten input hashes and equal inputs within each pair, completed Finalizer
Run/message pins, per-answer decisions and exact combined counts/times. The
reviewed report normalizes back to the raw report after removing only the
declared review fields. Both pinned QA-067 inputs/evidence and the first
continuation report are unchanged. All 394 Markdown files and whitespace checks
pass. Six owned runtime/test roots are physically absent, including both live
attempts; no temporary Team data or credentials are retained in the evidence.
