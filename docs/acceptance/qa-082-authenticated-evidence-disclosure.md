# QA-082 authenticated evidence disclosure

The production goal is explicit source-owner authorization connected to real
Bridge transport and existing Result storage. See
[ADR-0056](../adr/0056-authorize-exact-evidence-disclosure.md).

Local acceptance uses two different Members and Device credentials, separately
scoped sources, a shared Task/Room and an authorized final evidence consumer.
It includes exact-content consent, private candidate retention, no raw streaming
egress, current-authority publication, revocation races and ambiguous-commit
idempotency. These checks call production entrypoints, not the QA disclosure
adapter. No external model calls or live user-data disclosure are authorized.

Human approval binds exact bytes and destination; it does not certify correctness.
Grant status, Run outcome, Result proposal and Result acceptance remain distinct.
An unavailable source remains unavailable to the final consumer.

Physical multi-owner/device acceptance and installation are separate future
evidence. Delivery state and dependencies are recorded only in TASKS.md.

## Local outcome, 2026-09-07

The implemented path is:

```text
Private Runtime → local candidate → owner reviews exact text
    → full owner Web session approves metadata
    → paired Bridge reads current Central grant
    → atomic exact-content Result publication
    → existing authorized Task Result reader
```

Two independently issued Member sessions and two Device credentials were used
on one disposable local host. Central derives the source owner from its existing
identity tables; it does not trust a caller-supplied grant, public key or active
snapshot. This proves credential separation, not separate physical machines.

| Boundary | Observed outcome |
| --- | --- |
| Ownership | Alice cannot approve Bob's disclosure; a Device token cannot approve human consent; a foreign Device cannot read or publish the grant |
| Fixed scope | Changed content, source range, Run, Device, criteria, expiry, extra caller grant state and a reserved Result operation are rejected |
| Local output | Candidate text stays in a private local file; reply/output/activity/error/session bodies do not enter shared Run/Room data; private failure and restart use a content-free terminal envelope |
| Compatibility | Actual WebSocket publication preserves the private capability; each connection epoch must redeclare it; local/wire mode mismatch cannot start Runtime |
| Current authority | Room access and revoked Device/credential checks deny later publication; disclosure revocation and first publication share the same Central transaction boundary |
| In-flight revoke | The test pauses a real HTTP request after Central receives its body and before its handler commits, acknowledges revocation, then resumes: no Result is created |
| Ambiguous commit | A real publication response is dropped after commit, Central is reopened, the grant is revoked, and an authenticated GET resolves the one existing Result |
| Atomic rollback | Injected grant-link failure rolls back the Result and lifecycle message; repair permits the original operation to publish |
| Existing consumption | Room Result reads and the existing manual Agent Task tool service read both owners' released Results; removing the consumer's Room access denies the next read |
| Acceptance | Published Results remain informational/proposed with no review; neither disclosure consent nor Run completion performs human acceptance |
| Endpoint trust | The Bridge binds its credential to the paired Central origin and refuses redirects; it never automatically retries a content POST |

The source/version/hash/range binding is an owner attestation. Neither Central
nor the final consumer is claimed to have independently checked the private
source's truth. The signed QA-only disclosure model is not used here.

## Verification evidence

The committed tests are the durable reproducible evidence; their disposable
private files, credentials and databases are removed by the repository wrapper.
No historical model journal, frozen fixture or grade was rewritten.

- [Production authority tests](../../apps/server/test/evidence-disclosure.test.ts): independent credentials, actual Go client/HTTP, in-flight ordering, restart, current authorization, ordinary Result bypass and existing consumer reads.
- [WebSocket protocol tests](../../apps/server/test/bridge-websocket.test.ts): 35 checks including the new production private-capability mapping.
- Existing Agent, Result, Delivery, Workspace lease and Bridge event tests: the combined focused Server run passed 61 checks before adding the additional WebSocket case; the updated authority and WebSocket files also passed separately.
- [Private Runtime tests](../../bridge/internal/runtime/private_output_test.go), [Delivery tests](../../bridge/internal/delivery/runtime_executor_test.go) and [Go disclosure client tests](../../bridge/internal/result/disclosure_test.go): local retention, no streaming egress, mode mismatch, private recovery, source changes, origin/redirect rejection and concurrent file writes. The interop test that normally skips without its temporary Central input was explicitly exercised by the Server suite.
- Contracts: 115 JavaScript checks, deterministic regeneration/type checks, shared disclosure fixtures and Go contract tests passed.
- Web: 20 focused disclosure/criterion/Task-detail tests passed under the Web workspace's JSX configuration. A prior root-directory invocation selected the wrong JSX configuration; the owning-workspace command is documented.
- Go: affected Runtime/Result/Delivery/Connection/Bridge core packages passed race tests; affected modules and the CLI passed vet. Server and Web production builds passed. The existing Web bundle-size advisory remains.
- Documentation lint, changed-document local-link checks and `git diff --check` passed before the completion commit.

## Limits and next acceptance

This closes a bounded production identity/Bridge/Result path on the local test
host. It does not prove Discussion is smarter than Single, validate arbitrary
free-text claims, execute a model, change participant selection or implement
automatic private Discussion contribution admission.

The Bridge wrapper controls its transport events, not arbitrary child-process
network access. Owners still control Runtime tools and OS credentials. The local
private store requires POSIX owner-only permissions. Windows private-mode opt-in
is rejected until native ACL support is implemented and accepted.

Physical two-owner/device use, Windows ACL work, installed-service upgrade and
production Discussion recovery/E2E remain separate acceptance. Before a physical
exercise, actual owners must choose their own devices/workspaces and approve the
specific material to disclose. The restart evidence above concerns publication
and existing Bridge terminal recovery, not a general Discussion Wave restart.
