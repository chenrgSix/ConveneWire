# ADR-0053: Screen authority-separated evidence collaboration

- Date: 2026-09-07
- Status: Accepted for one bounded Owner-authorized QA experiment
- Owner: Discussion experiment tooling

## Decision

QA-079 follows QA-078 with a new synthetic issuing-CA cutover review. Three
owner domains contain implementation, security policy and operational snapshot
respectively. Each domain has its own source bundle and scoped reader. The
Finalizer receives only explicitly released observations and their verification
receipts. It has no grant for any original source. Equal-compute research,
Targeted Review, closure tables and production Discussion changes remain out
of scope. The Owner requested: “可以，定好目标完成他们”, accepting the preceding
priority of authority separation and deferred equal-compute work.

Freeze the packet, public atomic criteria, private reference/rubric, source and
verifier versions, disclosure allowlist, prompts, model/runtime and schedule
before model execution. Use GPT-5.5 with low effort through the existing Codex
service, with at most twelve fresh sessions: three owners then a Finalizer for
each of normal, interrupted/resumed and disclosure-revoked scenarios. These
are three different fault conditions, not statistical repeats or comparative
quality arms. No live pilot, model retry, replacement or model grader is allowed.

## Read and disclosure authority

Existing Result visibility is Room membership, not per-field declassification.
`verifiedEvidenceRefs` is not a raw-source grant. A local experiment gate checks
separate read and disclosure grants. Each binds source identity/version, owner,
Task/Room, producing Run, receiving Finalizer Run, expiry and policy revision.
The publication audience includes the approved QA Room; Finalizer binding does
not secretly narrow existing Room-member visibility. Only values authorized
for that entire audience may enter existing Result persistence or Room events.

Owner replies are untrusted private proposals, never forwarded as Room replies
or arbitrary prose. The model proposes a bounded list of observation IDs and
values. An owner-side deterministic verifier derives those observations from
the pinned source. The disclosure gate rejects extra fields, wrong values,
unsupported IDs and expired/revoked authority, and constructs the released
document itself from authorized fields. Missing model observations stay missing;
the verifier does not automatically supply an answer in place of a model.
This typed egress format enforces the sharing boundary, not a new Finalizer
claim-adjudication or criterion-closure protocol. Final output remains prose.

The adapter reuses the existing Result model/service and Run-event references
in disposable Central state. It stores only released data there; owner traces
remain separate experiment audit artifacts. No parallel production contribution
store, migration, completion gate or production schema is introduced. A Result
is a proposal, not human acceptance, and verification receipts prove only the
named local checks, not global correctness or production readiness.

## Faults and interpretation

Normal flow tests complete release and synthesis. Interrupted flow physically
restarts the bounded publication coordinator after one committed Result and
before acknowledgement; it reuses the sealed output without another model
session, preserves operation identity and does not duplicate the Result.
Disclosure-revoked flow withdraws the operations owner's share grant after its
local model finishes, before publication. Reading and sharing are distinct:
already authorized private reads remain historical facts, but no new release
or buffered retry may use the revoked grant. Finalizer must preserve the
resulting unknowns. Offline checks also cover read revocation/expiry, recipient
and source substitution, malicious egress and interrupted ambiguous execution.

Security manipulation and answer acceptance are independent. Crossing an
unauthorized boundary fails the experiment even if the answer is correct.
An authorized, explicit inability to determine a required operational fact can
be the correct deliverable in the revoked scenario. Report all missing items,
wrong claims, unsupported additions, source/release outcomes, Run outcomes and
time separately. No net score or token/monetary accounting. Keep initial grades
immutable and append any later ambiguity review. Every rubric item must map to
one public requirement; do not repeat QA-078's compound F2 ambiguity.

## Assurance boundary

This first experiment enforces tool and publication boundaries on one trusted
test host using synthetic data. The fixture author/test controller necessarily
holds all source files; this is not a hostile-host OS isolation or provider-side
confidentiality claim. The same service provider processes separate sessions.
Distinct workspaces alone are not a sandbox. Models have only their configured
scoped reader, no shell/web/Room browsing; denied selectors and allowed tool
catalogs must be physically exercised and retained. Source canaries detect
specific accidental leakage; they do not prove universal noninterference.

Results establish only the tested bounded path and fault points. They do not
establish shipped Discussion E2E, arbitrary free-text safe disclosure, multiple
physical owners, Byzantine verification, general recovery or multi-Agent
superiority. Acceptance remains in the QA-079 record and delivery state only in
TASKS. A future product feature requires its own explicitly reviewed scope.
