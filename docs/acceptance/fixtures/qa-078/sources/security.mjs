// Synthetic specimen. verifySession is trusted upstream middleware, not a client flag.
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireSession, getOwned } from "./api-storage.mjs";

export const securityContract = {
  create: "Create/cancel/issue-link HTTP routes require a verified session and current active tenant membership.",
  worker: "A worker exports only the tenant/filter authorized when the job was created. User revocation does not cancel that background computation; it must deny subsequent downloads.",
  download: "Every download must check current active membership for the user/tenant to whom the link was issued. Revocation takes effect on the next download, even for an unexpired signed link. No separate caller session is required by this fixture's download contract; link possession is insufficient after the signed user's membership is revoked.",
  signing: "The fixture secret is supplied by the owner; no real secret, token, deployment key configuration or production IAM evidence is included."
};

export const memberKey = ctx => `${ctx.tenantId}/${ctx.userId}`;
export function requireMember(ctx, members) {
  requireSession(ctx);
  if (!members.has(memberKey(ctx))) throw new Error("membership_revoked");
}

export function authorizedRoute(ctx, members, handler) {
  requireMember(ctx, members);
  return handler();
}

const sign = (body, secret) => createHmac("sha256", secret).update(body).digest();
function encode(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret).toString("base64url")}`;
}
function decode(token, secret, now) {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("bad_link");
  const signature = Buffer.from(parts[1], "base64url"), expected = sign(parts[0], secret);
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error("bad_signature");
  const value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  if (typeof value.jobId !== "string" || typeof value.tenantId !== "string" ||
      typeof value.userId !== "string" || !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= now) throw new Error("expired_or_invalid_link");
  return value;
}

export function issueLink(db, ctx, id, members, secret, now) {
  requireMember(ctx, members);
  const job = getOwned(db, ctx, id);
  if (job.state !== "ready") throw new Error("not_ready");
  return encode({ jobId: id, tenantId: ctx.tenantId, userId: ctx.userId, expiresAt: now + 60_000 }, secret);
}

export function download(db, token, members, store, secret, now) {
  const value = decode(token, secret, now);
  const job = db.prepare("SELECT * FROM jobs WHERE id=? AND tenantId=?").get(value.jobId, value.tenantId);
  if (!job || job.state !== "ready") throw new Error("not_ready");
  return store.get(job.objectKey);
}
