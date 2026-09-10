import assert from "node:assert/strict";
import test from "node:test";
import tls from "node:tls";
import { once } from "node:events";
import { freeIngressPort, nativePeerIngressFixture } from "./helpers/native-peer-ingress-fixture.js";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { sessionCookieName } from "../src/http/http-helpers.js";
import { PeerIngress } from "../src/local-node/peer-ingress.js";
import { createServerApp } from "../src/app.js";
import { openDatabase } from "../src/data/database.js";
import { CoreRepository } from "../src/data/core-repository.js";
import { AuthService } from "../src/security/auth-service.js";
import { AuthorityService } from "../src/security/authority-service.js";
import { PeerAdmissionService } from "../src/security/peer-admission-service.js";
import { verifyPeerProof } from "../src/security/peer-proof-verifier.js";
import { PeerRunAuthority } from "../src/peer/run-authority.js";
import { RunRepository } from "../src/run/run-repository.js";
import { RunService } from "../src/run/run-service.js";
import { AgentTaskRepository } from "../src/task/task-repository.js";
import { MessageService } from "../src/team-room/message-service.js";

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

test("actual native TLS Run admission verifies the frozen Host request and rejects browser credentials", async t => {
  const f = await nativePeerIngressFixture(t), { joined } = await f.join();
  const m = joined.runtime.membership;
  const offer = { schemaVersion: 1, displayName: "Native Peer writer", role: "Reviewer", grant: {
    schemaVersion: 1, exportId: "export_nativepeer001", revision: 1, state: "active", issuedAt: f.now, expiresAt: m.expiresAt,
    peerId: m.peerId, participantNodeId: m.participantNodeId, authorityNodeId: m.hostNodeId, localAgentId: "agent_nativeexport001",
    teamId: m.scope.teamId, roomIds: [f.room.roomId], capabilities: { supportsStart: true, supportsStreaming: true,
      supportsInterrupt: true, supportsResume: false, supportsTaskContextIsolation: true, supportsOwnerPrivateOutput: false }
  } };
  const machine = { authorization: `Bearer ${joined.runtime.machineCredential.token}` };
  const offered = await f.request("/api/peer/agents/offers", { method: "POST", headers: machine,
    payload: { schemaVersion: 1, offer, proof: f.proof("agent.export", "op_nativeoffer001", "A".repeat(43), peerDigest(offer)) } });
  assert.equal(offered.status, 200, offered.body);
  const accepted = await f.app.inject({ method: "POST", url: "/api/peer/agents/accept", headers: f.ownerHeaders, payload: {
    schemaVersion: 1, operationId: "op_nativeaccept001", peerId: m.peerId, localAgentId: offer.grant.localAgentId,
    exportId: offer.grant.exportId, grantRevision: 1, grantDigest: peerDigest(offer.grant), offerDigest: peerDigest(offer),
    roomIds: offer.grant.roomIds, capabilities: offer.grant.capabilities, expiresAt: m.expiresAt,
    expectedAcceptanceId: null, expectedAcceptanceRevision: null } });
  assert.equal(accepted.statusCode, 200, accepted.body);
  const database = openDatabase(f.databasePath);
  t.after(() => database.close());
  const core = new CoreRepository(database), auth = new AuthService(database, () => f.now);
  const actor = auth.authenticateWebSession(f.owner.session.token, f.now), target = accepted.json().projection.projectionAgentId;
  const message = new MessageService(core, auth).createMemberMessage(actor, { roomId: f.room.roomId, content: "Native admission fixture", now: f.now,
    mentions: [{ targetType: "agent", targetAgentId: target, displayLabel: "Native Peer writer" }] });
  const run = new RunService(core, new RunRepository(database), auth, new AgentTaskRepository(database)).createRunsForMessage(actor, message.messageId, f.now)[0]!;
  const identity = new AuthorityService(database, f.localOrigin, f.launch), admission = new PeerAdmissionService(database, auth, identity, f.origin);
  const frozen = new PeerRunAuthority(database, admission, identity).freeze(run.runId, f.now);
  const input = { schemaVersion: 1, binding: frozen.binding,
    proof: f.proof("run.admission", "op_nativeadmit001", "A".repeat(43), peerDigest(frozen.binding)) };
  const response = await f.request("/api/peer/runs/admit", { method: "POST", payload: input, headers: machine });
  assert.equal(response.status, 200, response.body);
  verifyPeerProof(response.json().proof, { nodeId: identity.nodeId, publicKey: identity.publicKey }, {
    purpose: "run.admission", audienceNodeId: m.participantNodeId, operationId: "op_nativeadmit001",
    nonce: "A".repeat(43), subjectDigest: peerDigest(frozen.binding) }, f.now);
  for (const headers of [{ ...machine, origin: f.origin }, { ...machine, cookie: `${sessionCookieName(true)}=${f.owner.session.token}` },
    { ...machine, "x-convenewire-node-control": f.launch.controlToken }]) {
    assert.equal((await f.request("/api/peer/runs/admit", { method: "POST", payload: input, headers })).status, 403);
  }
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

test("native TLS Participant departure invalidates an already issued human browser session", async t => {
  const f = await nativePeerIngressFixture(t), { joined, browser } = await f.join();
  const claim = await f.request("/api/peer/browser-entry/claim", { method: "POST", payload: browser, headers: { origin: f.origin } });
  assert.equal(claim.status, 200, claim.body);
  const cookie = claim.headers["set-cookie"]![0]!.split(";", 1)[0]!;
  assert.equal((await f.request(`/api/rooms/${f.room.roomId}/messages`, { headers: { cookie } })).status, 200);
  const intent = { schemaVersion: 1, operationId: "op_nativeleave001", host: joined.runtime.invitation.host,
    hostOrigin: f.origin, participant: joined.human.participant, membershipId: joined.runtime.membership.membershipId,
    peerId: joined.runtime.membership.peerId };
  const payload = { schemaVersion: 1, intent, proof: f.proof("peer.leave", intent.operationId,
    joined.runtime.proof.payload.nonce, peerDigest(intent)) };
  assert.equal((await f.request("/api/peer/memberships/leave", { method: "POST", payload, headers: { cookie, origin: f.origin } })).status, 403);
  const response = await f.request("/api/peer/memberships/leave", { method: "POST", payload });
  assert.equal(response.status, 200, response.body); assert.equal(response.json().state, "revoked");
  assert.notEqual((await f.request("/api/auth/session", { headers: { cookie } })).status, 200);
  assert.notEqual((await f.request(`/api/rooms/${f.room.roomId}/messages`, { headers: { cookie } })).status, 200);
  const retry = await f.request("/api/peer/memberships/leave", { method: "POST", payload });
  assert.equal(retry.status, 200, retry.body); assert.deepEqual(retry.json().intent, intent);
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
