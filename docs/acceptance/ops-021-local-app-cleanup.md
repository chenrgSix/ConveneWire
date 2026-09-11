# OPS-021: local application cleanup

The owner's application search showed multiple ConveneWire entries after local
development updates. There was one formal installation; expanded desktop builds,
old acceptance installations and rollback copies remained elsewhere, and macOS
registered those application bundles as additional launch choices.

## Cleanup and preservation

The cleanup inspected the repository's generated distribution/acceptance/upgrade
directories and the two established owner backup roots. All 38 selected bundles
had the ConveneWire/AgentRoom bundle identity, were untracked and had no open
files. Every application file was compared with its archive before removal:
16 existing archives were reused and 22 missing rollback archives were created.
Legacy macOS ZIP filenames without the UTF-8 flag were decoded before comparison.
Only expanded `.app` directories and their launch registrations were removed;
rollback ZIPs, stopped data snapshots and surrounding installation records remain.
The [sanitized inventory](evidence/ops021/local-cleanup.json) maps each removed
copy to its retained archive without including credentials or database contents.

The formal `/Applications/ConveneWire Bridge.app`, local Node identity, local
Agent configuration and legacy Bridge profile passed unchanged digest checks.
The application stayed running and its readiness endpoint returned HTTP 200.
The final LaunchServices query returned only the formal installed application
for this product; no global registration reset or application restart was used.

The inspected temporary roots also contained 242 inactive old project logs and
16 empty directories, which were removed. An occupied test directory was kept.
Expanded bundles occupied 3,171,880 KiB; the new verified archives occupy
394,312 KiB. These are directory allocation measurements, not an exact APFS
physical-recovery claim. Rounded system free space rose from 16 GiB to 18 GiB.

## Packaging prevention and verification

The macOS packaging script now builds its transient application and ZIP inside
a private hidden temporary directory. Exit cleanup removes that directory on
success or ordinary failure; only a completed ZIP is published. Existing output
protection remains. The documented installation workflow also removes inspection
extractions and stores rollback applications as archives beside their snapshots.

All four packaging/platform checks and 26 release-policy checks pass. The path
regression exercises real production shell staging and ZIP I/O with compiler,
plist and Mach-O doubles: three relative/spaced/absolute outputs, archive content,
overwrite rejection, failed validation and failed partial-ZIP cleanup. Shell
syntax, docs lint, changed-document links and whitespace checks pass. No new
native compilation, reinstall, model call, external CI or publication was needed
for this packaging-lifecycle change.
