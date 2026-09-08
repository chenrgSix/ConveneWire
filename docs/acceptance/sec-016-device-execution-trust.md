# SEC-016 owner device execution trust acceptance

Date: 2026-09-09. Authority:
[ADR-0062](../adr/0062-trust-owner-devices-for-central-execution.md).
Delivery state lives only in [TASKS](../TASKS.md).

The paired local client exposes **受控开发 → 完全信任此设备** as the primary
choice for an owner device. One explicit local consent permits existing Central
members authorized to use its Codex Agents to request work in ordinary
conversation. No repository/profile/work-policy registration or separate
“start development” form is required. Shared-device scope policies remain under
collapsed **范围授权**. Pi and generic runtimes retain their existing permissions.

The setting defaults off and binds to the exact Central, Device and owner.
Central displays the mirrored consent and revision, then freezes the revision
into ordinary Run permissions and delivery. The Bridge must publish consent on
the current connection and match the delivered revision against local consent
before launching Codex with `danger-full-access` and `approvalPolicy: never`.
Web Agent registration cannot grant this permission. Legacy omitted fields
remain valid; missing pins do not receive full access. Governed/private Runs
retain their separate boundaries and cannot inherit this full-trust pin.

Changing trust first stops and drains Bridge execution. Revision comparison
prevents stale enable requests from restoring revoked permission. A failed
revocation save leaves the worker stopped; a saved decision is not rolled back
on reconnection failure. Changing pairing does not transfer the consent.

Ordinary trusted work uses the configured checkout and the owner's local account.
It can use Git, commands, network and browsers without per-task client approval.
This removes the imposed Codex sandbox restriction, not macOS application or
account restrictions. It does not fabricate isolated candidate/verification
receipts or authorize actions absent from the user's request. Secrets, commands
and local paths remain local; the Central mirror contains scope and revision.

## Verification

- 65 focused Server cases passed across development work, delivery, connection
  registry and WebSocket tests. They cover frozen consent, revoked queued work,
  fresh connection publication, forged Web consent and governed authority on a
  fully trusted device. Server build passed.
- All 324 Web tests, 63 embedded Console JavaScript tests and production Web
  build passed. Generated contracts, TypeScript type checks, all 118 Node
  contract tests and all generated Go contract packages passed.
- Go race tests and vet passed for configuration, Runtime, connection, Console
  and Bridge core. Tests cover default-off, wrong pairing, durable consent,
  explicit confirmation, replay, revocation failure and pre-launch rejection of
  forged/stale/conflicting authority. The subprocess fixture checks actual
  Codex thread sandbox parameters and preserved owner configuration.
- Installed Codex's generated app-server schema recognizes full-access sandbox
  on thread start/resume. Schema inspection and deterministic execution make no
  model calls.

## Physical browser and process evidence

Both opt-in scenarios passed with actual temporary Central, Go Bridge and Git,
using Chrome for Testing Headless Shell 152.0.7977.82, an isolated profile and
its native browser sandbox. The host execution sandbox requires authorized
process startup. The deterministic Codex protocol fixture calls no model and
uses no user repository or installed device as test data.

The full-trust scenario enables consent through the local UI, submits an ordinary
Room composer request and creates a real local Git commit in the temporary
checkout. It creates one Run and zero work-authorizations. After a full client
restart, consent remains revision 1. Revocation through the UI advances to
revision 2 and removes the published full-trust policy. See the
[receipt summary](assets/sec-016/summary.json),
[enabled local control](assets/sec-016/device-trust-enabled.png),
[Central Agent detail](assets/sec-016/central-device-trust.png) and
[conversation result](assets/sec-016/trusted-conversation-complete.png).

The constrained-policy scenario still completes two ordinary conversation
requests, distinct isolated commits, command and browser verification, restart
and parent-policy revocation. See its
[two-task summary](assets/sec-016/two-task-summary.json).
The local consent control, collapsed scope policy and Central detail screenshots
were visually inspected.

## Installed preview

Local packaging and installation verification are pending. The actual owner's
full-trust setting will remain off; the owner must explicitly enable it locally.
Live model interpretation, Windows/Linux, CI and external publication are outside
this evidence. Native installed-window screenshot acceptance is not claimed.

Reproduce with the [browser acceptance commands](../development-commands.md#standing-work-browser-acceptance).
