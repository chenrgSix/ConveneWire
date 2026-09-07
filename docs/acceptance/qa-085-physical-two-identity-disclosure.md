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
