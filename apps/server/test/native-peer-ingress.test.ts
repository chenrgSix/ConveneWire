import assert from "node:assert/strict";
import test from "node:test";
import tls from "node:tls";
import { once } from "node:events";
import { freeIngressPort, nativePeerIngressFixture } from "./helpers/native-peer-ingress-fixture.js";
import { sessionCookieName } from "../src/http/http-helpers.js";
import { PeerIngress } from "../src/local-node/peer-ingress.js";
import { createServerApp } from "../src/app.js";

test("native TLS entry cannot expose local Owner, control, bootstrap, Device or proxy authority", async t => {
  const f = await nativePeerIngressFixture(t);
  const status = await f.request("/api/auth/status");
  assert.equal(status.status, 200, status.body);
  assert.deepEqual(status.json(), { mode: "trusted-team", state: "sign_in_required", peerOnly: true });
  const local = await f.app.inject({ url: "/api/auth/status", headers: { host: new URL(f.localOrigin).host } });
  assert.equal(local.json().localNode, true); assert.equal(local.json().mode, "local");
  await assert.rejects(f.request("/api/auth/status", { trust: false }), /self.signed|certificate/u);
  for (const url of ["/api/local-node/control/entry", "/api/local-node/control/state", "/api/bootstrap", "/api/peer/invitations",
    "/api/peer/agents/accept", "/api/auth/recover-owner", "/api/authority/proof", "/ws/bridge", "/api/peer/../local-node/control/state", "/api/%6cocal-node/control/state"]) {
    const denied = await f.request(url, { method: "POST", payload: {} });
    assert.equal(denied.status, 403, url);
    assert.ok(!denied.body.includes(f.launch.controlToken));
  }
  for (const headers of [
    { host: new URL(f.localOrigin).host }, { origin: "https://other.test" }, { forwarded: "proto=https;host=localhost" },
    { "x-forwarded-proto": "https" }, { "x-convenewire-node-control": f.launch.controlToken },
    { authorization: `Bearer ${f.owner.session.token}` }, { "x-agent-room-recovery-token": "arbitrary" }
  ]) assert.equal((await f.request("/api/auth/status", { headers })).status, 403);
  const ownerCookie = `${sessionCookieName(true)}=${f.owner.session.token}`;
  assert.equal((await f.request("/api/auth/session", { headers: { cookie: ownerCookie } })).status, 403);
  assert.equal((await f.request("/api/teams", { headers: { cookie: ownerCookie } })).status, 403);
  const forged = await f.app.inject({ url: "/api/auth/status", headers: { host: new URL(f.origin).host, "x-forwarded-proto": "https" } });
  assert.equal(forged.statusCode, 403);
});

test("actual native TLS claim and independent browser entry retain Room scope and secure cookies", async t => {
  const f = await nativePeerIngressFixture(t), { joined, browser, invitation } = await f.join();
  assert.equal(invitation.invitation.hostOrigin, f.origin);
  assert.equal(joined.runtime.membership.hostNodeId, f.launch.identity.nodeId);
  assert.equal((await f.request("/api/peer/browser-entry/claim", { method: "POST", payload: browser })).status, 403);
  const claim = await f.request("/api/peer/browser-entry/claim", { method: "POST", payload: browser, headers: { origin: f.origin } });
  assert.equal(claim.status, 200, claim.body); assert.equal(claim.json().session.token, undefined);
  assert.equal(claim.json().mode, "trusted-team"); assert.equal(claim.json().user.peerAccess.roomId, f.room.roomId);
  const setCookie = claim.headers["set-cookie"]![0]!;
  assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict/u);
  const cookie = setCookie.split(";", 1)[0]!;
  const session = await f.request("/api/auth/session", { headers: { cookie } });
  assert.equal(session.status, 200); assert.equal(session.json().user.peerAccess.roomId, f.room.roomId);
  assert.equal((await f.request(`/api/rooms/${f.room.roomId}/messages`, { headers: { cookie } })).status, 200);
  assert.equal((await f.request(`/api/rooms/${f.otherRoom.roomId}/messages`, { headers: { cookie } })).status, 403);
  assert.equal((await f.request(`/api/rooms/${f.room.roomId}/messages`, { method: "POST", payload: { content: "Denied without Origin" }, headers: { cookie } })).status, 403);
  const message = await f.request(`/api/rooms/${f.room.roomId}/messages`, { method: "POST", payload: { content: "Peer human message", mentions: [] }, headers: { cookie, origin: f.origin } });
  assert.equal(message.status, 200, message.body);
  await f.app.inject({ method: "DELETE", url: `/api/peer/memberships/${joined.runtime.membership.membershipId}`, headers: f.ownerHeaders });
  assert.notEqual((await f.request("/api/auth/session", { headers: { cookie } })).status, 200);
  assert.notEqual((await f.request(`/api/rooms/${f.room.roomId}/messages`, { headers: { cookie } })).status, 200);
});

