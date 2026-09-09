import { createHash } from "node:crypto";
import { canonicalPeerJson } from "./peer-json.mjs";
import { validatePeer } from "./peer-validation.mjs";

export const peerProofLifetimeSeconds = 30;
export const peerProofClockSkewSeconds = 5;
export const peerInvitationMaximumSeconds = 86400;
export const peerSettlementMaximumSeconds = 604800;
export function peerDigest(value) {
  return createHash("sha256").update(canonicalPeerJson(value)).digest("hex");
}

export function peerProofTranscript(payload) {
  if (!validatePeer("PeerProofPayload", payload)) throw new Error("Invalid Peer proof payload");
  return canonicalPeerJson({ domain: "convenewire.peer.proof.v1", payload });
}

/** Fresh proof time never extends its independent grant/membership expiry. */
export function peerProofTimeValid(payload, now) {
  if (!validatePeer("PeerProofPayload", payload) || !Number.isFinite(now)) return false;
  const issued = Date.parse(payload.issuedAt);
  const expires = Date.parse(payload.expiresAt);
  return expires > issued && expires - issued <= peerProofLifetimeSeconds * 1000 &&
    issued <= now + peerProofClockSkewSeconds * 1000 && expires > now;
}
