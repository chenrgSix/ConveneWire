import type Database from "better-sqlite3";
import type { AgentExportGrant, PeerMembership, RemoteAgentAcceptance } from "@convene-wire/contracts/peer";
import { peerDigest, peerProofClockSkewSeconds } from "@convene-wire/contracts/peer-proof";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { CoreRepository } from "./core-repository.js";
import { PeerMembershipRepository, PeerStoreError } from "./peer-membership-repository.js";

type Authorization = AgentExportGrant | RemoteAgentAcceptance;
type Kind = "export" | "acceptance";
interface Revision<T> { value: T; digest: string }
interface Lineage { peer_id: string; local_agent_id: string; retired_at: string | null; export_id?: string }

function time(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) throw new PeerStoreError("INVALID_MESSAGE");
  return result;
}

/** Stores verified Participant grants and explicit Host acceptance on one writer. */
export class PeerAuthorizationRepository {
  private readonly memberships: PeerMembershipRepository;
  private readonly core: CoreRepository;
  public constructor(private readonly database: Database.Database) {
    this.memberships = new PeerMembershipRepository(database);
    this.core = new CoreRepository(database);
  }

  public recordVerifiedExport(grant: AgentExportGrant, now: string): Revision<AgentExportGrant> {
    if (!validatePeer("AgentExportGrant", grant)) throw new PeerStoreError("INVALID_MESSAGE");
    time(now);
    return this.database.transaction(() => {
      const digest = peerDigest(grant);
      const exact = this.getExport(grant.exportId, grant.revision);
      if (exact) return this.replay(exact, digest);
      const member = this.memberForPeer(grant.peerId);
      this.assertBinding(grant, member);
      this.assertActiveScope(grant, member, now);
      const lineage = this.lineage("export", grant.exportId);
      if (lineage && (lineage.peer_id !== grant.peerId || lineage.local_agent_id !== grant.localAgentId)) throw new PeerStoreError("PAYLOAD_CONFLICT");
      this.assertNext("export", grant.exportId, grant, lineage, now);
      if (!lineage) {
        this.database.prepare("INSERT INTO peer_export_lineages (export_id, peer_id, local_agent_id) VALUES (?, ?, ?)")
          .run(grant.exportId, grant.peerId, grant.localAgentId);
        this.replaceHead("export", grant.peerId, grant.localAgentId, grant.exportId, now);
      }
      this.append("export", grant.exportId, grant, digest);
      return { value: grant, digest };
    }).immediate();
  }

  public recordAcceptance(acceptance: RemoteAgentAcceptance, ownerMemberId: string, now: string): Revision<RemoteAgentAcceptance> {
    if (!validatePeer("RemoteAgentAcceptance", acceptance)) throw new PeerStoreError("INVALID_MESSAGE");
    time(now);
    return this.database.transaction(() => {
      const owner = this.core.getMember(ownerMemberId);
      if (owner?.teamId !== acceptance.teamId || owner.role !== "owner") throw new PeerStoreError("SCOPE_DENIED");
      const digest = peerDigest(acceptance);
      const exact = this.getAcceptance(acceptance.acceptanceId, acceptance.revision);
      if (exact) return this.replay(exact, digest);
      const member = this.memberForPeer(acceptance.peerId);
      this.assertBinding(acceptance, member);
      if (acceptance.memberId !== member.memberId) throw new PeerStoreError("SCOPE_DENIED");
      const exportRecord = this.getExport(acceptance.exportId, acceptance.grantRevision);
      if (!exportRecord || exportRecord.digest !== acceptance.grantDigest) throw new PeerStoreError("PAYLOAD_CONFLICT");
      const grant = exportRecord.value;
      if (grant.peerId !== acceptance.peerId) throw new PeerStoreError("SCOPE_DENIED");
      this.assertActiveScope(acceptance, member, now);
      if (acceptance.state === "active") {
        const current = this.currentExport(grant.peerId, grant.localAgentId);
        if (!current || current.digest !== exportRecord.digest || current.value.state !== "active") throw new PeerStoreError("STALE_AUTHORIZATION");
        this.assertActiveScope(grant, member, now);
        this.assertIntersection(acceptance, grant);
      }
      const lineage = this.lineage("acceptance", acceptance.acceptanceId);
      if (lineage && (lineage.export_id !== acceptance.exportId || lineage.peer_id !== acceptance.peerId || lineage.local_agent_id !== grant.localAgentId)) throw new PeerStoreError("PAYLOAD_CONFLICT");
      this.assertNext("acceptance", acceptance.acceptanceId, acceptance, lineage, now);
      if (!lineage) {
        this.database.prepare("INSERT INTO peer_acceptance_lineages (acceptance_id, export_id, peer_id, local_agent_id) VALUES (?, ?, ?, ?)")
          .run(acceptance.acceptanceId, grant.exportId, acceptance.peerId, grant.localAgentId);
        this.replaceHead("acceptance", acceptance.peerId, grant.localAgentId, acceptance.acceptanceId, now);
      }
      this.append("acceptance", acceptance.acceptanceId, acceptance, digest);
      return { value: acceptance, digest };
    }).immediate();
  }

