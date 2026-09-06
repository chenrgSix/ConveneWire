import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { sign } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createTestResources } from "../test/resources.mjs";
import { makeAccess } from "./evidence-access-runtime.mjs";
import { readEvidence } from "./evidence-access-reader.mjs";
import { observeOwner } from "./authority-owner-verifier.mjs";
import { packet, sourceFor, scopeFor, replayFor, makeDisclosure, requireDisclosure, releaseProposal, verifyRelease,
  exclusive, encoded, hash, revokeDisclosure, withAuthorityLock, deliverWithConsent, localVerify, childCommand } from "./authority-collaboration.mjs";
import * as code from "../../docs/acceptance/fixtures/qa-079/owners/code.mjs";
import { policy } from "../../docs/acceptance/fixtures/qa-079/owners/security.mjs";
import { snapshot } from "../../docs/acceptance/fixtures/qa-079/owners/operations.mjs";

const meta = { scenario: "normal", taskId: "task_qa079_test0001", roomId: "room_qa079_test0001",
  runs: Object.fromEntries([...packet().owners, "finalizer"].map(r => [r, `run_qa079_${r}_0001`])) };
const expected = owner => ({ ...scopeFor(meta, owner), owner });
const ownerReceipt = async owner => ({ version: 1, ...expected(owner),
  ...Object.fromEntries(["evidenceRef", "revision", "contentSha256"].map(k => [k, sourceFor(owner).source[k]])),
  verifierSha256: hash(readFileSync("scripts/bench/authority-owner-verifier.mjs")), observedAt: new Date().toISOString(),
  values: await observeOwner(owner, sourceFor(owner).source.path) });
const proposal = verifier => JSON.stringify({ observations: Object.entries(verifier.values).map(([checkId, value]) => ({ checkId, value })) });

test("new complete scenario independently exposes three gate violations and preserves staging", async () => {
  assert.equal(code.stageTrust().activeIssuer, "old");
  assert.deepEqual(code.stageTrust().trustedIssuers, ["old", "new"]);
  const all = snapshot.devices.filter(d => !d.revoked);
  const policyAllowsSwitch = all.every(d => d.ackRevision === snapshot.stagedBundle.revision && d.ackDigest === snapshot.stagedBundle.digest);
  assert.equal(policyAllowsSwitch, false); assert.equal(code.canSwitch(snapshot.devices, snapshot.stagedBundle), true);
  assert.equal(policy.includeOfflineNonRevokedDevices, true); assert.equal(code.eligibleForSwitch(all).length, 2);
  const now = Date.parse(snapshot.observedAt), elapsed = (now - Date.parse(snapshot.stagedAt)) / 3_600_000;
  assert.equal(elapsed, 26); assert.ok(elapsed >= policy.minimumOverlapHours);
  assert.ok(snapshot.oldCertificateNotAfter.some(x => Date.parse(x) > now));
  assert.equal(code.canRetireOld({ stagedAt: Date.parse(snapshot.stagedAt), now }), true);
  for (const owner of packet().owners) {
    assert.deepEqual(await observeOwner(owner, sourceFor(owner).source.path), JSON.parse(readFileSync("docs/acceptance/fixtures/qa-079/scoring.json")).knownLocalFindings[owner]);
  }
});

test("public atomic requirements match rubric; no extra private fact-anchor requirements", () => {
  const p = packet(), rubric = JSON.parse(readFileSync("docs/acceptance/fixtures/qa-079/scoring.json"));
  assert.deepEqual(rubric.criteria.map(({ criterionKey, description, required, ordinal }) => ({ criterionKey, description, required, ordinal })), p.task.criteria);
  assert.equal(new Set(p.task.criteria.map(c => c.criterionKey)).size, 14);
  assert.ok(p.task.criticalCriterionKeys.length < p.task.criteria.length);
  assert.equal(p.schedule.length, 12); assert.equal(p.authorization.maximumSessions, 12);
  assert.deepEqual(p.schedule.map(s => s.scenario), p.scenarios.flatMap(s => Array(4).fill(s)));
  if (existsSync("docs/acceptance/fixtures/qa-079/reference.md")) assert.ok(readFileSync("docs/acceptance/fixtures/qa-079/reference.md").length < p.runtime.maximumAnswerBytes);
});

