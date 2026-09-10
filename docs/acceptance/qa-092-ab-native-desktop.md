# QA-092: combined A/B/C manual and physical acceptance

Milestones A/B/C implementation and the [QA-091 automated gate](qa-091-node-first-v1.md)
are complete. QA-092 is now **ACTIVE** in [the task register](../TASKS.md), after
the deferred implementation boundary. This record preserves historical A/B
observations separately from current V1 interaction and remaining physical gates.

## Current V1 interaction

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

## Current final artifact

The replacement clean-source package is built from
`9286835ad90dfa600601764f5ef0f4e0d1ae8ef8`:
`dist/local-node-qa092-9286835a/convenewire-bridge-desktop_0.0.0-local_darwin_arm64.zip`.
Its size is 75,961,239 bytes and SHA-256 is
`9271934572f6cda456a30f6452855fb442171b249fdbaab5f2cba0fa0cbd70ab`.
[Package verification](evidence/qa092/v1-native-package.json) proves safe ZIP paths,
all 6,215 extracted Hub files, exact clean source/version, native arm64 binaries
and bundled Node 22.23.1/SQLite execution with an empty PATH. The earlier QA-091
archive remains the source-specific automated-gate artifact; use this replacement
for further manual acceptance. Subsequent evidence-only commits do not relabel it.

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

## Final acceptance procedure

Use the exact replacement artifact and explicit disposable profiles for remaining
local observations. Do not launch an extracted app without its fixture arguments:
the UI inspector can relaunch a stopped application with default configuration.
Verify the owned process is alive before inspecting it. Preserve historical
evidence rather than silently attributing it to the new binary.

1. Check the actual tray's open-local-space, configure-Agent and quit actions;
   verify closing a window keeps the Hub, while quit drains the Runtime and Hub.
2. Inspect independent browser entry and complete the reviewed Host/Participant
   product interaction: invite, Room ceiling, local Export, exact Host Acceptance,
   local approval, remote Run, mixed Discussion and revocation. The existing
   `peer-host-browser-fixture.test.ts` prepares a disposable `Native Host` Team,
   `Invited Room` and the offered `远端代码审阅` Agent (`agent_browserfixture1`).
   Its `Uninvited Room` is outside the offer. The remaining Host click grants
   access only to `Invited Room`; it cannot execute a provider in that fixture.
3. Use separately consenting human owners and their chosen machines for physical
   cross-Node acceptance. Record exact Node/source/platform identities and scope;
   same-computer TLS fixtures do not replace this observation.
4. On an explicitly authorized Windows test machine, build the same source and
   run native install/upgrade/uninstall checks with stopped backups. Record native
   minimum-OS behavior separately. A local macOS archive is not Windows evidence.

The access-changing Host browser click `接纳此 Agent` was previously rejected by
automatic approval review because it creates Agent access to a Room and the
specific recipient/resource/scope had not been approved. It remains pending;
it has not been retried through another UI or API. The reviewable fixture above
makes the required decision concrete. Actual installation and independent-owner
consent retain their own gates; live models require a separately bounded budget.

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
hardware, real installation, external models, CI and publication are separate gates.
