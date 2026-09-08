# BRG-078 local work-policy client evidence

Date: 2026-09-08. Authority:
[ADR-0060](../adr/0060-preauthorize-local-work-policies.md).
Delivery state is recorded only in [TASKS](../TASKS.md).

The local token-authenticated Console provides an explicit policy form over
registered repositories, configured Agents, matching Runtime profiles and
verification profiles. It reads the owner's Room list through the existing
paired member entry, or accepts explicitly entered Room IDs for legacy paired
devices without that entry. The owner chooses allowed initiators, output directories,
source branch, finite task budgets and expiration. No per-Task local form is
required after this setup. Registration validates current profiles, source and
immutable pins; overlapping active Agent/Room/initiator policies are rejected.

Create and revoke stop and drain the current Bridge before mutating owner-local
state, then restart only if it was previously running. A committed policy or
revocation receipt survives a reconnect failure and reports that failure
separately. Revocation can be retained without working Git or Runtime binaries.
The inventory distinguishes active, expired and revoked parent policies.

Validation:

- Focused Console race tests and owning `go vet` pass. They cover owner token,
  confirmation, unknown-field rejection before mutation, create/revoke process
  drain and restart, and deep cloning of parent bounds. The API lifecycle tests
  use injected authority callbacks; repository issuance/revocation is separately
  exercised by BRG-077 and EXEC-012 physical fixtures.
- All 63 embedded-client JavaScript tests pass, including exact registered
  profile selection, changed/revoked resource rejection and expiry display.
- The actual embedded page was opened in the in-app browser using the disposable
  `TestWorkPolicyBrowserFixture`. Room/resource selection, form filling and
  successful save/inventory update were observed. This fixture uses simulated
  resources and no installed policy or Runtime.
- The final QA-089 fixture exercised the actual local Console, registered physical
  repository/profiles, saved one policy through the real form, then completed two
  Room-initiated Tasks with a full Bridge restart between them. Inline parent
  revocation updated both derived grants and removed Room readiness. The final
  fixture passed in 34.13 seconds; no model was called.
- Real form submission exposed a millisecond versus canonical nanosecond timestamp
  mismatch. Owner input is now normalized before immutable persistence; equivalent
  timestamps replay the same policy digest. Repository/Console race regressions
  and owning vet pass. Form controls and inventory were visually inspected.
- Screenshots: [policy form](assets/qa-089/local-policy-ready.png),
  [saved policy](assets/qa-089/local-policy-saved.png),
  [revoked parent and both grants](assets/qa-089/local-policy-revoked.png).

The installed client, live model and physical Windows/macOS packaging have not
been changed or accepted by these checks.