test("disclosure rechecks exact owner, task, room, producer, recipient, source, revision, expiry and policy", () => {
  const { state } = makeDisclosure(meta, "code"); requireDisclosure(state, expected("code"));
  for (const key of ["owner", "taskId", "roomId", "runId", "recipientRunId", "authorityId", "experimentId"]) {
    assert.throws(() => requireDisclosure(state, { ...expected("code"), [key]: "foreign" }));
  }
  for (const key of ["evidenceRef", "revision", "contentSha256", "policyRevision", "audience", "allowedFields"]) {
    const changed = structuredClone(state); changed.grant[key] = key === "allowedFields" ? [] : "foreign";
    changed.grantSha256 = hash(JSON.stringify(changed.grant));
    assert.throws(() => requireDisclosure(changed, expected("code")));
  }
  assert.throws(() => requireDisclosure(state, expected("code"), state.grant.expiresAt), /expired/);
  assert.throws(() => requireDisclosure({ ...state, status: "revoked" }, expected("code")), /revoked/);
});

test("egress rejects raw prose, extra fields, duplicate IDs, false values and forged verifier linkage", async () => {
  const verifier = await ownerReceipt("code"), { state, privateKey } = makeDisclosure(meta, "code");
  const release = text => releaseProposal({ text, verifier, state, expected: expected("code"), privateKey });
  for (const text of ["private source prose", JSON.stringify({ observations: [], privateNote: code.privateNote }),
    JSON.stringify({ observations: [{ checkId: "code_stage_keeps_old_issuer", value: false }] }),
    JSON.stringify({ observations: [{ checkId: "privateNote", value: code.privateNote }] }),
    JSON.stringify({ observations: [{ checkId: "code_stage_keeps_old_issuer", value: true, explanation: code.privateNote }] }),
    JSON.stringify({ observations: Array(2).fill({ checkId: "code_stage_keeps_old_issuer", value: true }) })]) assert.throws(() => release(text));
  assert.throws(() => releaseProposal({ text: proposal(verifier), verifier: { ...verifier, runId: "other" }, state, expected: expected("code"), privateKey }));
  const accepted = release(proposal(verifier));
  assert.equal(verifyRelease(accepted, state, expected("code")).observations.length, 4);
  assert.ok(!JSON.stringify(accepted).includes(code.privateNote));
  const altered = structuredClone(accepted); altered.body.observations[0].value = false;
  assert.throws(() => verifyRelease(altered, state, expected("code")), /signature/);
  const extra = structuredClone(accepted); extra.body.verification.privateNote = code.privateNote;
  extra.signature = sign(null, Buffer.from(JSON.stringify(extra.body)), privateKey).toString("base64");
  assert.throws(() => verifyRelease(extra, state, expected("code")), "Even signed envelopes cannot extend the approved schema");
  assert.equal(release('{"observations":[]}').body.observations.length, 0, "Do not fill model omissions from the verifier");
});

