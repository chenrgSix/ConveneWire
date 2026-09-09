# WEB-081: Room folder navigation

Date: 2026-09-09. Dependencies: WEB-079 and WEB-080 are DONE.

The previous Room list and heading added `#` in Web presentation. Room creation
stores the trimmed name without adding that prefix. Rooms now use open/closed
folder icons and indented Task buttons. Disclosure only expands or collapses;
Task selection uses the existing Room/Task navigation, including browser history
and task-scoped drafts. This is a navigation hierarchy over existing Rooms and
Tasks, with no filesystem folder creation or domain migration.

The active Room reuses its live task snapshot, including newly created Tasks.
Other Rooms load only when expanded. Failed reads offer retry; cancellation,
Team changes and Web session changes discard late responses. Foreign-Room task
rows are excluded. Five tasks are initially visible, including an out-of-window
selection, with a control to reveal the rest. Selected tasks use a subdued fill
without the former purple side stripe. Long names truncate and retain a title.

## Verification

The focused command passed 27 tests, including nested cases:

```sh
node scripts/test/run-with-temp-root.mjs --cwd apps/web -- ../../node_modules/.bin/tsx --test --test-concurrency=2 test/room-folders.test.tsx test/workspace-navigation-app.test.tsx test/onboarding.test.tsx test/work-attention.test.tsx test/room-settings-dialog.test.tsx
npm run build --workspace @convene-wire/web
```

Coverage includes disclosure without navigation, task list expansion, new-task
selection, lazy loading/retry, wrong-Room exclusion and late reads after collapse,
Team or session changes. The actual App/Fastify/SQLite navigation test also crosses
Rooms to a non-default Task, restores an unsent draft with browser history and
retains the selection on remount, without issuing Agent commands. Existing
onboarding, room settings, attention and navigation regressions passed.
Type checking and the production Web build passed; the existing large-chunk
advisory remains.

The in-app browser used a disposable Central and the production Web build with
synthetic data. Creating a Room named 项目优化 displayed that exact name without
`#`. Creating two Tasks added and selected them under that folder immediately.
Folder collapse preserved the URL, and a Task under the other Room returned to
its conversation. A 114-task folder initially displayed five rows and a reveal
control. Desktop light and dark themes were inspected at 1280 pixels.

A same-origin QA wrapper embedded the same running, authenticated product at
390 by 844 pixels. In both themes the visible DOM layout receipt showed zero
page/sidebar horizontal overflow, visible folder navigation and all row bounds
inside the viewport. The sidebar height was 422 pixels, preserving space for
the conversation and composer while its contents scroll. This was actual App
rendering, rather than a separate sidebar mockup.

Screenshots: [desktop light](assets/web-081/desktop-light.jpg),
[desktop dark](assets/web-081/desktop-dark.jpg),
[narrow light](assets/web-081/narrow-light.jpg),
[narrow dark](assets/web-081/narrow-dark.jpg).

## Installed local preview

Pending verified source packaging and local Central update. No real model calls,
CI, external release or other physical-platform acceptance is claimed.
