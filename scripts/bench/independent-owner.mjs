import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { packet, json, hash, exclusive, pinDocument, sourceFor, replayFor, scopeFor,
  finalInstruction, localVerify, makeDisclosure, releaseProposal, revokeDisclosure,
  deliverWithConsent, inspectInvocation, childCommand } from "./authority-collaboration.mjs";
import { invokeAuthoritySession } from "./authority-session-runtime.mjs";
import { runAuthorityFinalizer, terminalIntent, retainTerminalIntent, replayTerminalIntent } from "./authority-session.mjs";

export const planPath = "docs/acceptance/fixtures/qa-081/plan.json";
export const plan = () => json(planPath);
export function independentInstruction(owner) {
  const p = packet(), { content, ...identity } = sourceFor(owner).doc;
  return [plan().ownerInstruction, `Owner domain: ${owner}`, `Public task: ${JSON.stringify(p.task)}`,
    `Permitted observation schema: ${JSON.stringify(p.disclosure.fields[owner])}`,
    `Authorized source identity: ${JSON.stringify(identity)}`].join("\n\n");
}
export function reserve(report, meta) {
  assert.equal(report.state, "running");
  const slot = plan().schedule[report.attempts.length]; assert.ok(slot, "Eight-session ceiling consumed");
  const entry = { ...slot, runId: meta.runs[slot.role], state: "reserved", reservedAt: new Date().toISOString() };
  report.attempts.push(entry); return entry;
}
export function gradeObservations(text, owner, values) {
  let candidate;
  try { candidate = JSON.parse(text); } catch { return { protocolValid: false, correct: [], incorrect: [], missing: packet().disclosure.fields[owner].map(f => f.checkId) }; }
  const rows = Array.isArray(candidate?.observations) ? candidate.observations : [];
  const fields = packet().disclosure.fields[owner].map(f => f.checkId);
  const protocolValid = candidate && Object.keys(candidate).length === 1 && Array.isArray(candidate.observations) &&
    rows.every(r => r && Object.keys(r).sort().join() === "checkId,value" && fields.includes(r.checkId)) &&
    new Set(rows.map(r => r.checkId)).size === rows.length;
  const correct = [], incorrect = [], missing = [];
  for (const field of fields) {
    const found = rows.filter(r => r?.checkId === field);
    if (!found.length) missing.push(field);
    else if (found.length === 1 && JSON.stringify(found[0].value) === JSON.stringify(values[field])) correct.push(field);
    else incorrect.push(field);
  }
  return { protocolValid: Boolean(protocolValid), correct, incorrect, missing };
}

