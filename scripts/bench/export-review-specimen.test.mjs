import assert from "node:assert/strict";
import test from "node:test";
import { database, createExport, claim, finish, cancelExport } from "../../docs/acceptance/fixtures/qa-078/sources/api-storage.mjs";
import { memberKey, issueLink, download } from "../../docs/acceptance/fixtures/qa-078/sources/security.mjs";
import { dispatch, work, memoryStore } from "../../docs/acceptance/fixtures/qa-078/sources/operations.mjs";
import { documentedChecks } from "../../docs/acceptance/fixtures/qa-078/sources/test-evidence.mjs";

const ctx = { verified: true, tenantId: "cobalt", userId: "u1" };
const body = { requestKey: "r1", format: "csv", filter: "paid" };
function specimen(t) { const db = database(); t.after(() => db.close()); return db; }

test("published positive evidence executes against the complete specimen", async () => {
  assert.deepEqual(await documentedChecks(), ["tenant-isolation-and-same-payload-replay", "atomic-job-outbox-rollback",
    "happy-path-ready-dedup-and-link-expiry", "canceled-state-denies-download-and-reclaim"]);
});

test("same-key different payload silently replays old data instead of the required conflict", t => {
  const db = specimen(t), first = createExport(db, ctx, body);
  const second = createExport(db, ctx, { ...body, filter: "unpaid" });
  assert.equal(second.id, first.id); assert.equal(second.filter, "paid");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM jobs").get().n, 1);
});

test("mark-before-publish loses delivery after a pre-delivery failure and dispatcher restart", async t => {
  const db = specimen(t); createExport(db, ctx, body);
  await assert.rejects(dispatch(db, { async publish() { throw new Error("pre-delivery failure"); } }, 100));
  const observed = [];
  await dispatch(db, { async publish(event) { observed.push(event); } }, 200);
  assert.equal(observed.length, 0);
  assert.equal(db.prepare("SELECT state FROM jobs").get().state, "queued");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM outbox WHERE sentAt IS NULL").get().n, 0);
});

test("an unexpired link still downloads after issuer membership is revoked", async t => {
  const db = specimen(t), job = createExport(db, ctx, body), store = memoryStore();
  const members = new Set([memberKey(ctx)]), secret = "synthetic-fixture-only-not-a-credential";
  await work(db, { jobId: job.id }, { now: () => 100, store, async render() { return "private-export"; } });
  const link = issueLink(db, ctx, job.id, members, secret, 200);
  members.delete(memberKey(ctx));
  assert.equal(download(db, link, members, store, secret, 201), "private-export");
});

test("a stale worker overwrites then deletes winning bytes despite a correct DB epoch fence", async t => {
  const db = specimen(t), job = createExport(db, ctx, body), store = memoryStore();
  let now = 100, resume, rendered;
  const paused = new Promise(resolve => { resume = resolve; });
  const reached = new Promise(resolve => { rendered = resolve; });
  const old = work(db, { jobId: job.id }, { now: () => now, store, async render() { rendered(); await paused; return "old-bytes"; } });
  await reached; now = 30_101;
  assert.equal(await work(db, { jobId: job.id }, { now: () => now, store, async render() { return "winning-bytes"; } }), "ready");
  const ready = db.prepare("SELECT * FROM jobs WHERE id=?").get(job.id);
  assert.equal(store.get(ready.objectKey), "winning-bytes");
  const writes = [], originalPut = store.put;
  store.put = async (key, bytes) => { await originalPut(key, bytes); writes.push(store.get(key)); };
  resume(); assert.equal(await old, "discarded");
  assert.deepEqual(writes, ["old-bytes"]);
  assert.throws(() => store.get(ready.objectKey), /object_missing/);
  assert.equal(db.prepare("SELECT epoch FROM jobs WHERE id=?").get(job.id).epoch, ready.epoch);
  assert.equal(db.prepare("SELECT state FROM jobs WHERE id=?").get(job.id).state, "ready");
});

test("cancellation and expired-lease checks already fence DB publication", t => {
  const db = specimen(t), job = createExport(db, ctx, body), lease = claim(db, job.id, 100);
  assert.equal(finish(db, lease, "unused", 30_100), false);
  cancelExport(db, ctx, job.id);
  assert.equal(finish(db, lease, "unused", 101), false);
  assert.equal(claim(db, job.id, 40_000), null);
});
