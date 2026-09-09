import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import WebSocket from "ws";
import type { PeerRuntimeChallenge, PeerRuntimeMessage } from "@convene-wire/contracts/peer";
import { decodePeer } from "@convene-wire/contracts/peer-validation";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { verifyPeerProof } from "../src/security/peer-proof-verifier.js";
import { nativePeerIngressFixture } from "./helpers/native-peer-ingress-fixture.js";

const nextFrame = async (socket: WebSocket) => {
  const [bytes, binary] = await once(socket, "message", { signal: AbortSignal.timeout(3000) });
  assert.equal(binary, false);
  return decodePeer("PeerRuntimeMessage", bytes) as PeerRuntimeMessage;
};

test("real native Peer ingress authenticates a separate Runtime and drains its upgraded socket", async t => {
  const f = await nativePeerIngressFixture(t), { joined } = await f.join();
  const socket = new WebSocket(f.origin.replace("https:", "wss:") + "/ws/peer/runtime", {
    ca: f.cert, headers: { authorization: `Bearer ${joined.runtime.machineCredential.token}` }
  });
  t.after(() => socket.terminate());
  const initial = await nextFrame(socket);
  assert.equal(initial.type, "peer.runtime.challenge");
  const challenge = initial.payload as PeerRuntimeChallenge, binding = challenge.binding;
  assert.equal(binding.hostOrigin, f.origin);
  assert.equal(binding.memberId, joined.runtime.membership.memberId);
  const expected = { purpose: "peer.connect" as const, audienceNodeId: binding.participant.nodeId,
    operationId: binding.operationId, nonce: challenge.nonce };
  verifyPeerProof(challenge.proof, joined.runtime.invitation.host,
    { ...expected, subjectDigest: peerDigest({ phase: "challenge", binding }) }, f.now);
  const ready = nextFrame(socket);
  socket.send(JSON.stringify({ protocolVersion: "peer.v1", messageId: "msg_nativeruntime001", timestamp: f.now,
    type: "peer.runtime.authenticate", payload: { schemaVersion: 1, bindingDigest: peerDigest(binding),
      proof: f.proof("peer.connect", binding.operationId, challenge.nonce, peerDigest({ phase: "authenticate", binding })) } }));
  const received = await ready;
  assert.equal(received.type, "peer.runtime.ready");
  verifyPeerProof(received.payload.proof!, joined.runtime.invitation.host,
    { ...expected, subjectDigest: peerDigest({ phase: "ready", binding }) }, f.now);
  const ack = nextFrame(socket);
  socket.send(JSON.stringify({ protocolVersion: "peer.v1", messageId: "msg_nativeheartbeat001", timestamp: f.now,
    type: "peer.runtime.heartbeat", payload: { schemaVersion: 1, bindingDigest: peerDigest(binding), sequence: 1 } }));
  assert.equal((await ack).type, "peer.runtime.acknowledged");
  const closed = once(socket, "close", { signal: AbortSignal.timeout(3000) });
  await f.app.close();
  await closed;
  await assert.rejects(f.request("/api/auth/status"));
});

test("native Runtime upgrade denies browser, human, Owner and Device credential reuse", async t => {
  const f = await nativePeerIngressFixture(t), { joined } = await f.join();
  const upgrade = { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" };
  for (const [headers, expected] of [
    [{ authorization: `Bearer ${f.owner.session.token}` }, 401],
    [{ authorization: `Bearer ${joined.human.humanCredential.token}` }, 401],
    [{ authorization: `Bearer ${joined.runtime.machineCredential.token}`, origin: f.origin }, 403],
    [{ authorization: `Bearer ${joined.runtime.machineCredential.token}`, cookie: "human=arbitrary" }, 403],
    [{ authorization: `Bearer ${joined.runtime.machineCredential.token}`, "x-agentroom-server-token": "device-control" }, 403]
  ] as const) {
    const result = await f.request("/ws/peer/runtime", { headers: { ...upgrade, ...headers } });
    assert.equal(result.status, expected, result.body);
  }
  const socket = new WebSocket(f.origin.replace("https:", "wss:") + "/ws/peer/runtime", {
    ca: f.cert, headers: { authorization: `Bearer ${joined.runtime.machineCredential.token}` }
  });
  t.after(() => socket.terminate());
  await nextFrame(socket);
  const closed = once(socket, "close", { signal: AbortSignal.timeout(3000) });
  socket.send(Buffer.from("{}"));
  await closed;
});