export async function executeIndependent(resources, report, {
  invoke = invokeAuthoritySession, save = () => {}, retain = () => {}, executable,
  verify = localVerify
} = {}) {
  const p = packet();
  for (const scenario of plan().scenarios) {
    const directory = path.join(resources.directory, scenario); mkdirSync(directory);
    const databasePath = path.join(directory, "central.sqlite");
    const central = (request, name) => childCommand(resources, "scripts/bench/authority-central.mts",
      { databasePath, ...request }, path.join(directory, `central-${name}`), { typescript: true });
    const initialized = await central({ mode: "init", scenario: `qa081_${scenario}` }, "init");
    assert.equal(initialized.exitCode, 0, initialized.diagnostic);
    const meta = initialized.response;
    const record = { scenario, meta, observedAt: new Date().toISOString(), owners: [], publications: [], statuses: [] };
    report.scenarios.push(record); save();
    const issued = p.owners.map(owner => {
      const ownerDirectory = path.join(directory, owner); mkdirSync(ownerDirectory);
      const authority = makeDisclosure(meta, owner), authorityPath = path.join(ownerDirectory, "authority.json");
      exclusive(authorityPath, authority.state);
      const entry = reserve(report, meta); assert.equal(entry.role, owner); assert.equal(entry.scenario, scenario); save();
      return { owner, ownerDirectory, authorityPath, entry, ...authority };
    });
    assert.equal((await central({ mode: "start", meta, roles: p.owners }, "start-owners")).exitCode, 0);
    const settled = await Promise.allSettled(issued.map(async ctx => {
      const documents = [sourceFor(ctx.owner).doc], replay = replayFor(meta, documents), instruction = independentInstruction(ctx.owner);
      const runtimeDirectory = path.join(ctx.ownerDirectory, "runtime"); mkdirSync(runtimeDirectory);
      ctx.entry.state = "started"; save();
      const row = await invoke({ resources, replay, scheduled: ctx.entry, instruction, executable, directory: runtimeDirectory });
      const checked = inspectInvocation(meta, ctx.owner, row, replay, instruction);
      ctx.entry.state = "terminal"; ctx.entry.outcome = row.outcome; save();
      const proposal = { scenario, owner: ctx.owner, instruction, row, checked, retainedAt: new Date().toISOString() };
      // The wx proposal record is committed before the private verifier is invoked or materialized.
      retain("proposal", scenario, ctx.owner, proposal);
      const verifier = await verify(resources, meta, ctx.owner, path.join(ctx.ownerDirectory, "hidden-verifier"));
      assert.ok(Date.parse(verifier.observedAt) >= Date.parse(proposal.retainedAt));
      const validation = { scenario, owner: ctx.owner, proposalSha256: hash(JSON.stringify(proposal)), verifier,
        observations: gradeObservations(row.finalAnswer, ctx.owner, verifier.values) };
      retain("validation", scenario, ctx.owner, validation);
      return { ...ctx, row, checked, proposal, validation };
    }));
    for (const [i, outcome] of settled.entries()) {
      const ctx = issued[i];
      const failOwner = async cause => {
        const intentPath = path.join(ctx.ownerDirectory, "terminal-intent.json");
        retainTerminalIntent(intentPath, terminalIntent(meta, ctx.owner, cause));
        const closure = await replayTerminalIntent({ resources, databasePath, intentPath, deliveryDirectory: path.join(ctx.ownerDirectory, "terminal-delivery") });
        record.statuses.push({ owner: ctx.owner, status: "unavailable", reason: "owner_proposal_unavailable" });
        const prior = record.owners.find(o => o.owner === ctx.owner);
        if (prior) prior.closure = closure;
        else record.owners.push({ owner: ctx.owner, outcome: "unavailable", closure }); save();
      };
      if (outcome.status !== "fulfilled") { ctx.entry.state = "terminal"; ctx.entry.outcome = "harness_failed"; await failOwner("HARNESS"); continue; }
      const o = outcome.value;
      record.owners.push({ owner: ctx.owner, outcome: o.row.outcome, checked: o.checked,
        observations: o.validation.observations, proposalSha256: hash(JSON.stringify(o.proposal)),
        validationSha256: hash(JSON.stringify(o.validation)), originalGrantState: ctx.state });
      if (!o.checked.delivered || !o.checked.fullReadCoverage) { await failOwner("EVIDENCE_INCOMPLETE"); continue; }
      const expected = { ...scopeFor(meta, ctx.owner), owner: ctx.owner };
      let release;
      try { release = releaseProposal({ text: o.row.finalAnswer, verifier: o.validation.verifier,
        state: json(ctx.authorityPath), expected, privateKey: ctx.privateKey }); }
      catch { await failOwner("PUBLICATION"); continue; }
      if (scenario === "revoked" && ctx.owner === "operations") {
        const revoked = revokeDisclosure(ctx.authorityPath); let centralCalls = 0;
        await assert.rejects(() => deliverWithConsent(ctx.authorityPath, expected, release, () => { centralCalls++; }), /revoked/);
        assert.equal(centralCalls, 0);
        const withheld = await central({ mode: "withheld", meta, role: ctx.owner, revokedGrantState: revoked }, "withheld");
        assert.equal(withheld.exitCode, 0);
        record.revocation = { state: revoked, centralCalls, bufferedPublicationDenied: true, notice: withheld.response };
        record.statuses.push({ owner: ctx.owner, status: "withheld", reason: "disclosure_revoked" }); save(); continue;
      }
      const published = await deliverWithConsent(ctx.authorityPath, expected, release, grantState =>
        central({ mode: "publish", meta, role: ctx.owner, release, grantState }, `publish-${ctx.owner}`));
      assert.equal(published.exitCode, 0, published.diagnostic);
      record.publications.push({ owner: ctx.owner, release, result: published.response.result });
      record.statuses.push({ owner: ctx.owner, status: "released", observations: release.body.observations.map(r => r.checkId),
        missingObservations: p.disclosure.fields[ctx.owner].filter(f => !release.body.observations.some(r => r.checkId === f.checkId)).map(f => f.checkId) }); save();
    }
    const documents = record.publications.map(({ owner, result }) => pinDocument(`evidence_qa079_${owner}_released`, JSON.stringify(result)));
    if (!documents.length) documents.push(pinDocument("evidence_qa079_release_absence", JSON.stringify(record.statuses)));
    const replay = replayFor(meta, documents), instruction = finalInstruction(meta, documents, record.statuses);
    const entry = reserve(report, meta); assert.equal(entry.role, "finalizer"); assert.equal(entry.scenario, scenario); save();
    assert.equal((await central({ mode: "start", meta, roles: ["finalizer"] }, "start-finalizer")).exitCode, 0);
    const finalDirectory = path.join(directory, "finalizer"); mkdirSync(finalDirectory);
    entry.state = "started"; save();
    const result = await runAuthorityFinalizer({ resources, databasePath, meta, invoke,
      intentPath: path.join(directory, "final-terminal-intent.json"), deliveryDirectory: path.join(directory, "final-terminal-delivery"),
      runtime: { resources, replay, scheduled: entry, executable, instruction, directory: finalDirectory } });
    record.final = { instruction, ...result };
    entry.state = "terminal"; entry.outcome = result.row?.outcome ?? "harness_failed";
    const inspected = await central({ mode: "inspect", meta }, "inspect"); assert.equal(inspected.exitCode, 0, inspected.diagnostic);
    record.centralSnapshot = inspected.response; record.endedAt = new Date().toISOString();
    record.elapsedMilliseconds = Date.parse(record.endedAt) - Date.parse(record.observedAt); save();
  }
}
