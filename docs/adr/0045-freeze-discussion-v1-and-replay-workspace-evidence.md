# ADR-0045: Freeze Discussion v1 and replay workspace evidence

- Status: Accepted
- Date: 2026-09-06
- Supersedes: none

## Context

The fixed comparisons in QA-068, historical replay in QA-069 and constructed
complex tasks in QA-070 did not establish a quality benefit for the tested
Discussion configurations. Completed Runs, correct retrieval and delivered
contributions did not guarantee acceptable final answers. These non-blind,
one-model observations do not establish general multi-Agent value or actual
user productivity; results and limitations remain in the acceptance records.

## Decision

Freeze Discussion v1 feature expansion. Maintain correctness, security,
recovery, final-answer evidence, explicit controls and observed Run lifecycle.
Recommend Single Agent first for everyday work, with explicit task facts,
constraints and acceptance. Use Discussion when independent evidence or
responsibilities need to be combined. This is guidance, not a change to
routing, UI defaults, human review or execution authority.

Do not add an automatic startup classifier, Top-N default switch, LLM router,
embedding selector or another tuning cycle against the scored packets.
ADR-0043 continues to exclude token and monetary accounting. The Discussion
module owns scope; TASKS.md alone tracks delivery.

## Post-comparison adoption

After reviewing QA-070 on 2026-09-06, the Owner confirmed this direction:

- Prioritize concrete Task/Run/Result usability, reliability and verifiable
  delivery problems within each newly authorized task.
- Start with one Agent and check actual deliverables against hard constraints.
  A completed Run, higher score or participant agreement does not accept a Result.
- For explicit collaboration, identify each member's independent contribution
  and verify that finalization preserves facts, corrects supported errors and
  covers requested deliverables. Complexity alone is not a selection rule.
- New value experiments need an independent task or workflow hypothesis,
  frozen comparison and acceptance rules, disclosed source-access differences
  and a bounded new execution plan. Consumed plans are not reusable permission.
- Retain existing workflows and data. Retirement is a separate product decision
  involving usage, maintenance burden, dependencies and compatibility; the
  absence of observed quality gains alone is insufficient.

The [usage guide](../discussion-usage-guide.md#日常任务的执行与验收) describes
practical acceptance. This adoption adds no model call, telemetry collection,
verification service, migration, publication or scheduled benchmark.

## Alternatives

Additional routing intelligence lacks evidence of a current bottleneck.
Historical and constructed tasks enable reproducible comparisons but cannot
replace representative real task evidence or prove customer productivity.

## Compatibility and security

Production contracts and authority boundaries remain unchanged. The benchmark
reader serves fixed hash-checked IDs within per-invocation read limits; it does
not accept arbitrary paths, commands, URLs or model-selected scopes. Tool
metadata discovery does not authorize other tools. Credentials remain with
the CLI; owned processes, temporary workspaces and caches are cleaned after
execution. Missing reads and Runtime failure remain separate observations.

## Verification and evidence

- [QA-068](../acceptance/qa-068-discussion-continuation.md): completed balanced
  comparisons and retained assessment failure/repair evidence.
- [QA-069](../acceptance/qa-069-workspace-evidence-replay.md): historical sources,
  three paired results, failed attempts, scoped reader and adapter checks.
- [QA-070](../acceptance/qa-070-complex-discussion-results.md): complex task
  results, criterion-level evaluation, source-access limits and failed arms.

The records retain raw answers, source/input/read identity, actual Runs,
arm elapsed time, grading and cleanup verification. All available finals were
reviewed; completing an experiment does not imply passing answer quality.
Operational batch chronology stays in Git and raw evidence, not this decision.
