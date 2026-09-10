import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import test from "node:test";
import type { PeerInvitationClaim, PeerProofPayload } from "@convene-wire/contracts/peer";
import { peerDigest, peerProofTranscript } from "@convene-wire/contracts/peer-proof";
import { createServerApp } from "../src/app.js";
import { verifyPeerProof } from "../src/security/peer-proof-verifier.js";
import { AuthService } from "../src/security/auth-service.js";
import { peerClaimDigest } from "../src/data/peer-membership-repository.js";
import { fixture, now, expiry, ownerId, teamId, roomId, secret } from "./helpers/peer-fixture.js";

test("Peer HTTP admission isolates strict wire decoding, cookies, Device tokens and pinned proof receipts", async t => {
  const f = await fixture(t), origin = f.identity.browserOrigin;
  const auth = new AuthService(f.database, () => now), owner = auth.issueWebSession(ownerId, now, expiry);
  const app = await createServerApp({ databasePath: f.databasePath, clock: () => now,
    webAuth: { mode: "trusted-team", publicOrigin: origin, ownerRecoveryToken: "peer-fixture-owner-recovery-0123456789" } });
  f.resources.defer(() => app.close());
  const ownerHeaders = { origin, cookie: `__Host-agentroom_session=${owner.secret}` };
  const request = { schemaVersion: 1, operationId: "op_httpcreate0001", scope: { kind: "room", teamId, roomId },
    expiresAt: "2026-09-10T03:00:00.000Z", membershipExpiresAt: expiry };
  const post = (url: string, payload: unknown, headers = {}) => app.inject({ method: "POST", url,
    headers: { "content-type": "application/json", ...headers }, payload: typeof payload === "string" ? payload : JSON.stringify(payload) });
  const missingOwner = await post("/api/peer/invitations", request);
  assert.equal(missingOwner.statusCode, 401);
  assert.equal((await post("/api/peer/invitations", request, { ...ownerHeaders, origin: "https://wrong.example.test" })).statusCode, 403);
  for (const raw of [
    JSON.stringify(request).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    JSON.stringify(request).replace('"schemaVersion":1', '"schemaVersion":1.0000000000000001'),
    JSON.stringify({ ...request, deviceId: "device_fallback001" })
  ]) {
    const invalid = await post("/api/peer/invitations", raw, ownerHeaders);
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.deepEqual(invalid.json(), { code: "INVALID_MESSAGE" });
  }
  const created = await post("/api/peer/invitations", request, ownerHeaders);
  assert.equal(created.statusCode, 200, created.body);
  assert.match(String(created.headers["cache-control"]), /no-store/u);
  const issued = created.json();
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 11)]), format: "der", type: "pkcs8" });
  const participant = { nodeId: "node_httpclient001", publicKey: createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url") };
  const identityNonce = secret();
  const identityResponse = await post("/api/peer/identity", { schemaVersion: 1, participant, operationId: "op_identity0001", nonce: identityNonce });
  assert.equal(identityResponse.statusCode, 200, identityResponse.body);
  const identity = identityResponse.json();
  verifyPeerProof(identity.proof, issued.invitation.host, { purpose: "node.identity", audienceNodeId: participant.nodeId,
    operationId: "op_identity0001", nonce: identityNonce, subjectDigest: peerDigest({ host: identity.host, hostOrigin: identity.hostOrigin }) }, now);
  assert.equal(identityResponse.body.includes(teamId), false);
  assert.equal(identityResponse.body.includes(ownerId), false);
  const preview = { schemaVersion: 1, invitationId: issued.invitation.invitationId, secret: issued.secret, participant,
    operationId: "op_httpclaim0001", nonce: secret() };
  for (const headers of [{ origin }, { authorization: `Bearer ${owner.secret}` }, { cookie: ownerHeaders.cookie }, { "x-forwarded-proto": "http" }]) {
    assert.equal((await post("/api/peer/invitations/preview", preview, headers)).statusCode, 403);
  }
  assert.equal((await post("/api/peer/invitations/preview", preview)).statusCode, 200);
  const wrong = await post("/api/peer/invitations/preview", { ...preview, secret: secret() });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.body.includes(issued.secret), false);
  const intent = { schemaVersion: 1, invitationId: preview.invitationId, invitationDigest: peerDigest(issued.invitation),
    secret: issued.secret, participant, operationId: preview.operationId, localUserId: ownerId, displayName: "Shared name" };
  const digest = peerClaimDigest(intent as PeerInvitationClaim);
  const challengeResponse = await post("/api/peer/invitations/challenge", { schemaVersion: 1, invitationId: preview.invitationId,
    secret: issued.secret, participant, operationId: preview.operationId, subjectDigest: digest });
  assert.equal(challengeResponse.statusCode, 200, challengeResponse.body);
  const challenge = challengeResponse.json();
  const payload: PeerProofPayload = { schemaVersion: 1, purpose: "invitation.claim", signerNodeId: participant.nodeId,
    signerPublicKey: participant.publicKey, audienceNodeId: issued.invitation.host.nodeId, operationId: intent.operationId,
    nonce: challenge.nonce, subjectDigest: digest, issuedAt: now, expiresAt: challenge.expiresAt };
  const claim = { ...intent, challengeId: challenge.challengeId, proof: { payload, signature: sign(null, peerProofTranscript(payload), key).toString("base64url") } };
  const claimed = await post("/api/peer/invitations/claim", claim);
  assert.equal(claimed.statusCode, 200, claimed.body);
  const joined = claimed.json();
  assert.equal(joined.runtime.humanCredential, undefined);
  assert.equal(joined.runtime.machineCredential.audience, "peer.runtime");
  assert.equal(joined.human.humanCredential.audience, "peer.human-binding");
  assert.equal((await post("/api/peer/invitations/claim", claim)).statusCode, 409);
  for (const token of [joined.runtime.machineCredential.token, joined.human.humanCredential.token]) {
    assert.equal((await app.inject({ url: "/api/auth/session", headers: { cookie: `__Host-agentroom_session=${token}` } })).statusCode, 401);
    assert.equal((await post("/api/bridge/authority-proof", { nonce: secret() }, { authorization: `Bearer ${token}` })).statusCode, 401);
  }
  const leaveIntent = { schemaVersion: 1, operationId: "op_httpleave0001", host: issued.invitation.host,
    hostOrigin: origin, participant, membershipId: joined.runtime.membership.membershipId, peerId: joined.runtime.membership.peerId };
  const leavePayload: PeerProofPayload = { ...payload, purpose: "peer.leave", operationId: leaveIntent.operationId, nonce: secret(), subjectDigest: peerDigest(leaveIntent) };
  const leave = { schemaVersion: 1, intent: leaveIntent, proof: { payload: leavePayload, signature: sign(null, peerProofTranscript(leavePayload), key).toString("base64url") } };
  for (const headers of [{ origin }, { cookie: ownerHeaders.cookie }, { authorization: `Bearer ${joined.runtime.machineCredential.token}` }]) {
    assert.equal((await post("/api/peer/memberships/leave", leave, headers)).statusCode, 403);
  }
  assert.equal((await post("/api/peer/memberships/leave?memberId=foreign", leave)).statusCode, 403);
  assert.equal((await post("/api/peer/memberships/leave", { ...leave, token: joined.human.humanCredential.token })).statusCode, 400);
  const departed = await post("/api/peer/memberships/leave", leave);
  assert.equal(departed.statusCode, 200, departed.body);
  assert.equal(departed.json().state, "revoked");
  assert.deepEqual(Object.keys(departed.json()).sort(), ["intent", "proof", "recordedAt", "schemaVersion", "state"]);
  const revoked = await app.inject({ method: "DELETE", url: `/api/peer/memberships/${joined.runtime.membership.membershipId}`, headers: ownerHeaders });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal((await post("/api/peer/invitations/preview", preview)).statusCode, 410);
});
