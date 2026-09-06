# QA-077: GPT-5.5 criterion-closure screening

Following [ADR-0051](../adr/0051-repeat-criterion-screening-with-gpt55.md), use
the Owner's model-change request to run six fresh `gpt-5.5` / low sessions.
The fixed order is E/F, F/E, E/F, five minutes each, no retries or replacement.
All QA-076 Task/Criteria, synthetic notes, evidence, prompt bytes, schemas and
rubric are reused unchanged. Only requested model and fresh experiment/Run
identities differ; neither arm receives old answers or private grading material.

The [plan](fixtures/qa-077/plan.json) binds the new authorization to the existing
Codex/OpenAI destination. The new freeze must be committed before startup.
The old QA-076 journal is never reopened, reset or overwritten.

Complete delivery requires all eight canonical criteria to pass final-artifact
review; keep critical failures, unsupported additions, missing evidence, reading,
closure overclaims and runtime overhead separate. Persist final-only first
judgments before unmasking tables. The evaluator knows the reference solution;
this is not independent human grading. The original preservation projection
limitation and strict output framing remain in force.

Any comparison with the earlier `gpt-5.4-mini` run is descriptive, not a
contemporaneous randomized model comparison or a new task. If both E/F pass,
that does not establish an incremental benefit from the closure table. Production
Discussion and follow-on experiment authority remain unchanged.

## Frozen preparation

The freeze retains 63 file pins. CLI `0.153.4`, its executable digest, Node
`v22.23.1`, both E/F instruction digests and reader catalog/configuration match
QA-076. Runtime and source/grade code bytes are unchanged. The npm manifest
only adds the new QA-077 commands and retains QA-076's post-run audit test;
its dependencies and other scripts match the historical freeze.

Five new offline checks cover model/input parity, exact authorization, rejected
old Run receipts, exclusive six-slot reservation and the frozen baseline. The
20 QA-076 checks remain passing; documentation and whitespace are checked
before the execution commit. These checks make no external model call.
