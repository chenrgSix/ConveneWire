# BRG-079 — Local Node Supervisor

Date: 2026-09-09. Scope: local Milestone A under
[ADR-0066](../adr/0066-local-node-delivery.md).

The native desktop verifies the exhaustive Hub inventory, starts the bundled
Node with an empty PATH and authenticates readiness through the private child
pipe. It holds the Node-root lease until the Console/Bridge and Hub have stopped.
Port collision, wrong proof, unexpected exit and mismatched local identity fail
closed. Relaunch reuses the original root, Owner, origin and execution records.

Fresh packaged profiles open the local Web workspace. Existing remote profiles
retain Bridge mode; `--bridge-only` remains explicit. The Owner selects one Team
in Web, then opens the existing local Console to configure Agents. This creates
one ordinary paired Bridge core with no automatically enabled Agent or execution
trust. Local Console cannot retarget the connection, re-pair or replace its
profile. Web navigation does not rebind the Runtime. Login-startup arguments
retain the exact local bundle/root; enabling login startup is still opt-in.

Verification on macOS arm64, Node 22.23.1 and Go 1.26.7:

- Go Supervisor/data/config tests with race detection cover child proof, timeout,
  cancellation, exit, lease ownership, malformed bundles and stable profiles.
  Console regression/race tests and focused Go vet pass.
- The native desktop package builds and desktop-tag tests pass. Native package
  scripts retain their existing output-path regression coverage (three tests).
  The local development ZIP carries Node, native SQLite, Web/Server and the
  headless lifecycle helper; source state is recorded honestly as modified.
- `npm run test:local-node` launches the actual bundled Server and Go Bridge with
  an empty PATH, explicitly binds a Team, adds an offline Pi fixture through
  Console, completes an ordinary Run and reopens the same persisted installation
  without replay. It also rejects duplicate hosts and saved-port collisions.
- Web entry, explicit binding and scoped Client Access regression assertions
  pass. Bridge Console UI tests (63), Contracts tests (120 plus shared Go
  fixtures, generated output and type checks), bundle negatives and production
  Server/Web builds pass. The two legacy managed-Bridge scenarios still complete.

The fixture is a native deterministic protocol program with no provider SDK,
model calls, home-directory reads or external network requests. It exercises the
production Bridge and Hub processes. This is not installed-client, Windows
native, physical minimum-OS, live-provider, CI or publication evidence.
Discussion and final product recovery are owned by QA-090 in the
[task register](../TASKS.md#node-first-milestone-a-local-node).
