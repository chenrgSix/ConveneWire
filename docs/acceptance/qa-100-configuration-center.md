# QA-100: Install the Configuration center label

The owner's local validation update continues with `v0.5.9-local.2`, built from
clean source `a86f5100a737019286f554c28f79a633b43efa1f`. WEB-094 changes the
workspace toolbar entry to `配置中心` / `Configuration center` for bound and
unbound Local Nodes; it opens the existing native configuration page. The
separate Runtime connection action retains explicit Team binding. See the
[module boundary](../modules/web-ui.md#local-node-entry).

Two existing Web entry/Runtime regressions, production TypeScript/Web build,
documentation lint, 354 local links and whitespace checks pass. Native
packaging also builds the Server and Web and verifies exact source/version,
ZIP safety, arm64/Mach-O metadata and the 7,305-file Hub manifest. All 7,316
installed application files match the candidate ZIP. The
[installation receipt](evidence/qa100/installation.json) records its digest.

No Runs were active before normal application shutdown. A ZIP of the installed
`v0.5.9-local.1` application was created and checked against all 7,316 files;
this is a repacked local rollback archive, not the original candidate ZIP.
The matching stopped Node snapshot verifies all 15 files and its closed
manifest. This private rollback pair remains beside historical backups. The
[backup receipt](evidence/qa100/backup-receipt.json) contains only verification
metadata, without owner identity, credentials or conversation content.

After replacement, SQLite quick_check and both health endpoints pass. Three
identity/configuration file digests and five work-table digests match the
pre-update baseline. One desktop and one bundled Hub process run. The actual
installed UI shows both translated labels, opens native configuration and
returns to the workspace. The original Chinese locale was restored. See the
[native UI receipt](evidence/qa100/native-ui.json). No settings or model
execution were changed.

The hidden installation stage, expanded old application, extracted candidate
and generated ZIP were removed. A stale registration for deleted package
staging was explicitly removed; LaunchServices contains one canonical app at
`/Applications/ConveneWire Bridge.app`. The
[cleanup receipt](evidence/qa100/cleanup.json) records these checks.

This is a local macOS validation build. Public release, Windows installation,
CI and live-model acceptance were not performed. Owner acceptance of the
earlier navigation fixes remains separate, as recorded by
[QA-099](qa-099-local-navigation-build.md).
