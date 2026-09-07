# ADR-0055: Screen independent owner observations

- Date: 2026-09-07
- Status: Accepted for bounded QA screening
- Owner: Discussion experiment tooling

## Decision

QA-081 repeats the existing fictional CA review in normal and revoked scenarios.
Each scenario uses three independent source-owner sessions and one Finalizer,
GPT-5.5 / low, at most eight sessions total, no retry, pilot or replacement.
The Owner authorized this bounded phase with “可以，定好目标开始吧”.

An owner receives only the public task, its permitted observation schema and
its own fixed raw source through the scoped reader. No verifier receipt,
expected values, peer proposal, rubric or reference answer enters its context.
Retain the original terminal proposal immutably before running the hidden
local verifier. Validate the proposed values after that point; reject a wrong
proposal without feedback, repair, completion or a second model call. Grade
correct, wrong and omitted owner observations separately from released facts.

Reuse QA-079's immutable source, criteria, disclosure and Result adapter and
QA-080's maintained runtime, metadata discovery and terminal convergence.
QA-081 has a new journal/plan identity; reused QA-079 identifiers name the
frozen evidence/disclosure recipe, not permission to reopen its consumed plan.
Every scenario creates fresh Task/Room/Run identities in a disposable database.
The new freeze binds this mapping, current implementations and installed CLI.

In the revoked scenario, withdraw Operations disclosure after its private
proposal and before publication. Finalizer receives only actual released
Results and public availability statuses. It must read the available sources,
deliver the supported review, preserve unknown operational state and request
a new authorized snapshot. A denied share is not a negative observation.

## Interpretation and limits

One normal run and one revoked run screen mechanisms; they do not establish
statistical superiority, general reasoning gain or an Agent's necessity over
the task-specific verifier. Keep owner correctness, egress, final acceptance,
runtime failure and elapsed time separate. Full final acceptance requires all
fourteen public criteria; critical acceptance uses the existing ten criteria.
Preserve unsupported additions, missing evidence and correct-content loss
individually, with exact answer quotations and no net score.

Trust remains the trusted test host, local authority file and owner lock.
The self-carried disclosure public key is not an authenticated Owner identity.
Only revocation before send is tested; no claim about in-flight commit-time
revocation or general Discussion recovery is permitted. Independent credentials,
authenticated Bridge transport and physical owners/devices require another
specifically authorized phase. No production Discussion change, Targeted Review,
new contribution store or new participant abstraction is part of this phase.

## Verification

Offline negative tests prove raw-only catalogs, post-proposal verifier ordering,
incorrect-value rejection, omission preservation, scoped reads, revoked absence,
terminal convergence and the eight-slot one-use bound. Freeze code, source,
reference and rubric before real calls; preserve every attempt and first grade.
Audit returned bytes against original grants, Results against original proposals,
and final inputs against actual publications. Historical QA-079/080 evidence
remains unchanged. Delivery status belongs only in TASKS.md.
