import assert from "node:assert/strict";
import { createPublicKey, randomBytes, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { createTestResources } from "../../../scripts/test/resources.mjs";
import { createServerApp } from "../src/app.js";
import { backupDatabase } from "../src/data/backup.js";
import { CoreRepository } from "../src/data/core-repository.js";
import { AuthService } from "../src/security/auth-service.js";
import { MemberDeviceService } from "../src/registry/member-device-service.js";
import { authorityProofTranscript } from "@convene-wire/contracts/authority-proof";
import type { AuthorityProofPayload } from "@convene-wire/contracts/authority";

const secret = () => randomBytes(32).toString("base64url");

test("Host proof is Device authenticated, immutable across restart/backup and verified by Go", async (t) => {
  const resources = await createTestResources(t, "convenewire-authority-");
  const databasePath = path.join(resources.directory, "host.sqlite");
  let app = await createServerApp({ databasePath }); resources.defer(() => app.close());
  const now = new Date().toISOString();
  const db = new Database(databasePath); resources.defer(() => db.close());
  const core = new CoreRepository(db), auth = new AuthService(db);
  core.ensureUser({ userId: "user_authority001", displayName: "Owner", createdAt: now });
  const owner = auth.issueWebSession("user_authority001", now, new Date(Date.now() + 3600_000).toISOString());
  const teamResponse = await app.inject({ method: "POST", url: "/api/teams", headers: { authorization: `Bearer ${owner.secret}` }, payload: { name: "Authority" } });
  assert.equal(teamResponse.statusCode, 200, teamResponse.body);
  const team = teamResponse.json().team;
  const actor = auth.authenticateWebSession(owner.secret, now);
  const device = new MemberDeviceService(core, auth).registerOwnDevice(actor, team.teamId, "Runtime", now);
  const credential = auth.issueDeviceCredential(device.deviceId, now);
  const request = (payload: unknown, token = credential.secret) => app.inject({ method: "POST", url: "/api/bridge/authority-proof", headers: { authorization: `Bearer ${token}` }, payload });
  const nonce = secret();
  const response = await request({ nonce }); assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "no-store");
  const p = response.json().payload as AuthorityProofPayload;
  assert.equal(p.nonce, nonce); assert.equal(p.deviceId, device.deviceId); assert.equal(p.teamId, team.teamId);
  assert.equal(p.ownerMemberId, device.ownerMemberId); assert.equal(Date.parse(p.expiresAt) - Date.parse(p.issuedAt), 30_000);
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(p.publicKey, "base64url")]), format: "der", type: "spki" });
  assert.ok(verify(null, authorityProofTranscript(p), key, Buffer.from(p.signature, "base64url")));
  for (const payload of [{ nonce, teamId: "team_forged001" }, { nonce: "invalid" }, { nonce, mode: "peer" }]) assert.notEqual((await request(payload)).statusCode, 200);
  assert.equal((await request({ nonce }, owner.secret)).statusCode, 401);
  assert.equal((await request({ nonce }, "revoked")).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/authority" })).statusCode, 401);
  const publicView = (await app.inject({ url: "/api/authority", headers: { authorization: `Bearer ${owner.secret}` } })).json();
  assert.deepEqual(Object.keys(publicView).sort(), ["authorityNodeId", "browserOrigin", "publicKey"]);
  assert.equal(publicView.authorityNodeId, p.authorityNodeId);
  assert.throws(() => db.prepare("DELETE FROM authority_identity").run(), /cannot be deleted/u);
  assert.throws(() => db.prepare("UPDATE authority_identity SET node_id = 'node_replaced001'").run(), /immutable/u);
  await app.close(); app = await createServerApp({ databasePath });
  assert.equal((await request({ nonce: secret() })).json().payload.publicKey, p.publicKey);
  const copy = path.join(resources.directory, "backup.sqlite"); await backupDatabase(databasePath, copy);
  const restored = await createServerApp({ databasePath: copy });
  const restoredResponse = await restored.inject({ method: "POST", url: "/api/bridge/authority-proof", headers: { authorization: `Bearer ${credential.secret}` }, payload: { nonce } });
  assert.equal(restoredResponse.json().payload.authorityNodeId, p.authorityNodeId);
  assert.equal(restoredResponse.json().payload.publicKey, p.publicKey); await restored.close();
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  await promisify(execFile)("go", ["test", "./internal/authority", "-run", "^TestLiveAuthorityProof$", "-count=1"], {
    cwd: path.resolve(import.meta.dirname, "../../../bridge"), timeout: 120_000,
    env: { ...process.env, CONVENE_WIRE_TEST_AUTHORITY: JSON.stringify({
      pin: { authorityNodeId: p.authorityNodeId, publicKey: p.publicKey, serverOrigin: origin },
      credential: { serverUrl: origin, teamId: team.teamId, deviceId: device.deviceId, ownerMemberId: device.ownerMemberId, token: credential.secret }
    }) }
  });
  auth.revokeDeviceCredential(credential.id, now);
  assert.equal((await request({ nonce })).statusCode, 401);
  await app.close();
  db.exec("DROP TRIGGER authority_identity_no_delete; DELETE FROM authority_identity");
  await assert.rejects(createServerApp({ databasePath }), /identity is missing/u);
});

test("Local Hub signing identity derives from the original installation without storing its seed", async (t) => {
  const resources = await createTestResources(t, "convenewire-local-authority-");
  const databasePath = path.join(resources.directory, "local.sqlite");
  const localNode = { schemaVersion: 1 as const, controlToken: secret(), identity: { schemaVersion: 1 as const,
    nodeId: `node_${secret()}`, ownerUserId: `user_${secret()}`, port: 48125, secret: secret() } };
  let app = await createServerApp({ databasePath, localNode });
  const db = new Database(databasePath);
  const row = db.prepare("SELECT * FROM authority_identity").get() as { node_id: string; seed_hex: null; public_key: string; kind: string };
  assert.equal(row.node_id, localNode.identity.nodeId); assert.equal(row.kind, "local"); assert.equal(row.seed_hex, null);
  assert.ok(!JSON.stringify(row).includes(localNode.identity.secret));
  await app.close(); app = await createServerApp({ databasePath, localNode });
  assert.deepEqual(db.prepare("SELECT * FROM authority_identity").get(), row); await app.close(); db.close();
  await assert.rejects(createServerApp({ databasePath, localNode: { ...localNode, identity: { ...localNode.identity, secret: secret() } } }), /does not match/u);
});
