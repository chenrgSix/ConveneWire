# ADR-0059: Show Agent configured models

- Status: Accepted
- Date: 2026-09-08
- Owner: Registry, Bridge and Web

## Context and decision

The Room owner requested model names beside Agent identities. `WEB-076` adds
an optional bounded `configuredModel` string to `agent.publish`. The existing
authenticated Device, Agent and connection-epoch checks remain authoritative.
Registry persists the name and a separate server-observed `modelReportedAt`;
heartbeats must not refresh that timestamp. Republishing without a model clears
the previous value, including when an older Bridge reconnects.

Bridge reports only a supported adapter's explicit launch configuration:
Codex's `-c model=...` override or Pi's `--model` argument. It does not read
global configuration, credentials, sessions or environment variables, launch a
Runtime, or infer a model from an Agent name. Profile-based, conflicting or
unrecognized selection remains unreported. No command arguments are transmitted.
Hosted Agents use only the current profile's model and creation timestamp;
reading this projection never decrypts or returns provider credentials.

Web displays the configured name in Room settings, the Room roster, Agent
inventory/details and Mention choices. Search includes the model. Unreported
values are explicit; offline managed Agents label retained names as last
reported and expose the timestamp. This is configuration evidence, not proof
of a particular Run's model. No Run history, routing or invocation changes.
There is no automatic-selection report in the current adapters; absence must
never be displayed as automatic selection.

## Compatibility and security

The optional field preserves protocol 1.0; the released publication envelope
allows additive properties. Older servers ignore the field and new servers
accept older publications. An additive nullable migration preserves old rows.
Model names are bounded identifiers; paths, URLs, control characters and common
API-key prefixes are rejected. Unknown clients keep the existing unknown label.
Only authorized Team readers receive the model projection. This deliberately
extends the safe Registry display metadata without exposing raw Provider data.

## Verification

Use shared positive/negative TypeScript and Go wire fixtures, Bridge extraction
and publication tests, actual WebSocket-to-Registry persistence/republication
checks, Hosted projection/privacy checks, and focused bilingual Web selection
tests. Build affected workspaces and run Go tests/vet (race for Connection).
Live models, installations, release and physical-browser acceptance are separate.
