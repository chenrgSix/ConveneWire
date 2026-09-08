# ADR-0062: Trust owner devices for Central execution

- Status: Accepted
- Date: 2026-09-09
- Owner: Bridge, Run and Web
- Amends: [ADR-0061](0061-continue-development-from-conversation.md)

## Decision

Provide an explicit local **完全信任此设备** setting for a paired owner device.
The owner consents once to allowing members already authorized to use that
Device's Codex Agents through the current Central to execute ordinary requested
work with full local process, filesystem and network access. This is a separate
choice from the existing constrained work-policy path. It requires no repository,
profile or per-task policy registration. Generic/Pi runtimes retain their own
permission behavior; owner-private and governed Runs retain their existing gates.

Consent is disabled by default, stored locally with a monotonically increasing
revision and bound to the exact Central origin, Device and owner identity.
Enabling or revoking drains the current Bridge worker and its processes before
replacing the local configuration and reconnecting. Concurrent/stale mutations
cannot restore an older decision. Central cannot enable this setting remotely.
Switching pairings does not transfer consent.

The Bridge publishes the bound full-trust revision in its authenticated Agent
Runtime policy. Central exposes the status to authorized Room members and pins
the revision into each eligible ordinary Run delivery. The Bridge requires an
exact current local match before starting Codex with full-access sandbox and
noninteractive approval. A stale or forged pin fails before process launch;
missing pins never receive full access. Revocation stops the local process first
and prevents stale Central delivery on reconnect. Existing task budgets, Room
membership, cancellation and governed admission remain authoritative.

This makes normal conversation the direct execution path on a trusted device;
the read-only proposal stage and standing-policy negotiation remain available
on devices without full trust. The ordinary Runtime can modify the configured
checkout and use Git or a browser as requested. It does not fabricate structured
candidate/verification receipts or claim isolated-workspace guarantees. The
trust setting grants execution capability, not an instruction to publish,
communicate externally or perform actions absent from the user's task.

Only scope and consent status synchronize to Central. Local executable paths,
environment secrets and credentials remain local. The owner-facing control names
the effective Central and warns that permitted members can exercise the owner's
local access. The product does not label this mode sandboxed or read-only.

## Verification

Verify default-off, explicit consent, exact revision, durable reload, changed
pairing, stop-before-revoke, failed save and restart failure. Verify authenticated
publication, optional legacy omission, Central display and frozen Run pins;
forged/stale pins and governed/private combinations cannot gain full access.
Use deterministic subprocess fixtures for the actual Codex thread parameters
and a temporary project/browser fixture for the local control and central flow.
Do not enable a real owner's setting or call models during implementation tests.

Delivery state belongs only in `docs/TASKS.md`.
