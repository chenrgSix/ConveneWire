# WEB-082: Header Settings entry

Date: 2026-09-09. Dependencies WEB-081 and TASK-015 are DONE.

The sidebar Collaboration/Management switch is removed. The header avatar is
replaced by an accessible Settings gear, opening the former management area:
Agents with a selected Team, Account and security without one. Clicking the gear
inside Settings retains its current destination. The header back arrow returns
to the remembered work location even while the sidebar is collapsed, preserving
the same-session, same-Team Task, tab, filters and unsent draft. Existing settings
links, permissions, account recovery and Team-change boundaries remain intact.

## Verification

Production Web build and type checking passed. Forty focused tests passed:

```sh
node scripts/test/run-with-temp-root.mjs --cwd apps/web -- ../../node_modules/.bin/tsx --test --test-concurrency=2 test/workspace-navigation-app.test.tsx test/continuous-work-app.test.tsx test/onboarding.test.tsx test/trusted-auth.test.tsx test/owner-recovery-settings.test.tsx test/room-folders.test.tsx test/work-attention.test.tsx
npm run build --workspace @convene-wire/web
```

Full Web coverage ran after updating old entry selectors: 326 of 335 tests passed.
The remaining nine failures were independently reproduced against a disposable
archive of the unchanged baseline commit `ae5bd5b`: six history/synchronization
cases in `context-races.test.tsx`, one message-status case in
`discussion-wave-status.test.tsx`, and two initial-snapshot cases in
`room-snapshot-selection-race.test.tsx`. The baseline run passed 11 of those 20
cases and failed the same nine. This change does not claim a green full suite.
The build retains its existing large-chunk advisory.

Follow-up [WEB-083](web-083-task-history-regressions.md) repaired the outdated
Task-history and listener fixtures; all nine scenarios and the final full Web
suite now pass (335/335 plus TypeScript). The failure counts above preserve the
evidence at the time of WEB-082 installation.

The in-app browser used the production build on a disposable Central with
synthetic data. It verified the removed area switch, gear-to-Agents navigation,
Account and security navigation, repeated gear click retaining that page, and
back navigation with a collapsed sidebar restoring the exact Room/Task URL and
unsent draft without sending. Desktop light/dark and actual 390 by 844 viewport
rendering were inspected. At the narrow width, header controls were inside the
viewport with zero horizontal page overflow, and Settings/back worked with both
expanded and collapsed navigation. No model calls were made.

The narrow screenshot embeds that same authenticated App in a 390 by 844
same-origin frame. The temporary frame and QA servers were removed after
acceptance, and the browser viewport override was reset.

Screenshots: [conversation](assets/web-082/conversation-light.jpg),
[settings light](assets/web-082/settings-light.jpg),
[settings dark](assets/web-082/settings-dark.jpg),
[narrow settings](assets/web-082/settings-narrow.jpg).

## Local installation

Central was upgraded after a verified SQLite backup to
`v0.5.10-local.d28f2ed`, exact source
`d28f2ed850fb8afd1919996e3c497f9f5f6da5d3`. Package verification passed.
The original-CA HTTPS endpoint serves the new gear/back controls and no longer
includes the old area switch or avatar. Doctor passed the release, Compose,
HTTPS and WebSocket checks.

Installation identity, schema 92, private CA and measured business row counts
were preserved, as were 36 client JSON files and eight Bridge application files.
Three Agents are ready and Central approval remains revision 3. Bridge remains
on `v0.5.9-local.85e3156`. Private local upgrade receipts include the before/after
hashes, business counts, matching baseline failures and served-asset checks.
No external release, CI or new live-model acceptance is claimed.
