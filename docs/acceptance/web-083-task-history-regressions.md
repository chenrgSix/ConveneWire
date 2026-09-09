# WEB-083: Task history and snapshot regression repair

Date: 2026-09-09. Dependencies TASK-015 and WEB-082 are DONE.

WEB-082 recorded nine full-Web failures reproduced on the unchanged `ae5bd5b`
baseline. TASK-015 had changed conversation ownership to the selected Task, but
these older fixtures still assumed Room-wide history and a single Room lifetime.
This repair changes test fixtures and assertions, without changing product code,
Server contracts, user data or the installed Central and Bridge.

## Repair

- Six history/synchronization cases now provide a real default Task and its
  auxiliary reads. Their controlled delays/failures begin with selected-Task
  history, after the separate metadata bootstrap. Every history request must
  name the correct Task, and bootstrap listeners must already be canceled.
- The message-status fixture matches the Task-filtered history request and gives
  its message and Run the correct Task ID, allowing the Run/Mention presentation
  assertions to execute again.
- The two Task-creation races check canceled bootstrap requests, exactly one
  active listener, no listener restarted by old output, Task-filtered replies and
  the submitted Task ID. Selected Task, unsent draft, Room members and delivered
  message assertions remain in place.

The late-initial-history scenario now sends within the selected Task. It no
longer invents a new Task that inherits an existing Room transcript. A delayed
initial page overlaps a committed send and two backward pages; all 201 messages
must survive its late completion, the next live update must bring the count to
202, and neither the forward cursor nor the exhausted backward cursor can rewind.
Separate Task-creation scenarios continue to cover selection and draft races.
The 600-message bounded-pagination case and late responses after Room switches
also retain their original end-user assertions.

## Verification

The focused command passed all 20 cases before adding the final explicit request
scope and listener cancellation assertions:

```sh
node scripts/test/run-with-temp-root.mjs --cwd apps/web -- ../../node_modules/.bin/tsx --test --test-concurrency=2 test/context-races.test.tsx test/discussion-wave-status.test.tsx test/room-snapshot-selection-race.test.tsx
```

Final verification ran `npm run test --workspace @convene-wire/web` with the
additional assertions: all 335 tests passed, zero failed or skipped, and the
following TypeScript check passed. All nine previously failing scenarios now
execute their functional assertions successfully. Documentation lint, changed
local links and whitespace checks also passed.

This is local synthetic regression coverage, not new browser, live-model, CI or
physical-client acceptance. No runtime package update is needed for test-only
changes.
