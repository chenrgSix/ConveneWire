# WEB-079 compact conversation acceptance

Date: 2026-09-09. Delivery state is recorded only in [TASKS](../TASKS.md).

The existing conversation remains the entry point. Its composer now contains
one Task row, an input that grows from 42 to 160 pixels and concise retention /
draft status. Static discussion mode, all-Agent and handoff-depth badges are
removed; their controls remain in Room settings. Contextual recipient previews,
ambiguity/disabled-routing errors and multi-Agent options remain available.
Detailed retention and 24-hour recovery explanations are available on hover.

The workspace header toggles the sidebar without changing Team, Room, Task or
URL. Its state persists in browser-local storage; the toggle remains keyboard
accessible and hidden navigation leaves the accessibility tree. Clipboard actions
appear under completed Agent replies on hover or keyboard focus. Touch devices
show them directly. Copy preserves the exact Markdown source and reports success
or a readable failure without changing the message. Streamed partial output,
human and system messages do not receive this action.

## Verification

The full Web suite ran 326 cases: 325 passed and one onboarding test still
expected the removed static policy labels. Its assertions now check their absence
while preserving the existing settings payload, disabled-all and parallel-routing
checks. The repaired onboarding case passed. After the final placeholder change,
all 26 affected cases passed, including real App/Server draft recovery, Enter /
Shift+Enter / IME behavior, exact clipboard content and failure, and sidebar
collapse/remount without navigation commands. Production Web build and type
checking passed. After binding auto-sizing to the current view, all 19 affected
App/Server navigation and recovery cases passed again; the browser also verified
that a 160-pixel draft returns at the same height after visiting management.

An isolated temporary Central with synthetic data was exercised in the in-app
browser. No real user repository, device permission or model call was used.
The browser verified the sidebar toggle and reload persistence, textarea growth
to 160 pixels with inner scrolling, reset to 42 pixels and no horizontal page
overflow at 1280, 900 and 390 pixels. The empty dock measures 136 pixels on desktop
and 134 pixels at 390 pixels. Clipboard content exactly matched the selected
Agent reply. Default action opacity was 0 and became 1 on hover.

See the [desktop default](assets/web-079/desktop-hidden.png),
[hover action](assets/web-079/desktop-hover.png),
[tablet navigation](assets/web-079/tablet-expanded.png),
[mobile navigation](assets/web-079/mobile-expanded.png),
[mobile conversation](assets/web-079/mobile-collapsed.png) and
[multiline input](assets/web-079/mobile-multiline.png).
The responsive layout measurements are retained in
[browser evidence](assets/web-079/summary.json).
Screenshots were inspected for spacing, input visibility and navigation access.

## Installed preview

The authorized local Central/Web preview is installed as `v0.5.4-local.cf067d5`,
source `cf067d599aa9406d2cca97230f6f079288da9c32`. Release checksum validation,
verified database backup, controller upgrade and doctor passed. Original-CA
HTTPS serves the new composer, sidebar toggle and copy assets.

The existing Bridge binary and all 30 client JSON files remain byte-identical.
The three original Agents reconnected ready. Business counts, installation
identity, original CA and schema 91 are unchanged. Private recovery records and
the active release directory are retained under the ignored
`var/local-upgrades/v0.5.4-local.cf067d5-20260909` directory. Refreshing an existing
browser tab loads the new assets; personal browser state was not modified.
This run does not claim live model, CI or cross-platform native acceptance.

Reproduce with the existing [product experience preview](../development-commands.md)
and the Web test/build commands, using only disposable seeded data.
