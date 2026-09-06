# QA-069 Historical workspace evidence replay

## Result

All three historical pairs were completed on 2026-09-06. The final delivery
ran at source `0fdeaa2`, consuming the phase's final 18-call authorization.
The [complete review](evidence/qa-069-workspace-completed-review-2026-09-06.json)
pins all five raw reports and both prior reviews. No exercised plan authorizes
another real invocation; the current delivery manifest is consumed.

| Case | Single criteria | Discussion criteria | Single Runs / seconds | Discussion Runs / seconds |
| --- | --- | --- | --- | --- |
| Delivery | 1/4 | 0/4 | 1 / 27.081 | 3 / 42.959 |
| Cancellation | 2/4 | 2/4 | 1 / 24.355 | 3 / 46.347 |
| Windows | 1/4 | 0/4 | 1 / 26.632 | 3 / 45.298 |
| Complete-pair totals | 4/12 | 2/12 | 3 / 78.068 | 9 / 134.604 |

All six finals were reviewed; none covers all four criteria. Discussion uses
three times the Runs and about 1.72 times the summed arm elapsed time in the
completed pairs. Three failed attempts add six Runs and 89.551 seconds
separately. The phase totals 18 invocations/Runs, 15 completed and three failed,
and 302.223 seconds of arm elapsed time, not phase wall time. Failed attempts
are unscored; do not pool this replay with other packets or infer user success.

## Frozen scope

[ADR-0045](../adr/0045-freeze-discussion-v1-and-replay-workspace-evidence.md)
owns the maintenance policy. The
[packet](fixtures/qa-069-workspace-cases.json) contains 13 hash-pinned historical
Git excerpts covering assessment delivery, cancellation-test timing and Windows
launcher discovery, with four criteria per case. These are pre-fix diagnostic
replays on one host, not applied repairs, customer incidents or physical
multi-machine acceptance. Rubrics and corrected answers stay outside model input.

Single Agent reads the union of disjoint Solver/Reviewer sources. Both arms
receive the same task and review checklist; Reviewer finalizes from its sources
and accepted contributions. Request gpt-5.4-mini/low; provider-attested identity
is unavailable. The fixed-ID MCP reader accepts up to eight reads per invocation
and no arbitrary paths, URLs or role changes. Metadata discovery is permitted;
other reported tool calls invalidate delivery. Reading is evidence of retrieval,
not understanding. A Finalizer using the transcript need not reread source files.

## Retained executions

The original batch stopped on failure; subsequent explicitly authorized plans
completed remaining work. This compact ledger replaces obsolete pending-plan
and temporary-directory narratives; exact chronology remains in Git and the
immutable raw reports.

| Raw report | Source | Calls | Outcome |
| --- | --- | --- | --- |
| [Initial](evidence/qa-069-workspace-startup-failure-2026-09-06.json) | `ed7508f` | 1 | Delivery Single failed |
| [Read gate](evidence/qa-069-workspace-read-gate-failure-2026-09-06.json) | `1652cb8` | 4 | Delivery Single completed; Discussion failed |
| [Remainder](evidence/qa-069-workspace-remaining-2026-09-06.json) | `ff541be` | 8 | Cancellation and Windows pairs completed |
| [Tool rejection](evidence/qa-069-workspace-tool-rejection-2026-09-06.json) | `0f16b52` | 2 | Delivery Discussion failed before Finalizer |
| [Final delivery](evidence/qa-069-workspace-delivery-completed-2026-09-06.json) | `0fdeaa2` | 3 | Delivery Discussion completed |

The [final manifest](fixtures/qa-069-workspace-delivery-retry.json) binds the
last report and consumed authority. Prior reports, reviews and fixture bytes
remain unchanged because continuation checks and the final audit reference
them. Later success does not erase a failed attempt or reconstruct an earlier
unrecorded tool identity.

## Task-result findings

Windows and delivery Finalizers treated already supplied contributor evidence
as missing. In the final delivery case, Solver read the observation/parser
sources but omitted the observed `recommendation: stop` value and proposed an
incorrect Central projection repair. Reviewer supplied the permitted enum
values from schema/type sources. Both complete contributions were in the
Finalizer instruction, but it adopted Reviewer's limited-source perspective
instead of joining the facts.

The delivery final therefore covers 0/4: it does not diagnose invalid optional
assessment metadata, propose semantic validation while preserving visible
output, cover the required regressions, or provide the requested evidence-based
diagnosis. This score does not mean every sentence is false. The complete
review retains the reasoning for all cases and both earlier audits.

All three baselines and six contributors in successful pairs read their full
assigned sources; all three Finalizers made no new reads. Missing original
facts in a contribution and facts delivered but ignored are different failures.
The evidence does not establish that routing caused these omissions or that
successful context delivery guarantees correct finalization.

## Verification and limits

Closure verified all 13 excerpts, nine task-input hashes, accepted read IDs and
digests, raw capture equality and each execution's source pins against its own
commit. Final answers were bound to completed Finalizer Run/output identities
by the pinned live helper. Retained fields were audited after cleanup; there
was no fresh join against the removed database. Central instructions and
Bridge-projected stdin hashes remain distinct; full projected stdin was not retained.

Nine focused workspace checks and three synthetic Server/Bridge flows passed;
the consumed real entrypoint also rejected with no provider executable on its
child PATH. Installed-CLI loopback and bounded-diagnostic checks passed, and
owned live/offline roots were physically removed. Current maintenance commands
are in [the usage guide](../discussion-usage-guide.md#维护与后续验证).

This is a completed bounded experiment with unpassed answer-quality criteria,
not a deployed repair or measured user-productivity gain. Keep the maintenance
freeze and Single Agent first guidance. TASKS.md alone records delivery status.
