import type Database from "better-sqlite3";
import type { PeerLeaveRequest, PeerLeaveReceipt, PeerNodeIdentity } from "@convene-wire/contracts/peer";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { PeerMembershipRepository, PeerStoreError } from "../data/peer-membership-repository.js";
import type { AuthorityService } from "./authority-service.js";
import { assertPeerOrigin, verifyPeerProof } from "./peer-proof-verifier.js";

export const peerLeaveReceiptDigest = (receipt: Pick<PeerLeaveReceipt, "intent" | "state" | "recordedAt">): string =>
  peerDigest({ intent: receipt.intent, state: receipt.state, recordedAt: receipt.recordedAt });

/** Participant Node proof permits only revoking its own exact membership.
 * No business credential, human entry, new membership or execution is issued. */
export class PeerDepartureService {
  public constructor(private readonly database: Database.Database, private readonly authority: AuthorityService,
    private readonly origin: string) {}

  public leave(input: PeerLeaveRequest, now: string): PeerLeaveReceipt {
    if (!validatePeer("PeerLeaveRequest", input)) throw new PeerStoreError("INVALID_MESSAGE");
    assertPeerOrigin(this.origin);
    const intent = input.intent;
    if (intent.host.nodeId !== this.authority.nodeId || intent.host.publicKey !== this.authority.publicKey ||
        intent.hostOrigin !== this.origin) throw new PeerStoreError("SCOPE_DENIED");
    return this.database.transaction(() => {
      const binding = this.database.prepare(`SELECT b.participant_node_id, b.participant_public_key,
        json_extract(i.invitation_json, '$.hostOrigin') AS host_origin
        FROM peer_memberships m JOIN peer_bindings b ON b.peer_id = m.peer_id
        JOIN peer_invitations i ON i.claimed_membership_id = m.membership_id
        WHERE m.membership_id = ? AND m.peer_id = ? AND b.host_node_id = ?`)
        .get(intent.membershipId, intent.peerId, this.authority.nodeId) as
        { participant_node_id: string; participant_public_key: string; host_origin: string } | undefined;
      if (!binding || binding.host_origin !== this.origin || binding.participant_node_id !== intent.participant.nodeId ||
          binding.participant_public_key !== intent.participant.publicKey) throw new PeerStoreError("UNAUTHENTICATED");
      const participant: PeerNodeIdentity = { nodeId: binding.participant_node_id, publicKey: binding.participant_public_key };
      const digest = peerDigest(intent), nonce = input.proof.payload.nonce;
      verifyPeerProof(input.proof, participant, { purpose: "peer.leave", audienceNodeId: this.authority.nodeId,
        operationId: intent.operationId, nonce, subjectDigest: digest }, now);
      const previous = this.database.prepare(`SELECT intent_digest, receipt_json FROM peer_departures
        WHERE membership_id = ? OR (participant_node_id = ? AND operation_id = ?)`)
        .all(intent.membershipId, participant.nodeId, intent.operationId) as { intent_digest: string; receipt_json: string }[];
      if (previous.length > 1 || previous.some(row => row.intent_digest !== digest)) throw new PeerStoreError("PAYLOAD_CONFLICT");
      const memberships = new PeerMembershipRepository(this.database);
      let content: Omit<PeerLeaveReceipt, "proof">;
      if (previous.length) {
        content = JSON.parse(previous[0]!.receipt_json) as typeof content;
        if (peerDigest(content.intent) !== digest || content.state !== "revoked" ||
            memberships.getMembership(intent.membershipId)?.state !== "revoked") throw new PeerStoreError("PAYLOAD_CONFLICT");
      } else {
        // Expired membership or missing Room ACL never prevents narrowing.
        memberships.revokeMembership(intent.membershipId, now);
        content = { schemaVersion: 1, intent, state: "revoked", recordedAt: now };
        this.database.prepare(`INSERT INTO peer_departures
          (membership_id, participant_node_id, operation_id, intent_digest, receipt_json) VALUES (?, ?, ?, ?, ?)`)
          .run(intent.membershipId, participant.nodeId, intent.operationId, digest, JSON.stringify(content));
      }
      const receipt: PeerLeaveReceipt = { ...content, proof: this.authority.signPeerProof({ purpose: "peer.leave",
        audienceNodeId: participant.nodeId, operationId: intent.operationId, nonce, subjectDigest: peerLeaveReceiptDigest(content) }, now) };
      if (!validatePeer("PeerLeaveReceipt", receipt)) throw new PeerStoreError("INVALID_MESSAGE");
      return receipt;
    }).immediate();
  }
}
