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
after `npm run test:discussion-workspace` passes. It uses an isolated actual
Server/Bridge and existing signed-in Codex CLI, requested gpt-5.4-mini, low
effort. Three pairs allow exactly 12 model invocations: three Single Agent
Runs and nine Discussion Runs. An atomic quota, 300-second process limit and
20-minute model-work deadline bound execution. Stop later attempts at the first
runtime failure. No retries, release, production data or token/cost accounting.

The only model tool is `evidence.read_evidence`, a stdio MCP reader for fixed
IDs. Each process has a maximum of eight reads, and records ID/digest receipts.
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
An answer is emitted only after successful completion and at least one actual
reader receipt; reading all assigned sources remains a reviewed coverage gate.

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
