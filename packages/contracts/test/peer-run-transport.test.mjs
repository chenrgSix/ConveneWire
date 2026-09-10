import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { peerDigest, peerProofTranscript, peerRunDeliveryReceiptDigest } from "../src/peer-proof.mjs";
import { decodePeer } from "../src/peer-validation.mjs";

const f = JSON.parse(await readFile(new URL("./fixtures/peer-run-transport.json", import.meta.url)));

test("Peer delivery receipt fixes exact execution and a nonrenewable seven-day capability", () => {
  assert.equal(peerRunDeliveryReceiptDigest(f.delivery), f.receiptDigest);
  const changedToken = structuredClone(f.delivery);
  changedToken.settlement.token = Buffer.alloc(32, 9).toString("base64url");
  assert.equal(peerRunDeliveryReceiptDigest(changedToken), f.receiptDigest);
  for (const [field, value] of [["capabilityId", "peersettle_another001"], ["issuedAt", "2026-09-10T02:00:01.000Z"], ["expiresAt", "2026-09-17T01:59:59.999Z"]]) {
    const changed = structuredClone(f.delivery); changed.settlement[field] = value;
    assert.notEqual(peerRunDeliveryReceiptDigest(changed), f.receiptDigest, field);
  }
  for (const change of [
    d => { d.settlement.binding.acceptanceRevision++; },
    d => { d.settlement.binding.peerId += "x"; },
    d => { d.request.payload.instruction += "x"; },
    d => { d.settlement.expiresAt = "2026-09-17T02:00:00.001Z"; },
    d => { d.settlement.expiresAt = d.settlement.issuedAt; },
    d => { d.settlement.audience = "peer.runtime"; }
  ]) {
    const changed = structuredClone(f.delivery); change(changed);
    assert.throws(() => peerRunDeliveryReceiptDigest(changed));
  }
});

test("new signed Peer transport vectors cover exact request, event and receipt bytes", () => {
  for (const [name, kind, subject] of [
    ["pollRequest", "PeerRunPollRequest", f.pollRequest.intent],
    ["pollReceipt", "PeerRunPollReceipt"], ["eventRequest", "PeerRunEventRequest"],
    ["eventReceipt", "PeerRunEventReceipt"], ["settlementRequest", "PeerRunSettlementRequest"],
    ["settlementReceipt", "PeerRunSettlementReceipt"]
  ]) {
    const message = decodePeer(kind, JSON.stringify(f[name]));
    const { proof, ...unsigned } = message;
    assert.equal(proof.payload.subjectDigest, peerDigest(subject ?? unsigned), name);
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(proof.payload.signerPublicKey, "base64url")]), format: "der", type: "spki" });
    assert.equal(verify(null, peerProofTranscript(proof.payload), publicKey, Buffer.from(proof.signature, "base64url")), true, name);
  }
});

