# ADR-0046: Connect criteria, contributions and verification

- Status: Accepted
- Date: 2026-09-06
- Amends: ADR-0045 for this explicitly authorized acceptance-evidence slice

## Context

QA-070 observed both missing contribution facts and incorrect use of delivered
contributions. The Owner authorized a bounded implementation after reviewing
these findings. Task criteria, immutable Result claims, sealed Artifacts and
candidate-bound independent verification already exist; creating a second
acceptance system would duplicate their authorities.

## Decision

First cover code delivery through existing repository checkpoints and local
verification receipts. Reuse ordinary immutable Result proposals as structured
contributions. A read-only acceptance-evidence projection joins canonical
criterion keys/revisions, attributed Result claims, exact Artifact identities,
captured candidates and independent verification outcomes. It serves both
single-Agent Result review and Discussion finalization.

The Result review view compares one explicit candidate Result with earlier
same-definition/same-criteria Results. It identifies missing candidate claims,
earlier evidence absent from candidate references, differing coverage claims,
and stale Task revisions. Rejected and superseded contributions remain labeled
history, never silently promoted into support. The projection reports its
selection limits and omitted counts. It does not determine semantic truth,
infer prose claims, or measure a model's internal understanding.

Discussion uses only Results attributable to its accepted prior member Runs
and explicitly offered in those accepted turns' `newEvidenceRefs`;
same-Wave, quorum-excluded and supplemental late contributions remain excluded.
The bounded criterion index is frozen in the existing durable Run instruction.
It distinguishes available structured evidence from unstructured replies and
explicitly discloses omissions. Members organize facts, source references,
inferences, assumptions, checks and gaps under canonical criterion keys when
available. Finalizers address each requirement and explain unsupported or
conflicting claims rather than treating reference existence as truth.

The Web Result view exposes this matrix and exact verification observations.
Existing APIs submit contributions, publish Artifacts, run owner-local
verification and review Results. This slice adds no new contribution store,
LLM judge, review Wave, verification executor or automatic acceptance rule.

## Ownership and compatibility

Task owns canonical criteria. Result owns immutable attributed claims and human
review. Artifact/checkpoint owns candidate content identity. The authenticated
verification receipt owns the recorded process outcome. Central derives a
read-only projection and cannot mint any of these facts. A receipt applies only
to the exact candidate, input, Run, plan revision and profile pins; optional,
missing, failed, unknown or mismatched checks cannot become required passes.
Passing configured checks does not prove all criterion claims true.

Use an additive closed response definition in the existing work schema and a
Room-authorized Result endpoint. Existing submission and Bridge wire envelopes
remain unchanged. No migration or copied source bytes are needed. Historical
Result criteria are read at their own revision and marked stale against the
current Task. Prompt and Web projections do not disclose local paths, commands,
environment values, credentials or private source content.

This authorization covers implementation and provider-free acceptance, not a
new real-model experiment. The Discussion maintenance freeze, consumed
benchmark plans and separate human acceptance/integration authorities remain.

## Verification

The acceptance criteria and evidence belong to the owning module documents;
delivery state belongs only to TASKS.md. Required checks cover real SQLite and
HTTP authorization, immutable source joins, historical criteria, candidate
substitution and negative verification outcomes, deterministic bounded
finalizer instructions including quorum/restart cases, TypeScript/Go contracts,
Web behavior and rendered production UI, and the existing real Server/Bridge
verification path with physical temporary-root cleanup. No answer-quality or
physical Windows acceptance claim follows from these checks.
