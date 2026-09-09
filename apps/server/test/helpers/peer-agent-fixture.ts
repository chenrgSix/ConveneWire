import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import type { PeerAgentOffer, PeerAgentOfferRequest, PeerAgentAcceptanceRequest, PeerProofPayload } from "@convene-wire/contracts/peer";
import { peerDigest, peerProofTranscript } from "@convene-wire/contracts/peer-proof";
import { peerSecretHash } from "../../src/data/peer-membership-repository.js";
import { PeerAuthorizationRepository } from "../../src/data/peer-authorization-repository.js";
import { PeerAgentService } from "../../src/registry/peer-agent-service.js";
import { PeerAdmissionService } from "../../src/security/peer-admission-service.js";
import { AuthService } from "../../src/security/auth-service.js";
import { fixture, now, expiry, ownerId, ownerMember, roomId, secret } from "./peer-fixture.js";

export async function peerAgentFixture(t: Parameters<typeof fixture>[0]) {
  const f = await fixture(t), i = f.invite();
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 19)]), format: "der", type: "pkcs8" });
  i.claim.participant.publicKey = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
  f.store.createInvitation(i.invitation, ownerMember, peerSecretHash(i.inviteSecret), now);
  const membership = f.store.claimVerifiedInvitation(i.claim, i.machine, now);
  const auth = new AuthService(f.database, () => now), ownerSession = auth.issueWebSession(ownerId, now, expiry);
  const actor = auth.authenticateWebSession(ownerSession.secret, now);
  const admission = new PeerAdmissionService(f.database, auth, f.identity);
  const service = new PeerAgentService(f.database, auth, f.identity, admission);
  const offer: PeerAgentOffer = { schemaVersion: 1, displayName: "Participant Writer", role: "Reviewer", grant: {
    schemaVersion: 1, exportId: "export_agentfixture01", revision: 1, state: "active", issuedAt: now, expiresAt: expiry,
    peerId: membership.peerId, teamId: membership.scope.teamId, participantNodeId: membership.participantNodeId,
    authorityNodeId: membership.hostNodeId, localAgentId: "agent_localfixture01", roomIds: [roomId],
    capabilities: { supportsStart: true, supportsStreaming: true, supportsInterrupt: true, supportsResume: false,
      supportsTaskContextIsolation: true, supportsOwnerPrivateOutput: false }
  } };
  const signed = (value = offer, at = now): PeerAgentOfferRequest => {
    const payload: PeerProofPayload = { schemaVersion: 1, purpose: "agent.export", signerNodeId: membership.participantNodeId,
      signerPublicKey: i.claim.participant.publicKey, audienceNodeId: membership.hostNodeId, operationId: "op_agentoffer0001",
      nonce: secret(), subjectDigest: peerDigest(value), issuedAt: at, expiresAt: new Date(Date.parse(at) + 30_000).toISOString() };
    return { schemaVersion: 1, offer: value, proof: { payload, signature: sign(null, peerProofTranscript(payload), key).toString("base64url") } };
  };
  const acceptance = (value = offer): PeerAgentAcceptanceRequest => ({ schemaVersion: 1, operationId: "op_agentaccept001",
    peerId: membership.peerId, localAgentId: value.grant.localAgentId, exportId: value.grant.exportId,
    grantRevision: value.grant.revision, grantDigest: peerDigest(value.grant), offerDigest: peerDigest(value),
    roomIds: value.grant.roomIds, capabilities: value.grant.capabilities, expiresAt: value.grant.expiresAt,
    expectedAcceptanceId: null, expectedAcceptanceRevision: null });
  return { ...f, membership, auth, ownerSession, actor, admission, service, offer, signed, acceptance,
    token: i.machineToken, grants: new PeerAuthorizationRepository(f.database) };
}
