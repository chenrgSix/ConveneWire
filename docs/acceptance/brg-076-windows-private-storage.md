# BRG-076: Windows private storage

[ADR-0058](../adr/0058-protect-windows-private-output.md) extends the initial
POSIX-only disclosure implementation. The completion state is in TASKS.md.

## Implemented boundary

The Bridge uses `internal/privatefs` for private Runtime candidates and prepared
disclosure bundles/metadata. On Windows, `CreateDirectory` and exclusive
`CreateFile` receive the protected security descriptor at creation. The owner is
the current process user SID; the DACL grants full control only to that SID and
LocalSystem. A new file is checked through its open handle before any bytes are
written. Existing broad, inherited, null, foreign or linked protection is rejected
without changing the existing object. Default candidate and prepared bundle reads
repeat the owner/DACL/regular-file/bound checks on the opened object.

Windows accepts local ACL-capable volumes and rejects UNC/device namespaces,
alternate streams, reparse paths, junction ancestors and hardlinked private files.
Ancestor handles remain open without write/delete sharing through the operation.
The local private directory is checked before Runtime starts; an unavailable store
emits only `PRIVATE_OUTPUT_WITHHELD` and cannot execute the Runtime. Creation is
exclusive, partial-write cleanup is local, and files are flushed before success.

POSIX retains restrictive modes, with owner and no-follow checks for private
reads. The production Bridge does not invoke PowerShell or `icacls`. No schema,
grant semantics, Result review, participant selection or completion gate changes.
The Bridge is not a Runtime sandbox; same-account processes and privileged host
administrators remain outside this storage isolation claim. Existing general
Device credential storage and installed Windows services are not migrated.

## Verification

The native Windows NTFS run passed all eight privatefs tests, with no skips:
round-trip/bounds/immutable replacement, concurrent exclusive creation, symlink
rejection, protection before first write and ancestor replacement denial, unsafe
descriptor rejection, actual weak-ACL rejection without repair, junction/hardlink
rejection, and unsupported namespace/stream rejection. The first ACL assertion
incorrectly compared a literal SID string to Windows' canonical `LA` alias and
`AI` flag rendering; it was corrected to compare the actual descriptor before
and after the rejected operation. Production ACL checks already passed that run.

The final [native Windows output](evidence/qa-085/windows-native.txt) also records
six private Runtime top-level tests, with no skips, including the new assertion
that unavailable private storage cannot start a Runtime. The focused macOS
Runtime/config/result/CLI suites and 24 existing Server/actual Bridge disclosure
and Discussion cases passed.

The final [whole-Bridge checks](evidence/qa-085/bridge-checks.txt) passed all 28
packages with tests, `go vet ./...`, and race tests for privatefs, runtime, result,
delivery and connection. Packages ran serially with `-p 1`; the Git-heavy
repository suite took 329.049 seconds and the Runtime race suite 54.776 seconds.
No assertion or Runtime deadline was relaxed. The
[verification manifest](evidence/qa-085/verification.json) records the exact
source commit, native test binary digests, gates and retained artifact hashes.

Earlier attempts are not counted as passes: a 360-second aggregate limit and a
150-second repository-only diagnostic limit expired while the existing Git-heavy
suite was still running. A concurrent race run missed the existing Codex helper's
two-second startup/Session assertion; the unchanged serialized Runtime race suite
subsequently passed. The final native rerun includes the corrected descriptor
rendering assertion described above.

[QA-085](qa-085-physical-two-identity-disclosure.md) records the separate physical
two-device workflow. Native test execution does not establish a desktop installer,
independently administered real-owner governance or LLM output quality.
