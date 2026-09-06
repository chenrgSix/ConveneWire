# QA-073: Repair evidence-reader visibility and diagnostics

## Authorized scope

The Owner requested a repair after QA-072 returned no source reads. This task
uses only provider-free and installed-CLI loopback tests. QA-072's nine-call
plan remains consumed; no model rerun, new task fixture, production Discussion
policy or authority expansion belongs here.

## Acceptance

Inspect the tool catalog actually emitted by the CLI before simulating tool
selection. Cover the builtin provider configuration as well as the custom
offline provider, and require a callable route to the exact authorized reader.
Drive simulated calls from the advertised schemas instead of assuming a tool
exists. Detect missing/mismatched catalogs as setup failure, not answer quality.

Retain bounded server/tool identity from started and rejected calls, including
incomplete event sequences. Preserve progress text separately from terminal
answers and require successful terminal evidence before declaring delivery.
Keep argument content, credentials, local paths and raw provider diagnostics
out of retained reports. Preserve source authorization and negative checks.

Keep QA-072 fixture, freeze, scoring and results byte-identical. If shared
implementation evolves, verify its old identity against the original Git
commit rather than rewriting the freeze or pretending it used the repaired
code. Prove consumed admission rejects a rerun before provider startup.

Record the reproduced defect, repair, focused checks and remaining live-model
limits here; delivery state belongs only in TASKS.md.

## Reproduced defect and repair

On 2026-09-06, installed Codex CLI `0.153.4` could discover the old reader with
the query `evidence read_evidence`, but returned an empty tool-search result for
`windows-availability`, an exact source identity in the frozen fixture. The
reader's source IDs were present only in input Schema enums; its searchable
description did not name them. This was reproduced against a loopback provider
before changing the reader, including the builtin provider's WebSocket path.

The reader description now includes all four fixed evidence identities. It
adds no source content, preferred source, correct contributor or expected
answer. B and C advertise identical metadata. Their input schemas and
authorization checks remain the same: exact Run, Task, Room, authority,
revision, digest and allowed byte range. A still has no evidence reader.

The new regression inspects the actual CLI provider request, searches each
source ID, selects a tool from the returned schema, then checks that the real
MCP return reaches the next provider request with the exact original content,
digest and byte count. It covers A/B/C with both the custom HTTP provider and
the builtin OpenAI provider using WebSocket, including empty warmup responses
and incremental requests. It does not assume a reader exists before discovery.
The existing `ws` version is now an explicit test dependency; its locked bytes
are unchanged.

This identifies a discoverability defect, not the unique cause of the old
failures. QA-072 retained neither search queries nor rejected tool identities,
so its two failed C sessions cannot be retrospectively attributed to this
specific query or tool. Earlier tests selected the correct tool name and did
not establish discovery by source identity.

## Diagnostic records and terminal answers

These records belong to the experiment adapter, not the Result wire contract
or an additional Contribution store:

| Record | Meaning and limits |
| --- | --- |
| `readerLifecycle` | At most 64 entries per reader process: startup, initialized, tools listed, call started and call returned; retains Run identity, observation time, tool-definition/schema digests and bounded status metadata |
| `toolEvents` | At most 64 CLI observations: item ID, kind, stage, server, tool, status, decision and time; retained before requesting shutdown, including rejected starts |
| Incomplete identities | A started call with an item ID can wait for an identity update; missing terminal identities, unfinished calls at turn completion, anonymous MCP calls, foreign tools and baseline reads fail closed; repeated observations do not count as new reads |
| `progressMessages` | At most 16 byte-bounded messages with phase when provided, item ID and time; omitted counts are explicit |
| `candidateAnswer` | Bounded UTF-8 text from the CLI's separate final-message file; retained even when the process fails, but not declared delivered |
| `finalAnswer` | Populated only after a successful process, successful terminal turn, a nonempty final-message file and no adapter failures; explicit commentary is not a final answer |
| `evidenceAccess` | Separately records configuration, reader catalog observation and successful source returns; model discovery is explicitly `not_observable_in_cli_json` |

The adapter checks the catalog definition digest against its expected reader.
Missing or mismatched catalog observations are setup failures. A catalog
observation proves the CLI listed the reader, not that the model discovered or
understood it. Only the offline provider test can directly inspect the outgoing
tool catalog and the source return in subsequent requests. No live traffic
capture or credentials are added.

Read Receipt version 1 is unchanged: it proves which bytes the reader returned,
not model delivery, understanding or claim verification. Tool event metadata
does not retain arguments, raw errors, credentials or local paths; invalid
identifier strings become null. Model-authored text is retained as text and
is not represented as automatically sanitized or verified evidence.

The CLI's documented [JSON event stream and final-message file](https://learn.chatgpt.com/docs/non-interactive-mode)
provide separate progress and terminal observations. Its MCP
[`required` setting](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
requires initialization; it does not prove discoverability. The builtin
loopback uses the documented
[`openai_base_url` override](https://learn.chatgpt.com/docs/config-file/config-reference).

## Historical preservation and validation

QA-072's fixture, sources, contributions, base instruction, C rule, receipt
schema, freeze, scoring and three result/assessment artifacts remain
byte-identical. The historical audit verifies all 23 frozen file pins against
the recorded source commit `edd19e0e4f66995d53eb3f4b2017b3a133aef2f1`, and
additionally checks frozen documentation inputs against the current files.
Shared tooling can therefore be repaired without rewriting which code ran.

The consumed-plan check runs before source checks or executable discovery.
A subprocess test with no executable search path proves the old execution
entrypoint rejects admission before it could launch a provider. This repair
does not reopen the old plan; any future model experiment needs a newly
authorized freeze that includes the repaired metadata and adapter behavior.

Focused validation uses `npm run test:discussion-evidence-access`: authority
and range negatives, transport receipts, A/B/C loopback, terminal/progress and
started/rejected-call handling, malformed events, UTF-8 and telemetry limits,
consumed admission, and two retained-report audits. Documentation is checked
with `npm run lint:docs`; whitespace with `git diff --check`.

On 2026-09-06, Node `22.23.1` and Codex CLI `0.153.4` passed all 30 focused
checks, including both retained-report audits. Documentation lint covered 403
files with zero issues, and whitespace validation passed. Nine retained
historical input/result files were additionally compared byte-for-byte with
the pre-repair HEAD; all matched. All 11 invocation-owned test roots from this
repair were physically absent after cleanup. The final focused suite took
12.68 seconds; this is local test duration, not external-model performance.

No production Discussion scheduling, storage, completion policy, participant
selection or Result acceptance code changes. Successful Run delivery here
still does not imply criterion acceptance; incomplete evidence use remains a
separate content/compliance observation, not a new completion gate.

The loopback uses no real account or external model: its builtin-provider
authorization header contains a fixture constant. ChatGPT account routing and
real model tool selection have not been revalidated. These checks demonstrate
mechanical discoverability and observability only; Q1/Q2 remain inconclusive,
and no Discussion quality improvement is claimed.
