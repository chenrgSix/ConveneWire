# ADR-0067: Multi-Authority Runtime Foundation

- Status: Accepted
- Date: 2026-09-09
- Tasks: CON-027, DATA-009, BRG-080, WEB-084
- Extends: ADR-0065, ADR-0066, ADR-0017, ADR-0063
- Supersedes: none

## Context and authorization

The Owner authorized Milestone B after Local Node implementation and agreed to
combine A/B native desktop acceptance after B. This decision starts the shared
Runtime foundation. Native installation, Windows physical acceptance, real
models and publication keep their separate gates. TASKS.md owns delivery status.

The existing Bridge composition creates transport, Inbox, Sessions, adapters and
an Agent gate together. Starting that function independently for several Hosts
would give a shared physical Agent and Workspace several independent executors.
The foundation must separate connection state from local resource ownership.

## Authority and compatibility boundary

B uses explicitly configured, independently authenticated **Device connectors**
to existing Host Teams, including the Local Node. It creates no Peer principal,
Invite, remote membership, Export or Acceptance. Device identity is not renamed
into Peer authority. The Host still owns all collaboration writes and existing
Device authorization. C will add a distinct Peer transport admission adapter.
No Peer payload or unsupported mode can fall back to Device permission.

Each configured connector pins an Authority Node ID, exact transport origin,
Host public key and its existing Team/Device/Owner binding. An endpoint is never
the namespace. New Host proof is additive to the existing Device protocol;
legacy single-connection Bridge remains compatible with older Hosts, while a
multi-Authority connector requires the new proof capability.

The Host proves its identity with Ed25519 over a versioned, fixed-order JSON
array of strings. The transcript binds the caller's random nonce, Authority ID,
public key, Team, Device, Owner Member, issue time and expiry. The response is
Device-authenticated; possession of the key alone grants no Team or human right.
Proof lives for at most 30 seconds with at most 5 seconds of clock skew. A queued
request must obtain current proof again after resource waiting and before start;
connection recovery also revalidates. Redirects, changed origins/keys/identity,
expired or mismatched proofs fail closed. No insecure remote transport is added;
HTTP is limited to explicit loopback development/Local Node fixtures.

Local Hub identity retains its existing Node ID and derives its signing seed
from the private installation seed. A non-Local Hub persists a separate stable
identity/key in its private database. Keys never enter Web status, Runtime input
or logs. B supports same-identity stopped restore only; key rotation, lost-key
replacement and endpoint rebinding cannot happen implicitly. C must add an
explicit authenticated transition before offering those operations.

## One core and explicit local identity

One Runtime core owns the root lease, stable local Agent identity map and shared
resource scheduler. Connectors own transport/authentication, publication aliases
and references to partitioned delivery state. They do not acquire independent
local execution authority. Both the single and multi-connector compositions reuse
the delivered Handler, RuntimeExecutor, cancellation and recovery algorithms.

An explicit projection-to-local-Agent mapping is resolved before resource
admission. Identical projection IDs on two Authorities are allowed and cannot
create another local execution identity. Runtime configuration remains local.
A new connector starts with no copied full trust, Central approval consent,
standing policy, private disclosure consent or native Session. Existing primary
Device consent remains bound to its original authenticated Device/Owner/origin.

The scheduler serializes the same local Agent and overlapping canonical physical
Workspace paths, including symlink aliases, across all connectors. Independent
resources may execute concurrently. Conflicting waiters are admitted fairly;
queue cancellation releases only that waiter's claim. Configuration replacement
continues to drain the owning core before changing resources. Local process
completion, rather than a Host's terminal projection, releases resource ownership.
The core durably records ordinary child-process ownership as lifecycle evidence
without granting governed execution. Startup fences all persisted ordinary and
governed orphans before any connector starts, including removed or offline
Authorities. A failed process cleanup retains ownership and blocks admission.

## Durable partitions and recovery

