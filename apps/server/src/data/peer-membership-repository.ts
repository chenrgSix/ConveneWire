import { createHash, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import type { PeerError, PeerInvitation, PeerInvitationClaim, PeerMembership, PeerScope } from "@convene-wire/contracts/peer";
import { peerDigest, peerInvitationMaximumSeconds } from "@convene-wire/contracts/peer-proof";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { createOpaqueId } from "../domain/identifiers.js";
import { CoreRepository } from "./core-repository.js";

export class PeerStoreError extends Error {
  public constructor(public readonly code: PeerError["code"]) {
    super(`Peer operation denied: ${code}`);
    this.name = "PeerStoreError";
  }
}

export function peerSecretHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Transport proof/nonce renewal cannot change an already consumed intent. */
export function peerClaimDigest(claim: PeerInvitationClaim): string {
  return peerDigest({
    invitationId: claim.invitationId, invitationDigest: claim.invitationDigest,
    operationId: claim.operationId, participant: claim.participant,
    localUserId: claim.localUserId, displayName: claim.displayName
  });
}

interface InvitationRow {
  invitation_json: string;
  invitation_digest: string;
  secret_hash: string;
  state: "open" | "claimed" | "revoked";
  claim_operation_id: string | null;
  claim_digest: string | null;
  claimed_membership_id: string | null;
  claimed_credential_id: string | null;
}

export interface PeerCredentialVerifier {
  credentialId: string;
  tokenHash: string;
  expiresAt: string;
}

export interface PeerCredentialRecord extends PeerCredentialVerifier {
  membershipId: string;
  audience: "peer.runtime" | "peer.human";
  scope: PeerScope;
  createdAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
}

function timestamp(value: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new PeerStoreError("INVALID_MESSAGE");
  return time;
}

function assertHash(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new PeerStoreError("INVALID_MESSAGE");
}

/** Durable data boundary. Network signature and current nonce checks belong to SEC-019. */
export class PeerMembershipRepository {
  private readonly core: CoreRepository;

  public constructor(private readonly database: Database.Database) {
    this.core = new CoreRepository(database);
  }

  public createInvitation(invitation: PeerInvitation, issuerMemberId: string, secretHash: string, now: string): void {
    if (!validatePeer("PeerInvitation", invitation)) throw new PeerStoreError("INVALID_MESSAGE");
    assertHash(secretHash);
    const time = timestamp(now), expires = timestamp(invitation.expiresAt);
    if (expires <= time || expires - time > peerInvitationMaximumSeconds * 1000 ||
        timestamp(invitation.membershipExpiresAt) < expires) throw new PeerStoreError("INVALID_MESSAGE");
    this.database.transaction(() => {
      const identity = this.database.prepare("SELECT node_id, public_key FROM authority_identity WHERE singleton = 1").get() as { node_id: string; public_key: string };
      if (identity.node_id !== invitation.host.nodeId || identity.public_key !== invitation.host.publicKey) throw new PeerStoreError("SCOPE_DENIED");
      const issuer = this.core.getMember(issuerMemberId);
      if (issuer?.teamId !== invitation.scope.teamId || issuer.role !== "owner") throw new PeerStoreError("SCOPE_DENIED");
      this.assertScope(invitation.scope);
      this.database.prepare(`
        INSERT INTO peer_invitations (invitation_id, invitation_json, invitation_digest, secret_hash, issued_by_member_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(invitation.invitationId, JSON.stringify(invitation), peerDigest(invitation), secretHash, issuerMemberId, now);
    }).immediate();
  }

  public getInvitation(invitationId: string): { invitation: PeerInvitation; digest: string; state: InvitationRow["state"] } | undefined {
    const row = this.invitationRow(invitationId);
    return row && { invitation: JSON.parse(row.invitation_json), digest: row.invitation_digest, state: row.state };
  }

  /** Call only after authenticating the fresh proof over peerClaimDigest. */
  public claimVerifiedInvitation(claim: PeerInvitationClaim, machine: PeerCredentialVerifier, now: string): PeerMembership {
    if (!validatePeer("PeerInvitationClaim", claim) || claim.displayName.trim().length < 1 || [...claim.displayName].length > 80) throw new PeerStoreError("INVALID_MESSAGE");
    const time = timestamp(now);
    return this.database.transaction(() => {
      const row = this.invitationRow(claim.invitationId);
      if (!row || !timingSafeEqual(Buffer.from(row.secret_hash, "hex"), Buffer.from(peerSecretHash(claim.secret), "hex"))) throw new PeerStoreError("UNAUTHENTICATED");
      if (row.state === "revoked") throw new PeerStoreError("REVOKED");
      const digest = peerClaimDigest(claim);
      if (claim.invitationDigest !== row.invitation_digest) throw new PeerStoreError("PAYLOAD_CONFLICT");
      if (row.state === "claimed") {
        if (row.claim_operation_id !== claim.operationId || row.claim_digest !== digest) throw new PeerStoreError("PAYLOAD_CONFLICT");
        const membership = this.requireActiveMembership(row.claimed_membership_id!, now);
        const credential = this.getCredential(row.claimed_credential_id!);
        if (!credential || credential.revokedAt || credential.expiresAt <= now) throw new PeerStoreError("REVOKED");
        if (credential.credentialId !== machine.credentialId || credential.tokenHash !== machine.tokenHash || credential.expiresAt !== machine.expiresAt) throw new PeerStoreError("PAYLOAD_CONFLICT");
        return membership;
      }
      const invitation = JSON.parse(row.invitation_json) as PeerInvitation;
      if (timestamp(invitation.expiresAt) <= time || timestamp(invitation.membershipExpiresAt) <= time) throw new PeerStoreError("EXPIRED");
      this.assertScope(invitation.scope);
      if (invitation.host.nodeId === claim.participant.nodeId) throw new PeerStoreError("SCOPE_DENIED");
      const membership: PeerMembership = {
        schemaVersion: 1, membershipId: createOpaqueId("peermember"), peerId: createOpaqueId("peer"),
        hostNodeId: invitation.host.nodeId, participantNodeId: claim.participant.nodeId, localUserId: claim.localUserId,
        memberId: createOpaqueId("member"), userId: createOpaqueId("user"), scope: invitation.scope,
        revision: 1, state: "active", createdAt: now, expiresAt: invitation.membershipExpiresAt
      };
      this.core.createUser({ userId: membership.userId, displayName: claim.displayName, createdAt: now });
      this.core.createMember({ memberId: membership.memberId, userId: membership.userId, teamId: membership.scope.teamId,
        displayName: claim.displayName, role: "member", createdAt: now }, []);
      this.database.prepare(`INSERT INTO peer_bindings
        (peer_id, host_node_id, participant_node_id, participant_public_key, local_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(membership.peerId, membership.hostNodeId, membership.participantNodeId, claim.participant.publicKey, membership.localUserId, now);
      this.database.prepare(`INSERT INTO peer_memberships
        (membership_id, peer_id, team_id, member_id, user_id, scope_kind, room_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(membership.membershipId, membership.peerId, membership.scope.teamId, membership.memberId, membership.userId,
          membership.scope.kind, membership.scope.roomId, now, membership.expiresAt);
      this.database.prepare(`INSERT INTO room_human_participants (room_id, member_id, added_at)
        SELECT room_id, ?, ? FROM rooms WHERE team_id = ? AND archived_at IS NULL AND (? IS NULL OR room_id = ?)`)
        .run(membership.memberId, now, membership.scope.teamId, membership.scope.roomId, membership.scope.roomId);
      this.issueCredential(membership.membershipId, "peer.runtime", machine, membership.scope, now);
      this.database.prepare(`UPDATE peer_invitations SET state = 'claimed', claim_operation_id = ?, claim_digest = ?,
        claimed_membership_id = ?, claimed_credential_id = ?, claimed_at = ? WHERE invitation_id = ? AND state = 'open'`)
        .run(claim.operationId, digest, membership.membershipId, machine.credentialId, now, claim.invitationId);
      return membership;
    }).immediate();
  }

  public getMembership(membershipId: string): PeerMembership | undefined {
    const row = this.database.prepare(`SELECT p.*, b.host_node_id, b.participant_node_id, b.local_user_id
      FROM peer_memberships p JOIN peer_bindings b ON b.peer_id = p.peer_id WHERE membership_id = ?`).get(membershipId) as {
      membership_id: string; peer_id: string; host_node_id: string; participant_node_id: string; local_user_id: string;
      team_id: string; member_id: string; user_id: string; scope_kind: "team" | "room"; room_id: string | null;
      revision: number; state: "active" | "revoked"; created_at: string; expires_at: string;
    } | undefined;
    if (!row) return undefined;
    return {
      schemaVersion: 1, membershipId: row.membership_id, peerId: row.peer_id, hostNodeId: row.host_node_id,
      participantNodeId: row.participant_node_id, localUserId: row.local_user_id, memberId: row.member_id, userId: row.user_id,
      scope: { kind: row.scope_kind, teamId: row.team_id, roomId: row.room_id } as PeerScope,
      revision: row.revision, state: row.state, createdAt: row.created_at, expiresAt: row.expires_at
    };
  }

  public requireActiveMembership(membershipId: string, now: string): PeerMembership {
    timestamp(now);
    const membership = this.getMembership(membershipId);
    if (!membership) throw new PeerStoreError("UNAUTHENTICATED");
    if (membership.state !== "active") throw new PeerStoreError("REVOKED");
    if (membership.expiresAt <= now) throw new PeerStoreError("EXPIRED");
    this.assertScope(membership.scope);
    return membership;
  }

  public revokeMembership(membershipId: string, now: string): void {
    timestamp(now);
    this.database.transaction(() => {
      const membership = this.getMembership(membershipId);
      if (!membership) throw new PeerStoreError("UNAUTHENTICATED");
      if (membership.state === "revoked") return;
      this.database.prepare("UPDATE peer_memberships SET state = 'revoked', revision = revision + 1 WHERE membership_id = ?").run(membershipId);
      this.database.prepare("UPDATE peer_credentials SET revoked_at = ? WHERE membership_id = ? AND revoked_at IS NULL").run(now, membershipId);
      this.database.prepare(`UPDATE rooms SET settings_revision = settings_revision + 1
        WHERE room_id IN (SELECT room_id FROM room_human_participants WHERE member_id = ?)`).run(membership.memberId);
      this.database.prepare("DELETE FROM room_human_participants WHERE member_id = ?").run(membership.memberId);
    }).immediate();
  }

  public revokeInvitation(invitationId: string, now: string): void {
    timestamp(now);
    this.database.transaction(() => {
      const row = this.invitationRow(invitationId);
      if (!row) throw new PeerStoreError("UNAUTHENTICATED");
      if (row.state === "revoked") return;
      if (row.claimed_membership_id) this.revokeMembership(row.claimed_membership_id, now);
      this.database.prepare("UPDATE peer_invitations SET state = 'revoked' WHERE invitation_id = ?").run(invitationId);
    }).immediate();
  }

  public issueCredential(membershipId: string, audience: PeerCredentialRecord["audience"], verifier: PeerCredentialVerifier, scope: PeerScope, now: string): void {
    assertHash(verifier.tokenHash);
    if (!validatePeer("PeerScope", scope) || !new RegExp(`^${audience === "peer.runtime" ? "peercredential" : "peerhuman"}_[A-Za-z0-9_-]{8,128}$`, "u").test(verifier.credentialId)) throw new PeerStoreError("INVALID_MESSAGE");
    if (timestamp(verifier.expiresAt) <= timestamp(now)) throw new PeerStoreError("EXPIRED");
    this.database.transaction(() => {
      const membership = this.requireActiveMembership(membershipId, now);
      if (scope.teamId !== membership.scope.teamId || (membership.scope.kind === "room" &&
          (scope.kind !== "room" || scope.roomId !== membership.scope.roomId)) || verifier.expiresAt > membership.expiresAt) throw new PeerStoreError("SCOPE_DENIED");
      this.assertScope(scope);
      this.database.prepare(`INSERT INTO peer_credentials
        (credential_id, membership_id, audience, token_hash, scope_kind, room_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(verifier.credentialId, membershipId, audience, verifier.tokenHash, scope.kind, scope.roomId, now, verifier.expiresAt);
    }).immediate();
  }

  public getCredential(credentialId: string): PeerCredentialRecord | undefined {
    const row = this.database.prepare(`SELECT c.*, p.team_id FROM peer_credentials c
      JOIN peer_memberships p ON p.membership_id = c.membership_id WHERE credential_id = ?`).get(credentialId) as {
      credential_id: string; membership_id: string; audience: PeerCredentialRecord["audience"]; token_hash: string;
      team_id: string; scope_kind: "team" | "room"; room_id: string | null; created_at: string; expires_at: string;
      consumed_at: string | null; revoked_at: string | null;
    } | undefined;
    return row && {
      credentialId: row.credential_id, membershipId: row.membership_id, audience: row.audience, tokenHash: row.token_hash,
      scope: { kind: row.scope_kind, teamId: row.team_id, roomId: row.room_id } as PeerScope,
      createdAt: row.created_at, expiresAt: row.expires_at, consumedAt: row.consumed_at, revokedAt: row.revoked_at
    };
  }

  private invitationRow(invitationId: string): InvitationRow | undefined {
    return this.database.prepare("SELECT * FROM peer_invitations WHERE invitation_id = ?").get(invitationId) as InvitationRow | undefined;
  }

  private assertScope(scope: PeerScope): void {
    const team = this.core.getTeam(scope.teamId);
    if (!team || team.archivedAt) throw new PeerStoreError("SCOPE_DENIED");
    if (scope.kind === "room") {
      if (!scope.roomId) throw new PeerStoreError("SCOPE_DENIED");
      const room = this.core.getRoom(scope.roomId);
      if (!room || room.teamId !== scope.teamId || room.archivedAt) throw new PeerStoreError("SCOPE_DENIED");
    }
  }
}
