import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import WebSocket from "ws";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { joinRelayNodes, relayRuntimeFixture, untilRelay } from "./helpers/relay-runtime-fixture.js";

test("real Relay issues a Node certificate through HTTP01 and verifies its public identity without exposing Owner", {timeout: 180000}, async t => {
  const f = await relayRuntimeFixture(t), host = await f.node("Host");
  assert.equal(host.runtime.status().state, "connecting");
  host.runtime.start();
  await untilRelay(() => host.runtime.status().state === "ready", "Node did not become ready: " + JSON.stringify(host.runtime.status()), 20000);
  assert.equal(f.ca.counters.certificates, 1);
  const publicStatus = await host.request("/api/auth/status");
  assert.equal(publicStatus.status, 200, publicStatus.body); assert.equal(publicStatus.json().peerOnly, true);
  for (const endpoint of ["/api/local-node/relay", "/api/local-node/control/state", "/api/local-node/network", "/api/bootstrap", "/api/peer/invitations"]) {
    assert.equal((await host.request(endpoint)).status, 403, endpoint);
  }
  assert.equal((await host.request("/api/auth/status", {headers: {authorization: host.ownerHeaders.authorization}})).status, 403);
  const participant = await f.node("Participant"); participant.runtime.start();
  await untilRelay(() => participant.runtime.status().state === "ready", "Participant did not become ready");
  assert.notEqual(host.origin, participant.origin); assert.equal(f.ca.counters.certificates, 2);
  const {joined, browser} = await joinRelayNodes(host, participant, f.ca.now);
  const claim = await host.request("/api/peer/browser-entry/claim", {method: "POST", payload: browser, headers: {origin: host.origin}});
  assert.equal(claim.status, 200, claim.body);
  const setCookie = claim.headers["set-cookie"]![0]!;
  assert.match(setCookie, /^__Host-agentroom_session=/u); assert.match(setCookie, /Path=\//u);
  assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict/u); assert.doesNotMatch(setCookie, /domain=/iu);
  const cookie = setCookie.split(";", 1)[0]!;
  assert.equal((await host.request(`/api/rooms/${host.room.roomId}/messages`, {headers: {cookie}})).status, 200);
  assert.equal((await host.request(`/api/rooms/${host.otherRoom.roomId}/messages`, {headers: {cookie}})).status, 403);
  assert.equal((await host.request(`/api/rooms/${host.room.roomId}/messages`, {method: "POST", headers: {cookie, origin: participant.origin}, payload: {content: "Sibling origin forgery"}})).status, 403);
  assert.notEqual((await participant.request("/api/auth/session", {headers: {cookie}})).status, 200);
  const socket = new WebSocket(host.origin.replace("https:", "wss:") + "/ws/peer/runtime", {agent: f.ca.agent,
    headers: {authorization: `Bearer ${joined.runtime.machineCredential.token}`}});
  t.after(() => socket.terminate());
  const nextFrame = async () => JSON.parse((await once(socket, "message", {signal: AbortSignal.timeout(5000)}))[0].toString());
  const challenge = await nextFrame(), binding = challenge.payload.binding;
  assert.equal(challenge.type, "peer.runtime.challenge"); assert.equal(binding.hostOrigin, host.origin);
  const ready = nextFrame();
  socket.send(JSON.stringify({protocolVersion: "peer.v1", type: "peer.runtime.authenticate", messageId: "msg_relayruntime001", timestamp: new Date(f.ca.now).toISOString(),
    payload: {schemaVersion: 1, bindingDigest: peerDigest(binding), proof: participant.proof(host.identity.nodeId, "peer.connect", binding.operationId,
      challenge.payload.nonce, peerDigest({phase: "authenticate", binding}))}}));
  assert.equal((await ready).type, "peer.runtime.ready");
  const closed = once(socket, "close", {signal: AbortSignal.timeout(5000)});
  await f.stop(); await closed;
  await untilRelay(() => host.runtime.status().state !== "ready", "Disconnect retained stale readiness");
  const local = await host.app.inject({url: "/api/local-node/relay", headers: host.ownerHeaders});
  assert.equal(local.statusCode, 200); assert.notEqual(local.json().running.state, "ready");
  assert.equal((await host.app.inject({url: "/api/teams", headers: host.ownerHeaders})).statusCode, 200);
  await f.start();
  await untilRelay(() => host.runtime.status().state === "ready", "Node did not reconnect");
  assert.equal(f.ca.counters.certificates, 2, "reconnect must reuse the certificate");
  assert.equal((await host.request(`/api/rooms/${host.room.roomId}/messages`, {headers: {cookie}})).status, 200);
  const revoked = await host.app.inject({method: "DELETE", url: `/api/peer/memberships/${joined.runtime.membership.membershipId}`, headers: host.ownerHeaders});
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.notEqual((await host.request(`/api/rooms/${host.room.roomId}/messages`, {headers: {cookie}})).status, 200);
  await host.app.close();
  assert.equal(host.runtime.status().state, "disabled");
  await assert.rejects(host.request("/api/auth/status"));
});
