// Frozen synthetic snapshot. Device names and local markers are not approved for disclosure.
export const privateNote = "QA079_OPERATIONS_PRIVATE_CANARY_1c873b";
export const snapshot = {
  observedAt: "2026-09-07T00:00:00.000Z",
  stagedAt: "2026-09-05T22:00:00.000Z",
  activeIssuer: "old",
  stagedBundle: { revision: 12, digest: "b".repeat(64) },
  devices: [
    { internalName: "private-east-machine", connected: true, revoked: false, ackRevision: 12, ackDigest: "b".repeat(64) },
    { internalName: "private-west-machine", connected: true, revoked: false, ackRevision: 12, ackDigest: "a".repeat(64) },
    { internalName: "private-disconnected-machine", connected: false, revoked: false, ackRevision: 11, ackDigest: "a".repeat(64) }
  ],
  oldCertificateNotAfter: ["2026-09-07T06:00:00.000Z", "2026-09-06T23:00:00.000Z"]
};
// This is not a live inventory. No real production timing, transport, rollout,
// provider identity or multi-machine execution is established by this snapshot.
