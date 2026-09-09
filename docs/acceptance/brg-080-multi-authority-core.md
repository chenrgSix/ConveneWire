# BRG-080: shared Multi-Authority Runtime core

The implementation follows [ADR-0067](../adr/0067-multi-authority-runtime-foundation.md).
[Task status](../TASKS.md) remains authoritative.

## Delivered behavior

One root lease and stable local Agent map serve explicitly configured Device
connectors. The primary keeps its original credential, Inbox payload/digest and
native Session configuration. Additional projections have immutable local-Agent
bindings and fresh private partitions; they inherit executable/workspace choices
and the owner's private-output floor, without copying trust or approval consent.

A shared fair scheduler serializes the same Agent and overlapping physical
Workspaces, including symlink and case aliases. Independent resources continue.
Every connector revalidates its Host proof after waiting and before Runtime start,
and on reconnect. Cancellation, Inbox, Session, result delivery and approval
callbacks remain scoped to the connector's authenticated identity and credential.
Changed duplicates disconnect the offending connector without invoking again.

Durable ordinary process tracking grants no execution permission. Before any
connector starts, the core fences all persisted ordinary and governed orphans,
including those belonging to offline or removed Authorities. An uncertain Run
keeps the released `outcome_unknown` behavior without automatic re-execution.
The legacy single-connection composition retains its released behavior.

## Evidence

`tests/e2e/multi-authority.test.ts` runs three actual Hosts and one compiled Go
Bridge, with an offline Pi process fixture and independently issued credentials.
The Hosts deliberately reuse Team, Owner Member, Device, Agent, Room, Task, Run
and trace IDs. It verifies:

- All colliding Runs finish once with their own reply and distinct native Sessions.
- Shared Agent and parent/child Workspaces serialize; an independent Agent runs
  concurrently. Cancelling B's waiter leaves A and C unaffected.
- Completed duplicate delivery does not invoke again; a changed payload forces
  only that connector to reconnect.
- The primary Host can be offline during a full core restart while another Host
  continues. A queued revoked Device never starts after the resource frees.
- An actual child process remains alive after Bridge SIGKILL. Restart fences that
  PID before another Authority executes; the interrupted Run becomes unknown and
  its original invocation count remains one.
- The original colliding Inbox files retain their own payloads and completion.
  Another Host's Device token cannot submit a Result or Runtime approval (401).

This scenario passed with zero skips and zero model calls. Go unit coverage adds
projection/identity rejection, fresh-partition consent boundaries, native Session
separation, scheduler fairness/cancellation, process exit/cleanup failure and
partition ownership. Authority/bridgecore/delivery/connection/ownership/runtime/
console race checks passed; final affected package race and full Bridge vet passed.
The packaged Local Node Run/Discussion/restart/stopped-restore scenario and both
legacy managed-Bridge Result scenarios passed. Server/Web production builds passed.

A full Go run reached its 240-second wrapper limit. A 90-second-per-package
diagnostic retry passed every package except the unchanged repository suite,
which reached its timeout while running Git preparation fixtures. Runtime and
Console also passed an isolated diagnostic run. The repository suite is being
checked separately with its longer total fixture allowance; neither timeout is
counted as a pass.

## Configuration and limits

The advanced configuration is `authority-connectors.json` in the existing private
Bridge data directory, validated against the generated `AuthorityConnectionsConfig`
schema. Its primary pin must match the saved pairing and all additional Device
credentials must already exist in explicitly named owner-private directories.
Local Agent IDs must already exist in `agent-identities.json`. A missing map or
attempted namespace/projection rebind fails closed. Configuration replacement
requires stopping/restarting the owning core; there is no remote provisioning UI.

This is Device transport foundation. Peer invitation, membership, Export and
Acceptance remain Milestone C. Multi-Authority permission prompts were not run
against real models; no new connector inherits Central approval consent. Native
A/B desktop interaction is QA-092. Physical Windows, real installation, CI and
publication are separate evidence gates.
