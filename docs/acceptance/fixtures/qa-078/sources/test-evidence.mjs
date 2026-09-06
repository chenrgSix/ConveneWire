// Synthetic local checks; actual observation is generated before freezing this file.
import assert from "node:assert/strict";
import { database, createExport, getOwned, cancelExport } from "./api-storage.mjs";
import { authorizedRoute, memberKey, issueLink, download } from "./security.mjs";
import { dispatch, work, memoryStore } from "./operations.mjs";

export const environment = {
  kind: "local in-memory SQLite/object store and scripted broker, not production",
  untested: ["remote storage/IAM/durability", "production load and recovery-time distribution"],
  observed: {"command":"node: import test-evidence.mjs; await documentedChecks()","observedAt":"2026-09-06T15:46:47.397Z","node":"v22.23.1","result":"passed","checks":["tenant-isolation-and-same-payload-replay","atomic-job-outbox-rollback","happy-path-ready-dedup-and-link-expiry","canceled-state-denies-download-and-reclaim"]}
};

export async function documentedChecks() {
  const db = database(), store = memoryStore();
  const ctx = { verified: true, tenantId: "cobalt", userId: "u1" };
  const other = { verified: true, tenantId: "ochre", userId: "u2" };
  const members = new Set([memberKey(ctx), memberKey(other)]);
  const secret = "synthetic-fixture-only-not-a-credential";
  const body = { requestKey: "request-1", format: "csv", filter: " paid " };
  const passed = [];
  try {
    const job = authorizedRoute(ctx, members, () => createExport(db, ctx, { ...body, tenantId: "ochre" }));
    assert.equal(job.tenantId, "cobalt");
    assert.equal(createExport(db, ctx, { ...body, filter: "paid" }).id, job.id);
    assert.notEqual(createExport(db, other, body).id, job.id);
    assert.throws(() => getOwned(db, other, job.id), /not_found/);
    passed.push("tenant-isolation-and-same-payload-replay");
    assert.throws(() => createExport(db, ctx, { ...body, requestKey: "rollback" }, () => { throw new Error("crash"); }));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM jobs WHERE requestKey='rollback'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM outbox").get().n, 2);
    passed.push("atomic-job-outbox-rollback");
    const events = [];
    await dispatch(db, { async publish(event) { events.push(event); } }, 100);
    const event = events.find(e => e.jobId === job.id);
    let renders = 0;
    const dependencies = { now: () => 200, store, async render(scope) {
      renders++; assert.deepEqual(scope, { tenantId: "cobalt", filter: "paid" }); return "paid-export";
    } };
    assert.equal(await work(db, event, dependencies), "ready");
    assert.equal(await work(db, event, dependencies), "ignored");
    assert.equal(renders, 1);
    const link = issueLink(db, ctx, job.id, members, secret, 300);
    assert.equal(download(db, link, members, store, secret, 301), "paid-export");
    assert.throws(() => download(db, link, members, store, secret, 60_300), /expired/);
    passed.push("happy-path-ready-dedup-and-link-expiry");
    cancelExport(db, ctx, job.id);
    assert.throws(() => download(db, link, members, store, secret, 302), /not_ready/);
    assert.equal(await work(db, event, dependencies), "ignored");
    passed.push("canceled-state-denies-download-and-reclaim");
    return passed;
  } finally { db.close(); }
}
