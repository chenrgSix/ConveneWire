# TASK-015: Task conversation and Runtime context isolation

Date: 2026-09-09. Dependencies TASK-006, TASK-013 and WEB-081 are DONE.
Decision: [ADR-0064](../adr/0064-isolate-task-conversations.md).

Task is now the default conversation boundary, including the default Task.
Room remains the membership/storage authority and folder. Web uses Task-filtered
history and cursors, retires old reads on switches, and scopes pending messages,
streaming output and Task memory-candidate cards. The new-task empty view states
that the conversation is independent instead of repeating first-use onboarding.

Runtime input contains Task-owned messages/projections/evidence, explicitly
published Room Memory, and requested accepted Results. Automatic Room excerpts
and rolling checkpoints are excluded. A current request or Task goal referencing
`TASK-N`, or a Result-to-child source edge, selects at most five same-Room accepted
Results with Task number, Result ID/version and source link. Unrequested,
unaccepted, foreign-Room and future-reviewed Results stay out. Existing Memory
publication/review APIs remain the shared project-knowledge authority; regular
messages do not become project knowledge automatically.

Bridge capability negotiation adds a versioned policy to native session keys.
Old mixed-context sessions and Artifact-consumption cursors cannot reappear in
the new policy. Clean sessions receive bounded bootstrap evidence and then resume
within their Task. Older clients use `start_new` until upgraded. Historical
frozen deliveries still validate their original receipts after reconnect/replay;
new planning does not create those old Room bundles.

## Verification

Focused Server regressions cover sparse Task history across 140 other-task
messages, cursor misuse, restart, Task projections, explicit public knowledge,
accepted Result references/child sources, old/new policy bootstrap, receipt
paging/retry and clarification continuation. Legacy delivery replay and forged
checkpoint/interval/coverage receipts pass through real WebSocket handling.

Web verification covers 32 cases across room synchronization, actual
App/Fastify/SQLite navigation and onboarding. It includes delayed responses after
same-Room Task switches, reload, cross-Room navigation/drafts and Task-only live
output reads. Server and production Web builds pass.

The contract package passes 119 Node checks, 277 shared golden fixtures,
deterministic generation/type checks and Go validation. Runtime and connection
Go tests, vet and race checks pass, including a stub Codex process proving the
first isolated request starts fresh and the next resumes. Two deterministic
cross-process scenarios pair a real Go Bridge with Central; the echoed Runtime
prompt includes explicit public knowledge and excludes the foreign-task marker.
These fixtures make no external model calls.

The full Server suite also exposed stale migration expectations ending at 91
although the existing approval schema is 92. The migration fixtures now include
the existing table and two indexes; no migration or live data schema was changed.
The final full Server run passes all 690 tests.

Useful commands:

```sh
npm run test --workspace @convene-wire/server
npm run test --workspace @convene-wire/contracts
node scripts/test/run-with-temp-root.mjs --cwd apps/web -- ../../node_modules/.bin/tsx --test --test-concurrency=2 test/room-synchronization.test.tsx test/workspace-navigation-app.test.tsx test/onboarding.test.tsx
node scripts/test/run-with-temp-root.mjs --cwd bridge -- go test -race ./internal/runtime ./internal/connection
node scripts/test/run-with-temp-root.mjs -- node_modules/.bin/tsx --test tests/e2e/managed-bridge.test.ts
```

## Browser evidence

The in-app browser used the production Web build against a disposable Central
with synthetic data. New Tasks A and B each started empty; after sending a
separate message to each, switching A/B and reloading B displayed only its own
message. The default Task retained its earlier history. A third new Task showed
the concise independent-conversation empty view. Light and dark views were
inspected at 1280 by 720. The temporary server and browser tab were then closed.

Screenshots: [Task A, dark](assets/task-015/task-a-dark.jpg),
[Task B, light](assets/task-015/task-b-light.jpg),
[new Task](assets/task-015/task-empty.jpg).

## Installed local verification

Central and the native macOS Bridge were updated to `v0.5.9-local.85e3156`, exact
source `85e3156918df7d4bd7d27cef419dc902d3359b74`. The Central source package passed
checksum verification; the controller made a verified SQLite backup before the
update. Both installed Bridge executables report the new version and all eight
application files match the packaged source build.

The original-CA HTTPS endpoint serves `/assets/index-ZF-K54Xa.js` and
`/assets/index-BC7mSYxP.css`. `doctor` passes checksums, private files, Compose,
browser readiness, HTTPS and WebSocket ingress. Central authenticated the new
Bridge source commit; all three Agents are ready and advertise Task context
isolation. All measured business row counts, 36 client JSON files, installation
identity, CA and schema 92 remain unchanged. Central approval revision 3 is
preserved. No production Room messages or model calls were used for this check.

Private before/after receipts and rollback packages remain under
`var/local-upgrades/v0.5.9-local.85e3156-20260909/`; no private configuration or
credentials are included in this document.

This is conversation-context isolation, not filesystem isolation or a change to
Room membership rights. Multiple Tasks using the same checkout still see its
files, and authorized explicit Room/MCP reads remain available. No live-model
or CI/production acceptance is claimed by these local checks.
