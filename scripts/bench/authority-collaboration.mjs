// QA-only transport and authority checks. No production storage or model-generated permission.
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, closeSync, unlinkSync } from "node:fs";
import path from "node:path";
import { spawnTestProcess } from "../test/child-process.mjs";
import { makeAccess } from "./evidence-access-runtime.mjs";
import { readEvidence, evidenceToolDefinition } from "./evidence-access-reader.mjs";

export const fixtureDirectory = "docs/acceptance/fixtures/qa-079";
export const packetPath = `${fixtureDirectory}/packet.json`;
export const hash = value => createHash("sha256").update(value).digest("hex");
export const json = file => JSON.parse(readFileSync(file, "utf8"));
export const encoded = value => JSON.stringify(value, null, 2) + "\n";
export function exclusive(file, value) { writeFileSync(file, encoded(value), { flag: "wx", mode: 0o600 }); }
export function withAuthorityLock(file, operation) {
  // One owner serializes publication and revocation. A stale lock fails closed; no implicit stealing.
  const lock = `${file}.lock`, fd = openSync(lock, "wx", 0o600);
  try { return operation(json(file)); } finally { closeSync(fd); unlinkSync(lock); }
}
export function revokeDisclosure(file, now = new Date().toISOString()) {
  return withAuthorityLock(file, state => {
    assert.equal(state.status, "active");
    const revoked = { ...state, revision: state.revision + 1, status: "revoked", revokedAt: now };
    writeFileSync(file, encoded(revoked), { mode: 0o600 }); return revoked;
  });
}
export async function deliverWithConsent(file, expected, release, deliver) {
  // Owner-side gate runs BEFORE constructing any Central request. Hold the owner
  // lock through the publication attempt so revocation has a defined order.
  const lock = `${file}.lock`, fd = openSync(lock, "wx", 0o600);
  try {
    const state = json(file);
    verifyRelease(release, state, expected);
    return await deliver(state);
  } finally { closeSync(fd); unlinkSync(lock); }
}
export function packet() { return json(packetPath); }
export function pinDocument(evidenceRef, content) {
  const bytes = Buffer.from(content);
  return { evidenceRef, revision: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
    contentSha256: hash(bytes), allowedRange: { start: 0, end: bytes.length }, content };
}
export function sourceFor(owner) {
  const p = packet(), source = p.sources.find(s => s.owner === owner);
  assert.ok(source); const content = readFileSync(source.path, "utf8");
  const doc = pinDocument(source.evidenceRef, content);
  for (const key of ["revision", "contentSha256"]) assert.equal(doc[key], source[key], "Source drift");
  assert.deepEqual(doc.allowedRange, source.allowedRange);
  return { source, doc };
}
export const scopeFor = (meta, role) => ({ experimentId: packet().identity, authorityId: packet().authorityId,
  taskId: meta.taskId, roomId: meta.roomId, runId: meta.runs[role], recipientRunId: meta.runs.finalizer });
