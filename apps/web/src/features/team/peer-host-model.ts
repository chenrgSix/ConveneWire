import type { PeerAgentOffer, PeerInvitation, PeerMembership, PeerNodeIdentity, RemoteAgentAcceptance } from "@convene-wire/contracts/peer";

export interface PeerHostAccess {
  host: PeerNodeIdentity;
  hostOrigin: string;
  invitationSupported: boolean;
  invitations: Array<{ invitation: PeerInvitation; state: "open" | "claimed" | "revoked" | "expired" }>;
  memberships: Array<Pick<PeerMembership, "membershipId" | "peerId" | "memberId" | "participantNodeId" | "scope" | "createdAt" | "expiresAt"> & {
    displayName: string; roomLabel: string | null; state: "active" | "revoked" | "expired";
  }>;
}

export interface PeerHostOffer {
  offer: PeerAgentOffer;
  offerDigest: string;
  grantDigest: string;
  acceptance: RemoteAgentAcceptance | null;
}

export function peerOperationId(): string {
  return `op_${crypto.randomUUID()}`;
}

export function currentPeerAcceptance(item: PeerHostOffer, now = Date.now()): boolean {
  const a = item.acceptance, g = item.offer.grant;
  return Boolean(a && a.state === "active" && Date.parse(a.expiresAt) > now && g.state === "active" &&
    Date.parse(g.expiresAt) > now && a.exportId === g.exportId && a.grantRevision === g.revision && a.grantDigest === item.grantDigest);
}
