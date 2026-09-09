import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  PeerChallenge, PeerClaimChallengeRequest, PeerHumanBindingCredential, PeerHumanBindingReceipt,
  PeerInvitationClaim, PeerInvitationCreateRequest, PeerInvitationIssued, PeerInvitationPreview,
  PeerInvitationPreviewRequest, PeerJoined, PeerJoinReceipt, PeerMachineCredential, PeerMembership, PeerScope,
  PeerIdentityRequest, PeerIdentityProof
} from "@convene-wire/contracts/peer";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { CoreRepository } from "../data/core-repository.js";
import { PeerMembershipRepository, PeerStoreError, peerClaimDigest, peerSecretHash } from "../data/peer-membership-repository.js";
import { createOpaqueId } from "../domain/identifiers.js";
import type { AuthService, MemberPrincipal, WebPrincipal } from "./auth-service.js";
import type { AuthorityService } from "./authority-service.js";
import { assertPeerOrigin, verifyPeerProof } from "./peer-proof-verifier.js";

export interface PeerPrincipal {
  audience: "peer.runtime";
  credentialId: string;
  peerId: string;
  membershipId: string;
  hostNodeId: string;
  participantNodeId: string;
  participantPublicKey: string;
  localUserId: string;
  memberId: string;
  scope: PeerScope;
}
interface ClaimChallengeRow {
  invitation_id: string; operation_id: string; participant_node_id: string; participant_public_key: string;
  subject_digest: string; nonce: string; expires_at: string; consumed_at: string | null;
}
export const peerJoinReceiptDigest = (receipt: Omit<PeerJoinReceipt, "schemaVersion" | "proof">) => peerDigest({
  invitationDigest: peerDigest(receipt.invitation), membership: receipt.membership, machineCredential: receipt.machineCredential
});
export const peerHumanReceiptDigest = (receipt: Omit<PeerHumanBindingReceipt, "schemaVersion" | "proof">) => peerDigest({
  host: receipt.host, participant: receipt.participant, localUserId: receipt.localUserId,
  joinReceiptDigest: receipt.joinReceiptDigest, humanCredential: receipt.humanCredential
});

/** Separate Peer admission; no Device credentials, names or arbitrary local User IDs select a Host member. */
export class PeerAdmissionService {
  private readonly memberships: PeerMembershipRepository;
  private readonly core: CoreRepository;
  public constructor(private readonly database: Database.Database, private readonly auth: AuthService,
    private readonly authority: AuthorityService, private readonly origin = authority.browserOrigin) {
    this.memberships = new PeerMembershipRepository(database);
    this.core = new CoreRepository(database);
  }

  public createInvitation(actor: WebPrincipal, input: PeerInvitationCreateRequest, now: string): PeerInvitationIssued {
    this.assert("PeerInvitationCreateRequest", input);
    assertPeerOrigin(this.origin);
    const owner = this.requireOwner(actor, input.scope.teamId);
    const intent = peerDigest({ ownerMemberId: owner.memberId, request: input });
    return this.database.transaction(() => {
      const previous = this.database.prepare(`SELECT intent_digest, invitation_id FROM peer_invitation_operations
        WHERE owner_member_id = ? AND operation_id = ?`).get(owner.memberId, input.operationId) as
        { intent_digest: string; invitation_id: string } | undefined;
      const secret = this.authority.peerSecret("invitation", intent);
      if (previous) {
        if (previous.intent_digest !== intent) throw new PeerStoreError("PAYLOAD_CONFLICT");
        const { invitation } = this.memberships.requireInvitationSecret(previous.invitation_id, secret, now);
        return { schemaVersion: 1, invitation, secret };
      }
      const team = this.core.getTeam(input.scope.teamId)!;
      const room = input.scope.roomId ? this.core.getRoom(input.scope.roomId) : undefined;
      const invitation = { schemaVersion: 1 as const, invitationId: createOpaqueId("peerinvite"),
        host: { nodeId: this.authority.nodeId, publicKey: this.authority.publicKey }, hostOrigin: this.origin,
        scope: input.scope, teamLabel: team.name, roomLabel: room?.name ?? null,
        expiresAt: input.expiresAt, membershipExpiresAt: input.membershipExpiresAt };
      this.memberships.createInvitation(invitation, owner.memberId, peerSecretHash(secret), now);
      this.database.prepare(`INSERT INTO peer_invitation_operations (owner_member_id, operation_id, intent_digest, invitation_id)
        VALUES (?, ?, ?, ?)`).run(owner.memberId, input.operationId, intent, invitation.invitationId);
      return { schemaVersion: 1, invitation, secret };
    }).immediate();
  }

