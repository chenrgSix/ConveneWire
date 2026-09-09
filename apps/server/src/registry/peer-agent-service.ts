import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  PeerAgentOffer, PeerAgentOfferRequest, PeerAgentOfferReceipt, PeerAgentAcceptanceRequest,
  PeerAgentRevokeRequest, PeerAgentAcceptanceReceipt, RemoteAgentAcceptance, PeerAgentSyncRequest, PeerAgentSyncReceipt
} from "@convene-wire/contracts/peer";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { PeerAuthorizationRepository } from "../data/peer-authorization-repository.js";
import { PeerAgentProjectionRepository } from "../data/peer-agent-projection-repository.js";
import { PeerMembershipRepository, PeerStoreError } from "../data/peer-membership-repository.js";
import { createOpaqueId } from "../domain/identifiers.js";
import type { AuthService, WebPrincipal } from "../security/auth-service.js";
import type { AuthorityService } from "../security/authority-service.js";
import type { PeerAdmissionService, PeerPrincipal } from "../security/peer-admission-service.js";
import { verifyPeerProof } from "../security/peer-proof-verifier.js";

interface OfferRow { payload_json: string; offer_digest: string; grant_digest: string }
type AcceptanceResult = Omit<PeerAgentAcceptanceReceipt, "schemaVersion" | "proof">;

/** Participant offers and Host decisions retain separate immutable evidence. */
export class PeerAgentService {
  private readonly grants: PeerAuthorizationRepository;
  public constructor(private readonly database: Database.Database, private readonly auth: AuthService,
    private readonly authority: AuthorityService, private readonly admission: PeerAdmissionService,
    private readonly onChanged: (teamId: string) => void = () => {}) {
    this.grants = new PeerAuthorizationRepository(database);
  }

  public offer(token: string, input: PeerAgentOfferRequest, now: string): PeerAgentOfferReceipt {
    this.assert("PeerAgentOfferRequest", input);
    const principal = this.admission.authenticateMachine(token, now), { grant } = input.offer;
    this.assertOffer(input.offer, principal);
    const offerDigest = peerDigest(input.offer), grantDigest = peerDigest(grant);
    const context = { purpose: "agent.export" as const, audienceNodeId: this.authority.nodeId,
      operationId: input.proof.payload.operationId, nonce: input.proof.payload.nonce, subjectDigest: offerDigest };
    verifyPeerProof(input.proof, { nodeId: principal.participantNodeId, publicKey: principal.participantPublicKey }, context, now);
    this.database.transaction(() => this.persistOffer(input.offer, now)).immediate();
    this.onChanged(grant.teamId);
    const result = { exportId: grant.exportId, grantRevision: grant.revision, grantDigest, offerDigest };
    return { schemaVersion: 1, ...result, proof: this.authority.signPeerProof({ ...context,
      audienceNodeId: principal.participantNodeId, subjectDigest: peerDigest(result) }, now) };
  }

  public synchronize(token: string, input: PeerAgentSyncRequest, now: string): PeerAgentSyncReceipt {
    this.assert("PeerAgentSyncRequest", input);
    const principal = this.admission.authenticateMachine(token, now);
    for (const offer of input.offers) {
      this.assertOffer(offer, principal);
      if (offer.grant.localAgentId !== input.localAgentId) throw new PeerStoreError("SCOPE_DENIED");
    }
    const historyDigest = peerDigest({ schemaVersion: 1, localAgentId: input.localAgentId, offers: input.offers });
    const context = { purpose: "agent.export" as const, audienceNodeId: this.authority.nodeId,
      operationId: input.proof.payload.operationId, nonce: input.proof.payload.nonce, subjectDigest: historyDigest };
    verifyPeerProof(input.proof, { nodeId: principal.participantNodeId, publicKey: principal.participantPublicKey }, context, now);
    const current = this.database.transaction(() => {
      const head = this.grants.synchronizeVerifiedExports(input.offers.map(offer => offer.grant), now);
      for (const offer of input.offers) this.persistOffer(offer, now);
      return head;
    }).immediate();
    this.onChanged(principal.scope.teamId);
    const result = { peerId: principal.peerId, localAgentId: input.localAgentId, historyDigest,
      exportId: current.value.exportId, grantRevision: current.value.revision, grantDigest: current.digest };
    return { schemaVersion: 1, ...result, proof: this.authority.signPeerProof({ ...context,
      audienceNodeId: principal.participantNodeId, subjectDigest: peerDigest(result) }, now) };
  }

