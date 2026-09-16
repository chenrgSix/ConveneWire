# QA-092: combined A/B/C manual and physical acceptance

Milestones A/B/C implementation and the [QA-091 automated gate](qa-091-node-first-v1.md)
are complete. QA-092 is now **ACTIVE** in [the task register](../TASKS.md), after
the deferred implementation boundary. This record preserves historical A/B
observations separately from current V1 interaction and remaining physical gates.

## Current acceptance baseline

On 2026-09-15 the owner authorized the latest macOS package and local acceptance.
The installed arm64 application now comes from clean source
`acab8a33de113b020eec4b0bbae90ded9140567c`, version `v0.0.0-local`, including
the Relay/Tunnel implementation. The retained archive is
`dist/local-node-qa092-relay-acab8a33/convenewire-bridge-desktop_0.0.0-local_darwin_arm64.zip`,
78,320,335 bytes, SHA-256
`f927336198b4b6146bfa045c10e97226ae3cc291ec37dba340561face7f2e487`.
[Package evidence](evidence/qa092/relay-local/installed-package.json) records
safe ZIP paths, all 7,296 Hub files, exact installed contents, native source/version,
and bundled Node 22.23.1/SQLite 3.53.4 with an empty PATH. The host is macOS
26.6.2; the declared 12.0 deployment target is not minimum-OS hardware acceptance.

The application replaced the single `/Applications/ConveneWire Bridge.app`
installation. A stopped Node snapshot and a verified ZIP of the previous installed
application were retained in the private owner backup directory. The old archive
was no longer present at its historical repository path, so the rollback ZIP was
created from the actual installed application before replacement. No additional
expanded app was retained. The package contains no Relay service profile:
convenient access remains disabled, and public deployment/validation is deferred.

## Current local workflow observations

The [installed supervisor suite](evidence/qa092/relay-local/installed-supervisor.json)
passed both tests in 18.60 seconds. A temporary copy of the existing
[suite](../../scripts/local-node/supervisor.test.mjs) substituted the installed Hub
and installed `convenewire-node` for freshly built outputs; its Runtime assertions
were unchanged. It covers actual offline Codex/Pi Run/Discussion, native Console
authority negatives, duplicate/port rejection, exact network review/save retry,
HTTPS activation, Owner/control isolation, and same-identity restart/restore.
Disabled Relay configuration and private certificate cache also survive restore
without starting ACME. No public Relay or external model was contacted.

The installed desktop then used an explicitly isolated Node/configuration/Workspace.
The [actual network dialog](evidence/qa092/relay-local/relay-unconfigured.jpg)
shows the missing-provider state; advanced manual HTTPS and return navigation work.
[Both native Agent probes](evidence/qa092/relay-local/agent-probes.jpg) passed in
the same application window. The temporary offline executable was extended to
answer the exact readiness instruction: its ordinary reply initially failed the
probe as expected, and no product validation was relaxed. The real native composer
submitted [one additional Run](evidence/qa092/relay-local/native-new-run.jpg),
bringing the fixture to five completed Runs and one completed Discussion.

Closing the window retained the same desktop and Hub PIDs and a healthy listener.
The tool's direct raise of the hidden window showed a transient `Load failed`
message; normal single-instance activation refreshed the entry and
[reopened the healthy workspace](evidence/qa092/relay-local/native-reopened.jpg).
An isolated Hub-child SIGKILL produced the expected
[native failure dialog](evidence/qa092/relay-local/hub-failure.jpg).
Normal application quit returned zero. Both subsequent
[restart](evidence/qa092/relay-local/after-restart.jpg) and
[stopped snapshot restore](evidence/qa092/relay-local/after-restore.jpg) reopened
the same records. [Before recovery](evidence/qa092/relay-local/native-before-close.json),
[after restart](evidence/qa092/relay-local/native-after-restart.json), and
[after restore](evidence/qa092/relay-local/native-after-restore.json) match exactly:
identity, configuration, Team/Room/Task/Run/Discussion rows and the invocation
journal. Three native quits returned zero; recovery started no additional Run.
[Lifecycle evidence](evidence/qa092/relay-local/native-lifecycle.json) distinguishes
these observations from actual tray interaction.

Ordinary launch returned to the [original light workspace](evidence/qa092/relay-local/owner-restored.jpg).
[Owner preservation](evidence/qa092/relay-local/owner-preservation.json) confirms
unchanged identity, both configurations, one Team, one Room, one Task and the
original completed Run. [Final cleanup](evidence/qa092/relay-local/final-cleanup.json)
confirms removal of the fixture and package staging; one installed application
registration, one desktop and its Hub remain for the owner.

