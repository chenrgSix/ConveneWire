# ADR-0050: Screen full criterion closure on a new task

- Date: 2026-09-06
- Status: Accepted for offline preparation; live budget requires Owner approval
- Owner: Experiment tooling

## Decision

QA-075 corrected two highlighted propositions in all six answers but accepted
no complete deliverable. This makes completeness a candidate bottleneck, not a
proven unique cause. Neither structured claim adjudication nor Targeted Review
enters production. Do not tune the historical Windows task again.

Prepare QA-076 using a newly authored, synthetic snapshot-retention review:
two tenants, twelve inventory objects, four fixed policy/inventory/verification/
pin sources, and two explicitly human-authored fixture notes. There is no live
customer data, repository deletion, generated contributor or replayed historical
answer. Newness means independent task/evidence/error conditions; it does not
mean a statistically representative held-out task or an independently authored
benchmark. The evaluator knows its reference solution.

E and F receive identical Task, canonical Criteria, notes, source identities,
source access, evidence-use instruction and final JSON artifact contract.
E directly returns the artifact. F alone prepends one `criterion-closure` table
covering every canonical criterion with `criterionKey`, `status` (`satisfied` or
`unresolved`), actually returned `evidenceRefs`, and `missing`. The table is an
external self-assessment, not reasoning, verification, Result acceptance or a
new contribution store. Each `satisfied` row has no missing items; each
`unresolved` row names missing deliverable elements. Failed reads permit empty
refs with an explicit limitation, never fabricated successful reads.

Both arms see all requirements and output fields. No target claim list, known
error hints, expected dispositions or reference answer enters either prompt.
Every private rubric item maps to a canonical criterion visible in both arms;
the rubric cannot add hidden required policies or cases after seeing answers.
The common JSON deliverable is intentionally a strong structured baseline: the
comparison tests the incremental F self-assessment, not structure in general.

Unknown external facts and incomplete deliverables are distinct. Correctly
holding an object with missing verification and reporting the missing evidence
can satisfy the criterion requiring that behavior. Calling every criterion
`unresolved` does not satisfy the task. An emitted `satisfied` does not turn a
missing, incorrect or unsupported final deliverable into a pass.

## Measurement and interpretation

Primary: independently assessed **all-required-criteria pass** for the final
artifact. Deterministic checks cover exact object coverage, decisions, pins,
transitive dependencies, strict age boundary, uncertainty inventory and sums.
Frozen manual review covers semantic rationales, source relevance and proposed
regression inputs/expected outcomes. A reference artifact proves feasibility
within the common output cap before model invocation. It is not model evidence.

Separately retain critical-criteria pass, correct facts preserved, unsupported
additions, unresolved preservation, full evidence returns, criterion-to-final
consistency, Run outcome and time/byte overhead. No net score. Reading receipts
prove returned bytes only. F's consistency failures and false `satisfied` rows
remain outcomes; never exclude them to improve its apparent performance.
Format/full-source manipulation checks are distinct from semantic acceptance.

Propose six fresh sessions, E/F, F/E, E/F, without retries or replacement slots.
No external invocation is authorized by this preparation: admission remains
closed until the Owner approves the concrete model/destination/count and the
approval is recorded and committed in a new freeze. Requested common settings
are `gpt-5.4-mini`, low effort, 300 seconds, eight source calls, 8,192 bytes per
return, 16,384 final-artifact bytes and 32,768 terminal bytes. No inherited
450-word ceiling constrains this larger deliverable. Same caps are not equal
token or compute budgets. Preserve both arms' actual overhead.

A candidate signal requires F complete in all three attempts and E in at most
one, with valid common setup/reading and F table presence/reference binding,
no F preservation or uncertainty loss and no unsupported F addition. E emitting
the F table contaminates the control, while its answer still remains recorded.
Other patterns are reported as mixed or no incremental
signal. If no complete final passes, partial item gains cannot establish quality
improvement. Even this strict within-task signal proves no Discussion product
gain and does not authorize another experiment automatically. Both arms passing
means this baseline did not expose an incremental F benefit. Both failing means
inspect missing criteria, evidence relevance and budget/instructions before
assigning a unique model limitation. Do not retry this task with tuned prompts.

## Later Multi-Agent comparison

Only after a stable mechanism signal should a separately frozen independent
task compare a strong Single Agent against Discussion. Both need the same
evidence, canonical criteria, final verification protocol, model class and
output limits. Include Single draft/check/revise as a compute-budget control;
record actual calls/time and disclose that equal calls are not equal tokens.
Applying an improved protocol to Discussion alone would confound that test.
No Single-versus-Discussion superiority follows from QA-072 through QA-076.

No production scheduling, participant selection, storage, completion policy,
automatic startup, heterogeneous model or Review Wave changes are included.
Task/Room/Run/source/version/range authorization is reused with a distinct
synthetic-source authority, not the QA-072 historical-excerpt identity. Existing
Result and acceptance ownership remains authoritative. See
[QA-076](../acceptance/qa-076-criterion-closure.md); only TASKS tracks delivery.
