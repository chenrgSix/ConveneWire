# ADR-0045: Freeze Discussion v1 and replay workspace evidence

- Status: Accepted
- Date: 2026-09-06
- Supersedes: none

## Context

QA-068 completed six fixed comparisons: both arms covered 22/24 criteria,
with 6 versus 18 successful-pair Runs and 101.317 versus 226.319 seconds.
Two failed Discussion attempts remain separate evidence. These closed-input,
non-blind comparisons do not establish a general multi-Agent quality benefit.
The Owner accepted moving effort toward reliability and real task evidence.

## Decision

Freeze Discussion v1 feature expansion. Maintain its correctness, recovery,
final-answer review, existing explicit controls and observable Run lifecycle.
Use Single Agent as the recommended starting point for everyday work. Consider
explicit Discussion when participants can supply independent evidence from
different workspaces or responsibilities. This is usage guidance, not a change
to existing routing, UI defaults or authorization.

QA-069 replays three documented repository incidents using exact historical
source excerpts and retained observations: optional assessment delivery,
Hosted cancellation test timeout and Windows launcher discovery. They are
historical diagnostic tasks, not current user incidents. Evidence is copied
into separate disposable workspaces on one host; no physical multi-machine
acceptance or repository write authority is implied.

A test-only fixed-ID MCP reader lets each contributor inspect its assigned
source documents. Single Agent can read the union of those same documents.
The Reviewer contributes independently, then finalizes with its documents and
the accepted contribution transcript. No rubric or corrected source enters
model input. Pin sources, prompts and criteria before calls. Record actual
reader receipts; reading a document is not proof of understanding or new facts.

Use three pairs, two contributors plus one Finalizer per Discussion, requested
gpt-5.4-mini at low effort, at most 12 model invocations, 300 seconds per
invocation and 20 minutes of model work. Stop at the first runtime failure;
never silently retry or replace failed evidence. Retain actual Runs, elapsed
time, raw answers, source reads, omissions and unsupported conclusions.
Missing source reads are a separate quality observation, not a fabricated
Runtime failure; Finalizers may work from the accepted contribution transcript.
After the first one-invocation failure and offline CLI repair, the Owner
authorized QA-069 to use 12 new invocations, at most 13 across the phase
including the retained failure. After those 13 calls, the Owner explicitly
authorized three new calls for only the missing delivery Discussion, at most
16 across the phase, reusing the completed Single Agent baseline. Failed
evidence remains immutable. That attempt used two calls and stopped; the
Owner then explicitly approved a v4 delivery-only plan for three new calls,
at most 18 across the phase. All three calls completed and consumed this final
authorization; the current manifest rejects another real invocation. No further
automatic retry is added.
Non-blind task-agent grading is separate from runtime success. Real user
rework and task success rates are not measured by this historical replay.

Do not add an automatic startup classifier, Top-N default switch, LLM router,
embedding selector or another tuning cycle against the same fixed questions.
ADR-0043 continues to exclude token and monetary accounting. TASKS.md alone
tracks delivery; the Discussion module owns scope and QA-069 owns acceptance.

## Post-comparison adoption

On 2026-09-06, after reviewing the
[QA-070 complex-task results](../acceptance/qa-070-complex-discussion-results.md),
the Owner accepted continuing the maintenance freeze and Single Agent first
guidance. Three complete pairs scored Single 45/60 and Discussion 22/60; all
nine delivered finals failed critical acceptance. Three failed arms remain
unscored. This is evidence about one requested model and a split-source
configuration, not proof that every collaboration workflow lacks value.

Apply the following maintenance and work-selection policy:

- Prioritize concrete everyday Task/Run/Result usability, reliability and
  verifiable delivery problems when the Owner supplies a new task. Measure
  success against that task's requirements and actual evidence.
- Start ordinary work with one Agent, explicit source facts, hard constraints
  and acceptance criteria. A completed Run or higher rubric score does not
  accept a Result. Preserve the existing human review and execution boundaries.
- Retain explicit Discussion for a stated need to combine independent evidence
  or responsibilities. Identify what each participant contributes and check
  that the final answer preserves facts, resolves supported conflicts and
  covers the requested deliverables. Complexity alone is not a selection rule.
- Maintain reproducible correctness, security, recovery, final-answer evidence
  and Run-lifecycle defects within authorized task scope. Feature expansion,
  routing experiments and further tuning on the scored packets remain frozen.
- A new value experiment needs a concrete independent task or workflow
  hypothesis, a frozen comparison and acceptance rule, equal source access
  or explicit disclosure of access differences, and a bounded new execution
  plan. Approval to adopt this recommendation does not reopen consumed plans.
- Retain existing collaboration controls and historical data. Retirement would
  require a separate decision covering actual usage, maintenance burden,
  dependent workflows and compatibility; this adoption does not remove it.

The [usage guide](../discussion-usage-guide.md#日常任务的执行与验收) supplies a
practical starting workflow. This is a documentation and prioritization
decision: no new classifier, product default, verification service, telemetry
collection, model call, migration or publication is introduced. ADR-0043's
token and monetary-accounting exclusion continues. TASKS.md alone records
delivery; no new backlog or scheduled benchmark is created here.

## Alternatives

More routing intelligence lacks evidence of a current bottleneck. Prompt-only
questions cannot test retrieval. In-flight user tasks would be more
representative, but no concrete current incident was supplied; reproducible
historical replay is the bounded next step and must remain labeled as such.

## Compatibility and security

No production protocol, migration or external publication changes. The reader
serves only fixed, hash-checked document IDs, with eight reads per invocation;
it accepts no filesystem paths, commands, URLs or model-selected scopes.
Disable shell, apps, plugins and user configuration. The fixed reader is the
only permitted evidence source; client tool search may discover its metadata.
Native CLI scaffolding can still be advertised and is not granted task
authority. Unapproved reported calls invalidate the answer. Credentials stay with the
existing CLI authentication and never enter evidence or Room output. Preserve
owned process/data/cache cleanup, including failure paths.

## Verification

QA-069 requires source-pin, access-union, out-of-scope/over-limit reader and
adapter regression checks, a synthetic real Server/Bridge traversal, the
bounded real comparison, per-criterion evidence and physical cleanup.
Conclusions must distinguish replay diagnosis from an applied/tested repair.

The [completed QA-069 record](../acceptance/qa-069-workspace-evidence-replay.md)
retains all three pairs: Single Agent covers 4/12 criteria with 3 Runs and
78.068 seconds; Discussion covers 2/12 with 9 Runs and 134.604 seconds. Three
failed attempts remain separate, adding 6 Runs and 89.551 seconds. All 18 phase
invocations are accounted for. Successful source retrieval and complete
contributor context did not ensure correct final evidence use. This completes
the bounded experiment, without a quality pass or evidence to broaden routing.
Keep the maintenance freeze and Single Agent first guidance; future work needs
independent task evidence rather than tuning against this scored packet.
