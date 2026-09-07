# QA-083: Authorized disclosure in production Discussion

## Goal and scope

[ADR-0057](../adr/0057-admit-authorized-disclosure-to-discussion.md) connects
SEC-015 to existing Discussion turns and Finalizer instructions. The Task register
owns delivery status. This acceptance does not authorize external models or real
owner installations.

```text
Private Agent Run completes locally
  → existing turn waits within the Wave deadline
  → source owner approves exact released bytes
  → Bridge publishes an informational Result
  → existing turn records its immutable Result reference
  → authorized shared Finalizer receives bounded evidence and canonical criteria
  → shared reply completes Discussion; human Task/Result acceptance stays separate
```

## Implemented semantics

The existing Result lifecycle Message anchors the turn; no private Runtime reply
is forged. Its assessment contains the admitted Result reference and no invented
reviewer approval or criterion claim. Evidence identity and source binding come
from the authoritative committed grant. Novelty evaluation uses the released text,
not the generic Result lifecycle notification.

The first eligible Result for that exact Run, Task, Room, Agent and current Task
definition/criteria revisions is admitted once. Turn settlement and Wave advancement
share a transaction. If publication committed but admission failed, publication
still returns its receipt and the ordinary sweep or reopened Central reconciles it.
Quorum reconciliation also uses the refreshed member set when constructing its
progress snapshot; transaction rollback cannot silently lose a completed member.

Owner waiting spends no additional Runtime call. The existing Wave deadline closes
missing contributions; finish/pause requests end waiting at reconciliation, while
cancellation prevents admission. A failed/expired private Runtime settles normally.
A Result published too late remains available in the Task but cannot replace a
closed turn or already frozen Finalizer input. Revocation after publication does
not recall already shared evidence, as specified by ADR-0056.

The Finalizer must support shared output. A private-only roster cannot request a
shared final answer, and private Agents cannot use read-only quorum. Existing
ordinary selection policy is retained. Owner membership, Agent membership and
assignment, Device state and Task revisions are rechecked on managed sends,
reconnect retries and acceptance; the Server also fences other dispatch adapters.
Already transmitted bytes cannot be recalled.

## Input accounting

Only admitted, still-current Results enter the explicit owner-evidence section.
The index carries Result/version, owner/Device/Agent/Run, source identity/revision/
hash/range and the approved text digest. Source bindings are owner attestations.
Canonical Task criteria remain in the existing acceptance-evidence section and
Run Context Manifest; no satisfaction claim is synthesized.

The total instruction retains its existing 20,000-code-point ceiling. The private
evidence section uses at most 12,000 code points and the five latest private turns;
earlier omitted turns are counted. Each displayed body records complete/truncated
inclusion, redaction, supplied byte count and supplied digest separately from the
approved content digest. Missing or stale sources remain explicit. These fields
describe input construction, not model reading, understanding or claim verification.

## Durable verification

- [Authority and orchestration tests](../../apps/server/test/discussion-disclosure.test.ts) exercise delayed approval, withheld/revoked evidence, immutable second/late releases, current criteria and consumer scope, finish/cancel, transaction failure and actual Central reopen recovery.
- [Cross-process acceptance](../../tests/e2e/disclosure-discussion.test.ts) builds and runs two real Go Bridge processes using different issued Member/Device credentials and separate local workspaces. Generic deterministic Runtime processes read private source files, retain owner-only candidates, use the real CLI prepare/publish and Owner HTTP approval, and return the final shared answer through production Discussion/Bridge transport. Exactly three contribution Runs and one finalization Run are created. Private sentinels never enter shared Messages or Run instructions.
- [Web regression](../../apps/web/test/discussion-wave-status.test.tsx) proves a completed private Runtime is still displayed as awaiting owner release and does not increment completed contribution counts.
- Existing Discussion, Result/disclosure, delivery, WebSocket and cross-language contract suites cover compatibility. Exact commands are in [Development commands](../development-commands.md#discussion-disclosure-admission-disc-021).

## Limits

The two processes ran on one disposable local host. Test credentials and synthetic
sources are independent fixtures, not independently administered physical owners.
Generic Runtime output is deterministic: this proves transport and orchestration,
not semantic quality or Multi-Agent superiority. No external model was called.

POSIX owner-only files are required; Windows private mode remains rejected. The
Bridge controls its transport, not arbitrary Runtime network access. This work does
not add automatic owner consent, arbitrary claim validation, Targeted Review,
automatic startup, installation upgrades or a new completion gate.

[QA-084 preparation](qa-084-physical-disclosure-discussion.md) records the remaining
physical acceptance boundary. No installed service or real owner data was changed.

## Local outcome, 2026-09-07

The 116-check focused Server run passed, including the new admission checks and
existing Discussion, quorum rollback/recovery, Result evidence, delivery and
WebSocket regressions. An earlier 72-check run also covered the original disclosure
authority tests and actual Go HTTP publication/retry. These runs overlap and are
not added together as distinct tests.

The final missing-source fallback addition passed its affected 14-check suite
(twelve disclosure scenarios and two finalization-instruction cases). A failing
Finalizer retains the explicit count of unavailable private sources without their
candidate text. The earlier quorum failure was repaired by using the refreshed
member list; it passed individually and in the 116-check run.

The two-real-Bridge cross-process scenario passed after the final delivery authority
changes. Ten focused Web checks passed, including waiting-release progress.
All 115 JavaScript contract checks, deterministic generation/type checks and Go
contract tests passed. Server and Web production builds passed; the existing Web
bundle-size advisory remains. No Go source or wire schema was changed.

Maintained Markdown lint, changed-document links and whitespace checks passed.
Disposable test directories and Bridge process groups were removed by the test
resource wrappers. This is local acceptance, not CI, an installed-service upgrade,
physical two-owner acceptance or an external-model experiment.
