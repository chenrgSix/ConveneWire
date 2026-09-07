# ADR-0058: Protect Windows private output and accept two physical test identities

- Status: Accepted
- Date: 2026-09-07
- Extends: ADR-0056, ADR-0057
- Owner: Bridge, Security and Testing

## Context

The authorized next step is a real macOS/Windows two-device technical acceptance
with two independent application identities operated by one test controller.
QA-084's independently administered human-owner governance acceptance remains
separate. Windows currently rejects private mode because POSIX mode bits cannot
establish its filesystem boundary.

## Decision

BRG-076 adds a small platform-specific private storage boundary reused by private
Runtime candidates and prepared disclosure files. Windows creates each private
object with its protected DACL before any content is written. Only the current
process user SID and LocalSystem may have access; the object owner must be that
user. Existing weak, foreign-owned, linked or reparse-point objects are rejected,
not silently repaired. Exclusive file creation, bounded reads, flush, immutable
candidate identity and failure cleanup remain mandatory. Path handles protect
the creation/read window from replacement. Unsupported filesystems fail closed.
No external ACL command runs in the production Bridge.

POSIX behavior keeps its existing restrictive modes. Windows configuration can
advertise private mode only with runtime storage checks in place; storage failure
does not disclose raw output or invent a completed candidate. Prepared private
bundles and default candidate reads recheck their protection before use. Explicit
source/release selection does not give Central filesystem access.

This protects the Bridge's owned files from other ordinary OS principals. It
does not sandbox arbitrary Runtime tools, isolate programs sharing an OS account,
or protect against an administrator, LocalSystem, backup privilege or a compromised
host. Existing Device credential storage is not redesigned by this change.
There is no wire, Result storage, consent, participant-selection or completion
policy change.

## Acceptance scope

QA-085 uses one real macOS host and one real Windows host, two separate issued
Member sessions and Device credentials, real Go Bridge processes and production
Result/Discussion paths. A single authorized test controller owns the fictional
snapshots and approves their exact predefined releases as the respective test
identities. It may manage both hosts for setup and evidence collection; this
privileged fixture access is not available to production application callers.

Use an isolated Central and temporary host directories. Do not modify existing
installed services, real owner data, OS accounts or global developer settings.
Prefer portable test binaries/toolchains to machine-wide installation. No external
model calls, new model budget, automatic startup or desktop installer acceptance.

The frozen cases are: successful two-source finalization; cross-owner approval
and publication denial; forged/changed disclosure denial; revocation before
publication with explicit unavailable evidence; retry after committed publication;
and Bridge/Central disconnect or restart without duplicate admission. Check raw
source sentinels never enter shared content. Retain actual outputs separately
from transport assertions; deterministic synthesis is not an LLM-quality result.

## Verification and interpretation

Run native Windows positive and negative ACL tests, including broad inherited
permissions, foreign grants, reparse paths, replacement and concurrent creation.
Run affected Go test/vet/race, contract compatibility and existing disclosure
integration checks. Record exact source/binary identities and sanitized physical
receipts. Restore or remove only owned temporary artifacts and processes.

Passing QA-085 proves that bounded physical two-device, two-identity workflow.
It does not complete QA-084, establish two independently administered real owners,
prove general free-text egress safety, or show superiority over a single Agent.
