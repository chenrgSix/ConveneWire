# ADR-0052: Compare strong Single Agent and bounded Discussion

- Date: 2026-09-06
- Status: Accepted for one Owner-authorized twelve-session experiment after freeze
- Owner: Discussion experiment tooling

## Decision

Stop expanding Finalizer prompts, claim adjudication, criterion closure,
Targeted Review and ordinary Waves in this research stream. QA-077 established
six correct critical answers with GPT-5.5. Its two wording-sensitive failures
are disputed, not reliable evidence of table harm. Preserve the original
assessment and its [interpretation amendment](../acceptance/qa-077-gpt55-criterion-closure.md#interpretation-amendment-after-wording-review).

QA-078 asks whether two independent contributions plus synthesis improve
complete delivery over one capable Agent on a new cross-domain engineering
review. Use exactly `gpt-5.5` with low reasoning effort for every session;
the [official model page](https://developers.openai.com/api/docs/models/gpt-5.5)
documents that model identifier and effort. Do not substitute models, optimize
prompts against observed answers or reuse Windows/retention sources.

The [acceptance design](../acceptance/qa-078-strong-single-discussion.md) defines
S/D, D/S, S/D: three trials per arm, six final artifacts, at most twelve fresh
model sessions. S is one session with all sources. D is two independent
contributor sessions followed by one fresh Finalizer session. Contributions
are generated anew per trial; freeze their generation protocol, not their
future contents. Contributor source assignments are fixed before execution.

S and the D Finalizer receive identical Task/Criteria, source index, full-source
read grants, evidence-use rules, tools, common answer instruction and limits.
D alone also receives the two current-trial contributions in fixed ordinal
order. Neither final prompt requires a claim or criterion self-assessment
table. Contributors have the same tool implementation but narrower declared
source grants. All sources are owner-authored synthetic materials, with their
provenance disclosed; all grants remain bound to exact evidence/version/range
and current Run/Task/Room/authority.

Use an isolated benchmark adapter with one contribution Wave and one
finalization phase. Reuse existing Result/source semantics and bounded reader
instrumentation; do not add production persistence or alter the production
scheduler, participant selection or completion policy. Freeze and disclose the
adapter's differences from shipped Discussion, including common final prompt
and fresh-session behavior. Its results describe the tested pipeline, not
production end-to-end quality or real permission-isolated collaboration.

## Acceptance and interpretation

Judge semantic task behavior and complete required delivery before examining
arm identity or contributor traces. Correctness, concrete omissions, ambiguous
wording, unsupported additions and runtime failure remain separate. The first
assessment stays immutable; later disputes are append-only amendments with
quotes and reasons. Equivalent safe behavior cannot fail for lacking a magic
word. No grade may require an unstated test vector or response format.

The primary endpoint is full required deliverable pass, with critical pass,
correct-fact retention, uncertainty, actual source returns, runtime failure and
whole-team elapsed time reported separately. No net score substitutes for
acceptance. A Discussion candidate signal requires D=3/3 full and critical,
S at most 1/3 full, valid execution, no unsupported additions or lost required
facts/uncertainty in D, and a conclusion unchanged by disputed grading items.
This only motivates another independent task; it does not prove product gain.

This comparison deliberately spends up to three sessions on D and one on S.
It cannot isolate orchestration from extra computation or establish equal-cost
superiority. ADR-0043 still excludes token and monetary accounting. Report
actual sessions, critical-path time and summed session time, without inferring
cost from call counts. Three repetitions of one task are not three tasks.

## Execution boundary

Freeze the complete new sources, public criteria, private reference/rubric,
fact/uncertainty anchors, prompts, source partitions, output limits, adapter,
CLI/configuration/catalog identity and order before any model execution. Use
offline tests and reference artifacts to establish solvability; no real-model
pilot is permitted outside the twelve-session budget. The final bounded plan
must bind Owner authorization to the exact packet and existing destination;
no prior consumed QA plan is reusable authority.

The Owner subsequently requested “可以，定好目标把制作并冻结题包、参考答案和评分规则到实验完成做完”.
This authorizes preparing and freezing the packet and running this exact
twelve-session ceiling through assessment, without another permission round.
The packet retains that instruction, model, destination, order and fresh Run
identities. Existing consumed plans remain closed. Synthetic sources and the
reference are authored by the implementation assistant acting for the Owner,
not independent human experts. Only TASKS records delivery state.

The isolated adapter retains ordinary plain replies and their source-return
metadata in the experiment journal. It does not manufacture Result proposals,
criterionClaims or production Artifact verification. Future contributor text
cannot be frozen beforehand; its exact generation and lossless transfer are
frozen, and each new reply is bound to its current Run and hash. The private
rubric and reference are never passed to a model. Natural-language judgments
are manual semantic review; code verifies their coverage, quotes, identities
and aggregation, not their truth. Existing production contracts, credentials
and acceptance authority remain unchanged.