On 2026-09-16 the owner confirmed that actual tray open-local-space,
configure-Agent and quit all work. The
[owner confirmation](evidence/qa092/relay-local/tray-owner-confirmation.json)
closes the remaining local macOS interaction check for the installed `acab8a33`
baseline. This is owner-reported physical evidence; the earlier SystemUIServer
automation timeout and the 2026-09-15 cleanup snapshot remain historical records.
The latest package and local macOS acceptance are complete.

QA-092 remains ACTIVE for the broader combined acceptance. Independent-owner
cross-Node, scoped Host Acceptance, Windows, minimum-OS hardware, public Relay,
external-model, CI and publication gates remain separate.

## Historical WEB-089 acceptance baseline

The previous installed macOS arm64 application was the WEB-089 build from clean
source `d8e2ed673a792cf9d25f4c64f80c43a23e7c9e5a`, version `v0.0.0-local`.
Its retained archive is
`dist/local-node-web089-d8e2ed67/convenewire-bridge-desktop_0.0.0-local_darwin_arm64.zip`,
SHA-256 `449cbeb7976e933a90051d4f29f3fc0733f43554ef59f8ebaa78ebd0cd08080a`.
[Installed package verification](evidence/qa092/current-local/installed-package.json)
covers safe ZIP paths, all 6,215 Hub files, native source/version, bundled
Node/SQLite with an empty PATH, exact installed contents and stopped owner backup.
WEB-087 unified the main window and startup; WEB-088 aligned the toolbar;
WEB-089 repairs task assignment. OPS-021 keeps package staging temporary.
The previous WEB-088 archive from `76278906` is retained as a verified rollback
archive, with a new stopped Node snapshot under the private owner backup folder.
Historical observations below are not relabeled as current-source evidence.

On 2026-09-11 the owner authorized completing baseline alignment and the local
workflow before returning for cross-Node and platform acceptance. This local
pass uses the installed bundle with a disposable Node/configuration/Workspace
and deterministic Codex/Pi executables. It covers native Agent setup, task/Run,
Discussion, close/reopen, tray quit and recovery, with no external model calls.
Baseline alignment is complete. The local workflow checks below passed; actual
tray interaction remains unverified, so the whole local physical checklist and
broader QA-092 gate are not marked complete.

## Historical WEB-089 local workflow

On 2026-09-12 the installed `d8e2ed67` bundle ran with disposable Node,
configuration and Workspace arguments. Its two native offline Codex/Pi Agents
and Team/Room were prepared through the installed Node host's local APIs, then
the host stopped before the GUI launched. Actual GUI operations created the
[task with explicit assignments](evidence/qa092/current-local/task-create-assignments.jpg),
received its [ordinary Run reply](evidence/qa092/current-local/assigned-task-reply.jpg),
and completed a [two-Agent Discussion](evidence/qa092/current-local/assigned-task-discussion.jpg).
The Discussion contains two contribution Runs and one conclusion Run, all
completed. The existing-Task editor then changed the reviewer's assignment to
contributor; Task revision advanced from 1 to 2 and no new Run was started.
This is offline transport/orchestration evidence, not model-quality acceptance.

The actual native close control retained the same desktop PID and a ready Hub.
[Window-close assertions](evidence/qa092/current-local/window-close.json) and
[reopened Team](evidence/qa092/current-local/native-reopen.jpg) record the sequence.
An isolated SIGKILL of the desktop's own Hub child produced the expected
[native failure dialog](evidence/qa092/current-local/native-hub-failure.jpg).
Application quit returned zero; restarting opened the same Team and records.
A second normal quit allowed the installed Node host to take a stopped snapshot
and restore it at the same data path. Reopening the desktop preserved identity,
configuration, Team, Room, both Tasks, four completed Runs and one completed
Discussion. The three snapshots
[before recovery](evidence/qa092/current-local/before-recovery.json),
[after restart](evidence/qa092/current-local/after-restart.json), and
[after restore](evidence/qa092/current-local/after-restore.json) are identical,
including the offline invocation journal: recovery did not replay work.
[Task definitions and assignments](evidence/qa092/current-local/definition-restore.json)
also match the stopped source snapshot.