test("native ingress rejects browser/Device upgrades and drains incomplete TLS clients on Hub close", async t => {
  const f = await nativePeerIngressFixture(t);
  for (const url of ["/ws/bridge", "/ws/peer/runtime"]) {
    const denied = await f.request(url, { headers: { origin: f.origin, connection: "Upgrade", upgrade: "websocket",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" } });
    assert.equal(denied.status, 403);
  }
  const socket = tls.connect({ host: "127.0.0.1", port: f.peerPort, ca: f.cert });
  await once(socket, "secureConnect");
  socket.on("error", error => { assert.equal((error as NodeJS.ErrnoException).code, "ECONNRESET"); });
  socket.write("GET /api/auth/status HTTP/1.1\r\n");
  const closed = new Promise<void>(resolve => socket.once("close", () => resolve()));
  await f.app.close(); await closed;
  await assert.rejects(f.request("/api/auth/status"), /ECONNREFUSED|ECONNRESET/u);
  await assert.rejects(f.ingress.listen(f.app.server), /one running local Hub/u);
});

test("conflicting Peer TLS port fails without replacing or exposing another Hub", async t => {
  const f = await nativePeerIngressFixture(t);
  const duplicate = new PeerIngress({ configuration: f.ingress.configuration, tls: { cert: f.cert, key: f.key } });
  await assert.rejects(duplicate.listen(f.app.server), /EADDRINUSE/u);
  await duplicate.close();
  assert.equal((await f.request("/api/auth/status")).status, 200);
  const origin = `https://127.0.0.1:${await freeIngressPort()}`;
  const canceled = new PeerIngress({ configuration: { ...f.ingress.configuration, origin }, tls: { cert: f.cert, key: f.key } });
  const start = canceled.listen(f.app.server);
  const rejected = assert.rejects(start, /startup stopped|abort/iu);
  await canceled.close(); await rejected;
});

test("a changed ingress origin cannot adopt live invitation or membership pins", async t => {
  const f = await nativePeerIngressFixture(t);
  const { joined } = await f.join();
  await f.app.close();
  const port = await freeIngressPort();
  const configuration = { ...f.ingress.configuration, origin: `https://127.0.0.1:${port}` };
  const changed = new PeerIngress({ configuration, tls: { cert: f.cert, key: f.key } });
  await assert.rejects(createServerApp({ databasePath: f.databasePath, localNode: f.launch, peerIngress: changed }), /revoke existing Peer associations/u);
  // Owner can reopen the original pinned configuration, revoke, then explicitly reconfigure.
  const original = new PeerIngress({ configuration: { ...f.ingress.configuration, enabled: false } });
  const app = await createServerApp({ databasePath: f.databasePath, localNode: f.launch, peerIngress: original });
  try {
    const revoked = await app.inject({ method: "DELETE", url: `/api/peer/memberships/${joined.runtime.membership.membershipId}`, headers: f.ownerHeaders });
    assert.equal(revoked.statusCode, 200, revoked.body);
  } finally { await app.close(); }
  const newApp = await createServerApp({ databasePath: f.databasePath, localNode: f.launch, peerIngress: changed });
  await newApp.close();
});
