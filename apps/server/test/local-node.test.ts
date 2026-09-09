import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { createTestResources } from "../../../scripts/test/resources.mjs";
import { createServerApp } from "../src/app.js";
import { backupDatabase } from "../src/data/backup.js";
import type { LocalNodeLaunch } from "@convene-wire/contracts/local-node";

const secret = () => randomBytes(32).toString("base64url");
const launch = (): LocalNodeLaunch => ({ schemaVersion: 1, controlToken: secret(), identity: {
  schemaVersion: 1, nodeId: `node_${secret()}`, ownerUserId: `user_${secret()}`, port: 48123, secret: secret()
}});
const host = "127.0.0.1:48123";
const origin = `http://${host}`;

test("Local Node fixed Owner, one-time entry, origin isolation and durable binding survive reopen and backup", async (t) => {
  const resources = await createTestResources(t, "convenewire-local-node-");
  const databasePath = path.join(resources.directory, "hub.sqlite");
  const localNode = launch();
  let now = "2026-09-09T10:00:00.000Z";
  let app = await createServerApp({ databasePath, localNode, clock: () => now });
  resources.defer(() => app.close());
  const control = { host, "x-convenewire-node-control": localNode.controlToken };
  const entry = async () => {
    const response = await app.inject({ method: "POST", url: "/api/local-node/control/entry", headers: control });
    assert.equal(response.statusCode, 200, response.body);
    return (response.json().url as string).split("/").at(-1)!;
  };
  const claim = (ticket: string, extra = {}) => app.inject({ method: "POST", url: "/api/local-node/session", headers: { host, origin }, payload: { ticket, ...extra } });
  assert.deepEqual((await app.inject({ url: "/api/auth/status", headers: { host } })).json(), { mode: "local", state: "local_bootstrap", localNode: true });
  assert.equal((await app.inject({ method: "POST", url: "/api/bootstrap", headers: { host }, payload: { userId: localNode.identity.ownerUserId, displayName: "Impostor" } })).statusCode, 404);
  for (const headers of [{ host: "localhost:48123" }, { host, origin: "https://evil.test" }, { host, origin: "null" }, { host, "sec-fetch-site": "cross-site" }]) {
    assert.equal((await app.inject({ url: "/api/health/ready", headers })).statusCode, 403);
  }
  for (const headers of [{ host }, { ...control, origin }, { ...control, "sec-fetch-mode": "cors" }]) {
    assert.equal((await app.inject({ method: "POST", url: "/api/local-node/control/entry", headers })).statusCode, 403);
  }
  assert.equal((await claim(secret())).statusCode, 403);
  const ticket = await entry();
  assert.equal((await claim(ticket, { userId: "user_arbitrary_123" })).statusCode, 400);
  const response = await claim(ticket);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().user.userId, localNode.identity.ownerUserId);
  assert.equal((await claim(ticket)).statusCode, 403);
  const token = response.json().session.token as string;
  const owner = { host, origin, authorization: `Bearer ${token}` };
  const team = (await app.inject({ method: "POST", url: "/api/teams", headers: owner, payload: { name: "Local Team" } })).json().team;
  const bindURL = `/api/local-node/teams/${team.teamId}/bind`;
  const bound = await app.inject({ method: "POST", url: bindURL, headers: owner });
  assert.equal(bound.statusCode, 200, bound.body);
  const firstBinding = (await app.inject({ url: "/api/local-node/control/binding", headers: control })).json().binding;
  assert.ok(firstBinding.token);
  assert.ok(!bound.body.includes(firstBinding.token));
  assert.deepEqual((await app.inject({ method: "POST", url: bindURL, headers: owner })).json(), bound.json());
  const other = (await app.inject({ method: "POST", url: "/api/teams", headers: owner, payload: { name: "Other Team" } })).json().team;
  assert.notEqual((await app.inject({ method: "POST", url: `/api/local-node/teams/${other.teamId}/bind`, headers: owner })).statusCode, 200);
  const expired = await entry(); now = "2026-09-09T10:03:00.000Z";
  assert.equal((await claim(expired)).statusCode, 403);
  const abandoned = await entry();
  await app.close();
  app = await createServerApp({ databasePath, localNode, clock: () => now });
  assert.equal((await claim(abandoned)).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/auth/session", headers: owner })).json().user.userId, localNode.identity.ownerUserId);
  assert.deepEqual((await app.inject({ url: "/api/local-node/control/binding", headers: control })).json().binding, firstBinding);
  const freshOwner = await claim(await entry());
  assert.equal(freshOwner.json().user.userId, localNode.identity.ownerUserId);
  const copy = path.join(resources.directory, "backup.sqlite");
  await backupDatabase(databasePath, copy);
  const restored = await createServerApp({ databasePath: copy, localNode });
  assert.deepEqual((await restored.inject({ url: "/api/local-node/control/binding", headers: control })).json().binding, firstBinding);
  await restored.close();
  const db = new Database(databasePath);
  try {
    const content = db.prepare("SELECT * FROM local_node_binding").get();
    assert.ok(!JSON.stringify(content).includes(firstBinding.token));
    assert.ok(!JSON.stringify(db.prepare("SELECT * FROM local_node_installation").get()).includes(localNode.identity.secret));
    db.prepare("UPDATE devices SET status = 'revoked', revoked_at = ? WHERE device_id = ?").run(now, firstBinding.deviceId);
    assert.equal((await app.inject({ url: "/api/local-node/control/binding", headers: control })).statusCode, 401);
    assert.notEqual((await app.inject({ method: "POST", url: bindURL, headers: owner })).statusCode, 200);
    assert.equal((db.prepare("SELECT count(*) AS n FROM devices").get() as { n: number }).n, 1);
  } finally { db.close(); }
  await app.close();
  await assert.rejects(createServerApp({ databasePath }), /requires its installation identity/u);
  for (const identity of [{ ...localNode.identity, ownerUserId: `user_${secret()}` }, { ...localNode.identity, port: 48124 }, { ...localNode.identity, secret: secret() }]) {
    await assert.rejects(createServerApp({ databasePath, localNode: { ...localNode, identity } }), /does not match/u);
  }
});

test("Local Node refuses to adopt legacy Central users; legacy local bootstrap remains available", async (t) => {
  const resources = await createTestResources(t, "convenewire-local-legacy-");
  const databasePath = path.join(resources.directory, "legacy.sqlite");
  const app = await createServerApp({ databasePath });
  const response = await app.inject({ method: "POST", url: "/api/bootstrap", payload: { displayName: "Existing Owner" } });
  assert.equal(response.statusCode, 200);
  await app.close();
  await assert.rejects(createServerApp({ databasePath, localNode: launch() }), /cannot adopt/u);
});
