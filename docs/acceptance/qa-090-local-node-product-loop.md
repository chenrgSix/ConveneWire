# QA-090 — Local Node Product Loop

Date: 2026-09-09. Milestone A under
[ADR-0066](../adr/0066-local-node-delivery.md). The
[task register](../TASKS.md#node-first-milestone-a-local-node) owns delivery status.

## Production process evidence

[The retained scenario](../../scripts/local-node/supervisor.test.mjs) builds a
native Hub bundle and starts the actual Go Supervisor and Bridge with an empty
PATH. Console configures native deterministic Pi-protocol fixtures. Those
fixtures contain no model SDK, tools, external network calls or home-directory
reads. Existing production routing, delivery, execution and Discussion code
handle every request.

The scenario passes the following sequence:

1. Exchange the desktop entry for the fixed Owner, create a Team and Room,
   explicitly bind the local Runtime and configure the Solver through Console.
2. Complete an ordinary Run and publish exactly one reply. Add a Reviewer and
   wait for both Agents to be ready.
3. Start a two-Agent review Discussion. Its ordinary wave completes with two
   assessments, then stops at `awaiting_extension`. The Owner's explicit finish
   action creates exactly one completed Finalizer; state is `completed` with
   `user_requested_finish` and three Discussion Agent Runs.
4. Refuse a second host, live backup and an occupied saved port. Shutdown releases
   the listener. Restart preserves Node ID, Owner, origin, both Agent IDs, Run
   state and the same three Discussion turn Run IDs.
5. Take a stopped whole-root snapshot, park the original stopped root and restore
   only to its original absent location. The restored Hub retains the Discussion
   and execution records. A new ordinary request then completes successfully.

The fixture invocation journal contains four calls before restart and remains
unchanged after restart and restore. The new post-restore Run makes the fifth
call. Completed work is not replayed. The complete automated scenario passed in
20.8 seconds; subsequent disposable browser-preview runs also passed and cleaned
their exact process/data roots.

## Browser evidence

A new browser tab exchanges a fresh entry for Local Owner and displays the
persisted Team, both configured Agents and five completed Run attempts. Room
navigation shows the ordinary replies and completed Discussion. The local Console
shows two available Agents with local policy and no remote re-pairing controls.
The 390px viewport has no horizontal overflow; the local Runtime region remains
390px wide and exposes its Agent setup button. No page errors or warnings were
recorded in the final fresh workspace check.

Retained captures:

- [Local workspace and completed Discussion](assets/qa-090/local-workspace.png)
- [Local Agent Console](assets/qa-090/local-console.png)
- [390px local workspace](assets/qa-090/local-narrow.png)

Browser automation intermittently timed out on click/navigation commands. The
first bounded preview expired during inspection; a new bounded preview completed.
Fresh entry and page content were checked again. Expired two-minute entry URLs
are not reusable. These captures and DOM checks are browser evidence; native
Wails tray/window interaction and installed-app acceptance were not performed.

## Native artifact evidence

`npm run package:local-node -- /absolute/new-output` rebuilt the macOS arm64
package with Node 22.23.1, native SQLite, 6,132 inventoried Hub files and the
packaged lifecycle helper. Desktop compilation, native package verification and
Info.plist checks passed. Independently extracting the ZIP with `ditto`, checking
the entire Hub inventory and running its packaged helper with empty PATH passed
readiness, fixed-Owner exchange and graceful listener shutdown.

- Development artifact: `convenewire-bridge-desktop_0.0.0-local_darwin_arm64.zip`
- Source commit: `f91e874e37d04961208043ec3156493add5c0bbb`
- Manifest source state: `modified` (QA scenario changes were pending; this is a
  local development package, not an exact-tag release).
- Archive SHA-256: `a7043551d2100a031550c7580ab68b13f52cb14980710c573a9019039d56dda6`
- Native desktop minimum target: macOS 12; the bundled Node and SQLite Mach-O
  minimum targets are 11. Physical minimum-OS compatibility is not inferred.

[BRG-079](brg-079-local-node-supervisor.md) records Supervisor race/vet, native
Desktop tests, explicit Web binding, Server control security, Contracts and
legacy managed-Bridge regressions. [DATA-008](data-008-local-node-identity.md)
records identity, schema, origin, session and snapshot negative cases. Production
Server/Web builds, documentation lint, changed local links and whitespace checks
pass. One Go dependency download attempt failed with upstream EOF; its unchanged
retry passed before completion.

All acceptance state was disposable and made zero model calls. Windows native
packaging/storage for this new mode, physical installed-client behavior, CI,
release signing/publication and live-provider acceptance remain separate.
Peer/Multi-Authority remains outside Milestone A.
