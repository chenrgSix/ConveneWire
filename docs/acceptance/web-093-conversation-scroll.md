# WEB-093: Open conversations at the latest message

The owner reported that selecting an existing conversation opened its message
list at the oldest loaded message. `RoomTimeline` previously preserved older
history anchors but had no initial positioning or bottom-following behavior.

Each Room/Task timeline now opens at the latest message. Its existing scoped
React key resets the scrolling state when the selected conversation changes.
Delayed messages, streamed content and resized message/dock content follow the
bottom while the reader remains within 48 pixels of it. Scrolling back into
history stops following. Explicitly loading older history retains the existing
message anchor, including scrolling during the request and failure recovery.
Resize observers are disconnected on replacement/unmount. Only the timeline
scrolls; the surrounding page and composer are not moved.

## Automated checks

Seven new geometry-based regressions cover initial entry, delayed data,
conversation switching, live-message following, late layout changes,
older-history anchoring and failed history loading. The focused timeline,
clipboard, Work-link and navigation-controller group passes all 28 checks.
Another 32 App-level navigation, history-race and Discussion dock regressions
pass, including actual Task switching and delayed responses. Production
TypeScript and Web build, documentation lint, local links and whitespace pass.

## Browser layout verification

The actual production `RoomTimeline` and styles were rendered in a temporary
synthetic React fixture in the Codex in-app browser. Both 40-message
conversations open at the bottom with a measured gap below one pixel. Switching
conversation and appending new messages retain that placement. Doubling text
size also retains the bottom after native ResizeObserver delivery.

After scrolling up 800 pixels, a new message leaves scrollTop unchanged at
8,291.5 pixels. Loading five older messages keeps the previous first-message
anchor within 0.032 pixels of its original screen position. Body scroll stays
zero. The [browser receipt](evidence/web093/browser.json) records the measured
cases; [latest-message view](assets/web-093/latest-message.png) and
[history-anchor view](assets/web-093/history-anchor.png) contain only synthetic
messages.

The temporary preview source, browser tab, server and wrapper-owned state were
removed after the check. No owner profile, conversation or external model was
used. This is a browser component/layout check, not installed desktop or
physical Windows acceptance. No application package was installed or released.
