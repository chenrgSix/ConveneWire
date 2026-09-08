# ADR-0060: Preauthorize local work policies

- Status: Accepted
- Date: 2026-09-08
- Owner: Bridge, Execution, Repository, Verification and Web

## Context

Ordinary Room Codex Runs can edit a workspace while `.git` remains read-only.
The Bridge uses non-interactive Runtime approval and rejects interactive
requests. Asking the owner to approve every Task on the local client would
require an attended machine and does not satisfy everyday remote Room work.
The owner authorized a persistent, revocable work policy with automatic exact
Task grants, local Git delivery and browser verification. Existing local work
was preserved in commit `240a472` before this change started.

## Decision

The device owner configures a local standing work policy once. A policy binds
the paired Server/Team/Device/Owner namespace, exact repository registration,
allowed Rooms and human initiators, one configured Agent, Runtime/verifier
fingerprints, source ref, output path scope, operation allowlist and finite
validity and execution limits. Missing or ambiguous matching policies deny
admission. A policy is never a universal bearer grant or a natural-language
permission instruction. Its definition, local commands and credentials remain
on the device. Readiness, authorization and physical probe results are distinct.

For an explicitly selected Room development task, Central freezes the task
contract and authenticated initiator. A bounded negotiation pins the local
source revision and compiles the existing single-node governed plan. Bridge
derives an immutable exact Task grant only after rejoining the current policy,
repository identity and authenticated task/plan revision. The existing
execution admission, worktree, capture, verification and candidate-commit paths
remain authoritative. Chat, review, Discussion and unconfigured Agents retain
their existing behavior; messages are not heuristically promoted into writes.

Every derived grant records its parent policy identity and digest. Revocation,
expiry, changed binding/profile, another initiator, changed task or plan,
wider paths/operations and replay with changed content fail closed. Revocation
invalidates existing derived grants as well as future issuance; queued work
cannot start and active work is canceled through the existing process fence.
An unknown process or side effect is reconciled before retry, never blindly
duplicated. Policy updates require a new immutable policy and explicit
revocation of the previous policy. No overlapping grant silently wins.

The first policy supports prepare, capture and named verification profiles.
Candidate commits are produced by Bridge from exact captured bytes. Integration,
push, deployment, destructive cleanup, arbitrary shell escalation and remote
policy administration keep their separate authority; the first release does
not implement remote expansion of device permissions. Runtime remains
`approvalPolicy: never`; typed local operations execute under owner policy.

Browser verification is a separately approved local verifier configuration
with an isolated browser profile, exact allowed origins, bounded process tree,
temporary storage and retained diagnostics. It must report startup, page load,
interaction assertions, screenshots and visual review separately. A screenshot
or SIGABRT is not evidence of visual acceptance or a proven sandbox cause.
Code snapshots, tests, candidate commits and visual acceptance have separate
evidence. Only the corresponding execution receipt can establish completion.

## Product flow

The local client provides policy setup, inventory, expiry and revocation. Once
configured, a user can initiate supported development Tasks from Room without
an attended client or command-by-command approvals. Room displays path-free
capability readiness and actionable blockers, with a link to the owner device
when a policy must change. A policy never bypasses existing Task/Run budgets.

## Acceptance

The goal is met when one policy permits two different supported Tasks to run
without another local confirmation and each produces isolated code, verification
and candidate-commit receipts. Rejection, expiry, parent revocation, stale
scope, duplicate delivery, cancellation and restart cannot expand authority or
duplicate work. Browser validation must run against disposable local fixtures;
live model calls, installed-client migration, external publication and physical
platform claims require their separately applicable evidence.

Delivery states and dependencies live only in `docs/TASKS.md`. The owning module
documents record contracts and acceptance, not another completion checklist.
