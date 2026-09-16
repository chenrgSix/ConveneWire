# ADR-0071: Resolve the configured Codex model for Agent display

- Status: Accepted
- Date: 2026-09-16
- Amends: [ADR-0059](0059-show-agent-configured-models.md), model acquisition only
- Owner: Bridge and Registry

## Context

The native editor creates a Codex app-server command without a model override.
ADR-0059's argument-only extraction consequently reports no model even when the
owner's Codex configuration selects one. Successful Runs do not repair that
configuration-only publication field.

## Decision

Before connecting and publishing Agents, Bridge may ask the already configured
Codex executable for its effective configuration through the local stdio
`initialize`, `initialized`, and `config/read` protocol. The query uses the
Agent's actual command, Workspace and allowed environment. Codex resolves its
own configuration layers; Bridge does not parse or copy the owner's TOML files.
Only a validated model identifier leaves the local resolver. The result remains
`configuredModel`, never evidence of a completed or resumed Run's model.

The query is bounded in duration and output and uses the existing owned process
tree cleanup. It starts no thread or model turn and performs no configuration
write. Unsupported commands, malformed replies, missing models and failed queries
remain unknown; they do not prevent normal Agent publication. Explicit safe
selectors continue to work without a subprocess. Ambiguous selectors remain
unknown. Pi retains its existing explicit-selector behavior.

Resolve once per connection, with one shared bounded lookup budget, before the
WebSocket handshake. Capability republication reuses that snapshot; heartbeats
do not start metadata processes or advance `modelReportedAt`. Reconnection reads
configuration again. No task, routing, model-selection or permission behavior
changes. Unknown UI values say that the model has not been identified; omission
alone never proves automatic selection or a particular Runtime default.

## Compatibility and security

The existing optional `configuredModel` field and nullable database columns are
unchanged. Old clients and Hosted projections retain their behavior. The reader
does not expose the full configuration response, paths, environment, credentials,
stderr or model-query errors. Use a fixed read-only RPC sequence, reject requests
from the child, and drain every owned metadata child on completion/cancellation.

## Verification

Cover default lookup, explicit overrides, unsupported/ambiguous commands, malformed
or sensitive model identifiers, output limits, cancellation and cleanup. Test
publication/republication and actual WebSocket persistence/clearing, plus bilingual
labels and model search. A compatibility fixture may use the installed Codex
binary with a disposable home and no model credentials or turns. The
[official App Server interface](https://learn.chatgpt.com/docs/app-server)
and locally generated protocol schema define `config/read` and its Workspace
parameter. Native packaging/installation evidence remains source-specific.
