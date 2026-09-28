# BRG-087: Windows native settings return

The Windows owner reported that **Return to local workspace** did nothing after
installing the local diagnostics build from `57603c9` on 2026-09-28.

## Cause and scope

The pinned Wails v3.0.0-beta.12 Windows implementation applies
`WebviewWindowOptions.JS` only to HTML windows. ConveneWire uses URL windows.
The settings button therefore had no navigation listener. Calling `ExecJS` after
navigation is insufficient for these pages because that API queues until the
full Wails Runtime reports ready; the Console does not load that Runtime.
The previous diagnostics patch did not change these navigation paths.

The Console now imports the existing navigation script as a same-origin module.
The desktop embeds that identical file for existing platform injection. A
per-document guard prevents duplicate click handlers and theme observers when
both paths run. The fixed event name, host-owned entry ticket, reference
validation, native opt-in and permissions are unchanged. No arbitrary return
URL, command or credential is introduced.

## Verification

- Seven focused embedded UI tests pass: Windows/macOS return clicks, fresh
  documents, duplicate injection, nested click targets, untrusted references,
  ordinary browser without a native port and existing settings presentation.
- A hidden isolated Windows WebView2 probe used synthetic URL pages and a fresh
  temporary browser profile, without installed state or a model. Baseline
  `options.JS` produced zero return events (exit 3). Loading the shared module
  produced exactly three returns across three documents (exit 0). The failed
  intermediate navigation-completed/ExecJS approach also produced zero events.
- Final desktop module tests and desktop/Console vet pass. All 99 embedded UI
  regressions pass.

The probe covers the real native message transport and page lifecycle, not an
owner's authenticated Hub session. Physical acceptance of the installed button
remains distinct from these automated checks. No real model invocation occurred.

## Main integration

Merged with upstream main at `5660a35`. The task was renumbered from BRG-086
to BRG-087 because upstream had assigned BRG-086 to Peer execution trust.
All 101 merged embedded UI tests, desktop module tests, changed-document lint
and whitespace checks pass. The installation was not changed by this merge.
