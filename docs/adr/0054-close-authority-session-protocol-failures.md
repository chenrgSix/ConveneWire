# ADR-0054: Close authority-session protocol failures

- Date: 2026-09-07
- Status: Accepted for bounded QA maintenance
- Owner: Discussion experiment tooling

## Decision

QA-080 repairs the two observed QA-079 integration gaps before another quality
experiment or physical-owner trial. Native resource discovery must not be
confused with a source read, and every observed failed invocation must converge
to an existing Central Run terminal state. No new model sessions are authorized
by this repair. Equal-compute research and new Finalizer instructions remain
deferred under the Owner's latest direction.

The consumed QA-079 fixture, code pins, outcomes and first grades remain
unchanged. A separately named maintained authority-session adapter reuses the
existing reader, configuration, Result and Run repositories. Historical runtime
entrypoints remain frozen forensic fixtures; future authority maintenance uses
the new adapter. No alternate contribution persistence or production Discussion
policy is introduced.

## Tool boundary

In the isolated profile, only the configured evidence MCP server is loaded;
user configuration, plugins, apps, shell and web tools remain disabled. Allow
the exact native `codex/list_mcp_resources` and
`codex/list_mcp_resource_templates` identities as bounded metadata operations.
They grant no source access, count against a separate discovery limit, and
produce no read receipt. Preserve their original identities and lifecycle in
telemetry; do not relabel them as evidence reads or swallow failures.

Only `evidence/read_evidence` can return source bytes under the existing
Run/Task/Room/source-version/range grant. Resource reads, foreign servers,
malformed or changing tool identities, and other tool execution remain
rejected. Metadata-only calls must complete, and failed or incomplete calls
still fail the invocation. The CLI event observer is a detection/termination
mechanism, not a pre-execution sandbox. The scoped reader remains the actual
source authorization gate. Verify the installed CLI catalog and returned bytes
with an auth-free loopback provider before claiming compatibility.

## Failure convergence

Keep the original invocation outcome separate from persistence outcome. A QA
session supervisor retains a content-free terminal intent before attempting to
write Central, then applies an exact Run/Task/Room/Agent-bound failed or canceled
event through the existing RunRepository. The record contains only a fixed
failure category, no private reply, provider error, tool arguments or credentials.

Replay of that terminal intent cannot call the model, create a Result, append a
duplicate terminal event or overwrite a pre-existing terminal state. Persistence
failure remains explicit and recoverable by replaying the same intent; it must
not become a synthetic completed Run. Process errors, timeouts, cancellation,
missing terminal answers and rejected tools follow this path. Success continues
through the existing informational Result proposal without human acceptance.

## Acceptance and physical follow-up

Use deterministic observer tests, the installed CLI against only loopback, and
actual disposable SQLite Run/Result storage. Cover resource discovery followed
by a permitted read, discovery without reading, denied raw/foreign reads,
failed/incomplete discovery, process and timeout paths, cancellation, idempotent
terminal replay and a killed post-commit acknowledgement. Re-audit QA-079 bytes
and grades without rerunning its model plan.

The next physical trial needs separately identified owners/devices, a real task,
source ownership and approved shared fields, authenticated Bridge transport and
a frozen fault/acceptance plan. A single-host simulation cannot fill those
evidence slots. Record the preparation requirements without marking real-device
acceptance complete. Delivery state belongs only in TASKS.md.
