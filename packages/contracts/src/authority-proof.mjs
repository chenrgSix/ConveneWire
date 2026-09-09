/** Fixed-order ASCII transcript; validate the closed payload schema before use. */
export function authorityProofTranscript(payload) {
  return new TextEncoder().encode(JSON.stringify([
    "convenewire.authority.proof.v1", payload.authorityNodeId, payload.publicKey,
    payload.teamId, payload.deviceId, payload.ownerMemberId, payload.browserOrigin,
    payload.nonce, payload.issuedAt, payload.expiresAt
  ]));
}
export const authorityProofLifetimeSeconds = 30;
export const authorityProofClockSkewSeconds = 5;
