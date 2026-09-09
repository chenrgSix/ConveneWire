import type Database from "better-sqlite3";
import type { PeerBrowserEntryRequest, PeerHumanEntry, PeerHumanEntryIdentity, PeerHumanEntryRequest, PeerMembership, PeerScope } from "@convene-wire/contracts/peer";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { CoreRepository } from "../data/core-repository.js";
import { PeerMembershipRepository, PeerStoreError, peerSecretHash } from "../data/peer-membership-repository.js";
import type { AuthService } from "./auth-service.js";
import type { AuthorityService } from "./authority-service.js";
import { assertPeerOrigin, verifyPeerProof } from "./peer-proof-verifier.js";

export const peerHumanEntryIntent = (request: Pick<PeerHumanEntryRequest, "bindingCredentialId" | "operationId" | "scope">) => peerDigest({
  bindingCredentialId: request.bindingCredentialId, operationId: request.operationId, scope: request.scope
});
export const peerHumanEntryDigest = (entry: Omit<PeerHumanEntry, "schemaVersion" | "proof">) => peerDigest({
  credential: entry.credential, exchangeExpiresAt: entry.exchangeExpiresAt, hostOrigin: entry.hostOrigin
});
interface BindingRow {
  credential_id: string; membership_id: string; token_hash: string; expires_at: string; revoked_at: string | null;
}
interface EntryRow {
  credential_id: string; binding_credential_id: string; intent_digest: string; exchange_expires_at: string;
}

export class PeerHumanEntryService {
  private readonly memberships: PeerMembershipRepository;
  private readonly core: CoreRepository;
  public constructor(private readonly database: Database.Database, private readonly auth: AuthService,
    private readonly authority: AuthorityService, public readonly browserOrigin = authority.browserOrigin) {
    this.memberships = new PeerMembershipRepository(database);
    this.core = new CoreRepository(database);
  }

