# QA-076: Full criterion closure on an independent task

Following [ADR-0050](../adr/0050-screen-full-criterion-closure.md), test complete
delivery rather than known claim correction. The new case is a synthetic
read-only snapshot-retention review, with new evidence and canonical criteria.
It uses no Windows source, old Task/criterion IDs or historical answer. Two
fixture notes are authored directly, not attributed to real Agent Runs.

## Inputs and proposed arms

- [Packet](fixtures/qa-076/packet.json): Task/Criteria, source identities, frozen
  notes, shared artifact contract and the sole F instruction delta.
- [Sources](fixtures/qa-076/sources): policy, twelve-object inventory,
  verification observations and active pins; all synthetic and path-free.
- [Final artifact schema](fixtures/qa-076/final.schema.json) and
  [closure schema](fixtures/qa-076/closure.schema.json).
- [Private rubric](fixtures/qa-076/scoring.json): every item joins a canonical
  criterion; expected object decisions are not model-visible.
- [Reference artifact](fixtures/qa-076/reference.json): authored feasibility
  witness, never sent to the model or treated as experimental success.
- [Freeze](fixtures/qa-076/freeze.json) and
  [common E instruction](fixtures/qa-076/base-instruction.txt).

E receives evidence use, all canonical criteria and the full final artifact
contract. F receives exactly E plus an all-criterion self-assessment table
before the same final artifact. Both read the same four fixed sources. The
reference answer, private grading rubric and prior QA outcomes are unavailable
to the reader and prompt. Both output the same proposed review manifest; neither
may delete data, run shell commands or claim completed operational changes.

The proposed order is E/F, F/E, E/F, three fresh repetitions each. Current
external-model budget is **zero**. The proposed maximum is six sessions using
the installed Codex CLI and OpenAI/ChatGPT service, model `gpt-5.4-mini`, low
effort, five minutes per session, no retry or same-plan resume. A new explicit
Owner approval and committed authorization freeze must precede live startup.

## Acceptance

Primary `fullRequiredDeliverablePass` requires every required canonical
criterion to pass independent final-artifact review, including semantic review.
Neither table `satisfied`, number of table rows, nor an 8/10 subtotal suffices.
An unmet critical criterion independently fails `criticalCriteriaPass`.
Correctly documenting missing verification while holding affected objects can
satisfy the uncertainty-reporting criterion; invented certainty cannot.

The proposal must account for every inventory object exactly once; protect the
newest verified restore points, active pins and dependency closure; respect the
strict age boundary; hold failed/unknown verification; give exact byte totals;
name missing evidence; and propose concrete regression inputs and outcomes.
All policies, required fields and required test conditions are visible in the
Task/Criteria or cited policy, not hidden grading additions.

Check all-source returns, exact criterion coverage, output ordering and
successful-read citation binding separately. A correct table with a contradictory
or incomplete final is retained as a failure, not filtered from the comparison.
Score final-only exports before unmasking F tables. Persist the first item
judgments before joining arm mappings; record changes instead of overwriting
them. Manual semantic review remains fallible and does not prove private thought.

No product improvement follows if full delivery fails. A stable within-task
signal still requires a new independent Single/Discussion experiment with both
sides using the same final verification protocol and a strong Single compute
control. Do not tune this case after model results or automatically start more
calls. These preparations leave production Discussion unchanged.

## Offline preparation evidence

The preparation freezes 58 file pins plus CLI binary/version, both instruction
digests and identical reader catalog/configuration digests. Source `revision`
is the Git blob SHA-1 of each authored UTF-8 source, explicitly labeled
`git_blob_sha1`; it is not a fabricated historical commit. SHA-256 and exact byte
ranges additionally bind content. `authority_qa076_synthetic_sources_v1` is
distinct from the historical excerpt authority. The shared experiment runtime
accepts this fixture authority while retaining its previous default for consumed
plans. No production source or existing acceptance journal changes.

The complete authored reference is 5,679 bytes in compact JSON and 7,195 bytes
as stored, both below the common 16,384-byte final-artifact cap. This proves an
acceptable answer fits; it does not prove a model will produce it. The inherited
runtime word counter is only telemetry here; the common enforced output limits
are the explicit final-artifact and terminal byte caps.

Fourteen new provider-free tests cover input/rubric parity, all policy branches,
source authority/read binding, false self-closure, missing regression semantics,
legitimate unknowns, control contamination, invalid manual-review identity and
exclusive admission. Fifty-five historical access/QA-074/QA-075 regressions also
pass, including installed-CLI loopback without an external model. Markdown lint
covers 409 files. The zero-budget live-entry probe fails before journal creation
or provider startup; no QA-076 execution report or quality result exists.

Run `npm run test:discussion-criterion-closure` for offline checks. The proposed
`npm run bench:discussion-criterion-closure` remains blocked until the concrete
six-call authorization is approved, recorded, refrozen and committed. After an
authorized run, the audit entry exports final-only artifacts; first semantic
judgments must be durably recorded before joining table/arm identities.