  public preview(input: PeerInvitationPreviewRequest, now: string): PeerInvitationPreview {
    this.assert("PeerInvitationPreviewRequest", input);
    const { invitation, digest } = this.memberships.requireInvitationSecret(input.invitationId, input.secret, now);
    this.requirePinnedOrigin(invitation.hostOrigin);
    if (input.participant.nodeId === invitation.host.nodeId) throw new PeerStoreError("SCOPE_DENIED");
    return { schemaVersion: 1, invitation, proof: this.authority.signPeerProof({
      purpose: "invitation.preview", audienceNodeId: input.participant.nodeId,
      operationId: input.operationId, nonce: input.nonce, subjectDigest: digest
    }, now) };
  }

  /** Prove the pinned endpoint before a Participant transmits an invitation secret. */
  public identity(input: PeerIdentityRequest, now: string): PeerIdentityProof {
    this.assert("PeerIdentityRequest", input);
    assertPeerOrigin(this.origin);
    const content = { host: { nodeId: this.authority.nodeId, publicKey: this.authority.publicKey }, hostOrigin: this.origin };
    return { schemaVersion: 1, ...content, proof: this.authority.signPeerProof({
      purpose: "node.identity", audienceNodeId: input.participant.nodeId,
      operationId: input.operationId, nonce: input.nonce, subjectDigest: peerDigest(content)
    }, now) };
  }

