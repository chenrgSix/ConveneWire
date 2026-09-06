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
