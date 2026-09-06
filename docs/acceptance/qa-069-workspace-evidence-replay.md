# QA-069 Historical workspace evidence replay

## Authority and frozen acceptance

[ADR-0045](../adr/0045-freeze-discussion-v1-and-replay-workspace-evidence.md)
owns the maintenance freeze and advice-only usage boundary. TASKS.md alone
tracks delivery. The Owner accepted the next phase; absent an in-flight task,
this phase uses three documented historical incidents with pre-fix source.

The fixed packet is `fixtures/qa-069-workspace-cases.json`. Each source excerpt
retains a commit, path, line range, full-source digest and excerpt digest.
The packet includes prompts, disjoint contributor document assignments and
four criteria per case. Rubrics stay outside the disposable reader workspaces.
Single Agent gets the exact union, the same requested deliverables and review
checklist. The Reviewer finalizes using its own documents and the accepted
contribution transcript. Arm order alternates; no corrected source or known
rubric answer is supplied to either arm.

The cases concern Bridge assessment delivery, cancellation-test timing and
Windows launcher discovery. They are diagnostic replay tasks using code,
schema and recorded operational observations, not live incident repairs or
proof of customer productivity. Separate local folders simulate evidence
ownership; all execution occurs on one host. Earlier QA records stay immutable.

## Bounded execution

`npm run bench:discussion-workspace` must start from committed clean source
after `npm run test:discussion-workspace` and the explicit local
`npm run test:discussion-codex-bootstrap` gate pass. It uses an isolated actual
Server/Bridge and existing signed-in Codex CLI, requested gpt-5.4-mini, low
effort. Three pairs allow exactly 12 model invocations: three Single Agent
Runs and nine Discussion Runs. An atomic quota, 300-second process limit and
20-minute model-work deadline bound execution. Stop later attempts at the first
runtime failure. No retries, release, production data or token/cost accounting.

