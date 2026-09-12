# QA-093 Relay access evidence

Local verification completed on 2026-09-12, macOS arm64, Node 22.23.1 and
Go 1.26.7. This is evidence for the optional Relay increment under
[ADR-0070](../adr/0070-relay-tunnel-access.md); delivery state is recorded only
in [TASKS.md](../TASKS.md). Existing QA-092 physical/manual observations remain
open. No public service, real CA enrollment, application installation or model
call was performed.

## Delivered behavior

An operator supplies one public service profile with the application. The local
Owner opens Network settings, reviews the provider and certificate terms, and
saves convenient access for the next startup. There is no end-user router,
domain or certificate-file setup. Without that profile the UI explicitly reports
that the service is not configured and retains advanced manual HTTPS access.

The Node registers its existing signing identity over outbound WSS. The Go Relay
routes encrypted TLS to that Node and routes only exact HTTP-01 challenges on
port 80. The Node owns account and certificate keys. A fixed derived hostname
survives reconnect and recovery. Ready means an active tunnel, a valid certificate
and a recent signed identity response through the actual public route. It is
not inferred from an open control connection or a healthy daemon alone.

The existing Peer ingress still rejects local Owner/control/bootstrap access
from the public entry. Team/Room membership, Agent sharing and execution consent
remain independent. Disconnection retires readiness and stream credentials;
local work remains usable. Unknown certificate-order outcomes are reconciled
read-only before another order can be considered. The domain/HTTP-01 operator
remains trusted against active certificate interception.

## Verification results

| Surface | Observed result |
| --- | --- |
| Contracts | 139 Node tests, TypeScript types, Go tests/vet, deterministic generation and actual Node/Go signature interoperability pass; 182 schema and six raw JSON vectors |
| Go Relay daemon | 20 top-level tests, race and vet pass; real TLS/WS, SNI/HTTP-01, registration/replay, epoch retirement, bounded frames/backpressure, health and SIGTERM |
| Native settings | 25 tests pass, including Direct/Relay mutual exclusion, CAS, Owner retirement, strict private files, fixed origins and recoverable pending activation |
| Node ACME and connector | 32 tests including subtests pass; real JWS/CSR/HTTP-01, renewal/expiry, ambiguous order recovery, CA terms, text/oversized-frame negatives, reconnect and shutdown |
| Actual Relay HTTP/WS | Two native Hubs issue certificates through the Go daemon; public signed identity, scoped browser session and Runtime WebSocket authentication pass |
| Readiness failure | Failed initial issuance and expired-certificate renewal reject new invitations without creating records; local access and bounded shutdown pass |
| Existing Server behavior | 22 focused ingress, admission and Local Node regressions pass |
| Web | 24 focused component checks and production build pass; actual browser observations below |
| Go Peer through Relay | Three scenarios pass with race instrumentation, 47.427 seconds; Peer vet passes |
| Existing direct Go Peer | Four affected direct scenarios pass with race instrumentation, 34.375 seconds; Peer vet passes |
| Enabled Relay restore | One actual two-Node stop/backup/restore test passes, 12.9 seconds; CA unavailable during restoration, original certificate and access retained |
| Native distribution | Production Hub build, 10 bundle tests and two lifecycle cases pass; native Node/SQLite work with an empty PATH |

The Go Relay scenarios reuse the existing restricted native child and authority
assertions. They cover an ordinary Run, mixed Discussion with native session
reuse and frozen finalization across two Host restarts, and retry/duplicate/event
ordering with revoked settlement. Their Host is the complete native Local Hub,
so requests cross the real PeerIngress authentication boundary. Only disposable
DNS routing and CA trust are substituted; production Go Peer code is unchanged.
The native children are offline fixtures, not real paid model execution.

The restoration case closes the original Hub first and verifies public access
has stopped. It hashes and backs up the private tree, restores to the same path,
then starts that path alone. The new public identity proof has the same Node ID,
public key and origin. Cached certificate bytes and expiry remain unchanged;
no CA account, order, certificate or HTTP request is added while CA service is
unavailable. The original browser cookie still reaches the original Room,
another Room remains forbidden and the original membership ID is retained.
No duplicate identity is started.

Native lifecycle validation separately uses the actual bundled launch process:
default Relay is disabled with `provider: null`; disabled private Relay settings
and an opaque certificate-cache sentinel survive stop, backup and original-path
restore with unchanged bytes, permissions, Node and Owner identity. The main
native scenario also preserves offline Run/Discussion execution records.
Its manifest reports `darwin/arm64`, Node `v22.23.1`, source
`211564c6e838146c385ba353cbadf23b3dc9a9fa` and `sourceState: modified`, accurately
describing the development tree used for that build. It is not a clean release
artifact and was removed with the fixture.

## Browser observations

The production Web was served by a disposable native Hub connected to the actual
Go Relay and local ACME fixture. At 1280 by 720 the
[connected state](relay-access/ready.jpg) shows the verified route and certificate
expiry. The test-only consent, enable review and save succeed; the
[pending state](relay-access/pending.jpg) distinguishes current disabled access
from the saved next-startup configuration. Long details remain scrollable.
Advanced manual HTTPS and return navigation keep a single dialog. Closing it
restores focus to Network settings. Both browser tabs and the preview were
closed; the preview test completed successfully in 333.7 seconds.

These interactions used the local Owner UI over loopback. The public HTTPS
cookie, Origin and scope tests used an HTTP client through the real Relay with
the disposable CA. No system browser trust was bypassed or installed. This
does not establish public-CA behavior in Safari/WebView/Windows or Internet
reachability from another physical network.

## Reproduction and cleanup

Commands are maintained in
[Development and Operations Commands](../development-commands.md#relay-local-verification).
The relevant files are `relay-settings.test.ts`, `relay-certificates.test.ts`,
`relay-connector.test.ts`, `relay-runtime.test.ts`, `relay-readiness.test.ts`,
`relay-restore.test.ts`, `relay-browser-fixture.test.ts` under Server tests and
`relay_interop_test.go` under the Go Peer package. Browser preview is opt-in and
bounded; its private entry ticket file is removed at teardown.

Owned test roots and their child processes were reclaimed after exit, including
the browser root `rUoYBH`, combined settings root `v7b1ub`, restore root `ULOKNy`,
final Go Relay root `gnJbyy`, direct regression root `mGeGHK`, and native roots
`DVydzF`, `5uWLza`, `qIp8Jk`. One earlier Relay rerun timed out during an embedded
cold Go build while other native builds were active; its `BRlp41` root and
children were terminated and reclaimed. Serial rerun passed. Fixture startup
now leaves the inner 120-second build timeout time to report and exit before
the outer 150-second startup deadline; production timeouts are unchanged.

Feature commits are `08fe9c86` (architecture), `e94109d5` (contracts), `7ee06811`
(daemon), `211564c6` (settings), `3ead8789` (Web), `3eb67cf5` (Node lifecycle),
and `dba0cfbc` (profile packaging). This evidence and the final interoperability
fixtures are committed with the QA-093 task update.

## Public operation boundary

The [operator guide](../relay-deployment.md) includes DNS, raw TCP forwarding,
control certificates, Docker/Compose, renewal, limits and profile distribution.
Compose configuration and the profile example were validated locally. The
daemon CI workflow is defined, but no external CI run or image build is claimed.

Actual low-friction Internet use still requires an operator-provided server,
control hostname, wildcard Node domain, public 80/443 routing and an approved
real CA profile. Public deployment and certificate issuance, multi-network
browser acceptance, clean release packaging and physical-platform observations
remain separately authorized and verified operations. This local increment
does not advertise an existing hosted service.