After restoration, [both native self-tests](evidence/qa092/current-local/restored-agent-probes.jpg)
passed (Codex 19 ms, Pi 13 ms). The Agent editor opened and canceled three times
without a white page. A deliberately submitted [new request](evidence/qa092/current-local/post-recovery-reply.jpg)
completed as exactly one additional Run. The
[final capture](evidence/qa092/current-local/after-new-request.json) has five
completed Runs and only the two explicit self-tests plus that new Run added to
the journal. Final native application-menu quit returned zero.
[Lifecycle assertions](evidence/qa092/current-local/lifecycle.json) record three
zero-exit shutdowns, backup/restore and preservation of original owner files/Runs.

The owned fixture, its processes and control file were removed. Ordinary launch
restored the [original owner workspace](evidence/qa092/current-local/owner-workspace-restored.jpg):
Team `测试环境`, Room `测试房间`, original `本机codex` completed Run and light theme.
[Final cleanup verification](evidence/qa092/current-local/final-cleanup.json)
confirms one installed application registration, one desktop and one owned Hub,
no expanded app in the new package directory, and removal of the owned fixtures.
No external model calls, cross-Node grants, publication or Windows operations
were performed in this local pass.

The initial pass on `76278906` had configured both Agents through the actual
native editor and completed default-Task Run/Discussion
([initial capture](evidence/qa092/current-local/initial-native-workflow.json)).
It reproduced an ordinary-Task onboarding defect: creation omitted assignments
while the composer offered unassigned Agents. WEB-089 repairs it with explicit
creation/editing controls and local pre-submit validation; 28 focused checks,
including real App/Server execution, exact committed-response retry and conflict
preservation, pass. The final affected App/onboarding rerun passes all nine cases.
TypeScript, Hub/Web build, docs and changed-link checks also pass.
An initial editor white page on the older binary recovered through View/Reload;
it did not recur on two subsequent old-binary opens or three current-binary opens.
No cause or fix for that one observation is claimed. Earlier expired/preparation
fixtures were cleaned and do not count as exit or recovery passes.

The desktop automation surface exposes the main window and application menu but
not the system tray. SystemUIServer and ControlCenter inspection timed out;
Finder Desktop and the application bundle identifier did not expose the tray
menu either. Therefore actual tray open/configure/quit remains for the final
physical check. Application-menu quit and source-level callbacks do not replace
that check. Cross-Node owner consent and platform gates remain separately open.

## Historical V1 interaction

The clean `41cd563f` package identified by QA-091 was extracted into a new private
fixture and launched with explicit Node data, Bridge configuration and Workspace
arguments. It had a disposable Team, Room and no configured Runtime executable.
The [native local space](evidence/qa092/v1-native-space.jpg) showed the expected
Team and bound local Runtime. Its native configuration action opened the
[Agent window](evidence/qa092/v1-native-agents.jpg); closing that window retained
the same desktop process, healthy Hub and byte-identical identity. Native
application quit returned zero, stopped the Hub and retained that identity.
Owned processes were drained before removing the extracted app and private data.

The same binary could not initialize Wails/macOS windows inside the command
sandbox (SIGABRT during native initialization). The explicitly approved bounded
fixture succeeded outside that sandbox. An earlier noninteractive preview ended
on stdin EOF before UI inspection. Neither failed setup is counted as a pass.
SystemUIServer inspection still timed out; no tray action is inferred from the
working application menu or configuration button.

This inspection found that empty-Team/Room onboarding still routed the local
Agent card to legacy managed-Bridge pairing. WEB-086 corrects both entry surfaces
to open the local Owner Console without pairing or implicit Team binding. Six
focused checks, including real App/Local Node HTTP for both cards and the remote
Bridge onboarding regression, pass. A final stricter URL-retention assertion also
passes. The replacement package below contains this correction.

## Historical replacement artifact

The replacement clean-source package is built from
`9286835ad90dfa600601764f5ef0f4e0d1ae8ef8`:
`dist/local-node-qa092-9286835a/convenewire-bridge-desktop_0.0.0-local_darwin_arm64.zip`.
Its size is 75,961,239 bytes and SHA-256 is
`9271934572f6cda456a30f6452855fb442171b249fdbaab5f2cba0fa0cbd70ab`.
[Package verification](evidence/qa092/v1-native-package.json) proves safe ZIP paths,
all 6,215 extracted Hub files, exact clean source/version, native arm64 binaries
and bundled Node 22.23.1/SQLite execution with an empty PATH. The earlier QA-091
archive remains the source-specific automated-gate artifact. This replacement
was used for the observations below; subsequent commits do not relabel it.

