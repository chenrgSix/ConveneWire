// Local deterministic observation adapter. Never imports another owner's source.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

const hash = value => createHash("sha256").update(value).digest("hex");
export async function observeOwner(owner, sourcePath) {
  const source = await import(pathToFileURL(path.resolve(sourcePath)).href);
  if (owner === "code") {
    const bundle = { revision: 12, digest: "b".repeat(64) };
    const good = { connected: true, revoked: false, ackRevision: 12, ackDigest: bundle.digest };
    return {
      code_stage_keeps_old_issuer: source.stageTrust().activeIssuer === "old",
      code_gate_includes_offline: !source.canSwitch([good, { ...good, connected: false, ackRevision: 11 }], bundle),
      code_gate_checks_digest: !source.canSwitch([{ ...good, ackDigest: "a".repeat(64) }], bundle),
      code_retirement_checks_expiry: !source.canRetireOld({ stagedAt: 0, now: 26 * 3_600_000, oldCertificateNotAfter: [32 * 3_600_000] })
    };
  }
  if (owner === "security") return {
    policy_include_offline: source.policy.includeOfflineNonRevokedDevices,
    policy_exact_ack: source.policy.acknowledgementMustMatchRevisionAndDigest,
    policy_minimum_overlap_hours: source.policy.minimumOverlapHours,
    policy_old_certificates_expired: source.policy.requireAllOldCertificatesExpiredBeforeRetirement,
    policy_rollback_requires_old_trust_and_validity: source.policy.rollbackToOldIssuerAllowedOnlyWhileOldIsTrustedAndValid
  };
  assert.equal(owner, "operations");
  const s = source.snapshot, devices = s.devices.filter(d => !d.revoked);
  return {
    ops_nonrevoked_devices: devices.length,
    ops_exact_ack_devices: devices.filter(d => d.ackRevision === s.stagedBundle.revision && d.ackDigest === s.stagedBundle.digest).length,
    ops_offline_nonrevoked_devices: devices.filter(d => !d.connected).length,
    ops_overlap_hours: (Date.parse(s.observedAt) - Date.parse(s.stagedAt)) / 3_600_000,
    ops_old_certificate_remaining_hours: Math.max(0, ...s.oldCertificateNotAfter.map(at => (Date.parse(at) - Date.parse(s.observedAt)) / 3_600_000)),
    ops_active_issuer: s.activeIssuer,
    ops_snapshot_time: s.observedAt
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2), request = JSON.parse(readFileSync(input, "utf8"));
  const sourceBytes = readFileSync(request.source.path);
  assert.equal(hash(sourceBytes), request.source.contentSha256);
  assert.ok(request.source.path.endsWith(`/owners/${request.owner}.mjs`));
  const values = await observeOwner(request.owner, request.source.path);
  writeFileSync(output, JSON.stringify({ version: 1, ...request.binding, owner: request.owner,
    evidenceRef: request.source.evidenceRef, revision: request.source.revision,
    contentSha256: hash(sourceBytes), verifierSha256: hash(readFileSync(new URL(import.meta.url))),
    observedAt: new Date().toISOString(), values }) + "\n", { flag: "wx", mode: 0o600 });
}
