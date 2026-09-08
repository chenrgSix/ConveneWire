# VER-002 bounded browser verification

Date: 2026-09-08. Authority:
[ADR-0060](../adr/0060-preauthorize-local-work-policies.md).
Delivery state lives in [TASKS](../TASKS.md).

The owner registers an immutable local verifier with an optional `browser`
configuration. Its digest pins the executable bytes, document root, viewport,
ordered typed steps, time and output limits. The Task selects only that profile
reference. It cannot supply a URL, command, browser flags or JavaScript program.
Old command-only verifier profiles preserve their existing digest and behavior.

This version serves a static directory from the exact captured candidate. Each
verifier gets its own candidate materialization; output from a separate build
verifier is not carried into a browser verifier. A project that requires a build
or backend must supply a suitable captured static candidate or use its existing
command verifier. Arbitrary development servers and live backend browser tests
are outside this version's supported browser scope.

Use a dedicated Chrome for Testing Headless Shell executable. Desktop Chrome and
Edge executables are rejected. The filename guard prevents accidental desktop
launch; the owner must still select a trusted executable, whose bytes are pinned.
The native Chromium sandbox remains enabled. The verifier owns a fresh process,
profile, HTTP origin and proxy, and never attaches to an existing user browser.
The proxy accepts only GET/HEAD to the allocated candidate origin; CSP excludes
remote API calls, frames, workers and forms. Hidden files, symlinks, traversal,
nonregular files and files over 16 MiB are denied. This browser-level network
restriction is not a claim of an operating-system firewall or hostile-browser
containment. Runtime workspace restrictions remain a separate authority.

Startup, page load, each interaction assertion, screenshot, visual review and
cleanup are recorded separately in the existing bounded `test_result` log.
The verification receipt binds that artifact's revision and SHA-256. Central
projects only validated, bounded PNG data and diagnostic fields; SVG, changed
image digests and claims of completed visual review are rejected. A screenshot
always retains `visualReview: not_performed` until a separate review takes place.
Browser failure does not turn a candidate commit into a tested delivery.

## Owner configuration example

Save and review a local JSON file, replacing the executable with an absolute
path to the owner's dedicated Headless Shell installation:

```json
{
  "profileId": "profile_frontend_browser01",
  "revision": 1,
  "command": ["/absolute/tools/chrome-headless-shell"],
  "environmentNames": [],
  "timeoutMilliseconds": 30000,
  "outputLimitBytes": 1048576,
  "browser": {
    "version": 1,
    "documentRoot": "public",
    "startPath": "/",
    "width": 1280,
    "height": 900,
    "steps": [
      {"action": "visible", "selector": "h1"},
      {"action": "fill", "selector": "#goal", "value": "Example"},
      {"action": "click", "selector": "#save"},
      {"action": "text", "selector": "#result", "value": "Example"}
    ],
    "screenshot": true
  }
}
```

Register using the existing `repository verifier register --file ... --confirm`
command in [development commands](../development-commands.md), then select the
registered verifier in the local client's standing work-policy form.

## Evidence and limitations

- Physical macOS Headless Shell 152.0.7977.82 passed page loading, Chinese input,
  click, content assertion and PNG capture against a disposable static candidate.
  A forbidden-origin fetch did not reach its listening test service. Process,
  browser profile and verification temporary roots were cleaned.
- Running the same dedicated browser inside the task sandbox failed with macOS
  `bootstrap_check_in` permission denial. The log retained startup failure and
  no page acceptance. This observed error is distinct from an unexplained SIGABRT.
- An initial desktop Edge probe triggered its own updater, including maintenance
  of the user's EdgeUpdater files. The test was stopped; no manual restoration
  or cleanup of those user files was attempted. The implementation was restricted
  to dedicated Headless Shell to avoid repeating this desktop-browser side effect.
- Browser scope, path, command and profile mutation negatives, real proxy/static
  file denial, crash, timeout and cancellation tests pass under Go race checking.
  Command runner/profile and existing verification coordinator replay tests pass;
  owning vet and Server/Web builds pass. PNG/hash/semantic projection negatives
  and receipt-bound Web display tests pass.
- Live model calls, installed-client upgrade, physical Windows/Linux and CI were
  not exercised. The connected product fixture is recorded under QA-089.

Protocol and distribution references:
[Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/),
[CDP Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/),
[CDP Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/),
[Chromium proxy behavior](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md).
