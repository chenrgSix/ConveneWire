# QA-092: A/B native desktop evidence

Milestone B implementation is complete. QA-092 remains **ACTIVE** in
[the task register](../TASKS.md): the native interaction gate is not fully closed.

## Verified local behavior

The final unsigned macOS arm64 package contains source
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

A terminated Hub produced the native
[Hub-stopped dialog](evidence/qa092/hub-stopped.png), stating that Runtime had
stopped. Same-identity native restart after that particular fault was not
accepted: the long-running manual fixture had reached its cleanup deadline.
The separate packaged supervisor tests and three-Host core crash/recovery tests
remain passing evidence for their respective non-GUI paths.

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
Space Web regressions passed. The final package was built after those fixes.
The browser extension repeatedly timed out even though installation and native
host diagnostics passed. Opening a blank test-profile window did not restore
communication. Browser DOM inspection is therefore not claimed.

## Remaining acceptance and test limitations

- Exercise the actual tray menu's open/configure/quit actions. The system-UI
  inspection tool timed out, so window activation is not counted as tray evidence.
- Repeat native Hub-fault recovery with a process-owned fixture that drains the
  GUI before cleanup, preserving the exact identity and completed records.
- Visually inspect the independent browser login page when browser control works.
  Native dispatch/no-credential evidence above does not replace that visual check.

The first bounded manual preview finished and cleaned successfully. A subsequent
45-minute preview timed out while browser/tool diagnostics continued; its cleanup
removed the disposable profile before the last recovery check. It is recorded as
a failed preview, not a product pass. The ad-hoc manual-preview code was withdrawn;
normal test wrappers retain their original lifecycle behavior.

During an exit-state inspection, the UI tool automatically relaunched the test
package without its explicit arguments and loaded the default Bridge profile.
That process was promptly closed. No installation or intentional default-profile
configuration operation was performed; this is not counted as approved legacy
fixture acceptance. Later inspections verified an explicitly started test process
before accessing its UI.

All deliberately started test applications and fixture Hosts are stopped. The
final package and nonsensitive evidence remain. Physical Windows, minimum-OS
hardware, real installation, external models, CI and publication are separate gates.