The replacement ran in a fresh, explicitly configured disposable native fixture.
Its [corrected onboarding card](evidence/qa092/v1-native-onboarding-fixed.jpg)
opened the [actual native Console](evidence/qa092/v1-native-card-console.jpg).
The empty-Room card also opened that window. Health checks retained the owned
desktop process, Hub and byte-identical Node identity. No Agent was configured
and no provider was called. [Interaction evidence](evidence/qa092/v1-native-interaction.json)
records these observations separately from the earlier quit check. The bounded
preview ended and cleaned its owned processes/data before the final quit request;
the resulting unavailable-app response is not counted as a quit observation.

A subsequent fresh fixture completed the outstanding window lifecycle observation
using this same `9286835a` archive. Closing the actual native main-window control
left its verified process and Hub alive. Native activation reopened the original
Team. Application quit returned exit code zero, stopped the Hub and preserved the
exact identity bytes. [Lifecycle assertions](evidence/qa092/v1-native-lifecycle.json)
record the completed checks; owned processes were drained before the temporary
extraction and data were removed. This fixture had no configured Agent process.
These actions close the current-source window lifecycle gap and do not stand in
for the remaining system-tray menu observations.

## Historical authorized local installation

On 2026-09-10 the owner explicitly requested a local update and startup. The
verified `9286835a` replacement was installed in `/Applications/ConveneWire Bridge.app`,
replacing `v0.5.9-local.85e3156` with the `v0.0.0-local` Node-first development build.
The stopped old application was retained in the owner profile's timestamped
`app-backups` directory. The existing remote Bridge configuration is byte-identical.

[Installation assertions](evidence/qa092/v1-local-installation.json) record the
exact archive, source and installed manifest. Startup used explicit `--hub-bundle`
and `--node-data` arguments with a new persistent private Local Node root (0700).
The actual native window showed “ConveneWire · 本地空间” and first-Team onboarding;
`/api/health/ready` returned HTTP 200 with `status: ready`. The application is left
running for the owner. No Team, Agent or external model invocation was created.

The retained remote profile still selects Bridge mode on a later argument-free
launch; Local Node launch uses the explicit mode arguments. This observation
covers installation and initial startup on this macOS arm64 machine only. It
does not close the outstanding tray, independent-owner, Windows or minimum-OS
gates. Earlier disposable acceptance data remains separate from this real profile.

## Final acceptance procedure

The current macOS package and local interaction checks, including owner-confirmed
tray actions on 2026-09-16, are complete. For the remaining observations, use the
current acceptance baseline and explicit disposable profiles. Do not launch an
extracted app without its fixture arguments:
the UI inspector can relaunch a stopped application with default configuration.
Verify the owned process is alive before inspecting it. Preserve historical
evidence rather than silently attributing it to the new binary.

1. Inspect independent browser entry and complete the reviewed Host/Participant
   product interaction: invite, Room ceiling, local Export, exact Host Acceptance,
   local approval, remote Run, mixed Discussion and revocation. The existing
   `peer-host-browser-fixture.test.ts` prepares a disposable `Native Host` Team,
   `Invited Room` and the offered `远端代码审阅` Agent (`agent_browserfixture1`).
   Its `Uninvited Room` is outside the offer. The remaining Host click grants
   access only to `Invited Room`; it cannot execute a provider in that fixture.
2. Use separately consenting human owners and their chosen machines for physical
   cross-Node acceptance. Record exact Node/source/platform identities and scope;
   same-computer TLS fixtures do not replace this observation.
3. On an explicitly authorized Windows test machine, build the same source and
   run native install/upgrade/uninstall checks with stopped backups. Record native
   minimum-OS behavior separately. A local macOS archive is not Windows evidence.

The access-changing Host browser click `接纳此 Agent` was previously rejected by
automatic approval review because it creates Agent access to a Room and the
specific recipient/resource/scope had not been approved. It remains pending;
it has not been retried through another UI or API. The reviewable fixture above
makes the required decision concrete. The authorized local macOS installation
above does not grant independent-owner consent or Windows installation; live
models require a separately bounded budget.

## Historical A/B local behavior

The earlier unsigned A/B macOS arm64 package contains source
`896f72d08d8600bfae2d7bfffd4181ad0313525c`, native Node 22.23.1, SQLite, Server,
Web and CLI helpers. Packaging verifies the exact source and macOS target.
Its ZIP SHA-256 is
`61ac34d9d4b681bf4dbc0b8748e55565fbb992e776057edde716f18c204ea1df`.
There was no installation, publication or push.

