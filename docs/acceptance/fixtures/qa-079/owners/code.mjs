// Owner-authored synthetic implementation. Only the code-domain reader may return this file.
export const privateNote = "QA079_CODE_PRIVATE_CANARY_7d392c";
export const stageTrust = () => ({ trustedIssuers: ["old", "new"], activeIssuer: "old" });
export const eligibleForSwitch = devices => devices.filter(d => d.connected && !d.revoked);
export const canSwitch = (devices, bundle) => eligibleForSwitch(devices)
  .every(d => d.ackRevision === bundle.revision);
export const canRetireOld = ({ stagedAt, now }) => now - stagedAt >= 24 * 60 * 60 * 1000;
// canSwitch ignores offline-but-not-revoked devices and acknowledgement digest.
// canRetireOld has no inventory input and therefore cannot guard unexpired old certificates.