  public getExport(exportId: string, revision?: number): Revision<AgentExportGrant> | undefined {
    return this.getRevision("export", exportId, revision);
  }

  public getAcceptance(acceptanceId: string, revision?: number): Revision<RemoteAgentAcceptance> | undefined {
    return this.getRevision("acceptance", acceptanceId, revision);
  }

  public currentExport(peerId: string, localAgentId: string): Revision<AgentExportGrant> | undefined {
    const id = this.head("export", peerId, localAgentId);
    return id ? this.getExport(id) : undefined;
  }

  public currentAcceptance(peerId: string, localAgentId: string): Revision<RemoteAgentAcceptance> | undefined {
    const id = this.head("acceptance", peerId, localAgentId);
    return id ? this.getAcceptance(id) : undefined;
  }

  /** Current stored intersection only; live signed admission is still required by RUN-020. */
  public requireEffective(peerId: string, localAgentId: string, roomId: string, now: string) {
    time(now);
    const member = this.memberForPeer(peerId);
    const grant = this.currentExport(peerId, localAgentId);
    const acceptanceId = this.head("acceptance", peerId, localAgentId);
    const acceptance = acceptanceId ? this.getAcceptance(acceptanceId) : undefined;
    if (!grant || !acceptance || grant.value.state !== "active" || acceptance.value.state !== "active") throw new PeerStoreError("REVOKED");
    this.assertActiveScope(grant.value, member, now, roomId);
    this.assertActiveScope(acceptance.value, member, now, roomId);
    if (acceptance.value.exportId !== grant.value.exportId || acceptance.value.grantRevision !== grant.value.revision || acceptance.value.grantDigest !== grant.digest) throw new PeerStoreError("STALE_AUTHORIZATION");
    this.assertIntersection(acceptance.value, grant.value);
    if (!acceptance.value.roomIds.includes(roomId)) throw new PeerStoreError("SCOPE_DENIED");
    return { membership: member, grant, acceptance };
  }

  private memberForPeer(peerId: string): PeerMembership {
    const row = this.database.prepare("SELECT membership_id FROM peer_memberships WHERE peer_id = ?").get(peerId) as { membership_id: string } | undefined;
    const member = row && this.memberships.getMembership(row.membership_id);
    if (!member) throw new PeerStoreError("UNAUTHENTICATED");
    return member;
  }

  private assertBinding(value: Authorization, member: PeerMembership): void {
    if (value.peerId !== member.peerId || value.teamId !== member.scope.teamId || value.authorityNodeId !== member.hostNodeId || value.participantNodeId !== member.participantNodeId) throw new PeerStoreError("SCOPE_DENIED");
  }

