# BRG-090: Preserve the background desktop page

The owner reported that reopening the background application returned a selected
conversation to the workbench. The Local Node activation callback and tray click
previously called `openHub`, issued another entry ticket and navigated the native
window to the root document.

Ordinary Dock/single-instance activation and tray clicks now reveal the existing
window. The current Room/Task URL, browser session, draft and scroll position stay
in that document. The tray's workspace action also only reveals an existing
workspace. An explicit return from native Agent settings still obtains a fresh
local entry; native credentials are not forwarded to the Hub.

The navigation controller tracks only the active surface and a generation. A
wake, settings change or newer return fences delayed entry callbacks. No owner
URL, token or conversation content is persisted by the controller. This covers
a running application hidden in the background; process exit/restart and return
from a native settings document are separate navigation boundaries.

Five new navigation test groups cover repeated workspace opening, fresh return
from settings, interrupted return, out-of-order entries and concurrent wake.
The full desktop package passes `go test -race -tags desktop` (25.710 seconds)
and desktop `go vet` on macOS. The temporary-root wrapper removes the disposable
test state. The host SDK emits linker deployment-target warnings; these checks
do not establish compatibility on older macOS versions or native Windows.

No installed owner application was replaced, release published, model called or
owner conversation modified in this increment. Packaged native Dock/tray
acceptance remains a subsequent installation check.

The subsequent [QA-099 local installation](qa-099-local-navigation-build.md)
passes an installed macOS window-close/reopen smoke check on an existing owner
conversation. Owner manual acceptance and other activation paths remain separate.
