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
- `npm run generate --workspace @convene-wire/contracts` — regenerate wire types.
- `rg '^#' convenewire_network_design_v0.2.md` — review heading hierarchy.
- `npm run lint:docs` — lint maintained Markdown.
- `rg '^\| [A-Z]+-[0-9]+' docs/TASKS.md` — review registered task IDs.

## Disposable acceptance and previews

- `npm run test:temp-lifecycle` — verify success, failure, spawn error, timeout,
  cancellation, nested and parallel test-run cleanup with physical directory
  assertions.
- `npm run test:bridge` — run all Go Bridge tests with one owned temporary root
  and invocation-scoped Go build and module caches.
- `npm run test:bridge-ui` — test the embedded Bridge GUI's pairing state projection.
- `npm run test:qa-evidence` — test the sanitized two-machine acceptance evidence verifier.
- `npm run test:product-experience` — verify disposable local/trusted product acceptance fixtures with real sealed evidence.
- `CONVENE_WIRE_PRODUCT_PREVIEW=1 npm run preview:product-experience` — serve the built Web UI on two isolated loopback QA servers, with synthetic model responses and temporary data removed on shutdown; never use for deployment.
- `npm run test:compose` — verify the default/custom central HTTPS ports and validate the Caddy configuration.
- `npm run test:e2e` — run deterministic cross-process acceptance tests.

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

- `npm run capture:qa-002 -- --input /path/input.json --database /path/agent-room.sqlite --metrics /path/metrics.txt --bridge-installer /path/convenewire-bridge-desktop_VERSION_windows_amd64_setup.exe --bridge-desktop-archive /path/convenewire-bridge-desktop_VERSION_windows_amd64.zip --release-checksums /path/SHA256SUMS --output /path/evidence.md` — compute both Windows candidate digests, safely bind the packaged executable and authenticated Bridge/Central build observations to one reviewed two-machine record, and render no secrets or local paths.
- `go build -tags desktop ./cmd/convenewire-bridge-desktop` from `bridge/` — build the native Wails Bridge GUI for the current platform.
- `go test -tags desktop ./cmd/convenewire-bridge-desktop` from `bridge/` — verify desktop-only state mapping and compile its native shell.
- `go run -gcflags=github.com/srwiley/rasterx=-d=fmahash=qn . -root ../../.. -mode generate` from `bridge/tools/windows-resources/` — regenerate the checked-in Windows PNG, multi-size ICO and amd64 resource object from the product SVG using pinned non-fused arithmetic.
- `go test -gcflags=github.com/srwiley/rasterx=-d=fmahash=qn ./... && go vet ./... && go run -gcflags=github.com/srwiley/rasterx=-d=fmahash=qn . -root ../../.. -mode check` from `bridge/tools/windows-resources/` — verify the isolated icon tool and deterministic generated resources; format its Go source with `gofmt -w *.go`.
- `go run -gcflags=github.com/srwiley/rasterx=-d=fmahash=qn . -root ../../.. -mode verify -exe /absolute/path/to/ConveneWire-Bridge.exe` from `bridge/tools/windows-resources/` — inspect the actual Windows PE icon group and image resources rather than a generic Shell fallback.
- `RELEASE_TAG=v0.2.0-rc.3 GOOS=linux GOARCH=amd64 ./scripts/package-release.sh` from `bridge/` — build one portable Bridge archive.
- `RELEASE_TAG=v0.2.0-rc.3 GOARCH=arm64 ./scripts/package-desktop-darwin.sh` from `bridge/` — build one unsigned native macOS GUI archive.
- `pwsh -File ./scripts/package-desktop-windows.ps1 -ReleaseTag v0.2.0-rc.3 -GoArch amd64` from `bridge/` on native Windows with Inno Setup — build one unsigned Windows GUI archive and current-user installer.
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
