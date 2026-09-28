# ADR-0075: Per-connection Peer execution trust

- Status: Accepted
- Date: 2026-09-28
- Owner: Bridge Peer Runtime
- Amends: ADR-0068 Participant approval policy

## Context

Repeated Participant approvals make an intentionally shared LAN Agent difficult
to use. The owner requests full trust by default for Peer sharing, with a visible
per-connection opt-out. Legacy Device execution consent remains unchanged.

## Decision

The Participant owns an optional `PeerLocalConnection.executionTrust` preference.
Absence means enabled at revision zero, including existing joined connections.
An explicit choice persists as a boolean and monotonically increasing revision;
it cannot be deleted or reset by synchronization, reconnect or restart. Join
receipts cannot supply this local preference. It is bound to the immutable local
connection, including Host identity, Participant, membership and Team.

Only the authenticated local Owner Console can change the preference, using
its expected revision. The joined-space card displays the effective mode and
explains it before joining. Full-trust Codex uses `danger-full-access` with
`approvalPolicy: never`, allowing its commands, file access and network access
under the local account. Disabled trust restores the configured restricted
sandbox and Participant-local approvals. Pi and generic runtimes keep their
existing runtime permission behavior; they do not claim Codex approval support.

Changing the preference cancels and drains that Peer connector's executions and
pending approvals before replacement. Execution rechecks include the exact trust
revision before and after waits. Native session fingerprints include the trust
revision, so a changed mode cannot resume a session with older permissions.
Process and Run journals retain their original identities and prohibit replay.

Membership, export/acceptance scope, expiry, Host admission, cancellation and
publication rules remain authoritative. Trust does not create Agent exports,
broaden Room scope, fabricate Device consent, or transfer another Authority's
permissions. The local preference is never part of Host proof or wire payloads.

## Compatibility

The optional private-state field preserves reads of older stores. Explicit off
survives future upgrades. Older strict readers reject a store after a preference
has been saved; downgrading requires a compatible application, not deleting the
preference. A missing or corrupt existing store still fails closed.

## Verification

Use offline fixtures for persistent opt-out, revision conflicts and isolation,
Owner authentication, default full-trust Codex execution, restricted approvals,
mode-change cancellation, session separation and duplicate prevention. Validate
the closed state contract in TypeScript and Go with actual interoperation.
Run owning Go race/vet and embedded UI tests. No real model is required.
