# SEC-018: Installed Codex command approvals

Date: 2026-09-09. Dependency: [SEC-017](sec-017-central-runtime-approval.md).

## Reproduction and cause

With explicit owner permission, the native client enabled Central approval
revision 3 and one ordinary Room message requested a unique file outside its
repository workspace. The Run carried that exact approval revision and reached
the installed Codex 0.153.4 process, but ended with `CODEX_PROTOCOL_INVALID`.
No Central approval row or target file was created.

An isolated replay using the same installed CLI and a loopback Responses fixture
confirmed that local command requests carry `environmentId: "local"`. The
adapter rejected every non-null environment ID. Earlier synthetic command
fixtures omitted the field, so they did not detect this compatibility defect.
The old work-authorization response and this protocol rejection are separate
stages: this confirmed reproduction passed the initial routing stage.

## Repair and verification

The adapter accepts an explicit local environment, retaining absent/null
compatibility. Unknown, remote and empty environment identifiers still fail
closed, as do network-only scope, stdin injection and session-wide grants.
The request still waits for the exact owner's one-operation decision; no sandbox
policy, full-trust setting or standing authorization is broadened.

- Go parser regression covers absent/null/local, callback ID zero, and negative
  remote/empty/network cases. Process fixtures now include the local environment
  and exercise allow, deny and cancellation without replacing the Runtime.
- The Central/Go Bridge scenario's command fixtures also include `local` and
  retain command allow/deny and file-change allow coverage.
- `codex-approval-protocol.test.mjs` runs the installed CLI with an isolated home
  and unauthenticated loopback provider. It verifies the actual local callback,
  returns denial, waits for turn completion and checks that no file was written.
  Its two provider responses are fixed local data, not real model calls.

Passed locally: focused Runtime `go test -race` and `go vet`; installed CLI
compatibility (one test); real Central/Go Bridge process scenario (three Runs,
three approvals, zero standing work authorizations); documentation lint and
changed local links. No browser review is claimed by this process scenario.

## Installed repair

The existing macOS Bridge was updated to `v0.5.6-local.ef61656`, exact source
`ef61656b99d7868588eaac92734952000db95b95`. Native desktop/helper packaging
passed; all eight installed application files match the candidate. The new
authenticated connection reports that source and its executable SHA-256.
Three Agents are ready, with the two Codex Agents still advertising the
owner-enabled Central approval revision 3.

All 35 existing client JSON files, business row counts, Central installation
manifest and private CA were preserved. Central remains on the previous version;
this repair changes only the Bridge adapter. Private application/config backups
and installation receipts remain in the ignored local upgrade directory.

## Live owner approval acceptance

After separate owner authorization for one further real model invocation, the
same ordinary Room message was sent through the owner's logged-in browser. The
installed Codex 0.153.4 used `gpt-6-astra` and requested an escalated command to
write `approval-ok` to the unique test file outside the repository workspace.
Central displayed the exact command, working directory, reason and **Allow
once**/**Deny** controls. The owner clicked **Allow once** in Central; the test
operator did not submit the decision through an API or click it on their behalf.

| Event | Local time (Asia/Shanghai, 2026-09-09) | Evidence |
| --- | --- | --- |
| Original Run started | 11:34:36.926 | One ordinary Room Run |
| Central approval became pending | 11:34:50.888 | Exact owner-bound approval row and visible dialog; target absent |
| Owner allowed the operation | 11:38:34.128 | Immutable allow decision with deciding Web session |
| Target file written | 11:38:34.714 | Filesystem timestamp after decision; exact bytes `approval-ok` |
| Original Run completed | 11:38:57.318 | Completed Run and browser-visible Agent result |

The pending process snapshot and Runtime logs identify the same Codex PID
through completion. The same native turn started before approval and completed
after it. There was exactly one new Run and one approval in this retest, with no
replacement Run. The owner confirmed the browser action, and read-only checks
verified the resulting file. Private dialog, process, Runtime metadata and
database receipts are retained alongside the local installation evidence.

This completes the live **client request → Central dialog → owner allow →
client continuation** acceptance on this installed macOS/Codex combination.
Across reproduction and retest, two separately authorized real model Runs were
used. Real model denial and other physical platforms were not exercised here;
denial/cancellation coverage remains the offline and deterministic regressions
listed above. No CI, release publication or broader platform acceptance is
claimed.
