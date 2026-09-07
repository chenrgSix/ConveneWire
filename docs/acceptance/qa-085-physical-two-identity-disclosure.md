# QA-085: Physical two-device, two-identity disclosure acceptance

The goal and cases are frozen by [ADR-0058](../adr/0058-protect-windows-private-output.md).
Delivery status exists only in [TASKS.md](../TASKS.md). This record is preparation;
no physical execution or Windows ACL pass is claimed yet.

Use the user-authorized macOS workspace and Windows project directory, distinct
test Member sessions and Device credentials, fictional source snapshots and
deterministic Generic Runtimes. Temporary data and portable tools stay in owned
test roots. The Windows Git checkout and any existing installed services are
preserved. The controller's SSH authority is setup authority, never an input
credential available to the Runtime or Finalizer.

Acceptance requires actual Windows protected candidate/bundle creation and
negative ACL/reparse tests, two-source Discussion finalization, wrong-owner and
changed-content denials, revoked-source bounded uncertainty, committed-publication
retry, disconnect/restart recovery, immutable admission and source-sentinel
non-disclosure. Record each separately with version, binary digest, outcome and
cleanup evidence. No aggregate score can conceal a failed authority assertion.

The controller can exercise both independent test identities. This is physical
technical acceptance, not [QA-084](qa-084-physical-disclosure-discussion.md)'s
independently administered human-owner governance acceptance. No external-model,
native desktop UI, installer or Single-versus-Discussion quality claim follows.

## Frozen execution adapter

The opt-in [physical test](../../tests/e2e/physical-disclosure.test.ts) and
[Windows host adapter](../../tests/e2e/physical-disclosure-host.ts) are separate from
routine E2E discovery: without `CONVENE_WIRE_PHYSICAL_DISCLOSURE=1` they do not
contact a remote host. The owner supplies an out-of-repository configuration with
the SSH host, dedicated key file, preverified host-key file, approved Windows
workspace/node executable, exact Windows Bridge binary and retained report path.
Only the Windows identity's credential/session is provisioned there. Fresh
fixture directories receive owner/LocalSystem ACLs before secrets are copied.

Central runs on an isolated macOS loopback endpoint. A host-pinned SSH reverse
forward exposes that exact loopback port only on Windows loopback. Real Go Bridge
HTTP/WebSocket traffic crosses the encrypted connection; this does not accept
direct LAN HTTPS deployment, certificate installation or an existing service.
The existing production identity, publication and Discussion handlers run in the
test Central. Fixture identities are issued by its real identity services; this
does not retest interactive human enrollment or Owner UI clicks.

Two scenarios share the installed test processes: normal exact two-source
publication with cross-owner/forged/changed-content denials, and revoked Operations
with bounded uncertainty. The normal scenario freezes a Finalizer Run while the
consumer is offline, restarts Central and Windows Bridge, resolves an already
committed publication by authenticated CLI retry, then reconnects the Mac consumer
to the same Run and instruction. No new contributor or model call is used to hide
missing evidence. Each scenario must have three contribution Runs and one final
Run, no raw sentinel in shared Messages/Run instructions/events, and an exact
shared final reply. Task/Result human acceptance remains separate.

Before final execution, retain a committed adapter/source version and binary
digests. The report records source-file pins, host-platform metadata, each check,
actual final text and input hash. Cleanup checks the remote root marker, stops
only the exact test executable, removes that root, and confirms the remote Git
checkout remains unchanged. SSH enrollment remains available for the owner.