test("actual Go and Node agree on closed Peer transport and confidence-only decimal data", () => {
  const cases = [];
  const add = (kind, value, valid = true, deliveryValid) => cases.push({ kind, raw: JSON.stringify(value), valid, deliveryValid });
  const good = {
    PeerRunKnown: { runId: f.delivery.request.binding.runId, requestDigest: f.delivery.request.binding.requestDigest },
    PeerRunPollIntent: f.pollRequest.intent, PeerRunPollRequest: f.pollRequest, PeerRunPollReceipt: f.pollReceipt,
    PeerRunDelivery: f.delivery, PeerRunReplyEvent: f.eventRequest.event, PeerRunEvent: f.eventRequest.event,
    PeerRunStatusEvent: { type: "status", sequence: 1, status: "delivered" },
    PeerRunOutputEvent: { type: "output", sequence: 2, content: "正在执行", reset: true },
    PeerRunActivityEvent: { type: "activity", sequence: 2, activityId: "tool_001", kind: "tool", phase: "started", label: "Read source" },
    PeerRunEventRequest: f.eventRequest, PeerRunEventReceipt: f.eventReceipt,
    PeerRunSettlementRequest: f.settlementRequest, PeerRunSettlementReceipt: f.settlementReceipt
  };
  for (const [kind, value] of Object.entries(good)) {
    add(kind, value, true, kind === "PeerRunDelivery" ? true : undefined);
    add(kind, { ...value, deviceId: "device_foreign001" }, false);
    for (const field of Object.keys(value)) {
      // Optional event fields have independent negative cases below.
      if (["reset", "label", "assessment"].includes(field)) continue;
      const changed = structuredClone(value); delete changed[field]; add(kind, changed, false);
    }
  }
  add("PeerRunPollReceipt", { ...f.pollReceipt, delivery: null });
  add("PeerRunPollIntent", { ...f.pollRequest.intent, knownRuns: Array.from({ length: 129 }, (_, n) => ({ ...good.PeerRunKnown, runId: `run_transport${n.toString().padStart(8, "0")}` })) }, false);
  for (const status of ["working", "completed", "failed", "canceled", "input_required"]) add("PeerRunEvent", { type: "status", sequence: 2, status });
  add("PeerRunEvent", { type: "status", sequence: 2, status: "working", session: { disposition: "resumed", contextCursor: 3 } });
  add("PeerRunEvent", { type: "status", sequence: 2, status: "input_required", clarification: { kind: "task", question: "选择目标分支？", choices: ["main", "develop"] } });
  for (const event of [
    { type: "status", sequence: 2, status: "completed", clarification: { kind: "task", question: "late" } },
    { type: "status", sequence: 2, status: "completed", session: { disposition: "resumed", contextCursor: 3 } },
    { type: "status", sequence: 2, status: "working", session: { disposition: "resumed", contextCursor: 3, runtimeScopeId: "private" } },
    { type: "status", sequence: 2, status: "failed", error: { code: "RUNTIME_FAILED", message: "Failed", retryable: false, details: { command: "private" } } },
    { type: "reply", sequence: 2, content: "text", developmentProposal: {} },
    { type: "reply", sequence: 2, content: "text", ownerPrivateOutput: true },
    { type: "output", sequence: 2, content: "x".repeat(20001) },
    { type: "reply", sequence: 2, content: "text", assessment: { confidence: 1.1 } }
  ]) add("PeerRunEvent", event, false);
  for (const state of ["completed", "failed", "canceled", "expired", "outcome_unknown", "delivery_denied"]) {
    const value = structuredClone(f.settlementRequest); value.settlement.state = state; add("PeerRunSettlementRequest", value);
    value.settlement.reply = "private result"; add("PeerRunSettlementRequest", value, false);
  }
  for (const [kind, original, path] of [
    ["PeerRunEventRequest", f.eventRequest, "event"], ["PeerRunEvent", f.eventRequest.event, ""], ["PeerRunReplyEvent", f.eventRequest.event, ""]
  ]) {
    for (const confidence of ["0.875", "8.75e-1", "0", "1", "1e-400"]) {
      cases.push({ kind, raw: JSON.stringify(original).replace('"confidence":0.875', `"confidence":${confidence}`), valid: true });
    }
    for (const number of ["3.0000000000000001", "1e-400", "9007199254740992"]) {
      cases.push({ kind, raw: JSON.stringify(original).replace('"sequence":3', `"sequence":${number}`), valid: false });
    }
    if (path) cases.push({ kind, raw: JSON.stringify(original).replace('"grantRevision":1', '"grantRevision":1.00000000000000001'), valid: false });
    cases.push({ kind, raw: JSON.stringify(original).replace('"confidence":0.875', '"confidence":0.875,"confi\\u0064ence":0.9'), valid: false });
  }
  for (const mutate of [
    d => { d.settlement.binding.acceptanceRevision++; },
    d => { d.request.payload.instruction += " changed"; },
    d => { d.settlement.expiresAt = "2026-09-17T02:00:00.001Z"; }
  ]) { const changed = structuredClone(f.delivery); mutate(changed); add("PeerRunDelivery", changed, true, false); }
  for (const item of cases) {
    let decoded;
    try { decoded = decodePeer(item.kind, item.raw); } catch {}
    assert.equal(Boolean(decoded), item.valid, `${item.kind}: ${item.raw.slice(0, 160)}`);
    if (item.deliveryValid !== undefined) {
      let valid = true; try { peerRunDeliveryReceiptDigest(decoded); } catch { valid = false; }
      assert.equal(valid, item.deliveryValid);
    }
  }
  const result = spawnSync("go", ["run", "./test/interop-peer"], { cwd: new URL("../", import.meta.url),
    input: cases.map(item => JSON.stringify({ Kind: item.kind, Raw: item.raw })).join("\n") + "\n", encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
  assert.equal(result.status, 0, result.stderr);
  const actual = result.stdout.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(actual.length, cases.length);
  for (const [index, item] of cases.entries()) {
    assert.equal(actual[index].valid, item.valid, `${index}: ${item.kind}`);
    if (item.deliveryValid !== undefined) assert.equal(actual[index].deliveryValid, item.deliveryValid, `${index}: delivery`);
    if (item.deliveryValid) assert.equal(actual[index].deliveryDigest, f.receiptDigest);
  }
});