The real Wails application, started with explicit temporary configuration and
Node data paths, restored the local Team, completed records and two offline Pi
Agents. The same native process served local and separately authenticated remote
Runs and a two-Agent Discussion with exactly one Owner-requested Finalizer.
[Recorded identifiers](evidence/qa092/native-core.json) contain fixture IDs only.
No external model calls were made by these scenarios.

The separate [Agent window](evidence/qa092/local-agents.png) showed both Agents
ready. Closing that window retained the Hub. Closing the main window followed
by native activation reopened it with a new one-use entry and the same Team,
records and running core. The [legacy Bridge entry](evidence/qa092/legacy-entry.png)
was separately checked using an empty explicit temporary profile and
`--bridge-only`, without pairing or starting a model.

A fresh process-owned fixture on 2026-09-10 completed one native Run and a
two-Agent Discussion with one Owner-requested Finalizer, then sent SIGKILL only
to the verified Hub child of that desktop process. The
[native fault dialog](evidence/qa092/native-recovery-fault.png) stated that
Runtime had stopped. After exiting through the native application menu, the
fixture waited for process exit and reopened the same package with the same
explicit configuration, Node data and Workspace arguments.

The [reopened native window](evidence/qa092/native-recovery-reopened.png) showed
the original Team. [Recovery assertions](evidence/qa092/native-recovery.json)
verified byte-identical identity, the original completed Run, Discussion and
turn Run IDs, two ready Agents and no repeated offline fixture calls. A
new native Run then completed, increasing the invocation count from four to
five. No external model calls were made. This closes the native Hub-fault
recovery gate left open by the earlier expired preview.
Exiting again through the native application menu returned exit code zero and
stopped the Hub. All owned process groups were drained before the temporary
profile and extracted application were removed. This application-menu action
does not stand in for the remaining tray-menu gate.

## Native Space navigation

The native popup path was replaced with a bounded reference event. Page input
contains only configured Authority/Team IDs; the desktop re-reads the private
reference directory and constructs the system-browser URL. No arbitrary URL,
command or credential is accepted from page input. The injected click script
uses WKWebView/WebView2 message ports without requiring the Wails HTTP runtime.

A small separate native fixture with no configured Agents used a local HTTP
receiver to observe an actual native click. The
[request evidence](evidence/qa092/native-opener.json) proves a browser request to
exactly `/?team=team_qa092opener01`, without Authorization, Cookie or Referer.
The [local window](evidence/qa092/native-opener.png) retained its original session.
This receiver fixture tests native dispatch only; the authenticated directory
chain is covered separately by the three actual Host/Go-core scenario in
[WEB-084](web-084-authority-spaces.md).

Native desktop/launcher Go tests and vet, both message-port script tests and
Space Web regressions passed. That A/B package was built after those fixes.
The browser extension repeatedly timed out even though installation and native
host diagnostics passed. Opening a blank test-profile window did not restore
communication. Browser DOM inspection is therefore not claimed.
The browser connection failed again on 2026-09-10; repeated environment recovery
was not counted as acceptance evidence.

## Historical fixture and tool limitations

At the A/B boundary, actual tray actions and independent browser login inspection
remained incomplete. WEB-085 later obtained Host and native Console browser
layout/focus evidence using the in-app browser; this does not retroactively close
the original native dispatch or independent-owner acceptance gates.

The first bounded manual preview finished and cleaned successfully. A subsequent
45-minute preview timed out while browser/tool diagnostics continued; its cleanup
removed the disposable profile before the last recovery check. It is recorded as
a failed preview, not a product pass. The ad-hoc manual-preview code was withdrawn;
normal test wrappers retain their original lifecycle behavior.

The new ad-hoc fixture needed setup corrections before the accepted recovery
run: use the canonical macOS temporary path required by the existing private
repository store, explicitly request the Console, and wait for asynchronous
native exit before restarting. These failed fixture attempts are not product
passes. Each attempt stopped its owned process groups before removing its
temporary data; no product behavior or security guard was changed.

During an exit-state inspection, the UI tool automatically relaunched the test
package without its explicit arguments and loaded the default Bridge profile.
That process was promptly closed. No installation or intentional default-profile
configuration operation was performed; this is not counted as approved legacy
fixture acceptance. Later inspections verified an explicitly started test process
before accessing its UI.

All deliberately started test applications and fixture Hosts are stopped. The
named local packages and nonsensitive evidence remain. Physical Windows, minimum-OS
hardware, other real installations, external models, CI and publication are separate gates.
