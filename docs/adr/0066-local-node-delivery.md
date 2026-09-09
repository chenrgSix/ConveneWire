# ADR-0066: Local Node Delivery

- Status: Accepted
- Date: 2026-09-09
- Tasks: OPS-018, DATA-008, BRG-079, QA-090
- Extends: ADR-0065, ADR-0011, ADR-0017
- Supersedes: none

## Context

The Owner authorized Milestone A after the Node-first architecture review.
The deliverable is a desktop-managed Local Hub and the existing single-Team
Bridge, using the existing Run and Discussion implementations. Users do not
install Node, npm or Docker, or deploy a separate Central, to use this mode.

## Decision

Operations produces a native, versioned Hub directory containing Node 22,
production dependencies including native SQLite, compiled Server and Web,
migrations, Contracts and license notices. An exhaustive digest manifest binds
the platform and files. The desktop verifies the bundle before execution;
packaging on one platform does not establish evidence for another platform.

One installation has a private Local Node data root, a stable Node identity and
one stable local Owner. Browser storage and the loopback port do not determine
identity. The Hub uses a stable loopback-only origin. An occupied saved port
fails startup; the desktop never treats an unrelated listener as its Hub.
The supervisor owns the data-root lease, readiness, graceful shutdown and child
cleanup. Startup failure remains visible and preserves diagnostic data without
logging credentials. Relaunch does not silently create another identity.

Desktop launch authority reaches the Hub over a private child channel. A narrow
local entry exchange authenticates the fixed installation Owner. Local Node
disables arbitrary-user legacy bootstrap, rejects foreign Host/Origin values,
and does not put a long-lived Owner credential in a URL. Legacy Central local
development and trusted-team authentication keep their existing semantics.

The Owner explicitly chooses the Team for the local Bridge. Milestone A binds
one local Team and reuses the existing Device credential, Console Agent setup,
Runtime core, execution gate and delivery recovery. It cannot infer a Team from
list order, clone an Agent across independent cores, grant full execution trust,
or reinterpret Client Access as Owner access. Remote pairing data is retained;
an existing remote profile is never silently rebound to the Local Hub.

Business SQLite, local identity/control state and Bridge execution state live
under separate paths inside the private Node root. Existing checksum-verified
SQL migrations remain authoritative. Backup/restore must keep identity and data
consistent and occur without active writers; restoring an identity is not a
license to run a second writable copy. A newer unknown schema fails closed.

## Alternatives

Requiring Docker or npm would retain a separate deployment prerequisite.
Automatically bootstrapping a user from browser storage would make browser
reset change the installation Owner. An unauthenticated loopback control API
would expose local Owner or Runtime authority to other web origins. A new
execution stack would duplicate the existing delivery and Discussion semantics.

## Verification

Required evidence covers the native bundle with a clean executable search path,
fixed Owner identity across restart and browser reset, invalid entry and foreign
origin rejection, port collision, child exit and data-root ownership, plus a
disposable real Hub/Bridge scenario that creates a Team, configures Agents,
completes ordinary Run and Discussion, and reopens the same persisted state.
The Runtime fixture makes no model calls. Legacy Central/Bridge regression
checks remain required. Local verification, native packaging, real installation,
physical-platform acceptance, CI and publication are separate claims.

The task register owns delivery evidence. Milestones B/C, Peer networking,
Authority namespaces, real model calls, actual installations and external
publication are outside this authorization.