test("read authority refuses another domain, revision, range and expired/current Run mismatch", () => {
  const replay = replayFor(meta, [sourceFor("code").doc]);
  const access = makeAccess(replay, { runId: meta.runs.code, treatment: "B" }, new Date().toISOString());
  const call = arguments_ => readEvidence({ ...access, grant: access.control.grant, currentRun: access.control.run,
    call: { name: "read_evidence", arguments: arguments_ } });
  const raw = sourceFor("code").source;
  assert.equal(call({ evidenceRef: raw.evidenceRef, revision: raw.revision }).receipt.status, "returned");
  for (const args of [{ evidenceRef: sourceFor("security").source.evidenceRef, revision: raw.revision },
    { evidenceRef: raw.evidenceRef, revision: "0".repeat(40) },
    { evidenceRef: raw.evidenceRef, revision: raw.revision, range: { start: 0, end: raw.allowedRange.end + 1 } }]) {
    const r = call(args); assert.equal(r.receipt.status, "denied"); assert.equal(r.content, null);
  }
  const expired = readEvidence({ bundle: access.bundle, grant: access.control.grant, currentRun: access.control.run,
    now: access.control.grant.expiresAt, call: { name: "read_evidence", arguments: { evidenceRef: raw.evidenceRef, revision: raw.revision } } });
  assert.equal(expired.receipt.status, "denied"); assert.equal(expired.content, null);
  access.control.run.state = "revoked";
  assert.equal(call({ evidenceRef: raw.evidenceRef, revision: raw.revision }).receipt.status, "denied");
});

test("physical MCP reader observes grant withdrawal without restart and refuses private domains", async t => {
  const resources = await createTestResources(t, "convene-wire-qa079-reader-");
  const replay = replayFor(meta, [sourceFor("code").doc]);
  const access = makeAccess(replay, { runId: meta.runs.code, treatment: "B" }, new Date().toISOString());
  const bundle = path.join(resources.directory, "bundle.json"), control = path.join(resources.directory, "control.json");
  const receipts = path.join(resources.directory, "receipts");
  const { mkdirSync } = await import("node:fs"); mkdirSync(receipts); exclusive(bundle, access.bundle); exclusive(control, access.control);
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.resolve("scripts/bench/evidence-access-reader.mjs"), bundle, control, receipts, meta.runs.code, hash(JSON.stringify(access.control.grant))], stderr: "pipe" });
  const client = new Client({ name: "qa079-negative-reader", version: "1" }); resources.defer(() => client.close());
  await client.connect(transport); assert.deepEqual((await client.listTools()).tools.map(t => t.name), ["read_evidence"]);
  const read = async args => JSON.parse((await client.callTool({ name: "read_evidence", arguments: args })).content[0].text);
  const own = sourceFor("code").source, foreign = sourceFor("operations").source;
  assert.equal((await read({ evidenceRef: own.evidenceRef, revision: own.revision })).receipt.status, "returned");
  assert.equal((await read({ evidenceRef: foreign.evidenceRef, revision: foreign.revision })).receipt.status, "denied");
  access.control.run.state = "revoked"; writeFileSync(control, encoded(access.control));
  const denied = await read({ evidenceRef: own.evidenceRef, revision: own.revision });
  assert.equal(denied.receipt.status, "denied"); assert.equal(denied.receipt.returnedBytes, 0);
});

test("owner-local verifier process produces no other domain or private-text values", async t => {
  const resources = await createTestResources(t, "convene-wire-qa079-verifier-");
  const v = await localVerify(resources, meta, "code", path.join(resources.directory, "code"));
  assert.deepEqual(Object.keys(v.values), packet().disclosure.fields.code.map(f => f.checkId));
  assert.ok(!JSON.stringify(v).includes(code.privateNote)); assert.equal(v.runId, meta.runs.code);
});

test("Finalizer reader grant cannot select any raw-owner identity or a previous Run", () => {
  const content = "Approved bounded observation only.";
  const { doc } = sourceFor("code");
  const released = { ...doc, evidenceRef: "evidence_qa079_code_released", content, contentSha256: hash(content), allowedRange: { start: 0, end: Buffer.byteLength(content) } };
  const access = makeAccess(replayFor(meta, [released]), { runId: meta.runs.finalizer, treatment: "B" }, new Date().toISOString());
  for (const owner of packet().owners) {
    const raw = sourceFor(owner).source;
    const denied = readEvidence({ bundle: access.bundle, grant: access.control.grant, currentRun: access.control.run,
      call: { name: "read_evidence", arguments: { evidenceRef: raw.evidenceRef, revision: raw.revision } } });
    assert.equal(denied.receipt.status, "denied"); assert.equal(denied.content, null);
  }
  const denied = readEvidence({ bundle: access.bundle, grant: access.control.grant, currentRun: { ...access.control.run, runId: "run_previous" },
    call: { name: "read_evidence", arguments: { evidenceRef: released.evidenceRef, revision: released.revision } } });
  assert.equal(denied.receipt.status, "denied");
});

