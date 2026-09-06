# ADR-0051: Repeat criterion screening with GPT-5.5

- Date: 2026-09-06
- Status: Accepted for one Owner-authorized six-session experiment
- Owner: Experiment tooling

## Decision

The Owner requested “你把模型换成5.5测” after QA-076. QA-077 repeats that
bounded experiment using exactly `gpt-5.5`, retaining low reasoning effort,
E/F, F/E, E/F, three attempts per arm, five minutes per attempt and no retry,
replacement or same-plan resume. The existing installed Codex CLI and ChatGPT
authentication remain the provider destination. The approval is new; QA-076's
consumed authorization and journal remain closed and immutable.

The [official GPT-5.5 model page](https://developers.openai.com/api/docs/models/gpt-5.5)
documents the exact model identifier and support for low reasoning effort.
Provider/account availability is established by the bounded execution, not
inferred from documentation. No extra model probe or model fallback is allowed.

Reuse QA-076's exact Task/Room/Criteria, authored synthetic notes, four source
identities/versions/bytes/ranges, authority, common and F-specific instructions,
output schemas, rubric and grading code. Do not duplicate contribution storage
or tune prompts for GPT-5.5. The only requested behavioral change is the model;
fresh experiment and Run identities prevent old receipts from authorizing new
reads. A new freeze records the installed CLI and all transitive runtime inputs.
Instruction, source and grading parity must be verified before startup.

## Acceptance and interpretation

Keep QA-076's all-required-deliverable primary endpoint and separate critical,
uncertainty, unsupported-addition, evidence-return, self-report consistency and
time/byte outcomes. Schema-valid JSON or an all-satisfied table is not semantic
acceptance. Retain the original strict output framing, including failures.
The inherited preservation metric projects whole criteria; it is not a literal
fact-loss rate. Preserve this limitation instead of silently changing scoring.

Export final-only artifacts in hash order and persist first judgments before
unmasking E/F identities or closure tables. Then review every F row's sources,
missing items and agreement with final acceptance. Failed/missing Runs remain
scheduled non-passes; no successful-subset analysis. The evaluator knows this
synthetic task and its reference, so this is not independent blind evaluation.

The within-task F candidate rule stays unchanged: F full pass 3/3 and E at most
1/3, valid setup/reading/format, valid F tables/reference bindings, preserved
criteria and uncertainty, and no unsupported F additions. Otherwise report no
predeclared incremental signal. Both arms passing can show that GPT-5.5 handled
these attempts, without establishing incremental value of the F table.

Comparisons against QA-076 are descriptive: the model was not randomized across
contemporaneous runs, and provider behavior/time may differ even with identical
CLI bytes. This is the same known task, not a new held-out example. No general
model superiority, Discussion product gain or Single/Multi-Agent advantage
follows. The experiment authorizes no production changes, automatic follow-on
calls, Targeted Review, participant selection or new completion gate.

See [QA-077 acceptance](../acceptance/qa-077-gpt55-criterion-closure.md).
Delivery state is recorded only in TASKS.
