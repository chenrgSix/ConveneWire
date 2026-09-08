# BRG-078 local work-policy client evidence

Date: 2026-09-08. Authority:
[ADR-0060](../adr/0060-preauthorize-local-work-policies.md).
Delivery state is recorded only in [TASKS](../TASKS.md).

The local token-authenticated Console provides an explicit policy form over
registered repositories, configured Agents, matching Runtime profiles and
verification profiles. It reads the owner's Room list through the existing
paired member entry. The owner chooses allowed initiators, output directories,
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
- Browser interaction became unresponsive while exercising a native confirmation.
  Revocation now uses explicit inline confirmation. Full visual/revocation browser
  acceptance remains pending in this task and QA-089; no screenshot is presented
  as completed visual acceptance.

The installed client, live model and physical Windows/macOS packaging have not
been changed or accepted by these checks.
