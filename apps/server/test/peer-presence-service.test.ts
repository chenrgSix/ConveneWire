import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import WebSocket from "ws";
import type { PeerRuntimeChallenge } from "@convene-wire/contracts/peer";
import { peerDigest, peerProofTranscript } from "@convene-wire/contracts/peer-proof";
import { createServerApp } from "../src/app.js";
import { PeerRuntimeSessions } from "../src/peer/runtime-sessions.js";
import { PeerPresenceService } from "../src/registry/peer-presence-service.js";
import { PresenceService } from "../src/registry/presence-service.js";
import { executionFixture } from "./helpers/peer-run-fixture.js";
import { now, roomId, teamId, ownerMember } from "./helpers/peer-fixture.js";

const at = (seconds: number) => new Date(Date.parse(now) + seconds * 1000).toISOString();
const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 19)]), format: "der", type: "pkcs8" });
function authenticate(challenge: PeerRuntimeChallenge, time = now) {
  const b = challenge.binding;
  const payload = { schemaVersion: 1, purpose: "peer.connect" as const, signerNodeId: b.participant.nodeId,
    signerPublicKey: b.participant.publicKey, audienceNodeId: b.host.nodeId, operationId: b.operationId,
    nonce: challenge.nonce, subjectDigest: peerDigest({ phase: "authenticate", binding: b }),
    issuedAt: time, expiresAt: new Date(Date.parse(time) + 30000).toISOString() };
  return Buffer.from(JSON.stringify({ protocolVersion: "peer.v1", messageId: "msg_peerpresence001", timestamp: time,
    type: "peer.runtime.authenticate", payload: { schemaVersion: 1, bindingDigest: peerDigest(b),
      proof: { payload, signature: sign(null, peerProofTranscript(payload), key).toString("base64url") } } }));
}

async function presenceFixture(t: Parameters<typeof executionFixture>[0]) {
  const f = await executionFixture(t), changes: string[] = [];
  const sessions = new PeerRuntimeSessions(f.admission, f.identity, id => source.refresh(now, id));
  const source = new PeerPresenceService(f.database, sessions, id => changes.push(id));
  const presenceApi = new PresenceService(f.core, f.auth, 30000, undefined, source);
  f.resources.defer(() => sessions.close());
  const open = (time = now) => sessions.open(f.token, { send() {}, close() {} }, time);
  const connect = (time = now) => {
    const session = open(time);
    session.receive(authenticate(session.challenge(time).payload as PeerRuntimeChallenge, time), time);
    return session;
  };
  return { ...f, source, sessions, presenceApi, changes, open, connect, id: f.accepted.projection.projectionAgentId };
}

test("Peer presence follows proven connections and actual Run state without Device presence", async t => {
  const f = await presenceFixture(t), pending = f.open();
  f.source.refresh(now);
  assert.equal(f.core.getAgent(f.id)?.presence, "offline");
  assert.deepEqual(f.changes, []);
  pending.receive(authenticate(pending.challenge(now).payload as PeerRuntimeChallenge), now);
  assert.equal(f.core.getAgent(f.id)?.presence, "ready");
  assert.equal(f.presenceApi.listAgents(f.actor, teamId, now)[0]?.presence, "ready");
  f.source.refresh(now);
  assert.deepEqual(f.changes, [teamId], "unchanged state emitted a change");
  f.runs.applyEvent(f.run.runId, { type: "status", sequence: 1, status: "delivered" }, now);
  f.runs.applyEvent(f.run.runId, { type: "status", sequence: 2, status: "working" }, now);
  f.source.refresh(now);
  assert.equal(f.core.getAgent(f.id)?.presence, "busy");
  f.runs.applyEvent(f.run.runId, { type: "status", sequence: 3, status: "completed" }, now);
  f.source.refresh(now);
  assert.equal(f.core.getAgent(f.id)?.presence, "ready");
  const replacement = f.connect();
  pending.close();
  assert.equal(f.source.getAvailability(f.id, now), "ready", "old close hid the replacement");
  replacement.close();
  assert.equal(f.core.getAgent(f.id)?.presence, "offline");
  assert.equal(f.core.listDevices(teamId).length, 0);
});