  public listOffers(actor: WebPrincipal, teamId: string) {
    this.requireOwner(actor, teamId);
    const rows = this.database.prepare(`SELECT o.payload_json, o.offer_digest FROM peer_export_heads h
      JOIN peer_export_revisions r ON r.export_id = h.export_id
      JOIN peer_agent_offers o ON o.export_id = r.export_id AND o.grant_revision = r.revision
      JOIN peer_memberships m ON m.peer_id = h.peer_id
      WHERE m.team_id = ? AND r.revision = (SELECT max(revision) FROM peer_export_revisions WHERE export_id = h.export_id)
      ORDER BY o.received_at, h.peer_id, h.local_agent_id`).all(teamId) as OfferRow[];
    return rows.map(row => {
      const offer = JSON.parse(row.payload_json) as PeerAgentOffer;
      return { offer, offerDigest: row.offer_digest,
        acceptance: this.grants.currentAcceptance(offer.grant.peerId, offer.grant.localAgentId)?.value ?? null };
    });
  }

  public accept(actor: WebPrincipal, input: PeerAgentAcceptanceRequest, now: string): PeerAgentAcceptanceReceipt {
    this.assert("PeerAgentAcceptanceRequest", input);
    const row = this.getOffer(input.exportId, input.grantRevision);
    if (!row) throw new PeerStoreError("SCOPE_DENIED");
    const offer = JSON.parse(row.payload_json) as PeerAgentOffer, { grant } = offer;
    const owner = this.requireOwner(actor, grant.teamId);
    if (grant.peerId !== input.peerId || grant.localAgentId !== input.localAgentId || row.grant_digest !== input.grantDigest ||
        row.offer_digest !== input.offerDigest) throw new PeerStoreError("PAYLOAD_CONFLICT");
    const result = this.operation(owner.memberId, input.operationId, input, now, () => {
      const current = this.grants.currentAcceptance(grant.peerId, grant.localAgentId)?.value;
      if ((current?.acceptanceId ?? null) !== input.expectedAcceptanceId || (current?.revision ?? null) !== input.expectedAcceptanceRevision) throw new PeerStoreError("STALE_AUTHORIZATION");
      const membershipRow = this.database.prepare("SELECT membership_id FROM peer_memberships WHERE peer_id = ?").get(grant.peerId) as { membership_id: string };
      const membership = new PeerMembershipRepository(this.database).requireActiveMembership(membershipRow.membership_id, now);
      const continuing = current?.state === "active" && current.exportId === grant.exportId;
      const acceptance: RemoteAgentAcceptance = { schemaVersion: 1,
        acceptanceId: continuing ? current.acceptanceId : createOpaqueId("acceptance"),
        revision: continuing ? current.revision + 1 : 1, state: "active", issuedAt: now, expiresAt: input.expiresAt,
        peerId: grant.peerId, participantNodeId: grant.participantNodeId, authorityNodeId: grant.authorityNodeId,
        teamId: grant.teamId, memberId: membership.memberId, exportId: grant.exportId,
        grantRevision: grant.revision, grantDigest: row.grant_digest, roomIds: input.roomIds, capabilities: input.capabilities };
      this.grants.recordAcceptance(acceptance, owner.memberId, now);
      let projection = this.database.prepare("SELECT projection_agent_id FROM peer_agent_projections WHERE peer_id = ? AND local_agent_id = ?")
        .get(grant.peerId, grant.localAgentId) as { projection_agent_id: string } | undefined;
      if (!projection) {
        projection = { projection_agent_id: createOpaqueId("agent") };
        this.database.prepare("INSERT INTO peer_agent_projections (peer_id, local_agent_id, projection_agent_id, created_at) VALUES (?, ?, ?, ?)")
          .run(grant.peerId, grant.localAgentId, projection.projection_agent_id, now);
      }
      return { acceptance, offerDigest: row.offer_digest, projection: { schemaVersion: 1,
        projectionAgentId: projection.projection_agent_id, peerId: grant.peerId, authorityNodeId: grant.authorityNodeId,
        teamId: grant.teamId, localAgentId: grant.localAgentId, exportId: grant.exportId,
        acceptanceId: acceptance.acceptanceId, acceptanceRevision: acceptance.revision,
        displayName: offer.displayName, role: offer.role, capabilities: acceptance.capabilities } };
    });
    this.onChanged(result.acceptance.teamId);
    return this.receipt(result, input.operationId, now);
  }

