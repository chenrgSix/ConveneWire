# ADR-0049: Screen evidence-to-claim adjudication

- Date: 2026-09-06
- Status: Accepted for one bounded experiment
- Owner: Experiment tooling; no production Discussion change

## Decision

QA-075 asks whether an explicit, auditable claim disposition improves the use
and preservation of already returned evidence. Run at most six fresh Finalizer
sessions, C/D, D/C, C/D, with three repetitions per arm and no retry, replacement
or same-plan resume. QA-072 and QA-074 remain consumed. This is mechanism
screening on the same historical case, not an independent quality evaluation.

Reuse the exact Task, Criteria, original two contributions, four source
identities/revisions/ranges, reader, grants and receipts. Both arms get the
same two target propositions, current base instruction and evidence-use rule.
The propositions identify the historical missing-body dispute and independent
CLI/Console gates; neither gives an expected verdict or preferred contributor.
Both belong to the existing diagnostic criterion, not the policy criterion.
Their text and the private scoring rubric are frozen before any invocation.
All four original sources remain required; there is no post-answer selection.

Both arms emit one terminal message containing a `final-answer` block followed
by the existing assessment footer. D alone additionally emits a preceding
`claim-disposition` JSON block with one entry per target: exact claim ID,
criterion key, proposition, successful source refs and one of `supported`,
`contradicted`, `unresolved`. An `unresolved` list identifies exactly the target
IDs with that verdict. This is an external conclusion artifact, not private
reasoning, a second model turn, a Result proposal or an acceptance decision.
No derivation or chain of thought is requested.

C is therefore a fresh common-input baseline, not the retained QA-074 C answer.
D's only additional instruction is the disposition protocol. Reader catalog,
model, effort, timeout, read count, return bytes and terminal output byte cap
are identical. The diagnosis remains under 450 English words; table overhead
is retained and measured separately. Equal limits do not imply equal tokens or
compute. No tools, source bytes or rubric are added to D's ordinary prompt.

## Verification and interpretation

Deterministically check catalog/configuration/grant identity, all four full
source returns before the terminal message, exact target/schema coverage and
current-Run successful-return bindings. A manifest reference, old Run receipt,
partial range, failed return or JSON-shaped prose does not establish binding.
The existing receipt contract proves returned bytes, not comprehension.

Separately review evidence-to-claim correctness and claim-to-final consistency
against the frozen rubric, with exact source and answer spans. Consistency may
be correct or consistently wrong; omissions differ from contradictions. Keep
target correction, preservation, unsupported additions, uncertainty, delivery,
instruction compliance and elapsed time separate. Do not compute a net score.

Final/disposition contradiction is a recorded protocol failure and diagnostic
outcome, never an exclusion criterion that improves D's apparent success.
Missing/malformed tables or failed reads also remain in the six-attempt record.
Report structural fidelity and semantic results separately, not a selected set
of passing runs. An all-repetition mechanism claim requires valid common setup
and reading; table failures themselves measure failed D compliance.

A correct table followed by a contrary final answer demonstrates inconsistency
between observable artifacts. A wrong table shows error already present at that
artifact. Neither uniquely identifies internal comprehension, claim binding,
anchoring or reasoning; textual output order is not internal cognitive order.
A correct final after a wrong table is a later correction, also retained.
Overcorrection is reported as lost correct content or unsupported additions.
Three concordant repetitions are a within-case signal only. Even a stable D
advantage requires a separately authorized, newly frozen independent task,
evidence and error pattern before any Discussion quality claim.

## Boundary

No Targeted Review, Review Wave, extra Agent, heterogeneous model, production
scheduler, participant selection, storage, completion gate or automatic startup
changes. Only experiment files and acceptance documentation change. Existing
Result and criterion evidence ownership remains authoritative; the retained
table is a QA artifact, not parallel contribution persistence. Local source
authority stays bound to experiment, Task, Room, Run, revision and byte range.

See [QA-075](../acceptance/qa-075-claim-adjudication.md) for the frozen artifacts
and evidence. Delivery state is recorded only in `docs/TASKS.md`.
