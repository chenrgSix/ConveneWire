# WEB-080: Unboxed Agent replies

Date: 2026-09-09. Dependency: [WEB-079](web-079-compact-conversation.md).

Completed and streaming Agent replies now use a dedicated response container
instead of the generic message card. Their avatar and name sit together above
the Markdown. Text starts at the conversation's left edge without the previous
avatar-column indentation, card padding or bottom border. Member and system
message cards, Markdown code blocks and execution details retain their existing
presentation. Completed reply copy remains available on hover or keyboard focus.

## Verification

The four focused Markdown and clipboard cases passed from the Web workspace,
including streaming accessibility, safe Markdown, exact clipboard text and
clipboard failure. An initial repository-root invocation selected the wrong JSX
configuration and failed with `React is not defined`; the documented workspace
invocation passed without a source workaround. Type checking and the production
Web build passed.

The in-app browser exercised the production Web build against a disposable
Central with synthetic messages. At 1280 pixels, both themes show transparent
Agent response backgrounds, zero borders/radii and no shadows. Agent identity
remains visible. Copy action opacity was zero away from the message, one after
moving over the reply, and clicking it displayed the success state.

A separate server-rendered fixture of the actual `RoomTimeline` component and
production CSS exercised completed and streaming replies inside a 390-pixel
iframe. In both themes its visible layout receipt confirms no page overflow,
transparent/zero-border/zero-radius/no-shadow responses, preserved member-card
borders and horizontal scrolling confined to the long code block. This fixture
checks responsive rendering; clipboard interaction was checked in the full app.

Inspected screenshots: [desktop light](assets/web-080/desktop-light.jpg),
[desktop dark](assets/web-080/desktop-dark.jpg),
[narrow light](assets/web-080/narrow-light.jpg) and
[narrow dark](assets/web-080/narrow-dark.jpg).
All fixture content is synthetic; no real model or owner permission was used.

## Installed local preview

Central was upgraded through the verified source-package controller to
`v0.5.7-local.c132242`, exact implementation source
`c13224291cd7c685d2934183fd6efcaf65ccfaae`, after a verified SQLite backup.
The original-CA HTTPS endpoint serves the new `message-response` markup/styles,
and `doctor` passed release checksums, Compose, browser/HTTPS readiness and
WebSocket ingress.

All business row counts, 36 client JSON files, eight Bridge application files,
installation identity, schema version and private CA were preserved. Three
Agents returned ready and Central approval remains revision 3. Bridge stays on
its already accepted `v0.5.6-local.ef61656` implementation. Fixture tabs were
closed and their disposable servers and temporary roots were cleaned. Private
upgrade receipts remain in the ignored local upgrade directory.

No CI or other platform acceptance is claimed.
