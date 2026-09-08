import assert from "node:assert/strict";
import test from "node:test";
import {workPolicySpec} from "./static/work-policy-form.mjs";
import {governedOwnerPresentation, workPolicyRevocation} from "./static/governed-owner-view.mjs";

const inventory = {
  bindings: [{bindingId: "repobind_work001", revision: 1, repositoryId: "repo_work001", sourceFingerprint: "a".repeat(64)}],
  runtimeProfiles: [{spec: {profileId: "profile_runtime001", revision: 1, agentId: "agent_work001"}, digest: "b".repeat(64)}],
  verificationProfiles: [{profileId: "profile_verify001", revision: 1, digest: "c".repeat(64)}]
};
const values = {bindingId: "repobind_work001", agentId: "agent_work001", runtimeProfileId: "profile_runtime001",
  verifierIds: ["profile_verify001"], confirmed: true, alias: " Development ", sourceRef: "refs/heads/main",
  roomIds: ["room_work001"], initiatorMemberIds: "member_work001\nmember_work001", allowedPaths: "src\ntest", forbiddenPaths: "src/secrets",
  minutes: "30", attempts: "3", expiresAt: "2026-09-15T12:00:00Z"};

test("owner form freezes registered resource pins, explicit identities and finite budget", () => {
  const spec = workPolicySpec(values, inventory, "workpolicy_console001");
  assert.equal(spec.runtimeProfile.digest, "b".repeat(64));
  assert.equal(spec.sourceFingerprint, "a".repeat(64));
  assert.deepEqual(spec.initiatorMemberIds, ["member_work001"]);
  assert.deepEqual(spec.operations, ["prepare", "capture", "verify"]);
  assert.deepEqual(spec.scopePolicy.allowedPaths, ["src", "test"]);
  assert.equal(spec.maxTaskDurationSeconds, 1800);
  assert.equal(spec.maxConcurrency, 1);
  for (const change of [{confirmed: false}, {agentId: "agent_wrong001"}, {verifierIds: []}, {verifierIds: ["profile_wrong001"]}]) {
    assert.throws(() => workPolicySpec({...values, ...change}, inventory, "workpolicy_console001"));
  }
  const revoked = structuredClone(inventory); revoked.runtimeProfiles[0].revokedAt = "2026-09-08T00:00:00Z";
  assert.throws(() => workPolicySpec(values, revoked, "workpolicy_console001"));
});

test("policy inventory distinguishes expired and revoked authority and pins revocation", () => {
  const spec = workPolicySpec(values, inventory, "workpolicy_console001");
  spec.expiresAt = "2020-01-01T00:00:00Z";
  const policy = {spec, revision: 1, digest: "d".repeat(64), revokedAt: null};
  assert.equal(governedOwnerPresentation({workPolicies: [policy]}).groups.at(-1).rows[0].status, "已过期");
  assert.equal(workPolicyRevocation(policy).body.expectedDigest, policy.digest);
  policy.revokedAt = "2026-09-08T00:00:00Z";
  assert.match(governedOwnerPresentation({workPolicies: [policy]}).groups.at(-1).rows[0].status, /关联任务授权已失效/u);
  assert.equal(workPolicyRevocation(policy), null);
});
