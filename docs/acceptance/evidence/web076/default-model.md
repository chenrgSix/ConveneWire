# WEB-076: Default configured model repair

Date: 2026-09-16. Scope: local Bridge metadata and model labels; no model turns,
public Relay operations, remote deployments or release publication.

## Cause and behavior

The native Codex preset has no explicit model argument. Argument-only extraction
therefore published no model even when the owner's Codex configuration selected
one. Successful Runs cannot populate configuration-only metadata.

[ADR-0071](../../../adr/0071-resolve-codex-configured-model.md) permits a bounded
local `config/read` for the exact native preset, using its actual executable,
Workspace and allowed environment. Only a safe model identifier is published.
Explicit selectors need no process. Query failure remains unknown and cannot
block Agent publication; the UI says “模型：尚未识别”. Known values explicitly say
“配置模型”, or “上次上报模型” for an offline managed Agent.

Each query allows 1.5 seconds and 1 MiB of stdout, within a shared 3-second
connection budget. Capability republication reuses the connection snapshot;
reconnect reads it again. The query creates no thread or model turn and performs
no configuration write. Pi retains explicit-selector support only.

## Local verification

- Go `config`, `runtime` and `connection`: race-enabled tests and vet passed.
  Metadata negatives cover malformed/error replies, child RPC requests, wrong
  IDs/types, secret-like identifiers, oversized/aggregate output, cancellation,
  owned child reaping, custom commands and ambiguous selectors.
- Installed Codex `0.154.0-alpha.6.2`: the production reader returned the fake
  configured model from a disposable home through read-only RPCs. No owner
  credentials or model turns were used.
- Web: 9 tests passed, including bilingual labels, offline/unknown values,
  timestamps and searching participants by model.
- Server: 37 tests passed, including actual WebSocket model persistence,
  heartbeat stability, omission clearing and unsafe-value rejection.
- Contracts: Node validation, generated-source checks, TypeScript checks and Go
  contract suites passed. No schema or migration changed.
- Server/Web production build passed. The native Local Node suite passed both
  scenarios, including default Codex metadata before any fixture Run, ordinary
  Codex/Pi execution, Discussion and stopped backup/restore.
- Documentation lint and diff whitespace checks passed.

Native installed-app evidence will follow the clean implementation commit.
These local results do not establish Windows, minimum macOS, CI, public Relay
or production acceptance.
