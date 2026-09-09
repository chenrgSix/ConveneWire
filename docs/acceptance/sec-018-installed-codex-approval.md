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

Installed repair and a subsequent owner decision with a real model remain
pending. The first authorized real model call reproduced the failure; offline
compatibility coverage is not a claim that live approval has succeeded.
