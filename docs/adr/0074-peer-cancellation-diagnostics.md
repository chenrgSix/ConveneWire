# ADR-0074: Private Peer cancellation diagnostics

- Status: Accepted
- Date: 2026-09-24
- Owner: Bridge Peer Runtime

## Context

The Codex adapter maps a canceled execution context to CODEX_CANCELED.
That status does not identify an Owner action. Runtime channel failure,
authorization rechecks and parent lifetime termination can all end the context.
Historical records lack the evidence needed to distinguish these sources.

## Decision

Preserve the first context cancellation cause using classified local errors.
Record bounded metadata in a private per-Run diagnostics.json sidecar: UTC
observation times, cancellation source and reason, HTTP status where available,
approval wait transitions, and process cleanup completion. Never serialize raw
errors, commands, callback details, credentials, endpoints or native Session IDs.
Approval wait interruption is an observation, not proof of an Owner denial.

Diagnostics are best effort and confer no execution, replay or publication
rights. Existing authorization, cancellation, deadlines, process fencing,
settlement and retry behavior remain authoritative. Connection cancellation
continues to match context.Canceled; HTTP failures retain their original error
classification. The first context cause cannot be overwritten by cleanup.

## Alternatives

Changing outcome.json would break older strict decoders. Sending details in
Room events would expose participant-local state. Both are rejected.

## Compatibility and security

The sidecar is separate from version 1 journals and is never read for execution
or recovery. Missing, corrupt or unwritable diagnostics cannot permit a retry or
block cancellation. At most 32 approval observations are retained with a dropped
count. Cancellation has its own slot. Private storage checks remain mandatory.
Abrupt process death or storage failure can leave missing or partial evidence.
No historical root cause is inferred from the new instrumentation.

## Verification

Offline tests cover context-cause precedence, HTTP errors and redaction,
approval allow/deny/expiry/disconnect, real fake-child cancellation and successful
completion, sidecar failure and legacy journal recovery. Run owning Go tests,
vet and race checks using disposable test roots; never invoke a real model.