  private assertActiveScope(value: Authorization, member: PeerMembership, now: string, requestedRoomId?: string): void {
    if (value.state !== "active") return;
    this.memberships.requireActiveMembership(member.membershipId, now);
    if (time(value.expiresAt) <= time(now) || time(value.expiresAt) <= time(value.issuedAt)) throw new PeerStoreError("EXPIRED");
    if (value.expiresAt > member.expiresAt) throw new PeerStoreError("SCOPE_DENIED");
    for (const roomId of requestedRoomId ? [requestedRoomId] : value.roomIds) {
      const room = this.core.getRoom(roomId);
      if (!room || room.teamId !== value.teamId || room.archivedAt || !this.core.isRoomMember(roomId, member.memberId) ||
          (member.scope.kind === "room" && member.scope.roomId !== roomId)) throw new PeerStoreError("SCOPE_DENIED");
    }
  }

  private assertIntersection(acceptance: RemoteAgentAcceptance, grant: AgentExportGrant): void {
    if (acceptance.expiresAt > grant.expiresAt || acceptance.roomIds.some(id => !grant.roomIds.includes(id)) ||
        Object.entries(acceptance.capabilities).some(([key, allowed]) => allowed && !grant.capabilities[key as keyof typeof grant.capabilities])) throw new PeerStoreError("SCOPE_DENIED");
  }

  private assertNext(kind: Kind, id: string, value: Authorization, lineage: Lineage | undefined, now: string): void {
    const previous = this.getRevision<Authorization>(kind, id)?.value;
    if (value.revision !== (previous?.revision ?? 0) + 1 || (!previous && value.state !== "active")) throw new PeerStoreError("PAYLOAD_CONFLICT");
    if (previous?.state === "revoked" || (lineage?.retired_at && value.state === "active")) throw new PeerStoreError("REVOKED");
    if ((previous && value.issuedAt < previous.issuedAt) || time(value.issuedAt) > time(now) + peerProofClockSkewSeconds * 1000) throw new PeerStoreError("STALE_AUTHORIZATION");
  }

  private replay<T>(existing: Revision<T>, digest: string): Revision<T> {
    if (existing.digest !== digest) throw new PeerStoreError("PAYLOAD_CONFLICT");
    return existing;
  }

  private getRevision<T extends Authorization>(kind: Kind, id: string, revision?: number): Revision<T> | undefined {
    const row = this.database.prepare(`SELECT payload_json, digest FROM peer_${kind}_revisions
      WHERE ${kind}_id = ? AND (? IS NULL OR revision = ?) ORDER BY revision DESC LIMIT 1`).get(id, revision ?? null, revision ?? null) as { payload_json: string; digest: string } | undefined;
    return row && { value: JSON.parse(row.payload_json) as T, digest: row.digest };
  }

  private lineage(kind: Kind, id: string): Lineage | undefined {
    return this.database.prepare(`SELECT * FROM peer_${kind}_lineages WHERE ${kind}_id = ?`).get(id) as Lineage | undefined;
  }

  private head(kind: Kind, peerId: string, localAgentId: string): string | undefined {
    const row = this.database.prepare(`SELECT ${kind}_id AS id FROM peer_${kind}_heads WHERE peer_id = ? AND local_agent_id = ?`)
      .get(peerId, localAgentId) as { id: string } | undefined;
    return row?.id;
  }

  private replaceHead(kind: Kind, peerId: string, localAgentId: string, id: string, now: string): void {
    const previous = this.head(kind, peerId, localAgentId);
    if (previous) this.database.prepare(`UPDATE peer_${kind}_lineages SET retired_at = ? WHERE ${kind}_id = ?`).run(now, previous);
    this.database.prepare(`INSERT INTO peer_${kind}_heads (peer_id, local_agent_id, ${kind}_id) VALUES (?, ?, ?)
      ON CONFLICT (peer_id, local_agent_id) DO UPDATE SET ${kind}_id = excluded.${kind}_id`).run(peerId, localAgentId, id);
  }

  private append(kind: Kind, id: string, value: Authorization, digest: string): void {
    this.database.prepare(`INSERT INTO peer_${kind}_revisions (${kind}_id, revision, payload_json, digest, state, issued_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, value.revision, JSON.stringify(value), digest, value.state, value.issuedAt);
  }
}
