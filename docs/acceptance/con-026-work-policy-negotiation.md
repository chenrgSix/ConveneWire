# CON-026 work policy negotiation evidence

Date: 2026-09-08. Owning contract:
[standing policy negotiation](../modules/contracts.md), under
[ADR-0060](../adr/0060-preauthorize-local-work-policies.md).

The shared execution-runtime schema defines local policy input, path-free
offers, authorization identity, exact Task authorization and grant/denial
receipts. Managed Agent capabilities optionally carry offers; the two
`work.authorization.*` messages bind requests and responses to a Device and
connection epoch. Old wire fixtures still round-trip unchanged.

TypeScript and Go consume the same 25 policy fixtures. They reject scope
escape, injected commands, unauthorized operation kinds, missing Task/policy
pins, widened limits, forged grant identities and inconsistent success/denial
receipts. Go raw decoding additionally rejects duplicate/case-folded fields
and trailing JSON. Both languages reproduce the same stable authorization
identity hash. Seven Bridge fixtures cover optional publication, negotiated
request/receipt, manual-Agent exclusion and command injection. A nanosecond
offer timestamp survives typed Bridge serialization unchanged.

## Validation

- `npm run test --workspace @convene-wire/contracts`: 117 Node tests, generated
  artifact consistency, TypeScript types and Go contract tests pass.
- `npm run build`: all workspaces pass.
- `node scripts/test/run-with-temp-root.mjs --cwd bridge -- go test ./... -run '^$'`:
  Bridge packages compile; this command runs no behavioral tests.
- Changed-document lint, relative links and `git diff --check` pass.

These are protocol and compatibility results. Authenticated service admission,
local profile resolution, expiry and revocation enforcement, connected Room
execution and visual acceptance require their dependent Task evidence in
[the task register](../TASKS.md#preauthorized-everyday-development).
