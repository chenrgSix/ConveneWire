// QA-076 tooling. Fixture notes, self-assessments and reference answers are not Results.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { hash } from "./evidence-access-reader.mjs";
import { inspectManipulation } from "./evidence-screening-audit.js";

export const directory = "docs/acceptance/fixtures/qa-076";
export const packetPath = `${directory}/packet.json`;
const read = file => JSON.parse(readFileSync(file, "utf8"));
const ajv = new Ajv({ allErrors: true });
const finalValid = ajv.compile(read(`${directory}/final.schema.json`));
const closureValid = ajv.compile(read(`${directory}/closure.schema.json`));
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && [...a].sort().join("\n") === [...b].sort().join("\n");

export function loadClosurePacket() {
  const fixture = read(packetPath);
  assert.equal(fixture.identity, "qa-076-retention-criterion-closure-v1");
  assert.equal(fixture.authorityId, "authority_qa076_synthetic_sources_v1");
  assert.equal(fixture.synthetic, true);
  assert.deepEqual(fixture.order, ["E", "F", "F", "E", "E", "F"].map((treatment, slot) =>
    ({ slot, treatment, repetition: Math.floor(slot / 2) + 1, runId: `run_qa076_retention_${slot + 1}` })));
  const documents = fixture.sources.map(source => {
    assert.ok(source.path.startsWith(`${directory}/sources/`) && !source.path.includes(".."));
    const bytes = readFileSync(source.path);
    assert.equal(hash(bytes), source.contentSha256);
    assert.equal(source.revisionKind, "git_blob_sha1");
    assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), source.revision);
    assert.deepEqual(source.allowedRange, { start: 0, end: bytes.length });
    assert.ok(bytes.length <= fixture.runtime.maximumReturnBytes);
    return { ...source, content: bytes.toString("utf8") };
  });
  assert.equal(documents.length, 4); assert.equal(new Set(documents.map(doc => doc.evidenceRef)).size, 4);
  assert.equal(fixture.task.criteria.length, 8);
  assert.equal(new Set(fixture.task.criteria.map(row => row.criterionKey)).size, 8);
  assert.ok(fixture.task.criteria.every((row, i) => row.required === true && row.ordinal === i + 1));
  return { fixture, documents };
}

export function closureInstruction(arm, replay = loadClosurePacket()) {
  assert.ok(arm === "E" || arm === "F");
  const f = replay.fixture;
  // Only these model-visible fields are projected. No paths, private rubric or oracle.
  const common = `${f.commonInstruction}\n\nTask and canonical Criteria:\n${JSON.stringify(f.task, null, 2)}` +
    `\n\nAuthored fixture notes (not independent Agent results):\n${JSON.stringify(f.contributions, null, 2)}` +
    `\n\nFixed evidence manifest (UTF-8 byte offsets, end exclusive):\n${JSON.stringify(f.sources.map(({ evidenceRef, revision, revisionKind, contentSha256, allowedRange }) =>
      ({ evidenceRef, revision, revisionKind, contentSha256, allowedRange })), null, 2)}` +
    `\n\nCommon final artifact schema:\n${readFileSync(`${directory}/final.schema.json`, "utf8").trim()}`;
  return arm === "E" ? common : `${common}\n\nFull criterion closure requirement:\n${f.closureInstruction}`;
}

export function retentionOracle(replay = loadClosurePacket()) {
  const source = ref => JSON.parse(replay.documents.find(doc => doc.evidenceRef === ref).content);
  const inventory = source("snapshot-inventory"), observations = source("verification-observations").observations;
  const objects = new Map(inventory.objects.map(item => [item.objectId, item]));
  assert.equal(objects.size, inventory.objects.length, "Duplicate inventory identity");
  const verification = new Map(observations.map(item => [item.objectId, item.status]));
  assert.equal(verification.size, observations.length);
  const eligible = inventory.objects.filter(item => item.state === "complete" && verification.get(item.objectId) === "passed");
  const newest = [];
  for (const tenant of new Set(inventory.objects.map(item => item.tenant))) {
    newest.push(...eligible.filter(item => item.tenant === tenant).sort((a, b) =>
      Date.parse(b.completedAt) - Date.parse(a.completedAt) || a.objectId.localeCompare(b.objectId)).slice(0, 2).map(item => item.objectId));
  }
  const pins = source("active-pins").activeObjectIds, protectedIds = new Set([...newest, ...pins]);
  const visit = (id, ancestors = new Set()) => {
    const item = objects.get(id); assert.ok(item); assert.ok(!ancestors.has(id), "Dependency cycle");
    if (item.baseObjectId) {
      const parent = objects.get(item.baseObjectId); assert.ok(parent && parent.tenant === item.tenant);
      protectedIds.add(parent.objectId); visit(parent.objectId, new Set([...ancestors, id]));
    }
  };
  for (const id of [...protectedIds]) visit(id);
  const cutoff = Date.parse(inventory.asOf) - 7 * 24 * 60 * 60 * 1000;
  const decisions = {}, totals = { retainBytes: 0, deleteCandidateBytes: 0, holdBytes: 0 };
  for (const item of inventory.objects) {
    assert.ok(Number.isSafeInteger(item.bytes) && item.bytes >= 0 && Number.isFinite(Date.parse(item.completedAt)));
    const decision = verification.get(item.objectId) !== "passed" ? "hold" :
      protectedIds.has(item.objectId) || Date.parse(item.completedAt) >= cutoff ? "retain" : "delete_candidate";
    decisions[item.objectId] = decision;
    totals[{ retain: "retainBytes", delete_candidate: "deleteCandidateBytes", hold: "holdBytes" }[decision]] += item.bytes;
  }
  return { inventory, newest, protectedIds: [...protectedIds], decisions, totals,
    heldIds: Object.keys(decisions).filter(id => decisions[id] === "hold"), cutoff };
}

