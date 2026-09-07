# ADR-0057: Admit authorized disclosure to Discussion

- Status: Accepted
- Date: 2026-09-07
- Owner: Discussion, Task/Result and Security
- Extends: ADR-0056

## Decision

DISC-021 connects the existing exact owner disclosure workflow to production
Discussion. It does not authorize disclosure automatically. A private contribution
Run completes locally; its existing Discussion turn waits for an owner-approved
Result until the existing Wave deadline. The first eligible committed Result for
that exact Run is admitted once through the existing turn assessment's Result
reference and Result lifecycle Message. No parallel contribution body store,
synthetic Runtime reply or model-authored approval is introduced.

Admission requires the same Task, Room, Agent, Run and current Task definition and
criteria revisions, an authoritative disclosure grant, and exact approved content.
One Result is selected deterministically by Result version. A completed turn is
immutable: later Results remain ordinary Task evidence and do not rewrite that
turn or an already created Finalizer instruction. Restart reconciles committed
Results from storage; the publication response is not an admission authority.

The private turn waits without occupying another Runtime or spending another
model call. At the Wave deadline, missing disclosure becomes an explicit missing
contribution. Finish/pause stops waiting at the next reconciliation; cancellation
closes it without admission. Existing Wave budgets, decision rules and human
Result acceptance remain authoritative. Read-only quorum excludes private Agents
because they cannot provide its required public reply/supplemental protocol.

A shared-output Finalizer is required when requesting a final artifact. Private
Agents cannot be selected as the automatic shared Finalizer. The ordinary
participant selector and non-private Discussions retain their existing behavior.

## Evidence and authority

Finalizer input contains admitted Result identity/version, released content digest,
source identity/revision/hash/range and owner provenance, together with canonical
Task Criteria. These are disclosure and source-binding attestations, not semantic
verification. No supported claim, reviewer approval or criterion satisfaction is
fabricated. Missing, stale and input-budget-limited evidence is explicit; bounded
rendering records incomplete inclusion and must not claim a complete source read.
The existing persisted Run instruction freezes the actual supplied content.

Only released Room-audience bytes may enter shared inputs. Neither private files,
candidate replies nor uncommitted grants are inputs. Consumers must remain
authorized Room participants; creation and managed delivery recheck that boundary.
ADR-0056 commit-time publication/revocation semantics remain unchanged: revoking
future publication does not recall a Result already disclosed to the Room.

## Verification and limits

QA-083 uses disposable production Central/Bridge transport and independent local
credentials, with no external model calls. It covers delayed approval, withholding,
revocation, cancellation, offline delivery, duplicate/out-of-order callbacks,
restart after committed publication, immutable late evidence, current consumer
authorization and bounded input disclosure. Existing ordinary Discussion and
contract regressions remain required.

Physical two-owner/two-device installation, owners' exact material consent and
any external model budget require separate concrete authorization. QA-084 remains
planned for that acceptance. POSIX-only private storage and the absence of an OS
sandbox remain ADR-0056 limits. No Windows ACL claim, Targeted Review, automatic
startup, model quality comparison or general multi-Agent superiority is implied.