  public issue(request: PeerHumanEntryRequest, now: string): PeerHumanEntry {
    this.assert("PeerHumanEntryRequest", request);
    assertPeerOrigin(this.browserOrigin);
    return this.database.transaction(() => {
      const binding = this.database.prepare("SELECT * FROM peer_human_bindings WHERE credential_id = ? AND token_hash = ?")
        .get(request.bindingCredentialId, peerSecretHash(request.bindingToken)) as BindingRow | undefined;
      if (!binding) throw new PeerStoreError("UNAUTHENTICATED");
      const membership = this.activeBinding(binding, now);
      this.identity(membership, request.scope);
      const participant = this.database.prepare("SELECT participant_public_key FROM peer_bindings WHERE peer_id = ?").get(membership.peerId) as { participant_public_key: string };
      const digest = peerHumanEntryIntent(request);
      verifyPeerProof(request.proof, { nodeId: membership.participantNodeId, publicKey: participant.participant_public_key }, {
        purpose: "human.entry", audienceNodeId: membership.hostNodeId, operationId: request.operationId,
        nonce: request.nonce, subjectDigest: digest
      }, now);
      const prior = this.database.prepare("SELECT * FROM peer_human_entries WHERE binding_credential_id = ? AND operation_id = ?")
        .get(binding.credential_id, request.operationId) as EntryRow | undefined;
      if (prior && prior.intent_digest !== digest) throw new PeerStoreError("PAYLOAD_CONFLICT");
      const token = this.authority.peerSecret("human-entry", digest);
      const credentialId = `peerhuman_${peerSecretHash(token).slice(0, 32)}`;
      let exchangeExpiresAt: string;
      if (prior) {
        if (prior.credential_id !== credentialId || prior.exchange_expires_at <= now) throw new PeerStoreError("EXPIRED");
        exchangeExpiresAt = prior.exchange_expires_at;
      } else {
        const count = this.database.prepare(`SELECT count(*) AS n FROM peer_human_entries e
          JOIN peer_credentials c ON c.credential_id = e.credential_id
          WHERE e.binding_credential_id = ? AND e.exchange_expires_at > ? AND c.consumed_at IS NULL`)
          .get(binding.credential_id, now) as { n: number };
        if (count.n >= 8) throw new PeerStoreError("STALE_AUTHORIZATION");
        const expiresAt = new Date(Math.min(Date.parse(now) + 8 * 60 * 60 * 1000, Date.parse(binding.expires_at), Date.parse(membership.expiresAt))).toISOString();
        exchangeExpiresAt = new Date(Math.min(Date.parse(now) + 60_000, Date.parse(expiresAt))).toISOString();
        this.memberships.issueCredential(membership.membershipId, "peer.human", {
          credentialId, tokenHash: peerSecretHash(token), expiresAt
        }, request.scope, now);
        this.database.prepare(`INSERT INTO peer_human_entries (credential_id, binding_credential_id, operation_id, intent_digest, created_at, exchange_expires_at)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(credentialId, binding.credential_id, request.operationId, digest, now, exchangeExpiresAt);
      }
      const credential = this.memberships.getCredential(credentialId)!;
      if (credential.consumedAt || credential.revokedAt) throw new PeerStoreError("REVOKED");
      const content = { credential: { schemaVersion: 1 as const, audience: "peer.human" as const, credentialId,
        membershipId: membership.membershipId, scope: credential.scope, token, expiresAt: credential.expiresAt },
        exchangeExpiresAt, hostOrigin: this.browserOrigin };
      const result: PeerHumanEntry = { schemaVersion: 1, ...content, proof: this.authority.signPeerProof({
        purpose: "human.entry", audienceNodeId: membership.participantNodeId, operationId: request.operationId,
        nonce: request.nonce, subjectDigest: peerHumanEntryDigest(content)
      }, now) };
      this.assert("PeerHumanEntry", result);
      return result;
    }).immediate();
  }

  public preview(input: PeerBrowserEntryRequest, now: string): PeerHumanEntryIdentity {
    return this.entry(input, now).identity;
  }

  public consume(input: PeerBrowserEntryRequest, now: string) {
    return this.database.transaction(() => {
      const { credential, identity } = this.entry(input, now);
      const changed = this.database.prepare(`UPDATE peer_credentials SET consumed_at = ?
        WHERE credential_id = ? AND consumed_at IS NULL AND revoked_at IS NULL`).run(now, credential.credentialId);
      if (changed.changes !== 1) throw new PeerStoreError("REVOKED");
      const session = this.auth.issueWebSession(identity.userId, now, credential.expiresAt);
      this.database.prepare("INSERT INTO peer_web_sessions (session_id, credential_id) VALUES (?, ?)").run(session.id, credential.credentialId);
      // Verify the durable lineage before returning a human session.
      const actor = this.auth.authenticateWebSession(session.secret, now);
      return { identity, session, user: this.core.getUser(identity.userId)!, peerAccess: actor.peerAccess! };
    }).immediate();
  }

  private entry(input: PeerBrowserEntryRequest, now: string) {
    this.assert("PeerBrowserEntryRequest", input);
    const credential = this.memberships.getCredential(input.credentialId);
    if (!credential || credential.audience !== "peer.human" || credential.tokenHash !== peerSecretHash(input.token)) throw new PeerStoreError("UNAUTHENTICATED");
    if (credential.revokedAt || credential.consumedAt) throw new PeerStoreError("REVOKED");
    if (credential.expiresAt <= now) throw new PeerStoreError("EXPIRED");
    const entry = this.database.prepare("SELECT * FROM peer_human_entries WHERE credential_id = ?").get(input.credentialId) as EntryRow | undefined;
    if (!entry || entry.exchange_expires_at <= now) throw new PeerStoreError("EXPIRED");
    const binding = this.database.prepare("SELECT * FROM peer_human_bindings WHERE credential_id = ?").get(entry.binding_credential_id) as BindingRow;
    const membership = this.activeBinding(binding, now);
    if (membership.membershipId !== credential.membershipId || credential.expiresAt > binding.expires_at) throw new PeerStoreError("SCOPE_DENIED");
    return { credential, identity: this.identity(membership, credential.scope) };
  }

  private activeBinding(binding: BindingRow, now: string): PeerMembership {
    assertPeerOrigin(this.browserOrigin);
    const invitation = this.database.prepare("SELECT invitation_json FROM peer_invitations WHERE claimed_membership_id = ?")
      .get(binding.membership_id) as { invitation_json: string } | undefined;
    if (!invitation || JSON.parse(invitation.invitation_json).hostOrigin !== this.browserOrigin) throw new PeerStoreError("SCOPE_DENIED");
    if (binding.revoked_at) throw new PeerStoreError("REVOKED");
    if (binding.expires_at <= now) throw new PeerStoreError("EXPIRED");
    return this.memberships.requireActiveMembership(binding.membership_id, now);
  }

  private identity(membership: PeerMembership, scope: PeerScope): PeerHumanEntryIdentity {
    if (scope.teamId !== membership.scope.teamId || (membership.scope.kind === "room" &&
        (scope.kind !== "room" || scope.roomId !== membership.scope.roomId))) throw new PeerStoreError("SCOPE_DENIED");
    const room = scope.roomId ? this.core.getRoom(scope.roomId) : undefined;
    if (scope.kind === "room" && (!room || room.archivedAt || room.teamId !== scope.teamId ||
        !this.database.prepare("SELECT 1 FROM room_human_participants WHERE member_id = ? AND room_id = ?").get(membership.memberId, scope.roomId))) throw new PeerStoreError("SCOPE_DENIED");
    return { schemaVersion: 1, membershipId: membership.membershipId, scope, memberId: membership.memberId,
      userId: membership.userId, displayName: this.core.getMember(membership.memberId)!.displayName,
      teamLabel: this.core.getTeam(scope.teamId)!.name, roomLabel: room?.name ?? null };
  }
  private assert(kind: string, input: unknown): void {
    if (!validatePeer(kind, input)) throw new PeerStoreError("INVALID_MESSAGE");
  }
}
