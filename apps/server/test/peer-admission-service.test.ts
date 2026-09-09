import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import test, { type TestContext } from "node:test";
import type { PeerInvitationClaim, PeerInvitationCreateRequest, PeerProofPayload } from "@convene-wire/contracts/peer";
import { peerDigest, peerProofTranscript } from "@convene-wire/contracts/peer-proof";
import { peerClaimDigest } from "../src/data/peer-membership-repository.js";
import { AuthService, AuthorizationError } from "../src/security/auth-service.js";
import { AuthorityService } from "../src/security/authority-service.js";
import { PeerAdmissionService, peerJoinReceiptDigest, peerHumanReceiptDigest } from "../src/security/peer-admission-service.js";
import { verifyPeerProof } from "../src/security/peer-proof-verifier.js";
import { fixture, now, expiry, ownerId, teamId, roomId, otherRoomId, secret, denied } from "./helpers/peer-fixture.js";

export const participantKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 9)]), format: "der", type: "pkcs8" });
export const participant = { nodeId: "node_participant001", publicKey: createPublicKey(participantKey).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url") };
const create: PeerInvitationCreateRequest = { schemaVersion: 1, operationId: "op_createinvite001", scope: { kind: "room", teamId, roomId }, expiresAt: "2026-09-10T03:00:00.000Z", membershipExpiresAt: expiry };

async function admission(t: TestContext) {
  const f = await fixture(t);
  const auth = new AuthService(f.database, () => now), owner = auth.issueWebSession(ownerId, now, expiry);
  const actor = auth.authenticateWebSession(owner.secret, now);
  const service = new PeerAdmissionService(f.database, auth, f.identity);
  const issued = service.createInvitation(actor, create, now);
  const intent: Omit<PeerInvitationClaim, "challengeId" | "proof"> = { schemaVersion: 1,
    invitationId: issued.invitation.invitationId, invitationDigest: peerDigest(issued.invitation), secret: issued.secret,
    operationId: "op_claiminvite001", participant, localUserId: ownerId, displayName: "Shared name" };
  const claim = (at = now, change = {}) => {
    const pending = { ...intent, ...change };
    const digest = peerClaimDigest(pending as PeerInvitationClaim);
    const challenge = service.challenge({ schemaVersion: 1, invitationId: pending.invitationId, secret: pending.secret,
      participant: pending.participant, operationId: pending.operationId, subjectDigest: digest }, at);
    const payload: PeerProofPayload = { schemaVersion: 1, purpose: "invitation.claim",
      signerNodeId: participant.nodeId, signerPublicKey: participant.publicKey, audienceNodeId: f.identity.nodeId,
      operationId: pending.operationId, nonce: challenge.nonce, subjectDigest: digest, issuedAt: at,
      expiresAt: new Date(Date.parse(at) + 30_000).toISOString() };
    return { ...pending, challengeId: challenge.challengeId, proof: { payload,
      signature: sign(null, peerProofTranscript(payload), participantKey).toString("base64url") } };
  };
  return { ...f, auth, actor, owner, service, issued, intent, claim };
}

test("Peer preview and claim sign exact Host/Participant pins and independently issue human and machine secrets", async t => {
  const f = await admission(t);
  const nonce = secret();
  const preview = f.service.preview({ schemaVersion: 1, invitationId: f.intent.invitationId, secret: f.intent.secret,
    participant, operationId: f.intent.operationId, nonce }, now);
  assert.deepEqual(preview.invitation, f.issued.invitation);
  verifyPeerProof(preview.proof, preview.invitation.host, { purpose: "invitation.preview", audienceNodeId: participant.nodeId,
    operationId: f.intent.operationId, nonce, subjectDigest: peerDigest(preview.invitation) }, now);
  const claim = f.claim(), joined = f.service.claim(claim, now), m = joined.runtime.membership;
  assert.notEqual(m.userId, ownerId);
  assert.equal(m.localUserId, ownerId);
  assert.deepEqual(m.scope, create.scope);
  assert.notEqual(joined.human.humanCredential.token, joined.runtime.machineCredential.token);
  const expected = { purpose: "invitation.claim" as const, audienceNodeId: participant.nodeId,
    operationId: claim.operationId, nonce: claim.proof.payload.nonce };
  verifyPeerProof(joined.runtime.proof, f.issued.invitation.host, { ...expected, subjectDigest: peerJoinReceiptDigest(joined.runtime) }, now);
  verifyPeerProof(joined.human.proof, f.issued.invitation.host, { ...expected, subjectDigest: peerHumanReceiptDigest(joined.human) }, now);
  const machine = f.service.authenticateMachine(joined.runtime.machineCredential.token, now);
  assert.equal(machine.audience, "peer.runtime");
  assert.equal(machine.memberId, m.memberId);
  assert.throws(() => f.service.authenticateMachine(joined.human.humanCredential.token, now), denied("UNAUTHENTICATED"));
  assert.throws(() => f.service.authenticateMachine(f.owner.secret, now), denied("UNAUTHENTICATED"));
  assert.throws(() => f.auth.authenticateWebSession(joined.runtime.machineCredential.token, now), error => error instanceof AuthorizationError);
  assert.throws(() => f.auth.authenticateWebSession(joined.human.humanCredential.token, now), error => error instanceof AuthorizationError);
  for (const table of ["peer_invitations", "peer_credentials", "peer_human_bindings", "peer_claim_challenges"]) {
    const rows = JSON.stringify(f.database.prepare(`SELECT * FROM ${table}`).all());
    for (const token of [f.issued.secret, joined.runtime.machineCredential.token, joined.human.humanCredential.token]) assert.equal(rows.includes(token), false, table);
  }
  assert.deepEqual(f.database.pragma("foreign_key_check"), []);
});

test("Peer exact retries survive response loss and reopen without duplicate membership or credential renewal", async t => {
  const f = await admission(t);
  assert.deepEqual(f.service.createInvitation(f.actor, create, now), f.issued);
  assert.throws(() => f.service.createInvitation(f.actor, { ...create, scope: { kind: "room", teamId, roomId: otherRoomId } }, now), denied("PAYLOAD_CONFLICT"));
  const original = f.claim(), first = f.service.claim(original, now);
  assert.throws(() => f.service.claim(original, now), denied("STALE_AUTHORIZATION"));
  const later = "2026-09-10T04:00:00.000Z", retry = f.claim(later);
  const reopened = f.reopen();
  const auth = new AuthService(reopened.database, () => later);
  const restored = new PeerAdmissionService(reopened.database, auth, new AuthorityService(reopened.database, f.identity.browserOrigin));
  const second = restored.claim(retry, later);
  assert.deepEqual(second.runtime.membership, first.runtime.membership);
  assert.deepEqual(second.runtime.machineCredential, first.runtime.machineCredential);
  assert.deepEqual(second.human.humanCredential, first.human.humanCredential);
  assert.notEqual(second.runtime.proof.signature, first.runtime.proof.signature);
  assert.equal((reopened.database.prepare("SELECT count(*) AS n FROM peer_memberships").get() as { n: number }).n, 1);
  assert.equal((reopened.database.prepare("SELECT count(*) AS n FROM peer_human_bindings").get() as { n: number }).n, 1);
  reopened.store.revokeMembership(first.runtime.membership.membershipId, later);
  assert.throws(() => restored.authenticateMachine(first.runtime.machineCredential.token, later), denied("UNAUTHENTICATED"));
  assert.throws(() => restored.challenge({ schemaVersion: 1, invitationId: retry.invitationId, secret: retry.secret,
    participant, operationId: retry.operationId, subjectDigest: peerClaimDigest(retry) }, later), denied("REVOKED"));
});

test("Peer wrong proof, key, audience, nonce, expired challenge and changed intent fail before side effects", async t => {
  const f = await admission(t);
  const claim = f.claim();
  for (const field of ["purpose", "signerNodeId", "signerPublicKey", "audienceNodeId", "operationId", "nonce", "subjectDigest"] as const) {
    const changed = structuredClone(claim);
    const replacements = { purpose: "peer.connect", signerNodeId: "node_different001", signerPublicKey: "A".repeat(43),
      audienceNodeId: "node_different001", operationId: "op_different001", nonce: secret(), subjectDigest: "a".repeat(64) };
    Object.assign(changed.proof.payload, { [field]: replacements[field] });
    // A valid signature over the wrong context is still denied.
    changed.proof.signature = sign(null, peerProofTranscript(changed.proof.payload), participantKey).toString("base64url");
    assert.throws(() => f.service.claim(changed, now), denied("UNAUTHENTICATED"), field);
  }
  assert.throws(() => f.service.claim({ ...claim, proof: { ...claim.proof, signature: "A".repeat(86) } }, now), denied("UNAUTHENTICATED"));
  assert.throws(() => f.service.claim({ ...claim, displayName: "Changed name" }, now), denied("PAYLOAD_CONFLICT"));
  assert.throws(() => f.service.claim({ ...claim, secret: secret() }, now), denied("UNAUTHENTICATED"));
  assert.throws(() => f.service.claim(claim, "2026-09-10T02:00:30.000Z"), denied("STALE_AUTHORIZATION"));
  assert.equal((f.database.prepare("SELECT count(*) AS n FROM peer_memberships").get() as { n: number }).n, 0);
  assert.equal((f.database.prepare("SELECT consumed_at FROM peer_claim_challenges WHERE challenge_id = ?").get(claim.challengeId) as { consumed_at: null }).consumed_at, null);
  f.service.claim(claim, now);
  assert.throws(() => f.claim(now, { displayName: "Changed name" }), denied("PAYLOAD_CONFLICT"));
});

test("Peer claim rolls back invitation, new Member, credentials and nonce when receipt persistence fails", async t => {
  const f = await admission(t), claim = f.claim();
  f.database.exec("CREATE TRIGGER fail_peer_human_insert BEFORE INSERT ON peer_human_bindings BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END");
  assert.throws(() => f.service.claim(claim, now), /fixture storage failure/u);
  assert.equal((f.database.prepare("SELECT count(*) AS n FROM peer_memberships").get() as { n: number }).n, 0);
  assert.equal(f.store.getInvitation(claim.invitationId)?.state, "open");
  f.database.exec("DROP TRIGGER fail_peer_human_insert");
  assert.ok(f.service.claim(claim, now));
});

test("Peer invitation cannot survive Host origin change or revoked independent human binding", async t => {
  const f = await admission(t), claim = f.claim();
  const moved = new PeerAdmissionService(f.database, f.auth, f.identity, "https://moved.example.test");
  assert.throws(() => moved.claim(claim, now), denied("SCOPE_DENIED"));
  const joined = f.service.claim(claim, now);
  f.database.prepare("UPDATE peer_human_bindings SET revoked_at = ? WHERE membership_id = ?").run(now, joined.runtime.membership.membershipId);
  assert.throws(() => f.service.claim(f.claim(), now), denied("REVOKED"));
  assert.throws(() => f.database.exec("UPDATE peer_human_bindings SET revoked_at = NULL"), /regain/u);
  f.service.revokeInvitation(f.actor, claim.invitationId, now);
  assert.throws(() => f.service.createInvitation(f.actor, create, now), denied("REVOKED"));
});
