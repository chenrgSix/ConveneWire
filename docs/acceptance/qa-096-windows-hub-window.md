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

## Verification Status

The supervisor now supplies Windows-only `CREATE_NO_WINDOW` and `HideWindow`
attributes. The native regression exercises the real `Start` path and reads
`GetConsoleWindow` from the supervised child, then verifies normal EOF-driven
exit and owner-lease release. A separate deliberately allocated hidden console
proves the probe can detect console allocation. The Windows Release job runs
these tests before packaging; the existing uncached Windows CI gate includes them.

Local macOS `go test -race ./internal/localnode` passed in 12.727 seconds, and
`go vet ./internal/localnode` passed. Windows amd64 test compilation passed;
this is compilation evidence only. All 29 release workflow checks passed.
Native Windows execution, exact-source CI and release checks remain pending.