  public challenge(input: PeerClaimChallengeRequest, now: string): PeerChallenge {
    this.assert("PeerClaimChallengeRequest", input);
    return this.database.transaction(() => {
      const invitation = this.memberships.requireInvitationSecret(input.invitationId, input.secret, now);
      this.requirePinnedOrigin(invitation.invitation.hostOrigin);
      if (input.participant.nodeId === this.authority.nodeId) throw new PeerStoreError("SCOPE_DENIED");
      if (invitation.claimOperationId && (input.operationId !== invitation.claimOperationId || input.subjectDigest !== invitation.claimDigest)) throw new PeerStoreError("PAYLOAD_CONFLICT");
      this.database.prepare("DELETE FROM peer_claim_challenges WHERE expires_at <= ?").run(now);
      const count = this.database.prepare(`SELECT count(*) AS n FROM peer_claim_challenges
        WHERE invitation_id = ? AND consumed_at IS NULL`).get(input.invitationId) as { n: number };
      if (count.n >= 8) throw new PeerStoreError("STALE_AUTHORIZATION");
      const challenge: PeerChallenge = { schemaVersion: 1, challengeId: createOpaqueId("peerchallenge"),
        hostNodeId: this.authority.nodeId, participantNodeId: input.participant.nodeId,
        nonce: randomBytes(32).toString("base64url"), expiresAt: new Date(Date.parse(now) + 30_000).toISOString() };
      this.database.prepare(`INSERT INTO peer_claim_challenges (challenge_id, invitation_id, operation_id,
        participant_node_id, participant_public_key, subject_digest, nonce, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(challenge.challengeId, input.invitationId, input.operationId, input.participant.nodeId,
          input.participant.publicKey, input.subjectDigest, challenge.nonce, challenge.expiresAt);
      return challenge;
    }).immediate();
  }

  public claim(input: PeerInvitationClaim, now: string): PeerJoined {
    this.assert("PeerInvitationClaim", input);
    const digest = peerClaimDigest(input);
    return this.database.transaction(() => {
      const c = this.database.prepare("SELECT * FROM peer_claim_challenges WHERE challenge_id = ?").get(input.challengeId) as ClaimChallengeRow | undefined;
      if (!c || c.consumed_at || c.expires_at <= now) throw new PeerStoreError("STALE_AUTHORIZATION");
      if (c.invitation_id !== input.invitationId || c.operation_id !== input.operationId || c.subject_digest !== digest ||
          c.participant_node_id !== input.participant.nodeId || c.participant_public_key !== input.participant.publicKey) throw new PeerStoreError("PAYLOAD_CONFLICT");
      verifyPeerProof(input.proof, input.participant, { purpose: "invitation.claim", audienceNodeId: this.authority.nodeId,
        operationId: input.operationId, nonce: c.nonce, subjectDigest: digest }, now);
      const { invitation } = this.memberships.requireInvitationSecret(input.invitationId, input.secret, now);
      this.requirePinnedOrigin(invitation.hostOrigin);
      const machineSecret = this.authority.peerSecret("runtime", digest);
      const machineId = `peercredential_${peerSecretHash(machineSecret).slice(0, 32)}`;
      const membership = this.memberships.claimVerifiedInvitation(input, {
        credentialId: machineId, tokenHash: peerSecretHash(machineSecret), expiresAt: invitation.membershipExpiresAt
      }, now);
      const machineCredential: PeerMachineCredential = { schemaVersion: 1, audience: "peer.runtime",
        credentialId: machineId, peerId: membership.peerId, token: machineSecret, expiresAt: invitation.membershipExpiresAt };
      const runtimeContent = { invitation, membership, machineCredential };
      const proofContext = { purpose: "invitation.claim" as const, audienceNodeId: input.participant.nodeId, operationId: input.operationId, nonce: c.nonce };
      const runtime: PeerJoinReceipt = { schemaVersion: 1, ...runtimeContent,
        proof: this.authority.signPeerProof({ ...proofContext, subjectDigest: peerJoinReceiptDigest(runtimeContent) }, now) };
      const humanCredential = this.humanBinding(membership, digest, now);
      const humanContent = { host: invitation.host, participant: input.participant, localUserId: input.localUserId,
        joinReceiptDigest: runtime.proof.payload.subjectDigest, humanCredential };
      const human: PeerHumanBindingReceipt = { schemaVersion: 1, ...humanContent,
        proof: this.authority.signPeerProof({ ...proofContext, subjectDigest: peerHumanReceiptDigest(humanContent) }, now) };
      this.database.prepare("UPDATE peer_claim_challenges SET consumed_at = ? WHERE challenge_id = ? AND consumed_at IS NULL").run(now, input.challengeId);
      const result: PeerJoined = { schemaVersion: 1, runtime, human };
      this.assert("PeerJoined", result);
      return result;
    }).immediate();
  }

  /** A bearer establishes only the Peer runtime audience; a connection also needs its fresh Node proof. */
  public authenticateMachine(token: string, now: string): PeerPrincipal {
    if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(token)) throw new PeerStoreError("UNAUTHENTICATED");
    const row = this.database.prepare(`SELECT c.credential_id, c.membership_id, b.participant_public_key FROM peer_credentials c
      JOIN peer_memberships p ON p.membership_id = c.membership_id JOIN peer_bindings b ON b.peer_id = p.peer_id
      WHERE c.token_hash = ? AND c.audience = 'peer.runtime' AND c.revoked_at IS NULL AND c.expires_at > ?`)
      .get(peerSecretHash(token), now) as { credential_id: string; membership_id: string; participant_public_key: string } | undefined;
    if (!row) throw new PeerStoreError("UNAUTHENTICATED");
    const m = this.memberships.requireActiveMembership(row.membership_id, now);
    return { audience: "peer.runtime", credentialId: row.credential_id, membershipId: m.membershipId, peerId: m.peerId,
      hostNodeId: m.hostNodeId, participantNodeId: m.participantNodeId, participantPublicKey: row.participant_public_key,
      localUserId: m.localUserId, memberId: m.memberId, scope: m.scope };
  }

  public revokeInvitation(actor: WebPrincipal, invitationId: string, now: string): void {
    const invitation = this.memberships.getInvitation(invitationId);
    if (!invitation) throw new PeerStoreError("SCOPE_DENIED");
    this.requireOwner(actor, invitation.invitation.scope.teamId);
    this.memberships.revokeInvitation(invitationId, now);
  }

  public revokeMembership(actor: WebPrincipal, membershipId: string, now: string): void {
    const membership = this.memberships.getMembership(membershipId);
    if (!membership) throw new PeerStoreError("SCOPE_DENIED");
    this.requireOwner(actor, membership.scope.teamId);
    this.memberships.revokeMembership(membershipId, now);
  }

  private humanBinding(membership: PeerMembership, digest: string, now: string): PeerHumanBindingCredential {
    const token = this.authority.peerSecret("human-binding", digest), tokenHash = peerSecretHash(token);
    const credentialId = `peeraccess_${tokenHash.slice(0, 32)}`;
    const existing = this.database.prepare("SELECT * FROM peer_human_bindings WHERE membership_id = ?").get(membership.membershipId) as
      { credential_id: string; token_hash: string; expires_at: string; revoked_at: string | null } | undefined;
    if (existing) {
      if (existing.revoked_at || existing.expires_at <= now) throw new PeerStoreError("REVOKED");
      if (existing.credential_id !== credentialId || existing.token_hash !== tokenHash || existing.expires_at !== membership.expiresAt) throw new PeerStoreError("PAYLOAD_CONFLICT");
    } else this.database.prepare(`INSERT INTO peer_human_bindings (credential_id, membership_id, token_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)`).run(credentialId, membership.membershipId, tokenHash, now, membership.expiresAt);
    return { schemaVersion: 1, audience: "peer.human-binding", credentialId, membershipId: membership.membershipId,
      scope: membership.scope, token, expiresAt: membership.expiresAt };
  }

  private requireOwner(actor: WebPrincipal, teamId: string): MemberPrincipal {
    this.auth.requireFullWebSession(actor);
    const owner = this.auth.requireTeamMember(actor, teamId);
    if (owner.role !== "owner") throw new PeerStoreError("SCOPE_DENIED");
    return owner;
  }
  private requirePinnedOrigin(origin: string): void {
    assertPeerOrigin(origin);
    if (origin !== this.origin) throw new PeerStoreError("SCOPE_DENIED");
  }
  private assert(kind: string, value: unknown): void {
    if (!validatePeer(kind, value)) throw new PeerStoreError("INVALID_MESSAGE");
  }
}
