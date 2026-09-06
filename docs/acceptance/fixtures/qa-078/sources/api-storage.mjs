// Synthetic review specimen, not ConveneWire production code. Integer times are ms.
import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";

export const apiContract = {
  tenant: "Only a verified session's tenantId selects data; body tenantId is ignored.",
  idempotency: "Within one tenant, the same requestKey and normalized format/filter replay the same job. A different normalized payload with that key must be rejected as a conflict, without a new job or changed data. Different tenants may reuse a key.",
  transaction: "An accepted job must have a durable outbox event in the same transaction. A lost HTTP response is not proof of rollback.",
  cancellation: "Cancellation invalidates unfinished workers and future downloads; ready jobs may be canceled. It cannot retract bytes already downloaded.",
  state: "queued -> running -> ready, with expired running claims reclaimable; queued/running/ready -> canceled. Ready and canceled cannot be claimed."
};

export function database() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE jobs (
    id TEXT PRIMARY KEY, tenantId TEXT NOT NULL, userId TEXT NOT NULL,
    requestKey TEXT NOT NULL, payloadHash TEXT NOT NULL, filter TEXT NOT NULL,
    format TEXT NOT NULL, state TEXT NOT NULL, epoch INTEGER NOT NULL DEFAULT 0,
    leaseUntil INTEGER NOT NULL DEFAULT 0, objectKey TEXT,
    UNIQUE(tenantId, requestKey));
    CREATE TABLE outbox (eventId TEXT PRIMARY KEY, jobId TEXT NOT NULL UNIQUE,
    sentAt INTEGER);`);
  return db;
}

export function requireSession(ctx) {
  if (!ctx?.verified || !ctx.tenantId || !ctx.userId) throw new Error("unauthenticated");
}

export function createExport(db, ctx, body, afterInsert = () => {}) {
  requireSession(ctx); // HTTP middleware supplies ctx, never JSON from the caller.
  if (body.format !== "csv" || typeof body.filter !== "string" ||
      typeof body.requestKey !== "string" || !body.requestKey.trim()) throw new Error("invalid_request");
  const normalized = { format: body.format, filter: body.filter.trim() };
  const payloadHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  return db.transaction(() => {
    const existing = db.prepare("SELECT * FROM jobs WHERE tenantId=? AND requestKey=?")
      .get(ctx.tenantId, body.requestKey);
    if (existing) return existing;
    const id = randomUUID();
    db.prepare(`INSERT INTO jobs(id,tenantId,userId,requestKey,payloadHash,filter,format,state)
      VALUES(?,?,?,?,?,?,?, 'queued')`).run(id, ctx.tenantId, ctx.userId, body.requestKey,
      payloadHash, normalized.filter, normalized.format);
    afterInsert(); // Test-only injected exception models a transaction failure.
    db.prepare("INSERT INTO outbox(eventId,jobId,sentAt) VALUES(?,?,NULL)").run(`export:${id}`, id);
    return db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
  })();
}

export function getOwned(db, ctx, id) {
  requireSession(ctx);
  const job = db.prepare("SELECT * FROM jobs WHERE id=? AND tenantId=?").get(id, ctx.tenantId);
  if (!job) throw new Error("not_found");
  return job;
}

export function cancelExport(db, ctx, id) {
  const job = getOwned(db, ctx, id);
  db.prepare("UPDATE jobs SET state='canceled',epoch=epoch+1,leaseUntil=0 WHERE id=? AND tenantId=?")
    .run(job.id, ctx.tenantId);
}

export function claim(db, id, now) {
  return db.transaction(() => {
    const job = db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
    if (!job || !["queued", "running"].includes(job.state) ||
        (job.state === "running" && job.leaseUntil > now)) return null;
    db.prepare("UPDATE jobs SET state='running',epoch=epoch+1,leaseUntil=? WHERE id=?")
      .run(now + 30_000, id);
    return db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
  })();
}

export function finish(db, job, objectKey, now) {
  return db.prepare(`UPDATE jobs SET state='ready',objectKey=?,leaseUntil=0
    WHERE id=? AND tenantId=? AND state='running' AND epoch=? AND leaseUntil>?`)
    .run(objectKey, job.id, job.tenantId, job.epoch, now).changes === 1;
}
