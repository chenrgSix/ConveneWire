// Synthetic worker and dispatcher. No external service is contacted by this module.
import { claim, finish } from "./api-storage.mjs";

export const operationsContract = {
  broker: "publish may throw before delivery OR after delivery with a lost acknowledgement. A resolved publish acknowledges durable acceptance. Consumers receive at least once, possibly reordered. eventId is stable; no exactly-once broker promise.",
  dispatcher: "A supervised periodic dispatcher runs at least once per second and selects unsent outbox rows. There is no separate scan/reconciler for queued jobs whose outbox is already marked sent. The supervisor restarts it after a crash.",
  worker: "A supervised redelivery timer retries expired running jobs as well as the broker redelivering unacknowledged events. Workers can pause past the 30-second lease; claims need not finish in order.",
  objectStore: "put replaces the bytes at an existing key, get returns the current bytes, delete removes that key. These are the in-memory fixture semantics, not proof of real remote-store consistency, versioning or durability.",
  publication: "A ready job must refer to immutable bytes from its winning worker. A stale/canceled worker must neither overwrite nor delete a winning object's bytes. Failed attempts must clean up only their own unpublished objects.",
  deployment: "No production object-store contract, IAM policy, worker lease-latency distribution, load benchmark or measured recovery-time evidence is provided."
};

export async function dispatch(db, broker, now) {
  const events = db.prepare("SELECT * FROM outbox WHERE sentAt IS NULL ORDER BY eventId").all();
  for (const event of events) {
    db.prepare("UPDATE outbox SET sentAt=? WHERE eventId=?").run(now, event.eventId);
    await broker.publish({ eventId: event.eventId, jobId: event.jobId });
  }
}

export async function work(db, event, dependencies) {
  const job = claim(db, event.jobId, dependencies.now());
  if (!job) return "ignored";
  // render receives the stored tenant/filter, never a tenant from the event.
  const bytes = await dependencies.render({ tenantId: job.tenantId, filter: job.filter });
  const objectKey = `tenants/${job.tenantId}/exports/${job.id}.csv`;
  await dependencies.store.put(objectKey, bytes);
  if (finish(db, job, objectKey, dependencies.now())) return "ready";
  await dependencies.store.delete(objectKey);
  return "discarded";
}

export function memoryStore() {
  const objects = new Map();
  return {
    objects,
    async put(key, bytes) { objects.set(key, bytes); },
    get(key) { if (!objects.has(key)) throw new Error("object_missing"); return objects.get(key); },
    async delete(key) { objects.delete(key); }
  };
}