test("revocation and publication serialize; revoked buffered release cannot become new sharing", async t => {
  const resources = await createTestResources(t, "convene-wire-qa079-revoke-");
  const { state, privateKey } = makeDisclosure(meta, "code"), file = path.join(resources.directory, "authority.json"); exclusive(file, state);
  const verifier = await ownerReceipt("code");
  const release = releaseProposal({ text: proposal(verifier), verifier, state, expected: expected("code"), privateKey });
  withAuthorityLock(file, () => assert.throws(() => revokeDisclosure(file), /EEXIST/));
  const revoked = revokeDisclosure(file);
  assert.throws(() => verifyRelease(release, revoked, expected("code")), /revoked/);
  assert.throws(() => releaseProposal({ text: proposal(verifier), verifier, state: revoked, expected: expected("code"), privateKey }), /revoked/);
});

test("actual Result publication survives a killed coordinator without duplicate output, then denies revoked replay", async t => {
  const resources = await createTestResources(t, "convene-wire-qa079-central-");
  const databasePath = path.join(resources.directory, "central.sqlite");
  const call = (request, name) => childCommand(resources, "scripts/bench/authority-central.mts", { databasePath, ...request }, path.join(resources.directory, name), { typescript: true });
  const init = await call({ mode: "init", scenario: "restart" }, "init"); assert.equal(init.exitCode, 0, init.diagnostic);
  const m = init.response, owner = "code", exp = { ...scopeFor(m, owner), owner };
  const { state, privateKey } = makeDisclosure(m, owner), grantStatePath = path.join(resources.directory, "grant.json"); exclusive(grantStatePath, state);
  const verifier = await localVerify(resources, m, owner, path.join(resources.directory, "verify"));
  const release = releaseProposal({ text: proposal(verifier), verifier, state, expected: exp, privateKey });
  const publish = (name, extra = {}) => deliverWithConsent(grantStatePath, exp, release, grantState =>
    call({ mode: "publish", meta: m, role: owner, release, grantState, ...extra }, name));
  const dead = await publish("crash", { crashAfterCommit: true }); assert.equal(dead.signal, "SIGKILL", dead.diagnostic); assert.equal(dead.response, null);
  const resumed = await publish("resume"); assert.equal(resumed.exitCode, 0, resumed.diagnostic);
  assert.equal(resumed.response.replayed, true); assert.equal(resumed.response.resultCount, 1);
  assert.equal(resumed.response.result.proposedBy.runId, m.runs.code);
  const again = await publish("duplicate"); assert.equal(again.exitCode, 0, again.diagnostic);
  assert.equal(again.response.result.resultId, resumed.response.result.resultId);
  revokeDisclosure(grantStatePath);
  await assert.rejects(() => publish("revoked"), /revoked/);
  assert.equal(existsSync(path.join(resources.directory, "revoked", "input.json")), false, "Withheld values never become a Central request");
  const inspected = await call({ mode: "inspect", meta: m }, "inspect"); assert.equal(inspected.exitCode, 0, inspected.diagnostic);
  assert.equal(inspected.response.results.length, 1); assert.equal(inspected.response.results[0].review, null);
  assert.equal(inspected.response.runEvents.code.length, 3);
  assert.ok(!JSON.stringify(inspected.response).includes(code.privateNote));
});
