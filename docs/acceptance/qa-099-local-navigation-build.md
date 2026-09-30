# QA-099: Install the local navigation validation build

## Scope and package

The owner authorized replacing the local macOS application on 2026-09-30 for
their own validation. Local build `v0.5.9-local.1` uses clean exact source
`26248d0bf89d00af789981d7afd634bd98720495`, including
[BRG-090](brg-090-background-page.md) and
[WEB-093](web-093-conversation-scroll.md). Its native bundle version is `0.5.9`;
the desktop, Bridge helper, Node host and Hub manifest identify the full local
version. This build is not a published stable release.

`npm run package:local-node` passes the production Server/Web builds, native
macOS packaging and exact-source/version admission. The extracted package
passes ZIP safety and clean-source release-Hub verification, including all
7,305 Hub files. The desktop is arm64 and its Mach-O deployment target matches
the package metadata. Installed application inventory matches all 7,316 ZIP
files. The [installation receipt](evidence/qa099/installation.json) records the
source, version and archive digest.

## Backup and installation

Before replacement, zero Runs were active and all 7,316 installed v0.5.8 files
matched the verified official archive. The old application quit normally;
its desktop and Hub processes stopped before the Node backup. All 15 snapshot
files match the closed manifest. The compatible v0.5.8 ZIP and stopped snapshot
remain together in the owner's private application backup directory. The
[backup receipt](evidence/qa099/backup-receipt.json) contains verification
results only, without owner identity, credentials or work content.

The canonical application was replaced and started. SQLite quick_check,
liveness and readiness pass. Three identity/configuration file digests and
all five work-table digests match the pre-upgrade baseline: teams, rooms,
messages, runs and agent tasks. One desktop and one bundled Hub process run.
No Agent configuration, LAN setting, sharing permission or model execution was
changed.

## Native smoke check and cleanup

An existing conversation was opened in the installed application. Closing
its window to the background and opening the canonical app through Finder
revealed the same conversation and document, without returning to the
workbench. The [native UI receipt](evidence/qa099/native-ui.json) records only
the result and method; no owner conversation content was captured in evidence.

The hidden installation stage, old expanded application, extracted candidate
and redundant downloaded/generated ZIPs were removed: 14,634 temporary files
totaling 654,809,522 bytes. Historical backups and the new compatible rollback
pair remain. LaunchServices contains one canonical application registration.
The [cleanup receipt](evidence/qa099/cleanup.json) records these checks.

Owner manual validation of both reported behaviors remains pending. The
native smoke check does not establish every Dock/tray activation path, native
timeline geometry, process-restart navigation, Windows compatibility or CI.
The focused source regressions and browser geometry evidence remain recorded
under BRG-090 and WEB-093. No public release or live model check was performed.