The only configured MCP tool is `evidence.read_evidence`, a stdio reader for
fixed IDs. Execution revision v2 permits its metadata discovery via tool search. Each process has a maximum of eight reads, and records ID/digest receipts.
Single Agent may read all documents; Solver and Reviewer each get only their
assigned subset. No path, URL, shell, write or model-selected role is accepted.
Codex settings follow the official [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
and [MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
Read-only sandboxing alone is not a filesystem-read allowlist; the restricted
tool and disabled other tools provide the intended evidence boundary.

## Required evidence

Validate source pins against Git, the exact access union, rejected foreign IDs,
read limits, adapter failure/unknown-tool behavior and quota exhaustion without
a provider. A synthetic CLI must traverse the real MCP reader and actual
Server/Bridge flow without provider credentials. Retain exact instructions,
source/input hashes, reader receipts, answers, completed Finalizer identity,
actual Run states, elapsed time and failures. Grade each answer against the
frozen four-item rubric, labeled as non-blind Codex task-agent review.

Record which cited facts contributors independently supplied, whether the
Finalizer added unsupported claims, and remaining requested-item omissions.
Read counts are retrieval evidence, not quality. Real user rework remains
unmeasured. Runtime completion, rubric coverage and a deployed repair are
separate states. Completion requires three paired results, reviewed evidence,
updated guidance, relevant checks and physical temporary-root cleanup. A
failed invocation remains incomplete rather than being promoted to success.

## Implementation preflight

The fixed packet contains 13 exact Git excerpts across three incidents. The
reader persists its eight-read quota across MCP restarts; rejected calls also
consume a slot. Model-selected paths, foreign documents and forged role fields
are rejected without retaining those raw arguments. The separate evidence
adapter preserves the older closed-input adapter's prohibition on all tools.
An answer is emitted only after successful CLI completion and accepted tool
behavior. Revision v3 retains zero-read answers and records source coverage
separately; reading all assigned sources remains a reviewed coverage gate.

The first offline pass verified four focused checks and all 12 synthetic Runs
through actual MCP, Server and Bridge processes. The owned root
`convene-wire-test-run-JvXAyw` was physically removed. Corpus excerpts were then
trimmed to remove unrelated trailing declarations; the final committed packet
and full legacy/review/continuation regression are verified before live calls.

Final preflight passed all 19 benchmark checks, including unchanged legacy,
review and continuation suites plus the workspace reader checks and complete
12-Run synthetic traversal. All 396 maintained Markdown files and whitespace
checks passed. The final preflight root `convene-wire-test-run-SjRCgj` is absent.
No provider was invoked during either preflight.

## External execution authorization boundary

Before explicit Owner consent, no QA-069 real model invocation had started.
Automatic approval review rejected
`npm run bench:discussion-workspace` before process creation, then rejected a
second review after public-source verification. No benchmark process, Run,
model answer or new execution report was created by either rejected request.

Ten of the eleven distinct source files are byte-identical to unauthenticated
GitHub raw downloads from `chenrgSix/ConveneWire`: the original `1f519bd` and
`d66a004` commits cover six files; public `c583e1f` covers the remaining parser,
wire schema, generated Go types and QA-059 document. SHA-256 equality was checked
against every full-source digest in the frozen packet. A 404 at a local commit
was not interpreted as proof that its file content was private.

The remaining file is
[`qa-068-finalizer-assessment-failure-2026-09-06.json`](evidence/qa-068-finalizer-assessment-failure-2026-09-06.json).
Its complete field set was inspected: isolated-benchmark Run/trace/message IDs,
status timestamps, optional assessment and a previously generated selector
answer. It contains no credential, Owner identity, local path or customer-input
field. Nevertheless, automatic approval review requires explicit Owner consent
for this exact unpublished payload to the existing signed-in OpenAI Codex
service; the assistant's provenance assessment cannot supply that consent.

The requested authorization covers this record, the public source excerpts,
necessary task instructions and generated contribution transcript, using the
existing requested gpt-5.4-mini configuration and unchanged 12-invocation cap.
The packet and rubric have not been replaced to evade the rejection. The
Owner subsequently replied “允许” to this exact request on 2026-09-06, explicitly
authorizing those materials to the existing signed-in OpenAI Codex service for
at most 12 model invocations. This resolves the external-execution blocker.
The fixed packet, model, no-retry rule and acceptance criteria remain unchanged;
real results still require execution and review.

## First real attempt and offline diagnosis

The authorized invocation at source `ed7508f` stopped on its first arm. The
[unaltered report](evidence/qa-069-workspace-startup-failure-2026-09-06.json)
records one reserved CLI invocation, one failed Single Agent Run, 18.971 seconds
of arm elapsed time, zero reader receipts and no final answer. Five arms were unstarted; no quality
criteria can be scored. The owned root `convene-wire-test-run-5tRSEl` was removed.
The original adapter discarded provider diagnostics, so the exact original
failure chain cannot be reconstructed or confidently attributed to one cause.

An auth-free loopback provider with a disposable Codex home then exercised the
actual installed CLI 0.153.3 without an external model. It reproduced two
adapter assumptions that the synthetic CLI had missed: `skip_host_skill_discovery`
emits an `item.completed` error-shaped startup warning, and MCP tools are
available through client tool search with a namespace-qualified function call.
The original whitelist rejects the warning, while the original task instruction
forbids the required metadata discovery step. These are demonstrated preflight
defects, not proof that they explain every part of the first provider failure.

The repair explicitly suppresses that known startup warning, permits only
metadata discovery of the fixed reader, retains compact diagnostic categories
without provider text, and adds a real-CLI loopback discovery/read/final-answer
gate. Only the fixed MCP reader is configured. Codex still advertises some native
scaffolding; unapproved reported tool calls invalidate the invocation, and
read-only sandboxing plus disabled shell/apps/plugins preserve the execution
boundary. The test must not claim that no native tool was advertised.

This is execution revision v2; task source/rubric bytes stay unchanged and its
new instruction hash is retained separately. No real retry is authorized by
this repair. The original 12-invocation phase has used one; completing three
fresh pairs would need 12 more, a total of 13 including the retained failure.
The Owner explicitly replied “允许” to the request to raise the phase cap from
12 to 13 on 2026-09-06. The continuation is therefore authorized for at most
12 new invocations, with the original failed invocation retained separately.
It starts from committed execution revision v2 and stops at its first runtime
failure; no further retry or increase is included. Material-export consent
continues to cover the same fixed sources and necessary task context.

The repair passed all 19 benchmark checks and two additional real-CLI loopback
checks. The latter reproduce error-shaped startup-warning rejection even when
the actual read succeeds, and verify the repaired configuration delivers the
answer through deferred discovery and a namespace-qualified MCP call. Both use
synthetic source, an empty temporary Codex home and a loopback-only provider;
all six fixture HTTP requests had no Authorization header and called no model.
These checks prove CLI/reader integration, not compatibility with the remote
provider or task-answer quality. The two paths use the same exported
configuration as the real benchmark adapter.

All 396 maintained Markdown files and whitespace checks pass. Physical cleanup
was verified for the real attempt, the CLI-bootstrap root
`convene-wire-test-run-G5eKZ1` and the full regression root
`convene-wire-test-run-XmraYK`. The retained report is byte-identical to the
original ignored report; its 16 source hashes match Git at `ed7508f`, its task
prompt hash matches, and all four rubric decisions remain unscored. The report
SHA-256 is `e16dfc45266c2605756221397cf96a50b9651657cbb0e77f9c26ba2f799f1f6c`.
No external model calls were made during that offline bootstrap repair.

## Authorized continuation

The continuation uses `npm run bench:discussion-workspace`, whose atomic quota
still permits at most 12 new invocations. The total authorized phase limit is
13 including the immutable first failure. All three pairs start afresh because
the prior batch produced no completed arm. The three case prompts, source
excerpts and rubrics are unchanged; execution revision v2's metadata-discovery
instruction and startup configuration are separately identified in the report.
The 21 passing preflight checks remain applicable to unchanged implementation.

## Evidence-read gate failure and unstarted cases

The v2 batch at `1652cb8` used four invocations. Single Agent completed after
reading all five delivery documents in 27.081 seconds, but incorrectly called
`recommendation: stop` schema-valid. Both contributors completed with their
respective two and three source reads. The Finalizer exited zero with an agent
message and no new reads; the adapter then discarded that answer solely because
of its `no_evidence_reads` gate. The product recorded a failed finalization and
no output Message. The [unaltered v2 report](evidence/qa-069-workspace-read-gate-failure-2026-09-06.json)
retains the 46.704-second Discussion attempt and its diagnostics. The discarded
answer is unavailable, so contributions cannot substitute for its final answer.
This is a benchmark-induced delivery failure, not evidence of a production
Finalizer crash. The temporary root `convene-wire-test-run-d3Hbqe` is absent.

Execution revision v3 separates CLI/Run completion from document-read coverage.
A valid answer after a zero exit is retained even if the model used only the
supplied transcript; missing source reads are explicitly reported for quality
review. All source-read receipts and missing-document IDs remain visible.
Unauthorized tool calls, malformed CLI events, timeout and provider failures
still invalidate an invocation. Case prompts, source/rubric bytes and requested
model remain unchanged; neither earlier failure is rewritten as completed.

Within the existing Owner-authorized cap, one original plus four v2 invocations
leave eight. A pinned [remaining-case manifest](fixtures/qa-069-workspace-remaining.json)
selects only the two never-started cases, preserving their original arm order.
`npm run bench:discussion-workspace-remaining` is capped at eight new calls,
13 across the phase, with first-failure stop. It does not retry the failed
delivery Discussion. That case's missing final answer keeps the full
three-complete-pair acceptance gate open; completing the remaining two cases
must not be presented as completion of that gate.

Revision v3 passed 22 benchmark checks, including the zero-read Finalizer
regression, both quota sizes, tampered continuation/source rejection and the
complete 12- and eight-invocation synthetic workspace flows. Both installed-CLI
loopback checks still pass, without an external provider. All 396 maintained
Markdown files and whitespace checks pass. The roots
`convene-wire-test-run-rQtsyN` and `convene-wire-test-run-FJmZbK` are absent. The
v2 failure report is byte-identical to its original; all 16 source hashes match
Git at `1652cb8`. The report digest and original packet digest are pinned in
the remaining-case manifest.

## Reviewed remainder results

The [unaltered remainder report](evidence/qa-069-workspace-remaining-2026-09-06.json)
records eight successful Runs from clean source `ff541be`. Its 20 source hashes
match that commit, four task-input hashes match the stored inputs, and both
final answers bind completed finalization Turns to output Messages. The owned
root `convene-wire-test-run-D4tZX6` is physically absent. The report SHA-256 is
`c71775b477b0a4c7b789d402a645d6c3a14886e0e9f390947eb851df293fbb80`.

The [separate rubric review](evidence/qa-069-workspace-review-2026-09-06.json)
pins all three original reports and every scored final answer. It changes none
of their bytes or original null rubric decisions. Review is direct, non-blind
Codex task-agent review without another provider call or independent human
review. All clauses of a criterion must be covered; partial coverage is recorded
in the explanation, not rounded up.

| Historical case | Single Agent | Discussion | Single Run/time | Discussion Run/time |
| --- | --- | --- | --- | --- |
| Cancellation timeout | 2/4 | 2/4 | 1 / 24.355 s | 3 / 46.347 s |
| Windows discovery | 1/4 | 0/4 | 1 / 26.632 s | 3 / 45.298 s |
| Complete-pair total | 3/8 | 2/8 | 2 / 50.987 s | 6 / 91.645 s |

The delivery Single Agent answer is separately 1/4 in 27.081 seconds; its
Discussion answer is unavailable, so it is not part of the paired totals.
Across all attempts the approved 13 invocations are exhausted: 13 actual Runs,
11 completed and two failed. The two failed arms used four Runs and 65.675
seconds, including completed contributors inside the failed Discussion. All
seven arm attempts total 235.388 seconds; this is summed arm elapsed time, not
end-to-end phase wall time. No failed answer is promoted to success.

Both cancellation answers find the whole-test budget problem but omit the
explicit five-second cancel-to-abort limit, bounded settlement/shutdown and
protection against the provider's 15-second deadline falsely passing the
cancellation assertion. Solver independently supplied test/policy facts and
shutdown semantics; Reviewer supplied route wiring and same-source CI facts.
The Finalizer combined some facts but dropped Solver's shutdown outcome.

The Windows baseline locates the three execute-bit gates but misses the
`.exe`-only known-directory fallback and the full extension/negative-test
policy. Discussion's Reviewer supplied independent enrollment/Console evidence.
The Finalizer then falsely claimed those source labels were not evidenced in
the transcript and discarded those facts. Its stored Run instruction includes
the full Reviewer contribution; Bridge's prompt projection appends that
instruction unchanged. This supports a fact-use/correction failure, not a
missing-contribution delivery diagnosis. Both Finalizers made zero new source
reads; the six other invocations read every assigned document. The zero-read
answers are retained with explicit missing-document coverage.

Central Run instructions and the adapter's projected-stdin hashes are different
observations: Bridge adds normal Room/task context before the unchanged current
request. Full projected stdin was not retained, so the review does not claim
byte equality between those two fields. Some contributor Markdown links invent
filesystem targets; fixed source IDs and hash receipts are the verifiable
references. Neither a citation nor a successful read proves correct reasoning.

These two complete historical pairs show no Discussion benefit: coverage is
lower and summed arm time is about 1.80 times the baseline. Five available final
answers cover fewer than all four criteria. This remains one requested model,
non-blind review, no repeated trials and no provider-attested model identity.
It does not establish general superiority, real task success, user rework or
performance guarantees. Keep the Single Agent first guidance and Discussion v1
maintenance freeze; do not tune routing or prompts against this scored packet.

The frozen three-complete-pair gate remains open. A fresh delivery Discussion
would need three calls (two contributors and a Finalizer), reusing the completed
Single baseline. That would raise the phase total from 13 to 16. No such increase
or extra model execution is authorized by the current record.

## Prepared missing-pair completion

The [delivery-only manifest](fixtures/qa-069-workspace-delivery.json) is a
proposal, not authorization. It pins all three existing reports, their 13
invocations and the already completed delivery Single Agent answer.
`npm run bench:discussion-workspace-delivery` would start only a fresh delivery
Discussion, with two contributors and one Finalizer, an atomic three-call quota,
300 seconds per process and the existing 20-minute model-work bound. It keeps
the v3 task instruction, source packet, requested model and rubric unchanged;
no earlier evidence is replaced and no further retry is included.

The command is prepared and tested without a provider. Real invocation requires
Owner approval to raise the cumulative phase cap from 13 to 16. Existing consent
for the same source material and generated task context persists; no new data
export scope is requested. The synthetic full regression also exercises this
three-Run Discussion and rejects changed pins, baseline selection or call caps.

Preparation passed all 24 benchmark checks and two installed-CLI loopback
checks without a provider, including the exact baseline-input equality and
complete three-Run synthetic Discussion. The roots
`convene-wire-test-run-m6U32x` and `convene-wire-test-run-npMhNR` are absent.
All 396 maintained Markdown files and whitespace checks pass. There have been
no further external invocations after the 13-call authorized phase.
