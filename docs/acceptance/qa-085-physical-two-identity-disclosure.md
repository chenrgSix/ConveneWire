# QA-085: Physical two-device, two-identity disclosure acceptance

The goal and cases are frozen by [ADR-0058](../adr/0058-protect-windows-private-output.md).
Delivery status exists only in [TASKS.md](../TASKS.md). The frozen physical run
passed on 2026-09-07 using source `5f67d269a598862f6e26ea7dc309036f654a722c`:
two real macOS/Windows hosts, two separately issued application identities,
two scenarios, eight deterministic Runs and zero external-model calls.

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

## Retained execution evidence

The [physical receipt](evidence/qa-085/physical.json) records all 16 check groups as
passed, including actual final Messages, frozen input hashes, source-file hashes,
platform metadata and Bridge binary digests. The [TAP output](evidence/qa-085/physical-tap.txt)
records the final test pass in 30.47 seconds. The Windows binary was built from
the clean committed source above, verified by its
[embedded build identity](evidence/qa-085/windows-build-identity.txt), then checked
again by hash on Windows before execution.

| Case | Observed result |
| --- | --- |
| Two private sources | Each Bridge retained its own candidate; only exact approved releases entered Discussion |
| Owner and Device isolation | Both cross-owner approval directions, wrong-Device grant access/publication, changed content and unissued grants were rejected |
| Normal finalization | Shared reply retained digest validation and the blocked retirement state; raw source sentinels were absent from shared content |
| Revoked Operations | Publication failed locally and at Central; the final reply preserved missing cutover/retirement status and requested a new authorized snapshot |
| Offline/restart recovery | An offline Finalizer kept the same Run and instruction across reconnect; Central/Windows Bridge restart and exact publication retry created no duplicate Result or contribution |
| Cleanup | Owned remote fixtures and native test staging were removed; test processes and tunnel stopped; the Windows checkout stayed unchanged |

The Windows checkout remained at `da00abbfbfeeec6464792683bcaa0827ebe7baea`.
Execution used portable binaries from `5f67d26`, without updating that checkout,
installing a toolchain or replacing an installed service. The dedicated SSH
enrollment remains available to the owner. Local task staging and temporary
wrapper roots were removed after retaining the sanitized evidence.

The [verification manifest](evidence/qa-085/verification.json) pins the retained
artifacts by SHA-256 and records each gate, prior attempts and interpretation
limits separately. [Native Windows output](evidence/qa-085/windows-native.txt)
contains eight storage and six private Runtime top-level passes, with no skips.
[Whole-Bridge output](evidence/qa-085/bridge-checks.txt) records 28 package suites
and five race suites; `go vet ./...`, strict adapter typechecking and 24 existing
disclosure/Discussion integration cases also passed. Details and earlier failed
attempts are in [BRG-076](brg-076-windows-private-storage.md).

The Finalizer is a deterministic Generic Runtime in this acceptance. Its final
text checks the production evidence path and explicit unavailable-source input;
it does not measure whether a model understands those inputs. The endpoint is a
shared Discussion reply, not automatic human Task/Result acceptance. QA-084's
independently administered human-owner procedure remains unexecuted.

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
