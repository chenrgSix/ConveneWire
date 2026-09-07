# ADR-0056: Authorize exact evidence disclosure

- Date: 2026-09-07
- Status: Accepted
- Owner: Security, Task/Result and Bridge

## Decision

SEC-015 adds an explicit production disclosure path using existing authenticated
Member, Device, Agent, Run and Result identities. QA-082 verifies it without
external model calls. QA-079/080/081 remain historical mechanism evidence, not
production authorization or repeatable model budgets.

The Central remains the identity and disclosure-grant authority. A full Web
session belonging to the Device's actual owner grants or revokes a disclosure;
Team administration alone cannot impersonate that source owner. A Device bearer
credential authenticates transport, but cannot manufacture human disclosure
consent. No caller-supplied public key or grant-state snapshot is a trust root.

An immutable grant binds the owner Member, Device, Agent, Run, Task and Room,
an opaque source identity, fixed source revision/hash/range, exact released UTF-8
bytes/hash, expiry and a stable publication operation. The audience is explicitly
the existing Room membership; a Finalizer Run binding is not a private Room ACL.
Approval of disclosure is distinct from verification of truth and human Result
acceptance. Central validates identity, scope and exact bytes, not the private
source's semantic truth. The source owner attests its source binding.

## Local output boundary

An explicitly configured owner-private Agent retains its candidate reply locally
and sends only content-free status. Output deltas, activities, errors, session
details, clarifications and assessment bodies must not bypass that boundary.
The mode is advertised and frozen into delivery; unsupported or mismatched
execution fails closed before Runtime starts. Ordinary Agents retain existing
behavior. Private collection does not automatically become a Discussion
contribution or a Result and does not change scheduling or completion policy.

The first release workflow is explicit: inspect/select the exact local content,
prepare a bounded digest-bearing request, approve it as the authenticated source
owner, then publish through Bridge. Before sending content, Bridge checks current
grant status and all scope/content pins. Central commits the released evidence
and ordinary informational Result together. A source Run's content-free persisted
event supplies the existing Result linkage. No alternate contribution store or
automatic free-text policy classifier is introduced.

## Revocation and recovery

Central grant revocation and first Result publication are serialized by the same
database transaction boundary. Publication rechecks current grant, credential,
Device/Agent ownership, Task assignment and Room access inside that transaction.
An expired or revoked grant cannot create a new Result. If publication commits
first, later revocation does not retract already disclosed bytes or erase audit.
An exact retry resolves an already committed operation, even after disclosure
revocation, only for a currently authenticated and authorized reader; changed
payload or actor is rejected. An offline local revocation request is pending
until Central acknowledges it. Local permission checks do not imply distributed
commit-time revocation, and commit checks cannot erase bytes already transmitted.

## Scope and acceptance

Use generated TypeScript/Go contracts, real HTTP/Bridge transport and separate
Member/Device credentials in disposable integration tests. Exercise wrong-owner
approval, caller-forged grants, foreign source/Run/Room, changed content/range,
expiry, credential/device revocation, both publication/revocation orders,
ambiguous commit retry and private-output leakage sentinels. Preserve Result
review and acceptance authority. Prove an authorized released Result can enter
the existing final evidence path without changing Discussion orchestration.

Physical owners/devices and production installation require their own explicit
consent and acceptance; local independent credentials do not substitute for
that evidence. New model comparisons, implicit disclosure, semantic validators
for arbitrary claims, Review Waves and new completion gates are excluded.

## Implementation boundary

Private capability negotiation is per live connection epoch, not merely the
persisted Agent record. A reconnect or older Bridge cannot inherit that capability.
Private mode changes the native session fingerprint and disables session resume,
streaming, supplemental contribution publication, Artifact publication and
handoff. The Runtime wrapper is a Bridge transport boundary; it is not an OS
sandbox for arbitrary child-process network calls. Owners must retain control
of their Runtime tools and filesystem/credential isolation.

The initial local store requires POSIX owner-only permissions. Windows private
mode is explicitly rejected at configuration validation until Windows ACL
support and native acceptance exist; ordinary Windows Bridge behavior remains
unchanged. There is no claim of physical Windows acceptance.

The first released Result contains the exact text as an informational summary
and cites the private Run's content-free completion event. Source identity,
revision and range stay bound in the authoritative grant. They are source-owner
attestations, not proofs that the summary follows from the private source.
Existing Room Result reads and `team.list_task_results` expose only the released
Result to an authorized consumer. Private Runs are not automatically admitted as
Discussion turns or injected into Finalizer instructions; production Discussion
scheduling, contribution acceptance and recovery remain unchanged.