export function replayFor(meta, documents) {
  const p = packet();
  return { fixture: { ...p, task: { ...p.task, taskId: meta.taskId, roomId: meta.roomId },
    sources: documents.map(({ content: _content, ...d }) => d) }, documents };
}
export function ownerInstruction(owner, documents) {
  const p = packet();
  return `${p.ownerInstruction}\n\nYour domain: ${owner}\nPublic task:\n${JSON.stringify(p.task)}\n` +
    `Permitted observations and types:\n${JSON.stringify(p.disclosure.fields[owner])}\n` +
    `Your fixed source identities (omit range for full reads):\n${JSON.stringify(documents.map(({ content: _c, ...d }) => d))}\n`;
}
export function finalInstruction(meta, documents, statuses) {
  const p = packet();
  return `${p.finalizerInstruction}\n\nPublic task:\n${JSON.stringify(p.task)}\n` +
    `Domain release status:\n${JSON.stringify(statuses)}\n` +
    `Released evidence identities (omit range for full reads):\n${JSON.stringify(documents.map(({ content: _c, ...d }) => d))}\n` +
    `This Finalizer scope:\n${JSON.stringify(scopeFor(meta, "finalizer"))}\n`;
}
export function makeDisclosure(meta, owner, now = new Date().toISOString()) {
  const { source } = sourceFor(owner), p = packet();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const grant = { version: 1, ...scopeFor(meta, owner), owner,
    grantId: `grant_qa079_${meta.scenario}_${owner}`, policyRevision: p.disclosure.policyRevision,
    audience: p.disclosure.audience, evidenceRef: source.evidenceRef, revision: source.revision,
    contentSha256: source.contentSha256, allowedFields: p.disclosure.fields[owner].map(f => f.checkId),
    expiresAt: new Date(Date.parse(now) + 900_000).toISOString(),
    publicKey: publicKey.export({ type: "spki", format: "pem" }) };
  return { state: { revision: 1, status: "active", grant, grantSha256: hash(JSON.stringify(grant)), revokedAt: null },
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) };
}
export function requireDisclosure(state, expected, now = new Date().toISOString()) {
  const p = packet(), g = state?.grant;
  assert.ok(g && state.status === "active" && state.revision === 1 && state.revokedAt === null, "disclosure_revoked");
  assert.equal(state.grantSha256, hash(JSON.stringify(g)), "grant_digest_mismatch");
  assert.ok(Date.parse(now) < Date.parse(g.expiresAt), "disclosure_expired");
  for (const key of ["experimentId", "authorityId", "taskId", "roomId", "runId", "recipientRunId", "owner"]) {
    assert.equal(g[key], expected[key], `disclosure_${key}_mismatch`);
  }
  assert.equal(g.policyRevision, p.disclosure.policyRevision); assert.equal(g.audience, p.disclosure.audience);
  const source = p.sources.find(s => s.owner === g.owner); assert.ok(source);
  for (const key of ["evidenceRef", "revision", "contentSha256"]) assert.equal(g[key], source[key]);
  assert.deepEqual(g.allowedFields, p.disclosure.fields[g.owner].map(f => f.checkId));
  return g;
}
export function decodeProposal(text) {
  assert.ok(Buffer.byteLength(text) <= 32768, "egress_byte_limit");
  const value = JSON.parse(text);
  assert.deepEqual(Object.keys(value).sort(), ["observations"], "egress_extra_fields");
  assert.ok(Array.isArray(value.observations) && value.observations.length <= 16, "egress_observations");
  return value;
}
function validValue(value, type) {
  if (type === "boolean") return typeof value === "boolean";
  if (type === "integer") return Number.isSafeInteger(value) && value >= 0 && value <= 10_000;
  if (type === "issuer") return ["old", "new"].includes(value);
  return type === "timestamp" && typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/u.test(value) && Number.isFinite(Date.parse(value));
}
export function releaseProposal({ text, verifier, state, expected, privateKey, now = new Date().toISOString() }) {
  const g = requireDisclosure(state, expected, now), p = packet();
  for (const key of ["experimentId", "authorityId", "taskId", "roomId", "runId", "recipientRunId", "owner", "evidenceRef", "revision", "contentSha256"]) {
    assert.equal(verifier[key], g[key], `verifier_${key}_mismatch`);
  }
  assert.equal(verifier.verifierSha256, hash(readFileSync("scripts/bench/authority-owner-verifier.mjs")));
  assert.ok(Number.isFinite(Date.parse(verifier.observedAt)) && Date.parse(verifier.observedAt) <= Date.parse(now));
  const candidate = decodeProposal(text), seen = new Set();
  const observations = candidate.observations.map(row => {
    assert.deepEqual(Object.keys(row).sort(), ["checkId", "value"], "egress_row_extra_fields");
    assert.ok(!seen.has(row.checkId), "egress_duplicate"); seen.add(row.checkId);
    const allowed = p.disclosure.fields[g.owner].find(f => f.checkId === row.checkId);
    assert.ok(allowed && validValue(row.value, allowed.type), "egress_field_not_authorized");
    assert.deepEqual(row.value, verifier.values[row.checkId], "egress_verification_mismatch");
    return { checkId: allowed.checkId, value: verifier.values[allowed.checkId] };
  }).sort((a, b) => g.allowedFields.indexOf(a.checkId) - g.allowedFields.indexOf(b.checkId));
  const body = { version: 1, ...expected, grantId: g.grantId, grantSha256: state.grantSha256,
    policyRevision: g.policyRevision, evidenceRef: g.evidenceRef, revision: g.revision,
    contentSha256: g.contentSha256, observations,
    verification: { verifierSha256: verifier.verifierSha256, observedAt: verifier.observedAt,
      scope: "Named deterministic local observations only; not whole-task acceptance or production proof." }, sealedAt: now };
  return { body, signature: sign(null, Buffer.from(JSON.stringify(body)), privateKey).toString("base64") };
}
export function verifyRelease(release, state, expected, now = new Date().toISOString()) {
  const g = requireDisclosure(state, expected, now), b = release.body;
  assert.deepEqual(Object.keys(release).sort(), ["body", "signature"]);
  assert.equal(Buffer.from(release.signature, "base64").toString("base64"), release.signature);
  assert.ok(verify(null, Buffer.from(JSON.stringify(b)), g.publicKey, Buffer.from(release.signature, "base64")), "release_signature_invalid");
  assert.deepEqual(Object.keys(b).sort(), ["version", ...Object.keys(expected), "grantId", "grantSha256", "policyRevision", "evidenceRef", "revision", "contentSha256", "observations", "verification", "sealedAt"].sort());
  for (const key of Object.keys(expected)) assert.equal(b[key], expected[key]);
  for (const key of ["grantId", "policyRevision", "evidenceRef", "revision", "contentSha256"]) assert.equal(b[key], g[key]);
  assert.equal(b.grantSha256, state.grantSha256);
  assert.equal(b.version, 1);
  assert.ok(Date.parse(b.sealedAt) <= Date.parse(now) && Date.parse(b.sealedAt) < Date.parse(g.expiresAt));
  const fields = packet().disclosure.fields[g.owner], seen = new Set();
  assert.ok(Array.isArray(b.observations) && b.observations.length <= fields.length);
  for (const row of b.observations) {
    assert.deepEqual(Object.keys(row).sort(), ["checkId", "value"]);
    const f = fields.find(f => f.checkId === row.checkId);
    assert.ok(f && !seen.has(f.checkId) && validValue(row.value, f.type)); seen.add(f.checkId);
  }
  assert.equal(b.verification.verifierSha256, hash(readFileSync("scripts/bench/authority-owner-verifier.mjs")));
  assert.deepEqual(Object.keys(b.verification).sort(), ["observedAt", "scope", "verifierSha256"]);
  assert.equal(b.verification.scope, "Named deterministic local observations only; not whole-task acceptance or production proof.");
  assert.ok(Number.isFinite(Date.parse(b.verification.observedAt)) && Date.parse(b.verification.observedAt) <= Date.parse(b.sealedAt));
  return b;
}
export async function childCommand(resources, script, request, directory, { typescript = false, timeout = 60_000 } = {}) {
  mkdirSync(directory, { recursive: true });
  const input = path.join(directory, "input.json"), output = path.join(directory, "output.json");
  exclusive(input, request);
  const child = spawnTestProcess(resources, process.execPath, [...(typescript ? ["--import", "tsx"] : []), script, input, output],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let diagnostic = "";
  child.process.stdout.resume();
  child.process.stderr.on("data", c => { diagnostic = (diagnostic + c.toString()).slice(-4000); });
  const closed = new Promise(resolve => child.process.once("close", resolve));
  const timer = setTimeout(() => { void child.stop(); }, timeout);
  const terminal = await child.terminal; await closed; clearTimeout(timer);
  return { exitCode: terminal.code, signal: terminal.signal, error: terminal.error ? "spawn_failed" : null,
    response: existsSync(output) ? json(output) : null, diagnostic };
}
export async function localVerify(resources, meta, owner, directory) {
  const { source } = sourceFor(owner), request = { source, owner, binding: scopeFor(meta, owner) };
  const result = await childCommand(resources, "scripts/bench/authority-owner-verifier.mjs", request, directory);
  assert.equal(result.exitCode, 0, result.diagnostic);
  return result.response;
}
export function ownerDocuments(owner, verifier) {
  const { doc } = sourceFor(owner);
  return [doc, pinDocument(`evidence_qa079_${owner}_local_checks`, JSON.stringify(verifier))];
}
export function inspectInvocation(meta, role, row, replay, instruction) {
  const { bundle, control } = makeAccess(replay, row, row.observedAt), full = new Set();
  assert.equal(row.instructionSha256, hash(instruction)); assert.equal(row.requestedModel, packet().runtime.model);
  assert.equal(row.reasoningEffort, packet().runtime.reasoningEffort);
  assert.equal(row.runId, meta.runs[role]); assert.deepEqual(row.grant, control.grant);
  const catalogs = row.readerLifecycle.filter(e => e.stage === "tools_listed");
  assert.ok(catalogs.length && catalogs.every(e => e.runId === row.runId && e.definitionSha256 === hash(JSON.stringify(evidenceToolDefinition(bundle)))));
  for (const [attempt, read] of row.reads.entries()) {
    const receipt = read.receipt;
    assert.ok(Date.parse(receipt.observedAt) >= Date.parse(row.observedAt) && Date.parse(receipt.observedAt) <= Date.parse(row.endedAt));
    // A denied foreign selector may redact the original ID. Only successful returns are reconstructed.
    if (receipt.status !== "returned") { assert.equal(read.content, null); assert.equal(receipt.returnedBytes, 0); continue; }
    const checked = readEvidence({ bundle, grant: control.grant, currentRun: control.run, attempt, now: receipt.observedAt,
      call: { name: "read_evidence", arguments: { evidenceRef: receipt.evidenceRef, revision: receipt.revision, range: receipt.requestedRange } } });
    assert.deepEqual(read, checked);
    const doc = replay.documents.find(d => d.evidenceRef === receipt.evidenceRef);
    if (!receipt.truncated && JSON.stringify(receipt.returnedRange) === JSON.stringify(doc.allowedRange) && row.finalAnswerAt && Date.parse(receipt.observedAt) <= Date.parse(row.finalAnswerAt)) full.add(doc.evidenceRef);
  }
  assert.equal(row.answerSha256, hash(row.finalAnswer));
  return { delivered: row.outcome === "completed" && row.failures.length === 0 && Boolean(row.finalAnswer),
    fullSourcesBeforeAnswer: [...full], expectedSourceCount: replay.documents.length,
    fullReadCoverage: full.size === replay.documents.length,
    returned: row.reads.filter(r => r.receipt.status === "returned").length,
    denied: row.reads.filter(r => r.receipt.status === "denied").length };
}
