# Private reference review

This is one sufficient answer, not a required template or string match. It is
not model-visible. Equivalent correct fixes, combined concrete tests and safe
conditional release language are accepted under scoring.json.

Do not release this implementation unchanged. Four demonstrated contract
violations block it: different-payload idempotency replay, revoked-member
downloads, lost outbox delivery and stale-worker object corruption. Repair
authorization and data safety, repair reliable delivery and request conflict
semantics, run the regressions below, then obtain deployment-bound evidence
before release. Independent repairs may proceed in parallel; none is claimed
implemented by this review.

## Findings and repairs

1. `createExport` calculates payloadHash but returns an existing tenant/key row
   without comparing it. For cobalt/r1, create filter `paid`, then retry r1
   with `unpaid`: the second response returns the paid job without conflict.
   Compare the normalized payload hash inside the existing transaction; equal
   payloads replay, different payloads fail as a conflict without new rows or
   mutation. Keep tenant-local uniqueness and the transaction. A lost response
   may follow a successful commit, so retry must inspect/replay the same key.
   Source: evidence_qa078_api_storage.
2. `download` verifies the signed payload, expiry, bound job/tenant and ready
   state but never consults `members`. A member can obtain a link, be revoked,
   then still fetch within its 60-second lifetime. Check the current membership
   for the signed user/tenant on every download, or an equivalent online
   revocation mechanism. Reducing TTL alone cannot meet next-download revocation.
   Keep signature/expiry and tenant/state checks. The contract deliberately
   permits already-authorized worker computation after revocation; do not
   invent a requirement to stop those workers. Sources:
   evidence_qa078_security, evidence_qa078_api_storage.
3. `dispatch` writes sentAt before publishing. If publish fails before delivery,
   restart skips that event forever; there is explicitly no queued-job scan to
   rescue it. Publish first and mark sent only after durable acknowledgement,
   leaving ambiguous/failed attempts retryable with the stable eventId. If the
   broker delivered but the acknowledgement was lost, replay can duplicate:
   preserve the ready/canceled no-op and active-lease claim exclusion. Recovery
   may recompute after an expired claim; do not promise exactly-once external
   work. A durable equivalent confirmation protocol is acceptable. Sources:
   evidence_qa078_operations, evidence_qa078_api_storage.
4. Database fencing does not protect object-store writes. Worker W1 claims
   epoch 1 at t=100 and pauses rendering. At t=30101 W2 reclaims epoch 2,
   writes its bytes and makes the job ready. W1 resumes, overwrites the same
   tenant/job key, fails the correct DB CAS, then deletes that key. The DB
   remains ready at epoch 2 while winning bytes are corrupted and removed.
   Allocate an immutable attempt/epoch-specific object key, write only that
   key, then publish its reference through the existing state/epoch/lease CAS.
   A loser may remove only its own unpublished key. Failed/crashed attempt
   cleanup must identify orphan attempts safely, never the winning reference;
   cancellation must prevent any later publication and downloads, with cleanup
   scoped to the relevant attempt. Conditional/version-fenced remote writes
   are another valid design if they prove both overwrite and cleanup safety.
   Merely adding another database epoch check is insufficient. Sources:
   evidence_qa078_operations, evidence_qa078_api_storage.

## Preserve working behavior

- Verified-session tenantId, not JSON body tenantId, selects request ownership;
  the worker renders stored tenant/filter. Unique(tenantId,requestKey) allows
  different tenants to reuse a key. Existing owned lookups deny cross-tenant
  IDs. These are present protections, not missing features. Sources:
  evidence_qa078_api_storage, evidence_qa078_security, evidence_qa078_operations.
- The job and outbox inserts share a SQLite transaction; the injected failure
  rolls both back. Moving outbox marking must preserve that atomic insertion.
  Sources: evidence_qa078_api_storage, evidence_qa078_test_evidence.
- `finish` already requires matching tenant, running state, epoch and a live
  lease. Cancellation changes state and increments epoch. Preserve this DB
  fence while fixing external writes. Source: evidence_qa078_api_storage.
- Ready/canceled jobs are not claimable; an event redelivered after successful
  publication does not rerender. This limited deduplication is not exactly-once
  across interrupted execution. Sources: evidence_qa078_api_storage,
  evidence_qa078_operations, evidence_qa078_test_evidence.

## Proposed regression acceptance

These are proposed checks, not claims that the repairs or new tests ran.

| Group | Concrete setup and action | Expected behavior after repair |
| --- | --- | --- |
| Changed replay | Create cobalt/r1 with `paid`; repeat with ` paid `, then `unpaid` | Whitespace-equivalent payload replays the same ID; changed payload conflicts; one unchanged job/outbox remains |
| Tenant isolation | Submit cobalt session with body tenant ochre, reuse r1 from an ochre session, and request cobalt's job using ochre | First belongs to cobalt; ochre gets a separate job; cross-tenant owned lookup is denied |
| Atomicity | Throw after job insert but before outbox insert | Neither row survives; subsequent normal request commits exactly one pair |
| Broker recovery | Fail publish before delivery, restart; separately accept delivery but lose ack, then retry and redeliver after ready | Pre-delivery event remains retryable and eventually delivered; stable event identity survives ambiguous retry; duplicate after ready does not rerender |
| Stale storage | Pause W1 beyond lease; W2 reclaims and publishes; resume W1 through failed publication and cleanup | W2 remains ready with identical readable bytes; W1 cannot replace/delete them and only its own orphan is cleaned |
| Cancellation | Pause a claimed worker before storage; cancel job, then resume it and redeliver | State stays canceled, no ready publication/download/reclaim; unpublished attempt objects alone may be cleaned |
| Revocation | Issue a ready-job link while membership active; remove membership and download before link expiry | Next download returns no bytes; an equivalent safe deny is accepted |
| Happy path | With active membership run a job, redeliver ready event, use valid link, then reach expiry | One completed render, duplicate ignored, correct normal bytes returned, expiry denies |

## Remaining evidence

The supplied code executed four local check groups on an in-memory SQLite
database, memory object store and scripted broker. Those observations support
only their stated paths. They do not test the new repair regressions or prove
production safety. Source: evidence_qa078_test_evidence.

Two evidence groups remain unknown: (U1) the real store's consistency,
versioning/durability guarantees and deployed IAM/access configuration; request
the actual provider contract/configuration and deployment-bound integration
and cleanup tests. (U2) production load, worker lease-latency distribution and
recovery timings; request representative load/fault runs with observed timings
and deployment identity. No specific RTO, data-loss incident or real secret
configuration can be inferred. Sources: evidence_qa078_operations,
evidence_qa078_security, evidence_qa078_test_evidence.
