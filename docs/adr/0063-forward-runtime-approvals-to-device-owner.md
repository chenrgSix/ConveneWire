# ADR-0063: Forward Runtime approvals to the Device owner

- Status: Accepted
- Date: 2026-09-09
- Owner: Bridge, Run, Security and Web
- Amends: [ADR-0062](0062-trust-owner-devices-for-central-execution.md)

## Decision

The owner requested the interactive path: Codex requests permission, Bridge
pauses that process, Central presents the request, and the owner's decision
returns to the same process. Full device trust bypasses approval and therefore
cannot demonstrate this behavior.

Add a separate, default-off local Central approval mode bound to the exact
pairing and monotonically increasing consent revision. Changing modes drains
the worker before persistence. Central cannot enable the mode. Eligible ordinary
Codex Runs pin this revision, retain the configured sandbox and use on-request
approval. Private, governed and conversation-proposal Runs retain their gates.

Bridge submits bounded command/file-change approval details over authenticated
outbound HTTPS and polls the durable decision. Only the exact Device owner with
a full Web session and current Room membership may inspect and decide. A Team
administrator is not a substitute for that owner. Approval details appear in
an owner-only control surface, never in Room messages, reasoning or logs.
Local consent explicitly includes disclosure of command and path details for
this review. Recognized credential material fails closed before transmission.

Each request has a fresh random identity, immutable operation details, Run,
Agent, Device, consent revision, connection epoch and bounded expiry. Allow and
deny are single-request decisions, never session or policy amendments. Request
and decision retries must match their original content. Stale revisions,
terminal Runs, revoked ownership, expiry, disconnect/reconnect and server
restart invalidate pending delivery. No decision automatically starts a new Run
or a replacement process. Runtime methods not explicitly supported are rejected.

The first slice supports Codex command execution and file-change approvals.
Other runtimes and permission-profile/session grants are outside this slice.
Existing full trust and restricted modes preserve their behavior. Optional
capability and delivery fields keep legacy peers from gaining authority.

## Verification

Use generated TypeScript/Go contracts, negative authority and stale-state tests,
Go cancellation/race tests and deterministic subprocess interoperability.
Verify the production Web approval controls and physical temporary file side
effect only after allow, with no side effect on deny or timeout. Model calls and
actual owner settings are not part of routine implementation verification.

Delivery state belongs only in `docs/TASKS.md`.