function extract(text, tag) {
  const open = `<${tag}>`, close = `</${tag}>`, start = text.indexOf(open), end = text.indexOf(close);
  const valid = start >= 0 && end > start && text.split(open).length === 2 && text.split(close).length === 2;
  let value = null; const raw = valid ? text.slice(start + open.length, end).trim() : "";
  if (raw) { try { value = JSON.parse(raw); } catch { /* Retain malformed artifacts; do not repair. */ } }
  return { valid: valid && value !== null, value, raw, start, end: end + close.length };
}

export function parseClosureOutput(text, arm, replay = loadClosurePacket()) {
  const final = extract(text, "final-answer"), closure = extract(text, "criterion-closure"), errors = [];
  const finalSchemaValid = final.valid && Boolean(finalValid(final.value));
  if (!finalSchemaValid) errors.push("invalid_final_artifact");
  if (Buffer.byteLength(final.raw) > replay.fixture.runtime.maximumFinalArtifactBytes) errors.push("final_artifact_byte_limit");
  if (Buffer.byteLength(text) > replay.fixture.runtime.maximumAnswerBytes) errors.push("terminal_byte_limit");
  if (arm === "E") {
    if (text.includes("<criterion-closure>")) errors.push("unexpected_E_closure");
  } else {
    if (!closure.valid || !closureValid(closure.value)) errors.push("invalid_closure");
    else {
      const rows = closure.value.criterionChecks, keys = replay.fixture.task.criteria.map(row => row.criterionKey);
      if (JSON.stringify(rows.map(row => row.criterionKey)) !== JSON.stringify(keys)) errors.push("canonical_criterion_coverage_or_order");
      for (const row of rows) {
        if (row.status === "satisfied" ? row.missing.length !== 0 || row.evidenceRefs.length === 0 : row.missing.length === 0) errors.push("closure_status_missing_mismatch");
      }
    }
    if (!final.valid || !closure.valid || closure.end > final.start) errors.push("closure_not_before_final");
  }
  return { final, closure, finalSchemaValid, errors, finalArtifactSha256: hash(final.raw),
    finalArtifactBytes: Buffer.byteLength(final.raw), closureBytes: Buffer.byteLength(closure.raw), terminalBytes: Buffer.byteLength(text) };
}

export function deterministicCriteria(artifact, successfulRefs, replay = loadClosurePacket()) {
  const oracle = retentionOracle(replay), rubric = read(`${directory}/scoring.json`);
  const checks = Object.fromEntries(replay.fixture.task.criteria.map(row => [row.criterionKey, false]));
  if (!finalValid(artifact)) return checks;
  const rows = artifact.decisions, ids = rows.map(row => row.objectId), byId = new Map(rows.map(row => [row.objectId, row]));
  const decisionIs = (id, decision) => byId.get(id)?.decision === decision;
  checks.criterion_qa076_identity = sameSet(ids, oracle.inventory.objects.map(row => row.objectId));
  checks.criterion_qa076_newest = oracle.newest.every(id => decisionIs(id, "retain"));
  checks.criterion_qa076_protection = oracle.protectedIds.every(id => decisionIs(id, oracle.decisions[id]));
  checks.criterion_qa076_age = Object.entries(oracle.decisions).filter(([, decision]) => decision !== "hold").every(([id, decision]) => decisionIs(id, decision));
  checks.criterion_qa076_uncertainty = oracle.heldIds.every(id => decisionIs(id, "hold")) && sameSet(artifact.unresolved.map(row => row.objectId), oracle.heldIds);
  checks.criterion_qa076_accounting = Object.keys(oracle.totals).every(key => artifact.totals[key] === oracle.totals[key]);
  checks.criterion_qa076_regressions = sameSet(artifact.tests.map(row => row.caseKey), rubric.requiredTestKeys);
  checks.criterion_qa076_support = [...rows, ...artifact.unresolved].every(row => row.evidenceRefs.every(ref => successfulRefs.includes(ref)));
  return checks; // True is only a necessary condition; source relevance/meaning remains manual.
}

