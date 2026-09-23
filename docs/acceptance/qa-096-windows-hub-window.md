# QA-096: Windows Local Hub Console Window

The owner reported an unexpected black window on Windows after v0.5.4 and
authorized a repair on 2026-09-23. The existing release/update authorization
covers a replacement stable installer. The previous release remains immutable.

## Cause And Scope

The desktop executable already uses the Windows GUI subsystem. Managed Agent
processes already suppress console allocation, but the Local Hub supervisor
starts the bundled Node executable without Windows process attributes. Redirected
standard streams do not suppress console allocation.

The repair applies only to this background Hub launch. Arguments, environment,
authenticated stdio startup, data ownership and graceful shutdown are preserved.
No protocol, storage schema, Runtime authority or owner configuration changes
are required.

## Local And Native Verification

The supervisor now supplies Windows-only `CREATE_NO_WINDOW` and `HideWindow`
attributes. The native regression exercises the real `Start` path and reads
`GetConsoleWindow` from the supervised child, then verifies normal EOF-driven
exit and owner-lease release. A separate deliberately allocated hidden console
proves the probe can detect console allocation. The Windows Release job runs
these tests before packaging; the existing uncached Windows CI gate includes them.

Local macOS `go test -race ./internal/localnode` passed in 12.727 seconds, and
`go vet ./internal/localnode` passed. Windows amd64 test compilation passed;
this is compilation evidence only. All 29 release workflow checks passed.
Documentation lint covered 553 Markdown files with zero issues; 334 local
Markdown links and patch whitespace checks passed.

[CI 35815638617](https://github.com/chenrgSix/ConveneWire/actions/runs/35815638617) passed all four jobs for immutable source
`f357fee26ff4729e7962387775d68a30d8f14ca6`. Native Windows executed both new tests without skips:
windowless supervised startup, authenticated readiness, normal EOF shutdown and
owner-lease release passed in 1.49 seconds; deliberate hidden-console detection
passed in 1.33 seconds. Existing native Hub integration and Windows installer
upgrade checks also passed. The [CI receipt](evidence/qa-096/ci.json) separates
these observations from local cross-compilation.

## Published Release

Stable [v0.5.5](https://github.com/chenrgSix/ConveneWire/releases/tag/v0.5.5) was published at
`2026-09-23T04:15:20Z` from the same immutable application source.
[Release workflow 35816301745](https://github.com/chenrgSix/ConveneWire/actions/runs/35816301745) passed all ten jobs,
including another native Local Node test run and Windows installer upgrade from
v0.5.4, then full asset verification before upload and after Draft download.

All twelve assets were independently downloaded from the authenticated Draft and
again through credential-free public download URLs. Exact names/count, sizes,
GitHub SHA-256 digests, all seven outer checksum entries and four source license
files matched. Public files matched the Draft bytes and asset identities; the
anonymous Latest URL resolved to v0.5.5. The
[release receipt](evidence/qa-096/release.json) retains these hashes and workflow
links. Public download verification used authenticated release metadata, while
all public asset bytes were fetched without credentials.

## Scope Boundaries

No owner Windows installation or physical window-manager observation is claimed.
The owner's macOS installation and private data were untouched during this patch.
No new database migration, external model invocation, Codex session takeover or
public Relay test was performed. Temporary test/download fixtures are cleaned
while the current release files and previous rollback materials are retained.

## Release Documentation

README, desktop installation examples and the public website sources now point
to published v0.5.5. The website preserves v0.5.4 as the prior stable release.
All 15 site tests pass; final documentation lint covers 554 Markdown files with
zero issues, and 314 changed-document local links plus patch whitespace checks
pass. Website deployment is tracked separately from the application tag.