test("Peer liveness cannot restore changed, revoked, removed or expired bilateral authority", async t => {
  for (const boundary of ["export", "acceptance", "membership", "room", "agent", "expiry", "heartbeat"] as const) {
    await t.test(boundary, async t => {
      const f = await presenceFixture(t);
      f.connect();
      assert.equal(f.source.getAvailability(f.id, now), "ready");
      let time = now;
      if (boundary === "export") {
        const changed = { ...f.offer, grant: { ...f.offer.grant, revision: 2 } };
        f.service.offer(f.token, f.signed(changed), now);
      }
      if (boundary === "acceptance") f.grants.recordAcceptance({ ...f.accepted.acceptance, revision: 2, state: "revoked" }, ownerMember, now);
      if (boundary === "membership") f.store.revokeMembership(f.membership.membershipId, now);
      if (boundary === "room") f.database.prepare("DELETE FROM room_human_participants WHERE room_id = ? AND member_id = ?").run(roomId, f.membership.memberId);
      if (boundary === "agent") f.database.prepare("DELETE FROM room_agent_participants WHERE room_id = ? AND agent_id = ?").run(roomId, f.id);
      if (boundary === "expiry") time = f.accepted.acceptance.expiresAt;
      if (boundary === "heartbeat") time = at(20);
      assert.equal(f.source.getAvailability(f.id, time), "offline");
      f.source.refresh(time);
      assert.equal(f.core.getAgent(f.id)?.presence, "offline");
      assert.equal(f.source.getAvailability("agent_unknownpresence001", now), "offline");
    });
  }
});

test("HTTP Agent lists use native Peer presence and server restart clears persisted liveness", async t => {
  const f = await executionFixture(t), id = f.accepted.projection.projectionAgentId;
  const options = { databasePath: f.databasePath, clock: () => now,
    webAuth: { mode: "trusted-team" as const, publicOrigin: f.identity.browserOrigin, ownerRecoveryToken: "peer-fixture-owner-recovery-0123456789" } };
  const app = await createServerApp(options);
  f.resources.defer(() => app.close());
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(address.replace("http:", "ws:") + "/ws/peer/runtime", { headers: { authorization: `Bearer ${f.token}` } });
  t.after(() => socket.terminate());
  const [bytes] = await once(socket, "message", { signal: AbortSignal.timeout(3000) });
  const challenge = JSON.parse(bytes.toString()).payload as PeerRuntimeChallenge;
  const ready = once(socket, "message", { signal: AbortSignal.timeout(3000) });
  socket.send(authenticate(challenge), { binary: false });
  assert.equal(JSON.parse((await ready)[0].toString()).type, "peer.runtime.ready");
  const list = () => app.inject({ method: "GET", url: `/api/teams/${teamId}/agents`,
    headers: { cookie: `__Host-agentroom_session=${f.ownerSession.secret}` } });
  const response = await list();
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().find((a: { agentId: string }) => a.agentId === id).presence, "ready");
  socket.terminate();
  await app.close();
  f.core.updateAgentPresence(id, "ready", now); // Retained observation from an unclean old process.
  const restarted = await createServerApp(options);
  f.resources.defer(() => restarted.close());
  await restarted.ready();
  assert.equal(f.core.getAgent(id)?.presence, "offline");
});

test("a failed presence observer cannot leave an authenticated socket open", async t => {
  const f = await executionFixture(t);
  const sessions = new PeerRuntimeSessions(f.admission, f.identity, () => { throw new Error("projection unavailable"); });
  f.resources.defer(() => sessions.close());
  let closed = false;
  const session = sessions.open(f.token, { send() {}, close() { closed = true; } }, now);
  assert.throws(() => session.receive(authenticate(session.challenge(now).payload as PeerRuntimeChallenge), now), /projection unavailable/u);
  assert.equal(closed, true);
  assert.equal(sessions.get(f.membership.peerId, now), undefined);
});