  public revoke(actor: WebPrincipal, input: PeerAgentRevokeRequest, now: string): PeerAgentAcceptanceReceipt {
    this.assert("PeerAgentRevokeRequest", input);
    const current = this.grants.getAcceptance(input.acceptanceId)?.value;
    if (!current) throw new PeerStoreError("SCOPE_DENIED");
    const owner = this.requireOwner(actor, current.teamId);
    const result = this.operation(owner.memberId, input.operationId, input, now, () => {
      if (current.revision !== input.expectedRevision || current.state !== "active") throw new PeerStoreError("STALE_AUTHORIZATION");
      const original = this.database.prepare(`SELECT result_json FROM peer_agent_operations
        WHERE acceptance_id = ? AND acceptance_revision = ?`).get(current.acceptanceId, current.revision) as { result_json: string } | undefined;
      if (!original) throw new PeerStoreError("SCOPE_DENIED");
      const previous = JSON.parse(original.result_json) as AcceptanceResult;
      if (this.grants.currentAcceptance(current.peerId, previous.projection.localAgentId)?.value.acceptanceId !== current.acceptanceId) throw new PeerStoreError("STALE_AUTHORIZATION");
      const acceptance = { ...current, revision: current.revision + 1, state: "revoked" as const, issuedAt: now };
      this.grants.recordAcceptance(acceptance, owner.memberId, now);
      return { ...previous, acceptance, projection: { ...previous.projection, acceptanceRevision: acceptance.revision } };
    });
    this.onChanged(result.acceptance.teamId);
    return this.receipt(result, input.operationId, now);
  }

  private receipt(result: AcceptanceResult, operationId: string, now: string): PeerAgentAcceptanceReceipt {
    return { schemaVersion: 1, ...result, proof: this.authority.signPeerProof({ purpose: "agent.acceptance",
      audienceNodeId: result.acceptance.participantNodeId, operationId, nonce: randomBytes(32).toString("base64url"), subjectDigest: peerDigest(result) }, now) };
  }

  private operation(ownerMemberId: string, operationId: string, input: unknown, now: string, work: () => AcceptanceResult): AcceptanceResult {
    const intent = peerDigest(input);
    return this.database.transaction(() => {
      const previous = this.database.prepare("SELECT intent_digest, result_json FROM peer_agent_operations WHERE owner_member_id = ? AND operation_id = ?")
        .get(ownerMemberId, operationId) as { intent_digest: string; result_json: string } | undefined;
      if (previous) {
        if (previous.intent_digest !== intent) throw new PeerStoreError("PAYLOAD_CONFLICT");
        return JSON.parse(previous.result_json) as AcceptanceResult;
      }
      const result = work();
      new PeerAgentProjectionRepository(this.database).materialize(result, now);
      this.database.prepare(`INSERT INTO peer_agent_operations (owner_member_id, operation_id, intent_digest,
        acceptance_id, acceptance_revision, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(ownerMemberId, operationId, intent, result.acceptance.acceptanceId, result.acceptance.revision, JSON.stringify(result), now);
      return result;
    }).immediate();
  }

  private getOffer(exportId: string, revision: number): OfferRow | undefined {
    return this.database.prepare("SELECT payload_json, offer_digest, grant_digest FROM peer_agent_offers WHERE export_id = ? AND grant_revision = ?")
      .get(exportId, revision) as OfferRow | undefined;
  }
  private assertOffer(offer: PeerAgentOffer, principal: PeerPrincipal): void {
    const grant = offer.grant;
    for (const label of [offer.displayName, offer.role]) {
      if (label !== label.trim() || /[\u0000-\u001f\u007f]/u.test(label)) throw new PeerStoreError("INVALID_MESSAGE");
    }
    if (grant.peerId !== principal.peerId || grant.authorityNodeId !== principal.hostNodeId ||
        grant.participantNodeId !== principal.participantNodeId || grant.teamId !== principal.scope.teamId ||
        grant.capabilities.supportsOwnerPrivateOutput) throw new PeerStoreError("SCOPE_DENIED");
  }
  private persistOffer(offer: PeerAgentOffer, now: string): void {
    const { grant } = offer, offerDigest = peerDigest(offer), grantDigest = peerDigest(grant);
    const previous = this.getOffer(grant.exportId, grant.revision);
    if (previous) {
      if (previous.offer_digest !== offerDigest || previous.grant_digest !== grantDigest) throw new PeerStoreError("PAYLOAD_CONFLICT");
      return;
    }
    const count = this.database.prepare(`SELECT count(*) AS n FROM peer_agent_offers o
      JOIN peer_export_lineages l ON l.export_id = o.export_id WHERE l.peer_id = ?`).get(grant.peerId) as { n: number };
    // Retain space for withdrawal even after the active publication limit.
    if (count.n >= 2048 && grant.state === "active") throw new PeerStoreError("SCOPE_DENIED");
    this.grants.recordVerifiedExport(grant, now);
    this.database.prepare(`INSERT INTO peer_agent_offers (export_id, grant_revision, grant_digest, offer_digest, payload_json, received_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(grant.exportId, grant.revision, grantDigest, offerDigest, JSON.stringify(offer), now);
  }
  private requireOwner(actor: WebPrincipal, teamId: string) {
    this.auth.requireFullWebSession(actor);
    const owner = this.auth.requireTeamMember(actor, teamId);
    if (owner.role !== "owner") throw new PeerStoreError("SCOPE_DENIED");
    return owner;
  }
  private assert(kind: string, input: unknown): void {
    if (!validatePeer(kind, input)) throw new PeerStoreError("INVALID_MESSAGE");
  }
}
