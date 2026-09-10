import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { peerRunRequestDigest, verifyPeerRunRequest } from "../src/peer-proof.mjs";
import { decodePeer, validatePeer } from "../src/peer-validation.mjs";

const vector = JSON.parse(await readFile(new URL("./fixtures/peer-run.json", import.meta.url)));

test("Peer Run semantic identity binds context and authority without transport or Device pins", () => {
  const { request, digest } = vector;
  assert.equal(peerRunRequestDigest(request.binding, request.payload), digest);
  verifyPeerRunRequest(request);
  const reversed = value => Array.isArray(value) ? value.map(reversed) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reversed(child)])) : value;
  verifyPeerRunRequest(reversed(request));
  for (const field of Object.keys(request.binding)) {
    const changed = structuredClone(request);
    if (typeof changed.binding[field] === "number") changed.binding[field]++;
    else if (field.endsWith("Digest")) changed.binding[field] = "b".repeat(64);
    else changed.binding[field] += "x";
    assert.throws(() => verifyPeerRunRequest(changed), field);
  }
  for (const mutation of [
    p => { p.instruction += " changed"; },
    p => { p.contextMessages[0].content += " changed"; },
    p => { p.contextManifest.goal += " changed"; },
    p => { p.session.contextCursor++; },
    p => { p.deadline = "2026-09-10T02:20:00.121Z"; },
    p => { p.contextManifest.permissions.maxDurationSeconds--; }
  ]) {
    const changed = structuredClone(request); mutation(changed.payload);
    assert.throws(() => verifyPeerRunRequest(changed));
    assert.notEqual(peerRunRequestDigest(changed.binding, changed.payload), digest);
  }
});

test("actual Go and Node reject ambiguous, widened and cross-Task Peer Run requests", () => {
  const cases = [];
  const add = (name, request, schema, execution) => cases.push({ name, raw: JSON.stringify(request), schema, execution });
  add("golden", vector.request, true, true);
  for (const field of ["deliveryAttemptId", "idempotencyKey", "connectionId", "nonce", "deviceTrust", "centralApproval", "ownerPrivateOutput", "conversationWork", "roomContextBundle"]) {
    const changed = structuredClone(vector.request); changed.payload[field] = "foreign";
    add(field, changed, false, false);
  }
  for (const [name, mutate, schema] of [
    ["Device target", p => { p.contextManifest.target.deviceId = null; }, false],
    ["Device trust", p => { p.contextManifest.permissions.deviceTrustRevision = 1; }, false],
    ["full policy", p => { p.contextManifest.permissions.filesystemAccess = "full-access"; }, false],
    ["governed", p => { p.contextManifest.execution = {}; }, false],
    ["unknown context", p => { p.contextMessages[0].systemPrompt = "hidden"; }, false],
    ["shared Room session", p => { p.session.scope = "room"; }, false],
    ["foreign session", p => { p.session.runtimeScopeId = "runtime_foreign001"; }, false],
    ["foreign Task", p => { p.contextManifest.taskId = "task_otherpeer001"; }, true],
    ["foreign target", p => { p.contextManifest.target.agentId = "agent_otherpeer001"; }, true],
    ["foreign manifest Run", p => { p.contextManifest.runId = "run_otherpeer001"; }, true],
    ["changed content", p => { p.instruction += " revised"; }, true]
  ]) {
    const changed = structuredClone(vector.request); mutate(changed.payload); add(name, changed, schema, false);
  }
  // Original number spellings are checked before floating-point conversion.
  for (const [number, valid] of [["1.0", true], ["1e0", true], ["1.0000000000000001", false], ["1e-400", false]]) {
    cases.push({ name: number, raw: JSON.stringify(vector.request).replace('"grantRevision":1', `"grantRevision":${number}`), schema: valid, execution: valid });
  }
  cases.push({ name: "duplicate", raw: JSON.stringify(vector.request).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'), schema: false, execution: false });
  for (const item of cases) {
    let decoded;
    try { decoded = decodePeer("PeerRunRequest", item.raw); } catch {}
    assert.equal(Boolean(decoded), item.schema, item.name);
    if (decoded) {
      let valid = true;
      try { verifyPeerRunRequest(decoded); } catch { valid = false; }
      assert.equal(valid, item.execution, item.name);
    }
  }
  const result = spawnSync("go", ["run", "./test/interop-peer"], { cwd: new URL("../", import.meta.url),
    input: cases.map(item => JSON.stringify({ Kind: "PeerRunRequest", Raw: item.raw })).join("\n") + "\n",
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
  assert.equal(result.status, 0, result.stderr);
  const actual = result.stdout.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(actual.length, cases.length);
  for (const [index, item] of cases.entries()) {
    assert.equal(actual[index].valid, item.schema, item.name);
    if (item.schema) assert.equal(actual[index].executionValid, item.execution, item.name);
    if (item.execution) assert.equal(actual[index].executionDigest, vector.digest, item.name);
  }
  assert.equal(validatePeer("PeerRunPayload", { ...vector.request.payload, deviceId: "device_other001" }), false);
});
