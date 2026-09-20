# Development and Operations Commands

Read the section relevant to the current task. Commands run from the repository
root unless a different directory is stated. This reference preserves command
examples and their scope; listing a command does not authorize external effects.
Release tags, dates, IDs, digests and paths in examples are placeholders or
historical pins, not current execution inputs.

Node.js 22 and Go 1.26.7 are required. Use `nvm use22` when Node 22 is not active.
The contracts Go module pins the selected Go toolchain.

- [Workspace and website](#workspace-and-website)
- [Disposable acceptance and previews](#disposable-acceptance-and-previews)
- [Discussion maintenance tests](#discussion-maintenance-tests)
- [Bounded external-model experiments](#bounded-external-model-experiments)
- [Bridge owner-local operations](#bridge-owner-local-operations)
- [Desktop packaging and Windows resources](#desktop-packaging-and-windows-resources)
- [Central operations and release](#central-operations-and-release)

## Workspace and website

- `npm ci` — install locked workspace dependencies.
- `npm run validate` — validate all registered JSON Schemas.
- `npm run build` — build every implemented workspace.
- `npm run build:site` — build the credential-free product website for the `/ConveneWire/` GitHub Pages base.
- `npm run test:site` — verify static routes, metadata, capability boundaries, copy controls and isolated preview responses with Node.js only.
- `npm run preview:site` — build and serve the product website on a printed loopback-only URL.
- `git diff --check -- site` — check the website's `.editorconfig`-aligned HTML/CSS/JavaScript edits for whitespace errors; no generated `site/dist/` files are committed.
- `npm test` — run implemented workspace tests.
- `npm run db:migrate` — migrate the configured central SQLite database.
- `npm run dev:server` — run the Fastify API on port 3000.
- `npm run dev:web` — run the Vite browser UI with an API proxy.
- `node scripts/test/run-with-temp-root.mjs --cwd apps/server -- node --import tsx --test test/peer-membership-repository.test.ts test/peer-authorization-repository.test.ts test/migration-runner.test.ts` — Peer invitation rollback/replay/revoke, bilateral authorization lineage, durable Room ceilings, stopped backup and additive migration; no network or models.
- `node scripts/test/run-with-temp-root.mjs --cwd bridge -- go test -race ./internal/peer ./internal/privatefs` — private Peer receipts/history, local approval lifetime, and actual Go/Host HTTPS/WebSocket recovery; disposable loopback fixtures, no external service or models.
- `node scripts/test/run-with-temp-root.mjs --cwd apps/server -- node --import tsx --test test/peer-runtime-sessions.test.ts test/peer-runtime-ingress.test.ts test/native-peer-ingress.test.ts` — reciprocal Node proofs, isolated native Peer upgrades, ordered heartbeats, revocation, replacement and socket cleanup; no external service or models.
- `npm run generate --workspace @convene-wire/contracts` — regenerate wire types.
- `node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- npx tsx --test apps/server/test/authority.test.ts` — authenticated Host identity, stopped backup and real Go proof interoperability, without model calls.
- `node scripts/test/run-with-temp-root.mjs --cwd bridge --timeout-ms 180000 -- go test -race ./internal/authority` — private Authority partitions, identity/freshness denials and preserved legacy Inbox records; the separately invoked Server fixture supplies live proof interoperability.
- `node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- npx tsx --test tests/e2e/multi-authority.test.ts` — three authenticated fixture Hosts, one real Go core, colliding IDs, queues, credential isolation, offline and process-crash recovery; no model calls.
- `node scripts/test/run-with-temp-root.mjs --cwd apps/web --timeout-ms 120000 -- npx tsx --test test/space-directory.test.tsx test/local-node-runtime.test.tsx test/local-node-entry.test.tsx` — origin-bound links, session isolation and Local Node entry; run from the Web workspace for its JSX configuration.
- `node scripts/test/run-with-temp-root.mjs --cwd apps/web -- npx tsx --test test/peer-host-panel.test.tsx test/member-recovery.test.tsx` — Host invitation/Agent review, exact retry and session isolation with disposable Web fixtures.
- `CONVENE_WIRE_PEER_HOST_PREVIEW_FILE=/absolute/new-private-preview.json node scripts/test/run-with-temp-root.mjs --timeout-ms 610000 --cwd apps/server -- node --import tsx --test test/peer-host-browser-fixture.test.ts` — opt-in production Web preview over a disposable native Local Hub and actual Peer admission; build Web first. The private file contains a one-use local Owner entry, never publish it. The fixture waits up to nine minutes; create the same path with `.done` appended to finish. Both files and the owned servers/data are removed. No model or installed profile is used.
- `rg '^#' convenewire_network_design_v0.2.md` — review heading hierarchy.
- `npm run lint:docs` — lint maintained Markdown.
- `rg '^\| [A-Z]+-[0-9]+' docs/TASKS.md` — review registered task IDs.

## Disposable acceptance and previews

- `npm run test:temp-lifecycle` — verify success, failure, spawn error, timeout,
  cancellation, nested and parallel test-run cleanup with physical directory
  assertions.
- `npm run test:bridge` — run all Go Bridge tests with one owned temporary root
  and invocation-scoped Go build and module caches.
- `CONVENE_WIRE_CODEX_METADATA_TEST_BIN=/absolute/path/to/codex node scripts/test/run-with-temp-root.mjs --cwd bridge -- go test ./internal/runtime -run '^TestConfiguredAgentModel'` — optional installed-Codex metadata compatibility check using a disposable home, fake configured model, and only initialization/configuration-read RPCs; no model credentials or turns.
- `CONVENE_WIRE_CODEX_HANDOFF_TEST_BIN=/absolute/path/to/codex node scripts/test/run-with-temp-root.mjs --timeout-ms 150000 -- node --test scripts/qa/codex-handoff-compatibility.test.mjs` — ADP-020 opt-in installed-binary handoff checks with disposable profiles and an auth-free loopback provider: same-ID/history continuation, competing writers, dynamic tool handler failure, delayed unsubscribe release, shared-service callback boundaries, original-writer queue execution, native queue CLI routes, idle wakeup limits, non-idempotent retries, lost-ack reconciliation and cancellation before/after queue consumption. No desktop UI or real model is used; without the explicit executable these cases skip.
- `CONVENE_WIRE_CODEX_HANDOFF_TEST_BIN=/absolute/path/to/codex node scripts/test/run-with-temp-root.mjs --timeout-ms 150000 -- node --test scripts/qa/codex-desktop-mediator.test.mjs` — ADP-023 original-connection routing and synthetic tool callbacks, source write fencing, exact-turn output, retry deduplication, return, busy refusal and external-queue interference. Builds an owned test-only Go driver with an inherited control pipe; no listener, desktop GUI actions or real model. Defaults to skipped without the explicit native executable. Run `go test -race ./internal/desktopcodex` and `go vet ./internal/desktopcodex ./cmd/convenewire-codex-desktop` through the Bridge temporary-root wrapper for mediator and subprocess lifecycle checks.
- `CONVENE_WIRE_CODEX_HANDOFF_TEST_BIN=/absolute/path/to/codex node scripts/test/run-with-temp-root.mjs --cwd bridge --timeout-ms 180000 -- go test -race ./internal/runtime -run '^TestCodexConversationMetadata' -count=1` — bounded metadata discovery, invalid/untrusted response rejection and owned-child cleanup; the optional binary adds empty-profile native metadata checks. No conversation is resumed and no model is invoked.
- `node scripts/test/run-with-temp-root.mjs --cwd bridge -- go test ./internal/desktopcodex ./cmd/convenewire-codex-desktop` and the corresponding `go vet` command — ADP-022 private immutable startup plans, changed-binary/unsafe-plan rejection, stdio argument restriction, profile/tool environment preservation and duplicate-launch refusal.
- `CONVENE_WIRE_CODEX_HANDOFF_TEST_BIN=/absolute/App.app/Contents/Resources/codex CONVENE_WIRE_CODEX_DESKTOP_TEST_BIN=/absolute/App.app/Contents/MacOS/AppExecutable node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- node --test scripts/qa/codex-desktop-startup.test.mjs` — explicitly opt into launching the installed macOS desktop with a disposable profile and user-data directory. Builds the Go proxy, verifies actual stdio initialization and duplicate-launch refusal, then resumes the same synthetic Thread after desktop exit. Uses an auth-free loopback provider, performs no GUI actions and drains owned processes/socket files. Requires macOS GUI process access; without both explicit binaries the test skips. This is not Room UI acceptance.
- `npm run test:bridge-ui` — test embedded Console controllers, including pairing,
  native Space invitations/recovery/browser handoff, local Runtime forms and permission views.
- `npm run test:qa-evidence` — test the sanitized two-machine acceptance evidence verifier.
- `npm run test:product-experience` — verify disposable local/trusted product acceptance fixtures with real sealed evidence.
- `CONVENE_WIRE_PRODUCT_PREVIEW=1 npm run preview:product-experience` — serve the built Web UI on two isolated loopback QA servers, with synthetic model responses and temporary data removed on shutdown; never use for deployment.
- `npm run test:compose` — verify the default/custom central HTTPS ports and validate the Caddy configuration.
- `npm run test:e2e` — run deterministic cross-process acceptance tests.
- `node scripts/test/run-with-temp-root.mjs -- tsx --test --test-name-pattern 'central approval resumes' tests/e2e/governed-two-bridge-integration.test.ts` — SEC-017 real Central/Bridge process approval with a deterministic Codex protocol fixture, after building Web. No model or installed owner settings are used. Optional `CONVENE_WIRE_APPROVAL_PREVIEW=1` waits for client opt-in and three browser decisions; `CONVENE_WIRE_WORK_EVIDENCE_DIR` retains the sanitized summary. On an offline Go dependency cache, seed the wrapper's task-local `GOMODCACHE` from the existing module download cache before invoking the test.
- `CONVENE_WIRE_CODEX_BIN=/absolute/path/to/codex node scripts/test/run-with-temp-root.mjs --timeout-ms 60000 -- node --test tests/e2e/codex-approval-protocol.test.mjs` — SEC-018 opt-in installed CLI compatibility check. An isolated `CODEX_HOME` and loopback Responses fixture supply one fixed command; its approval is denied and the target must remain absent. It uses no model service, owner credentials or installed owner configuration. Without the explicit binary variable this test is skipped.

### Physical LAN Peer fixture

After explicit authorization for both devices, prepare a Windows AMD64 Go test
binary inside the temporary-root wrapper with
`cd bridge && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -c ./internal/peer -o "$CONVENE_WIRE_TEST_RUN_ROOT/peer.test.exe"`.
From the repository root in that same wrapper, run
`node scripts/qa/lan-peer-fixture.mjs PRIVATE_HOST_IPV4 PRIVATE_WINDOWS_IPV4 "$CONVENE_WIRE_TEST_RUN_ROOT/peer.test.exe" EVIDENCE_DIRECTORY`.
Use `--timeout-ms 1500000` for the outer wrapper; the gateway expires after
20 minutes. Both supplied addresses must be explicit private/loopback IPv4;
loopback runs are preflight evidence only.

The printed private `lan-access.json` contains the temporary download URL,
SHA-256 and bearer credential. Transfer only to the authorized Participant,
verify the archive hash before extraction, then run its `run.mjs` using existing
Node 22. The Windows executable needs no Go installation. The four allowlisted
Go scenarios use production Peer clients, restricted offline native children and
actual native Host PeerIngress, with disposable data and a private TLS leaf;
the Owner listener stays loopback-only. The bundle also runs Session partition
persistence and negative authority/protection checks, using one public contract
fixture. No models or system trust changes occur.

An authenticated `POST /result` on the download listener accepts the resulting
`result.txt` once. An authenticated `POST /finish` from the Host stops the
fixture, writes the source-address/job/digest record, and removes Host temporary
resources. Verify and remove the exact Participant staging directory and confirm
its test children stopped. Do not retain manifests, credentials, private keys or
expanded executables in evidence. The reusable helper's address/auth negatives
run with `node --test scripts/qa/lan-peer-fixture.test.mjs`; this does not certify
installed Windows UI, independent human consent, public Relay or release gates.

## Discussion maintenance tests

- `npm run test:discussion-benchmark` — provider-free regression for all benchmark adapters, packets and synthetic Server/Bridge flows.
- `npm run test:discussion-workspace` — focused source-pin, scoped-reader, adapter and historical replay regression, including continuation paths.
- `npm run test:discussion-complex` — focused complex-packet, reference-arithmetic, admission and synthetic continuation/failure regression.
- `npm run test:discussion-strong-single` — QA-078 source behavior, scoped grants,
  independent contributor barrier, lossless transfer, twelve-session admission
  and retained semantic-assessment audit; no external model invocation.
- `node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- node --test scripts/bench/authority-collaboration.test.mjs scripts/bench/authority-experiment.test.mjs` — QA-079 owner readers, typed disclosure, actual Result-service publication, killed-coordinator recovery, revoked sharing and retained audit; no external model.
- `node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- node --test scripts/bench/authority-session-observer.test.mjs scripts/bench/authority-session.test.mjs scripts/bench/authority-session-evidence.test.mjs` — QA-080 installed-CLI resource/template discovery over auth-free loopback, scoped denial, missing output, timeout/cancel/process failure, content-free Central terminal replay and retained evidence; no external model or retry of historical experiments.
- `node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- node --test scripts/bench/independent-owner.test.mjs` — QA-081 raw-only input, hidden post-proposal verification, wrong-value rejection, omitted-field preservation, actual Result/terminal storage and retained audit; no external model.
- `npm run test:discussion-evidence-access` — verify QA-072 historical pins, authority/ranges, returned-byte receipts and QA-073 diagnostics plus A/B/C installed-CLI source discovery over HTTP/WebSocket loopback without an external model.
- `npm run test:discussion-evidence-screening` — verify QA-074 manipulation gates, exact source returns, optional B reads, C coverage, frozen admission and retained reports without external models.
- `npm run test:discussion-claim-adjudication` — verify QA-075 common C/D inputs, returned-source claim bindings, output artifact validation and exclusive six-session admission without external models.
- `npm run test:discussion-criterion-closure` — verify the QA-076 synthetic task, full-deliverable checks, canonical criterion mapping, E/F parity, source authority, closed admission and retained six-run grading/receipt audit without external models.
- `npm run test:discussion-gpt55` — verify QA-077 model-only parity, fresh source scopes, consumed six-slot admission and retained first/table grading, receipts and separate metrics without external models.
- `npm run test:discussion-codex-bootstrap` — installed Codex CLI checks using an auth-free loopback fixture, without an external model.

## Bounded external-model experiments

Historical experiment authorizations are consumed and non-reusable. New real
model calls require a separately bounded Owner-authorized plan. Use the
provider-free maintenance tests for routine changes.

- `node scripts/test/run-with-temp-root.mjs --timeout-ms 3090000 -- node scripts/bench/authority-experiment.mjs --execute-qa079-frozen-twelve` — consume only QA-079's exact committed twelve-session ceiling once; not routine testing or permission for future calls.
- `npm run bench:discussion-evidence-access` — consume only the exact owner-authorized QA-072 nine-Finalizer freeze; an existing report prevents replay. This is not routine test or future execution permission.
- `npm run bench:discussion-evidence-screening` — consume only the newly authorized QA-074 nine-session freeze; the exclusive journal prevents retries or same-plan resume. Never treat this as a routine test command.
- `npm run bench:discussion-claim-adjudication` — consume only QA-075's frozen C/D, D/C, C/D plan once, with no retries or same-plan resume; this is not a routine test command.
- `npm run bench:discussion-criterion-closure` — QA-076's consumed six-session E/F plan. Its journal blocks repeat execution before provider startup; use the provider-free test command for maintenance. A new experiment needs a separately bounded Owner-approved plan.
- `npm run bench:discussion-gpt55` — the consumed QA-077 gpt-5.5 / low six-session plan; its journal rejects repeat startup. Use the provider-free test command for maintenance; further real calls require a new bounded Owner-authorized experiment.
- Historical `bench:discussion*` commands are not routine test commands or reusable execution permission. See [Discussion maintenance and evidence](discussion-usage-guide.md#维护与后续验证); exercised plans stay closed and a new real experiment requires a bounded new plan.
- `npm run test:e2e:live` — explicitly invoke local Codex and Pi against an isolated temporary Team.

## Bridge owner-local operations

- `go run ./cmd/convenewire-bridge console` from `bridge/` — run the token-authenticated local client setup UI.
- In Console, open **受控开发**, refresh registered resources, choose **读取我的 Room**, set the Agent, verification profiles, allowed initiators/directories and finite budgets, then save the work policy. This is standing owner consent; matching Room development Tasks do not need another local confirmation. Revoke an old policy before replacing overlapping authority. Repository and Runtime/verifier registration commands below remain first-use prerequisites.
- `CONVENE_WIRE_WORK_POLICY_UI_FIXTURE=1 node scripts/test/run-with-temp-root.mjs --timeout-ms 1260000 --cwd bridge -- go test ./internal/console -run '^TestWorkPolicyBrowserFixture$' -count=1 -v` — serve the actual embedded client with disposable simulated resources for browser acceptance; no model or installed permission is used. Finish via the fixture's loopback `POST /fixture/stop`.
- `go run ./cmd/convenewire-bridge artifact publish --config /path/bridge.json --agent Builder --run-id run_... --type patch --file change.patch --title "Verified patch" --summary "What changed"` from `bridge/` — publish one bounded Workspace-relative snapshot for an active assigned Run.
- `go run ./cmd/convenewire-bridge result propose --help` from `bridge/` — submit one inline, contract-valid immutable Result for a configured Agent and exact assigned Run; the command never accepts a proposal file or review/completion action.
- `go run ./cmd/convenewire-bridge repository bind --config /path/bridge.json --binding-id repobind_example001 --repository-id repo_example001 --alias Project --workspace /absolute/repository --allowed-root /absolute/repository --confirm` from `bridge/` — explicitly register one owner-selected local Git checkout; this grants no Runtime, Task, verification, integration or remote authority.
- `go run ./cmd/convenewire-bridge repository list --config /path/bridge.json` and `go run ./cmd/convenewire-bridge repository revoke --config /path/bridge.json --binding-id repobind_example001 --expected-revision 1 --confirm` from `bridge/` — inspect path-free local registration receipts or retain an irreversible revocation; standalone commands require the Bridge/Console owner lock to be available and never remove Git data.
- `go run ./cmd/convenewire-bridge repository grant issue --config /path/bridge.json --file /absolute/owner-reviewed-grant.json --confirm` from `bridge/` — retain one exact owner-local Task consent specification for an existing configured Agent and registered repository; this does not start or advertise a governed Runtime.
- `go run ./cmd/convenewire-bridge repository grant list --config /path/bridge.json` and `go run ./cmd/convenewire-bridge repository grant revoke --config /path/bridge.json --grant-id grant_example001 --expected-revision 1 --expected-digest REVIEWED_DIGEST --confirm` from `bridge/` — inspect path-free grant specifications/receipts or append a digest-bound revocation, including when the source/Git or an unexpired Device token is unavailable.
- `go run ./cmd/convenewire-bridge repository cleanup grant issue --config /path/bridge.json --grant-id cleanupgrant_example001 --operation-id op_cleanup_example001 --checkpoint-file /absolute/checkpoint.json --expires-at 2026-09-02T12:00:00Z --confirm` from `bridge/` — retain one cleanup-only owner consent after the exact local checkpoint, stopped-Run fence, finished process and current binding are rejoined; it does not create or advertise a Runtime grant.
- `go run ./cmd/convenewire-bridge repository cleanup preview --config /path/bridge.json --grant-id cleanupgrant_example001 --operation-id op_cleanup_example001 --checkpoint-file /absolute/checkpoint.json` followed by `repository cleanup execute` with the same pins, `--expected-preview-digest REVIEWED_DIGEST --confirm` — inspect and retire only the exact captured worktree/ref under current cleanup consent; no caller-supplied path or global scan is accepted.
- `go run ./cmd/convenewire-bridge repository cleanup grant list --config /path/bridge.json` and `repository cleanup grant revoke --config /path/bridge.json --grant-id cleanupgrant_example001 --expected-revision 1 --expected-digest REVIEWED_DIGEST --confirm` — inspect or irreversibly revoke the separate path-free cleanup consent, including after the Agent is removed from current configuration.
- `go run ./cmd/convenewire-bridge repository profile register --config /path/bridge.json --profile-id profile_example001 --agent-id agent_example001 --permission-profile convenewire_governed --confirm` from `bridge/` — physically probe and immutably register one exact owner-local Codex executable/configuration/profile boundary; a failed probe leaves no profile and registration alone is not Runtime startup authority.
- `go run ./cmd/convenewire-bridge repository profile list --config /path/bridge.json` and `go run ./cmd/convenewire-bridge repository profile revoke --config /path/bridge.json --profile-id profile_example001 --expected-revision 1 --expected-digest REVIEWED_DIGEST --confirm` from `bridge/` — inspect path-free local Runtime profile receipts or append an irreversible digest-bound revocation without starting Run machinery.
- `go run ./cmd/convenewire-bridge repository integration execute --config /path/bridge.json --operation-id op_integration_example001 --confirm` from `bridge/` — fetch one exact Central-approved owner-local integration operation, recheck its current integration-only grant and binding, and atomically compare-and-set the approved target ref; it never merges, rebases, pushes, resets or scans unrelated repositories.
- `go run ./cmd/convenewire-bridge repository verifier register --config /path/bridge.json --file /absolute/owner-reviewed-verifier.json --confirm` from `bridge/` — immutably register one owner-local bounded verification command/profile; `repository verifier list` and `repository verifier revoke --profile-id ... --expected-revision 1 --expected-digest ... --confirm` inspect or revoke it without granting Task, Run, Result or integration authority.

## Desktop packaging and Windows resources

- `node --test scripts/local-node/native-space-navigation.test.mjs` — execute the actual native Space click script without the Wails HTTP runtime, covering WKWebView and WebView2 message ports and malformed references.

- `npm run capture:qa-002 -- --input /path/input.json --database /path/agent-room.sqlite --metrics /path/metrics.txt --bridge-installer /path/convenewire-bridge-desktop_VERSION_windows_amd64_setup.exe --bridge-desktop-archive /path/convenewire-bridge-desktop_VERSION_windows_amd64.zip --release-checksums /path/SHA256SUMS --output /path/evidence.md` — compute both Windows candidate digests, safely bind the packaged executable and authenticated Bridge/Central build observations to one reviewed two-machine record, and render no secrets or local paths.
- `go build -tags desktop ./cmd/convenewire-bridge-desktop` from `bridge/` — build the native Wails Bridge GUI for the current platform.
- `go test -tags desktop ./cmd/convenewire-bridge-desktop` from `bridge/` — verify desktop-only state mapping and compile its native shell.
- `go run -gcflags=github.com/srwiley/rasterx=-d=fmahash=qn . -root ../../.. -mode generate` from `bridge/tools/windows-resources/` — regenerate the checked-in Windows PNG, multi-size ICO and amd64 resource object from the product SVG using pinned non-fused arithmetic.
- `go test -gcflags=github.com/srwiley/rasterx=-d=fmahash=qn ./... && go vet ./... && go run -gcflags=github.com/srwiley/rasterx=-d=fmahash=qn . -root ../../.. -mode check` from `bridge/tools/windows-resources/` — verify the isolated icon tool and deterministic generated resources; format its Go source with `gofmt -w *.go`.
- `go run -gcflags=github.com/srwiley/rasterx=-d=fmahash=qn . -root ../../.. -mode verify -exe /absolute/path/to/ConveneWire-Bridge.exe` from `bridge/tools/windows-resources/` — inspect the actual Windows PE icon group and image resources rather than a generic Shell fallback.
- `RELEASE_TAG=v0.2.0-rc.3 GOOS=linux GOARCH=amd64 ./scripts/package-release.sh` from `bridge/` — build one portable Bridge archive.
- `LOCAL_HUB_BUNDLE=/absolute/native-hub RELEASE_TAG=v0.2.0-rc.3 GOARCH=arm64 ./scripts/package-desktop-darwin.sh` from `bridge/` — build one unsigned native macOS Node-first GUI archive using a Hub with the same source commit and version.
- `pwsh -File ./scripts/package-desktop-windows.ps1 -LocalHubBundle /absolute/native-hub -ReleaseTag v0.2.0-rc.3 -GoArch amd64` from `bridge/` on native Windows with Inno Setup — build one unsigned Windows Node-first GUI archive and current-user installer using a matching native Hub.
- `pwsh -File ./scripts/verify-desktop-windows-installer.ps1 -PreviousReleaseTag v0.4.0 -PreviousInstallerPath /path/to/previous_setup.exe -ReleaseTag v0.4.1-rc.1 -CandidateArchivePath /path/to/candidate.zip -CandidateExecutablePath '/path/to/ConveneWire Bridge.exe' -InstallerPath /path/to/candidate_setup.exe` from `bridge/` on native Windows — install the previous stable package, preserve representative owner state through the strictly newer candidate in-place upgrade, then verify uninstall ownership.

## Central operations and release

Use the current owning Operations/QA release instructions before acting on a
real installation or release. Local development authorization is not authority
to migrate, restore, deploy or publish.

- `go test ./... && go vet ./... && go build ./cmd/convenewirectl` from `ops/convenewirectl/` — verify and build the central lifecycle controller.
- `convenewirectl trust-rotation prepare --data-root /path --overlap 24h` followed by `convenewirectl trust-rotation activate --data-root /path` — stage an authenticated two-CA Bridge overlap, wait for every eligible Device acknowledgement, and switch the private Caddy authority with rollback-safe readiness.
- `convenewirectl migrate-public-ca --data-root /path` — explicitly relabel only a legacy direct-HTTPS installation whose existing origin passes system-only public-CA readiness before and after migration.
- `convenewirectl migrate-private-hostname --data-root /path --hostname central.local` — move one ready scoped-private literal-IP Central to a stable private hostname while preserving its CA, installation identity, data and Device credentials through rollback-safe exact-host readiness.
- `convenewirectl migrate-browser-transport --data-root /path --mode lan_http|direct_https` — explicitly switch only a ready scoped-private installation between CA-free LAN browser HTTP and browser HTTPS while preserving the pinned HTTPS Bridge channel, CA, Device credentials and data through commit-last rollback-safe readiness.
- `RELEASE_TAG=v0.4.0-rc.1 SOURCE_REF=HEAD GOARCH=amd64 ./scripts/build-central-image.sh` from `ops/convenewirectl/` — build the once-per-architecture Server+Caddy OCI bundle with SPDX SBOMs and SLSA provenance.
- `RELEASE_TAG=v0.4.0-rc.1 SOURCE_REF=HEAD GOARCH=amd64 CENTRAL_IMAGE_BUNDLE_DIR=/path/to/image-bundle ./scripts/verify-central-image-docker.sh` from `ops/convenewirectl/` — prove a clean Docker daemon can load the final multi-image OCI archive and execute both exact digest references without pulling or building.
- `RELEASE_TAG=v0.6.0-rc.1 SOURCE_REF=HEAD ./scripts/package-central-release.sh` from `ops/convenewirectl/` — build one exact-commit, checksum-pinned, host-neutral Central source archive with Linux amd64/arm64 and macOS arm64 lifecycle helpers; Server/Web are built on the target through Docker Compose.
- `RELEASE_TAG=v0.6.0-rc.1 SOURCE_REF=HEAD ASSET_DIR=/path/to/dist ./scripts/verify-central-release.sh` from `ops/convenewirectl/` — verify the source package closure, source equality, three helper architectures, release/schema identity, checksums and forbidden-state boundary.
- Dispatching the ConveneWire Release workflow for an empty draft Release builds and verifies two Linux Bridge CLI archives, one Apple-silicon macOS Desktop archive with bundled CLI helper, one Windows Desktop archive and installer with bundled CLI helper, one host-neutral Central source archive with a separate internal-checksum pin, the outer checksums, and license assets.
- `docker compose up -d --build` — run the trusted-team Server and Caddy profile.
- `./scripts/compose-backup.sh` — create and copy a verified online SQLite backup.
- `./scripts/compose-restore.sh /absolute/backup.sqlite` — stage a verified restore under a new database name while Server is stopped.

## Maintaining commands and governed modules

When adding a module, document its build, run, format and test commands in this
reference in the same commit. Keep `AGENTS.md` focused on shared constraints.

Governed Execution, Repository and Verification modules use the existing
`npm run dev:server`, `npm run build --workspace @convene-wire/server`,
`npm run test --workspace @convene-wire/server` and `npm run test:e2e`
commands. Bridge repository operations use `gofmt`, `go test ./...` and
`go vet ./...` from `bridge/`; concurrency-sensitive packages also require
`go test -race`. These modules follow ADR-0036 and must not advertise unfinished
capabilities or treat generated contracts as runtime acceptance.

## Exact owner evidence disclosure (SEC-015)

This opt-in path uses an already paired Bridge and the source owner's full Web
session. It does not require model calls. Set `ownerPrivateOutput: true` on a
selected local Agent and restart its Bridge to advertise the mode. Ordinary
Agents are unchanged. Private collection requires POSIX owner-only storage or
Windows local storage with a protected current-user/LocalSystem DACL, as defined
by [ADR-0058](adr/0058-protect-windows-private-output.md). Windows refuses weak
existing ACLs, linked/reparse paths and volumes without persistent ACLs. It does
not silently repair existing files or support UNC private stores. Do not enable
governed execution on the same private Agent.

A completed private Run saves its candidate under
`<dataDir>/private-output/<runId>.txt` with owner-only permissions. Inspect it
locally and select the exact UTF-8 release text (1–16384 bytes, no leading or
trailing whitespace). Retain a fixed regular-file source snapshot up to 4 MiB.
Use opaque source IDs, never private paths as IDs.

```bash
convenewire-bridge disclosure prepare \
  --config /owner/bridge.json --agent PrivateResearcher \
  --run-id run_REPLACE_WITH_COMPLETED_RUN \
  --source-file /owner/frozen-source.txt \
  --release-file /owner/selected-release.txt \
  --evidence-ref evidence_REPLACE_WITH_OPAQUE_ID \
  --bundle /owner/release-bundle.json
```

The command makes no network request. It derives Device/Agent/Run/Task/Room and
Task revisions from pairing and the completed local inbox record. Optional
`--source-start` / `--source-end` specify a half-open byte range; the default is
the whole snapshot. `--source-revision` defaults to the snapshot SHA-256; an
explicit fixed Git revision is an owner attestation, not Central verification.
The one-hour request, exact content and local source path remain in the private
bundle. Only `<bundle>.request.json` contains the metadata for Central.

In the Task's **Evidence → Private evidence disclosure** panel, paste that
request file, inspect the digest, byte count, source/version/range and destination,
confirm the reviewed local text, then approve. Only the Device's actual owner
can approve, using a full session; a Team administrator or Device token cannot
substitute for that consent. Copy the returned grant ID.

```bash
convenewire-bridge disclosure publish \
  --config /owner/bridge.json --agent PrivateResearcher \
  --bundle /owner/release-bundle.json \
  --grant-id disclosure_REPLACE_WITH_APPROVED_GRANT
```

Bridge verifies the unchanged source snapshot and exact local text, reads current
Central authority, then sends only the approved text and grant revision. A
changed source, range, destination, Device, owner, content or expired/revoked grant
prevents a new publication. Keep the bundle and source for explicit retry. If a
previous publication committed, retry resolves its Result using an authenticated
GET and does not retransmit the text. There is no automatic content POST retry.

The same panel revokes future publication. Revocation is effective only after
Central acknowledges it, and does not recall an already committed Result or
bytes already in flight. Result acceptance remains a separate human action.
Delete local candidate/bundle/snapshot files only as an explicit owner cleanup;
local deletion does not revoke the Central grant or recall a Result.

Focused verification, using disposable sources and no external model:

```bash
node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- \
  node --import tsx --test apps/server/test/evidence-disclosure.test.ts
node scripts/test/run-with-temp-root.mjs --cwd apps/web --timeout-ms 120000 -- \
  node --import tsx --test test/evidence-disclosure-panel.test.tsx
node scripts/test/run-with-temp-root.mjs --cwd bridge --timeout-ms 180000 -- \
  go test -race ./internal/runtime ./internal/result ./internal/delivery ./internal/connection
npm run test --workspace @convene-wire/contracts
```

## Discussion disclosure admission (DISC-021)

To use the existing private workflow in Discussion, assign the private Agents and
at least one shared-output Finalizer to an active Task. Select all eligible
participants and all-settled completion when every owner should contribute; private
Agents do not support read-only quorum. Allow sufficient Wave time for owner review.
Use the SEC-015 prepare/approve/publish commands above for each completed private
Run. The turn waits for release, then automatically admits its exact Result.
Finish or the Wave deadline closes missing evidence without another Runtime call.

Provider-free local checks:

```bash
node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- \
  node --import tsx --test apps/server/test/discussion-disclosure.test.ts
node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- \
  node --import tsx --test tests/e2e/disclosure-discussion.test.ts
node scripts/test/run-with-temp-root.mjs --cwd apps/web --timeout-ms 120000 -- \
  node --import tsx --test test/discussion-wave-status.test.tsx
```

The cross-process test builds two real Go Bridges but uses synthetic Runtime output
and disposable credentials on one host. Physical devices and external models require
the separate [QA-084 preparation](acceptance/qa-084-physical-disclosure-discussion.md).

## Windows private storage (BRG-076)

Use an existing local data directory. The Bridge creates its protected
`private-output` child before Runtime startup and exclusively creates candidate
files. Prepared bundles use the same private-file boundary. An existing weak
private directory is rejected; the owner must deliberately choose or repair the
local location. Windows administrators and processes under the same account are
not isolated from each other by this feature.

Focused disposable verification:

```bash
node scripts/test/run-with-temp-root.mjs --cwd bridge --timeout-ms 180000 -- \
  go test -race ./internal/privatefs ./internal/runtime ./internal/result
```

For native Windows execution, build test executables with
`GOOS=windows GOARCH=amd64 go test -c` for `./internal/privatefs` and
`./internal/runtime`, then copy only those binaries to an approved test root.
Set process-local `TEMP` and `TMP` to an owned subdirectory. In PowerShell quote
Go test arguments, for example `& '.\privatefs.test.exe' '-test.v'` and
`& '.\runtime.test.exe' '-test.v' '-test.run=Private'`. No machine-wide Go install
is required for native execution of those cross-compiled tests. Preserve the
binary digests and native output; remove only the owned test artifacts.

## Physical two-identity disclosure (QA-085)

This is an owner-authorized physical test, not a routine CI command or model
experiment. Follow [the frozen procedure](acceptance/qa-085-physical-two-identity-disclosure.md).
Provide an out-of-repository JSON file with absolute local `identityFile`,
`knownHostsFile`, `windowsBinary`, `reportFile`, plus approved SSH `host`, Windows
`workspace` and `node` executable. Verify the host key independently before using
this configuration. The adapter neither learns a new host key nor reads the
user's global SSH configuration. Its temporary Windows path currently requires
an ASCII workspace without spaces. It creates only owned `.cache/qa085-*` roots.

```bash
CONVENE_WIRE_PHYSICAL_DISCLOSURE=1 \
CONVENE_WIRE_QA085_CONFIG=/absolute/path/to/approved-local-config.json \
node scripts/test/run-with-temp-root.mjs --timeout-ms 540000 -- \
  node --import tsx --test tests/e2e/physical-disclosure.test.ts
```

The Windows executable must come from the recorded source revision. Build it
with `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o <owned-output> ./cmd/convenewire-bridge`
from `bridge/`. The adapter builds the native Mac executable, verifies the copied
Windows digest, and uses existing Node on each host. It installs no global tools,
changes no OS accounts, and calls no external models. Its application test
identities do not complete QA-084's independent-human-owner governance evidence.

## Standing-work browser acceptance

- `CONVENE_WIRE_BROWSER_EXECUTABLE=/absolute/tools/chrome-headless-shell node scripts/test/run-with-temp-root.mjs --cwd bridge -- go test ./internal/verification -run '^TestBrowserPhysicalCandidate$' -count=1 -v` — opt-in disposable static candidate and dedicated browser; no model or installed profile. Native process permissions are required; a sandbox startup error is not page acceptance.
- The existing `repository verifier register` command accepts the reviewed browser JSON example in [VER-002](acceptance/ver-002-browser-verification.md). Build-dependent or backend-dependent pages are not implicitly prepared by this static verifier.
- `CONVENE_WIRE_BROWSER_EXECUTABLE=/absolute/tools/chrome-headless-shell CONVENE_WIRE_WORK_EVIDENCE_DIR=/absolute/owned-evidence node scripts/test/run-with-temp-root.mjs -- node_modules/.bin/tsx --test --test-name-pattern='conversation completes' tests/e2e/governed-two-bridge-integration.test.ts` — actual temporary Central/Bridge, one local form policy, one read-only conversation and two ordinary Room composer development requests, physical Git/command/browser receipts, restart and parent revocation. Build Web first with `npm run build --workspace @convene-wire/web`. Runtime is deterministic and makes no model calls. The evidence directory is explicitly retained; all process/profile/repository state is disposable. Omitting the browser variable exercises only API/Git/command acceptance.

- `CONVENE_WIRE_BROWSER_EXECUTABLE=/absolute/tools/chrome-headless-shell CONVENE_WIRE_WORK_EVIDENCE_DIR=/absolute/owned-evidence node scripts/test/run-with-temp-root.mjs -- node_modules/.bin/tsx --test --test-name-pattern='trusted device executes ordinary' tests/e2e/governed-two-bridge-integration.test.ts` — local device trust UI, ordinary Room request, direct temporary Git commit without policy registration, Central consent display, restart and revocation. No model or real owner consent is used. Build Web first. Combine with the previous scenario using `--test-name-pattern='conversation completes|trusted device executes ordinary'`.

## Native Local Hub bundle

OPS-018 builds a native directory for the desktop supervisor. Node 22 and locked
production dependencies must already be present on the build machine. The
result carries Node and does not require Node/npm/Docker on the user's machine.

```sh
npm run build:local-hub
mkdir -p dist
node scripts/local-node/bundle.mjs build dist/local-hub
node scripts/local-node/bundle.mjs verify dist/local-hub
npm run test:local-hub-bundle
```

The output must not already exist. Node's distribution license is read beside
its executable (Windows) or in its installation root (`../LICENSE` from a bin
directory); builders with a
different distribution layout set `CONVENE_WIRE_NODE_LICENSE` to that license
file. Packaging validates the native Node version and SQLite load with an empty
PATH. The manifest records the source commit and whether the checkout has local
changes, and includes every regular file's size and SHA-256. This inventory
checks bundle integrity; release authenticity still comes from the verified
outer distribution. Never copy private data into a bundle. macOS package tests
provide no Windows native or installed-client evidence.

`test:local-hub-bundle` also checks desktop exact-source/version admission and
Node distribution license discovery. Direct native packaging requires
`LOCAL_HUB_BUNDLE` to name an already built bundle with the same `RELEASE_TAG`
and exact `SOURCE_REF` commit. A release bundle must record a clean checkout;
only `v0.0.0-local` allows a manifest explicitly recording local modifications.
The `package:local-node` wrapper prepares this input automatically.

`node scripts/local-node/release-hub.mjs HUB_DIRECTORY SOURCE_COMMIT RELEASE_TAG PLATFORM ARCH`
inspects an extracted distribution against its explicit target without running
foreign code. It requires a clean source manifest even for a local version.
The combined release verifier calls it only after
`python3 scripts/local-node/verify-desktop-zip.py ARCHIVE PACKAGE` validates the
desktop ZIP before extraction. Python is used by these ZIP regression checks
(`python` on Windows, `python3` elsewhere). Native build and launch continue to
use the current-platform `bundle.mjs verify` admission.

On native Windows, run
`node scripts/test/run-with-temp-root.mjs -- node --test scripts/qa/windows-desktop-archive.test.mjs`
to verify portable ZIP names, Unicode/hidden files and existing-output/junction
negatives using Windows PowerShell. Other platforms explicitly skip this test.

### Optional Relay service profile

OPS-024 lets an operator include one public `RelayServiceProfile` from
[ADR-0070](adr/0070-relay-tunnel-access.md) in a distribution. The operator
must already provide the Relay, Node domain and CA configuration; packaging
does not deploy a service, change DNS, contact a CA or enable access for users.
The Node Owner still reviews the provider and explicitly accepts the service
and automatic certificate terms before enabling access.

The profile is a regular JSON file, not a symlink, at most 16 KiB. Its exact
closed-schema fields are `schemaVersion: 1`, `id`, `displayName`, `relayOrigin`,
`nodeDomain`, `acmeDirectoryUrl` and `termsUrl`. Origins and service URLs use
HTTPS. This file is public distribution data: never put tokens, account keys,
private material or credential-bearing URLs into it. Unknown fields, duplicate
JSON keys, malformed UTF-8, unsafe URLs and oversized files are rejected.

```sh
npm run check:relay-profile -- /operator/relay-service.json
node scripts/local-node/bundle.mjs build dist/relay-hub --relay-profile /operator/relay-service.json
node scripts/local-node/bundle.mjs verify dist/relay-hub
npm run package:local-node -- /absolute/new-output --relay-profile /operator/relay-service.json
```

The selected bytes are copied unchanged to `relay-service.json` at the Hub
bundle root. The existing exhaustive manifest includes its exact size and
SHA-256, and both native-target and release-target JavaScript inspection also
validate its schema. CLI output reports the selected profile digest, or `null`
when absent. The source commit and clean/modified state continue to describe
the actual checkout; selecting a profile cannot make a modified build clean.
Existing saved Node profiles retain their prior service decision when a new
distribution supplies a different profile.

Library callers pass the explicit `relayProfileFile` option to `buildBundle`.
By default neither library nor CLI reads `CONVENE_WIRE_RELAY_PROFILE_FILE`;
an inherited environment variable cannot silently add a provider. CI or a
local operator may explicitly opt into that environment input for one command:

```sh
CONVENE_WIRE_RELAY_PROFILE_FILE=/operator/relay-service.json node scripts/local-node/bundle.mjs build dist/relay-hub-env --relay-profile-env
```

The desktop wrapper accepts the same `--relay-profile-env` flag. Combining it
with `--relay-profile` is rejected, and the profile environment variable is
removed before invoking the lower-level native packager. Without either
option the bundle contains no profile and the UI reports that the service is
not configured, while advanced manual HTTPS remains available. Temporary Hub
and desktop staging retain the existing cleanup behavior; no extra app is
installed or left expanded by selecting a profile.

`npm run test:local-hub-bundle` covers profile parsing, explicit selection,
missing-profile compatibility, schema and inventory tampering, and native
bundled contracts/SQLite loading with an empty PATH. It uses a disposable
profile with test domains and makes no external Relay or CA requests.

### Relay local verification

The following tests use owned temporary roots, disposable local CA/DNS fixtures
and the actual Go Relay daemon. They require the locked Node dependencies and
Go 1.26.7, and do not use a public service, real CA or paid model. Run the Go
interop and native bundle suites serially to avoid competing cold Go builds.

```sh
node scripts/test/run-with-temp-root.mjs --timeout-ms 300000 --cwd apps/server -- node --import tsx --test --test-concurrency=1 test/relay-settings.test.ts test/relay-certificates.test.ts test/relay-connector.test.ts test/relay-runtime.test.ts test/relay-readiness.test.ts test/relay-restore.test.ts
node scripts/test/run-with-temp-root.mjs --timeout-ms 300000 --cwd bridge -- go test -race ./internal/peer -run '^TestGoRelay' -count=1
node scripts/test/run-with-temp-root.mjs --cwd bridge -- go vet ./internal/peer
npm run build:local-hub
npm run test:local-hub-bundle
npm run test:local-node
```

For a bounded manual inspection of the production Web, first build the Hub,
then set `CONVENE_WIRE_RELAY_PREVIEW_FILE` to a new private temporary JSON path
and run `apps/server/test/relay-browser-fixture.test.ts` through the same wrapper
with a 600000 ms outer timeout. The private file contains one-use local Owner
entry URLs. Close its browser tabs and create the sibling `.done` file to stop
early; normal teardown removes both files, the local services and fixture data.
The preview does not install or bypass browser certificate trust. Observed
results and their limits are in [QA-093](acceptance/qa-093-relay-access.md).

## Local Node desktop and recovery

`node scripts/test/run-with-temp-root.mjs --cwd apps/server -- node --import tsx --test test/peer-ingress-configuration.test.ts test/native-peer-ingress.test.ts test/local-node.test.ts test/peer-human-entry.test.ts`
checks explicit Peer HTTPS configuration, actual TLS admission/browser scope,
Owner/control/Device isolation, origin pins, port collision and pending/slow
client shutdown. It uses owned loopback certificates and temporary roots.
The configuration/deployment procedure is in
[Native Peer HTTPS ingress](modules/operations-deployment.md#native-peer-https-ingress).

`npm run test:local-node` builds a disposable native host and offline Pi fixture,
then drives the real bundled Hub/Bridge with an empty PATH. No model credentials
or installed profile are used. `npm run package:local-node` builds a native local
development desktop ZIP under `dist/local-node-desktop`; append `-- /absolute/new-output`
to select a fresh output directory. The wrapper cleans its own temporary Hub
staging directory. On macOS, desktop staging uses a private hidden directory;
success, build/validation failure and ZIP failure all remove that directory.
Only the completed ZIP remains in the output directory. Extract it into an
owned temporary directory for inspection/install, then remove that extraction.
Keep rollback applications as verified ZIPs alongside their stopped data snapshots,
so application discovery does not show backup copies as additional clients.
Packaging does not install, publish or enable login startup.

The native test also enables HTTPS in its stopped disposable profile, verifies
local and Peer port conflicts, confirms Owner/control isolation, and checks
that stop and backup/restore preserve the same identity and TLS configuration.

A packaged desktop defaults to the Local Hub, including when an existing remote
profile is retained. The old profile is not migrated or started implicitly.
Explicit desktop flags are `--hub-bundle /absolute/hub`,
`--node-data /absolute/private-node-root`, optional `--workspace /absolute/workspace`,
and `--bridge-only` for the released remote path.

For headless local operation use the packaged `convenewire-node` helper with
`--hub-bundle /absolute/hub --data-dir /absolute/private-node-root` and an explicit
workspace. `--stdio` is a private automation channel; its one-use entry and
Console URLs contain credentials and must not be published or logged. EOF stops
the Console/Bridge before the Hub and releases the data lease.

For a bounded browser inspection of the same disposable QA-090 scenario, set
`CONVENE_WIRE_LOCAL_NODE_PREVIEW_FILE=/absolute/new-private-preview.json` and run
`node scripts/test/run-with-temp-root.mjs --timeout-ms 450000 -- node --test scripts/local-node/supervisor.test.mjs`.
After the product loop passes, the scenario writes a private file containing
fresh entry/Console URLs and waits up to five minutes. Open the entry within its
two-minute validity, then create `/absolute/new-private-preview.json.done` to
finish. Both files and the owned process/data roots are removed on completion.
Do not publish these credential-bearing preview files.

Before an upgrade, stop the desktop and create a stopped snapshot with
`convenewire-node --data-dir /absolute/private-node-root --backup /absolute/new-snapshot`.
Keep the snapshot and original compatible bundle together. To restore, preserve
the failed root separately and use
`convenewire-node --data-dir /absolute/private-node-root --restore /absolute/new-snapshot`.
Restore requires the original root to be absent and refuses a different target,
tampered contents, links or a live owner. Do not operate the preserved copy as a
second writable Node. Neither helper silently downgrades a newer SQLite schema.

## Experimental Codex desktop startup

ADP-022 prepares the local startup boundary only; it does not enable Room adoption.
The owner accepted an explicit initial setup/restart. Do not replace the installed
desktop, change global launch environment or treat a successful startup as handoff
acceptance. The current implementation is macOS-only and uses a version-specific
desktop executable override, as recorded in
[ADR-0072](adr/0072-hand-off-desktop-codex-sessions.md).

From `bridge/`, build with
`go build -o ./bin/convenewire-codex-desktop ./cmd/convenewire-codex-desktop`.
Prepare a **new** private plan using explicit absolute paths:

```sh
./bin/convenewire-codex-desktop prepare \
  --desktop /Applications/ChatGPT.app/Contents/MacOS/ChatGPT \
  --out "$HOME/Library/Application Support/ConveneWire/codex-desktop/launch-plan.json"
```

Preparation hashes the desktop, its archive and bundled provider and creates an
immutable owner-only file. It neither starts nor stops the desktop. Once work is
settled and the selected desktop has exited, the experimental startup command is:

```sh
./bin/convenewire-codex-desktop launch \
  --plan "$HOME/Library/Application Support/ConveneWire/codex-desktop/launch-plan.json"
```

The command refuses an already running desktop and conflicting existing
transport overrides. It changes the executable selection only for that launch,
preserves the existing Codex home and tool environment, and opens no listener.
The proxy accepts only native version checks and stdio app-server invocations.
For stdio it mediates one verified native child and drains that owned process
group when the desktop connection ends. Version checks directly execute the
verified provider. The in-process mediation API is not a Room control endpoint.
After an app/provider update, the old plan fails verification;
validate compatibility before preparing a new plan under a new filename.

To restore ordinary startup, quit the experimental desktop after work settles
and open the existing app normally. No history migration or rollback copy of the
app is needed. The experimental entry must be used again after quitting; this
component does not install a persistent launcher, login item or global variable.

## Desktop Codex Room integration

- `CONVENE_WIRE_CODEX_HANDOFF_TEST_BIN=/absolute/path/to/codex node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- tsx --test scripts/qa/codex-room-handoff.test.ts` — QA-094 actual native original connection, Local Hub HTTP/WebSocket, Bridge inbox/Runtime, same-ID/history/tool continuation, explicit consent, cancel/review, no duplicate Run, coordinator restart and return. Uses isolated profiles and an auth-free loopback provider; no paid model or owner conversation.
- `node scripts/test/run-with-temp-root.mjs --cwd bridge -- go test -race ./internal/desktopcodex` — original connection, authenticated Unix control, source-write exclusion, exact-turn interrupt, bounded sandbox, protected journal and lost-acknowledgment recovery.
- `node scripts/test/run-with-temp-root.mjs -- tsx --test apps/server/test/desktop-handoff.test.ts` — native-only destination confirmation, audience/assignment checks, typed delivery, content withholding, release and provisional cancel.
- `node scripts/test/run-with-temp-root.mjs --cwd apps/web -- tsx --test test/desktop-codex-handoff.test.tsx` and `npm run test:bridge-ui` — browser Task entry and embedded owner review/consent/return controls.
- `CONVENE_WIRE_HANDOFF_UI_FIXTURE=1 node scripts/test/run-with-temp-root.mjs --cwd bridge -- go test ./internal/console -run '^TestDesktopHandoffBrowserFixture$' -v` — opt-in local native Console page with synthetic metadata for browser inspection. Its printed loopback URL uses a fixture credential; POST `/fixture/stop` ends it. No actual Codex connection or owner state.

The macOS desktop archive includes `Resources/bin/convenewire-codex-desktop`.
In an eligible fresh local Task, choose “连接已有 Codex 会话” / “在本机确认”.
The native Codex page prepares a pinned cooperative startup plan. After saving
work and quitting Codex yourself, use “启动 Codex”, open the intended conversation
there, and return to review its exact audience and permissions. Confirm consent,
then send the next message from that Task's Room. “交回 Codex” restores original
input; canceling the initial review leaves the Task available. Saved bindings
remain manageable from native Agent settings after restart. Launching Codex
normally rolls back the experimental startup selection.

This workflow is currently verified on macOS arm64 with the pinned provider in
[QA-094](acceptance/qa-094-codex-desktop-handoff.md). Only already-open idle Threads,
empty native queues, no goal and matching local workspaces are supported. Setup,
review and model execution are separate operations; packaging never activates an
owner profile or grants disclosure consent.
