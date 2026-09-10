# OPS-020 native distribution evidence

The macOS arm64 archive was built from clean source
`607677e9fbf7fe5502b44f88c32ed781950e70fd`. It is a local development artifact,
not an installed application or a published release. Delivery status belongs to
[TASKS.md](../TASKS.md).

## Verified archive

The retained artifact is
`dist/local-node-ops020-607677e9/convenewire-bridge-desktop_0.0.0-local_darwin_arm64.zip`.
Its size is 75,960,118 bytes and SHA-256 is
`fbb2c8f14951ee021512462d554950aaa6e93afeb0216c016876a2a9a753de66`.
[Machine-readable evidence](evidence/ops020/native-package.json) records the
manifest digest, versions and exact source identity without private fixture data.

Verification opened the actual ZIP, rejected unsafe paths before extraction,
and checked all 6,215 Hub files against the extracted manifest. The desktop,
legacy CLI and native Node host each report `v0.0.0-local`, contain the same
source commit and have arm64 Mach-O binaries. Packaging checked the emitted
macOS minimum target against its 12.0 metadata. The extracted bundled Node
reports 22.23.1 and executes an in-memory native SQLite query with an empty PATH.
The temporary extraction was removed after those processes exited.

## Automated checks and pipeline changes

The native bundle suite passes 5/5, including actual Hub startup, tamper
detection, exact-source admission, foreign-target inspection and unsafe ZIP
negatives. Workflow/output-path policy tests pass 30/30. Hub/Web builds,
native desktop Go tests/vet, documentation lint and changed local links pass.
The actual bundled Node completes an offline Run and Discussion, stages and
activates private HTTPS configuration, then restarts and restores the same
Owner identity and completed execution records without replay.

macOS and Windows CI/release jobs now prepare and test their native Hub before
packaging it. Go jobs also install the locked Node Host fixture dependencies:
the Peer Go tests start an actual TypeScript Host over TLS, so Go alone is not
sufficient for those jobs. Release verification independently inspects the
declared foreign platform without executing its binaries.

The full Peer race run exposed an insufficient fixture deadline in the
nine-Run shared-Workspace scenario. The uninstrumented case passed in 8.75 s;
under race instrumentation the first checked Run could remain behind the whole
serial queue for more than the old 30 s allowance. The fixture now uses one
bounded batch deadline derived from the existing per-Run allowance, without
changing production scheduling or resetting a fresh deadline for each receipt.
Two focused race repetitions passed with all nine settlements, eight actual
starts, one canceled-before-start Run and no overlapping children; settlement
took 53.915 s and 52.003 s. The subsequent full Peer race suite passed in
342.540 s, followed by a passing Peer vet check. The owned test root was removed.

Windows packaging requires the Hub and Node host. Its installer keeps the
existing App ID, protocol schemes and profile location, replaces obsolete
managed Hub files and retains private Node data outside the application
directory. The native Windows verification script compares installed Hub and
Node bytes with staging/ZIP, checks synthetic legacy/Node state sentinels through
upgrade and uninstall, and refuses an existing owner profile or installation.
Those sentinels verify installer ownership only; native runtime persistence is
covered by the separate offline scenario above.

## Evidence limits

No Windows PowerShell execution, Windows installation, physical minimum-OS
acceptance, external CI run, publication or model call was performed on this
macOS host. Final A/B/C manual acceptance remains QA-092. QA-091 will identify
its own combined verification source; this archive remains evidence for the
packaging increment and is not silently relabeled as a later final artifact.