AuthorityRef is a closed versioned reference with Authority ID, object type and
object ID. The authenticated connector supplies and validates its namespace;
payload references cannot select a different authority. Team/Device/Owner binding
is checked separately. Run identity is Authority plus Run ID, never connection
epoch, projection alias, grant revision or transport retry ID.

Inbox, cancellation tombstones, Session bindings, connection epochs, Artifact
staging, execution policies/receipts and approval callbacks have explicit
Authority ownership. The existing original Run payload and local Inbox digest
algorithm remain unchanged: generated typed payload JSON, SHA-256, excluding the
outer transport envelope. Existing persisted digests are never recomputed into
a different representation during namespace adoption. B does not exchange a new
Peer semantic digest. C's future semantic digest uses RFC 8785 canonical JSON
UTF-8 and SHA-256, with authorization pins included and retry envelope excluded;
its wire vectors and negotiation must precede Peer execution.

The primary legacy root can be adopted only after authenticated proof matches
its exact saved credential and stable Agent identities. A durable namespace
receipt binds the preserved records to that one Authority without rewriting
requests or creating fresh Inbox entries. Missing/ambiguous/mismatched receipts
fail closed. Additional connectors use fresh private Authority partitions;
external legacy profiles and their histories are never silently imported,
rewritten, deleted or rebound. A later history-import feature needs its own
explicit provenance and stopped-owner procedure.

Changing consent/session policy cannot create a new Run-deduplication namespace.
Native Sessions remain isolated by Authority and effective local configuration;
a broader context cannot be resumed under a restricted connector. Revoked
credentials cannot publish new content. Known completion remains in the local
partition when reporting fails. Interrupted accepted work retains the existing
conservative outcome-unknown semantics; it is never automatically rerun.

A connector failure stops/reconciles only its own traffic and invalidates its
pending callbacks. Other connectors remain available subject to real shared
resource contention. B retains Device-mode Central approval through the exact
origin and credential. C's Peer adapter must instead implement Participant-local
approval; it cannot reuse Device Central approval as a substitute.

Peer bilateral freshness, revision rollover, revoke settlement authentication
and private-output human binding remain C contracts, not enabled placeholders.
There is no settlement endpoint accepting revoked Device credentials. Unsupported
Peer operations fail closed rather than inheriting legacy business access.

## Local configuration and Web Spaces

B exposes owner-private connector configuration for advanced/local fixture use.
It requires explicit Authority pins, separately issued Device credentials and
projection mappings. It does not read unrelated existing profiles, pair a new
Host automatically or build an Invite UI. Empty configuration retains A.

Web presents a bounded local directory of Spaces: Authority ID, Team reference,
label and validated browser origin. Remote entries are references only, never
Hosted Room replicas. Separate origin-bound views retain their own human login,
navigation, draft/outbox and asynchronous request lifecycle. Space switching
never forwards the local Owner bearer or a Device credential. A remote human
still authenticates at that Host under its current rights; the directory grants
no access. No generic credential-bearing cross-origin proxy is introduced.

## Verification and consequences

CON-027 requires closed positive/negative TypeScript and Go fixtures, deterministic
generation, reference separation and matching proof transcripts. DATA-009 covers
stable Host proof, nonce/expiry/key/binding denial, exact legacy-root adoption,
namespace tampering and preserved records. BRG-080 covers one actual shared core
with local plus multiple authenticated fixture Hosts, colliding IDs, shared Agent
and overlapping Workspace arbitration, independent parallel resources, changed
payload rejection, cancellation, offline/retry/duplicate/out-of-order events,
Session/approval/result isolation and crash/restart. WEB-084 covers separate
origin navigation, no credential forwarding, delayed response/session guards and
A's existing Run/Discussion path. No model calls are needed.

A/B native desktop interaction is a joint gate after these implementation checks.
Local fixture success, native package creation, installed-client behavior,
physical Windows/minimum-OS acceptance, CI and publication remain distinct.