export function assessClosureOutput(text, arm, replay, successfulRefs, review = null) {
  const parsed = parseClosureOutput(text, arm, replay), rubric = read(`${directory}/scoring.json`);
  const checks = deterministicCriteria(parsed.final.value, successfulRefs, replay);
  let reviewValid = false;
  if (review) {
    assert.equal(review.finalArtifactSha256, parsed.finalArtifactSha256, "Semantic review belongs to another artifact");
    assert.ok(sameSet(review.criteria.map(row => row.criterionKey), replay.fixture.task.criteria.map(row => row.criterionKey)));
    for (const item of [...review.criteria, ...review.unsupportedAdditions]) {
      assert.ok(item.reason?.trim());
      if (item.status) assert.ok(rubric.states.includes(item.status));
      assert.ok(Array.isArray(item.quotes));
      if (item.status === "pass") assert.ok(item.quotes.length > 0);
      for (const quote of item.quotes) assert.ok(quote && parsed.final.raw.includes(quote), "Nonexistent semantic-review quote");
    }
    reviewValid = true;
  }
  const criteria = replay.fixture.task.criteria.map(criterion => {
    const manual = review?.criteria.find(row => row.criterionKey === criterion.criterionKey);
    const status = !checks[criterion.criterionKey] ? "fail" : !reviewValid ? "unscorable" : manual.status;
    return { criterionKey: criterion.criterionKey, required: criterion.required, deterministicNecessaryConditions: checks[criterion.criterionKey], status };
  });
  const additions = review?.unsupportedAdditions ?? null;
  if (additions?.length) criteria.find(row => row.criterionKey === "criterion_qa076_support").status = "fail";
  const withinLimits = parsed.finalArtifactBytes <= replay.fixture.runtime.maximumFinalArtifactBytes && parsed.terminalBytes <= replay.fixture.runtime.maximumAnswerBytes;
  const bindingErrors = [];
  if (arm === "F" && closureValid(parsed.closure.value)) {
    for (const row of parsed.closure.value.criterionChecks) for (const ref of row.evidenceRefs) {
      if (!successfulRefs.includes(ref)) bindingErrors.push(`${row.criterionKey}:${ref}:no_full_current_run_return`);
    }
  }
  const criterionToFinalStatus = arm === "E" || !closureValid(parsed.closure.value) ? [] : parsed.closure.value.criterionChecks.map(row => {
    const result = criteria.find(item => item.criterionKey === row.criterionKey)?.status;
    return { criterionKey: row.criterionKey, asserted: row.status, final: result,
      comparison: result === "unscorable" || !result ? "unscorable" : result === "pass" ?
        row.status === "satisfied" ? "consistent" : "underclaimed" : row.status === "satisfied" ? "overclaimed" : "consistent_failure" };
  });
  return { parsed, criteria, bindingErrors, reviewValid,
    fullRequiredDeliverablePass: parsed.finalSchemaValid && withinLimits && criteria.every(row => !row.required || row.status === "pass"),
    criticalCriteriaPass: parsed.finalSchemaValid && withinLimits && criteria.filter(row => replay.fixture.task.criticalCriterionKeys.includes(row.criterionKey)).every(row => row.status === "pass"),
    correctContentPreservation: rubric.preservation.map(item => ({ id: item.id, status: criteria.find(row => row.criterionKey === item.criterionKey).status })),
    unsupportedAdditions: additions, unresolvedPreservation: criteria.find(row => row.criterionKey === "criterion_qa076_uncertainty").status,
    criterionToFinalStatus, closureSemanticReview: arm === "F" ? "independent_missing_and_source_relevance_review_required" : "not_applicable" };
}

export function inspectClosureRun(replay, row, review = null) {
  const reading = inspectManipulation(replay, row, closureInstruction(row.treatment, replay));
  const assessment = assessClosureOutput(row.finalAnswer ?? "", row.treatment, replay, reading.fullSourcesBeforeAnswer, review);
  return { ...reading, evidenceUseRuleSupplied: reading.instructionValid, assessment,
    fullRequiredDeliverablePass: reading.delivered && assessment.fullRequiredDeliverablePass,
    criticalCriteriaPass: reading.delivered && assessment.criticalCriteriaPass,
    commonManipulationValid: reading.setup === "passed" && reading.delivered && reading.requiredReading === "complete" && assessment.parsed.finalSchemaValid &&
      !assessment.parsed.errors.includes("unexpected_E_closure"),
    closureProtocol: row.treatment === "E" ? assessment.parsed.errors.includes("unexpected_E_closure") ? "unexpected" : "not_required" :
      assessment.parsed.errors.length === 0 && assessment.bindingErrors.length === 0 ? "structurally_valid" : "failed" };
}
