import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { runAuthorityFinalizer, replayTerminalIntent, retainTerminalIntent, terminalIntent } from "./authority-session.mjs";
import { sessionFixture } from "./authority-session-fixture.mjs";
import { childCommand, hash } from "./authority-collaboration.mjs";

function capture(scenario, f, result, snapshot, extra = {}) {
  if (!process.env.CONVENE_WIRE_QA080_CAPTURE) return;
  const record = { scenario, observedAt: new Date().toISOString(), externalModelCalls: 0,
    fixtureProviderRequests: f.observations.requests, runtimeOutcome: result.row?.outcome ?? null,
    persistence: result.persistence, cause: result.intent?.cause ?? null,
    sourceReturns: result.row?.reads.filter(r => r.receipt.status === "returned").length ?? 0,
    sourceReachedFixtureProvider: f.observations.sourceReachedProvider,
    metadataOutputs: f.observations.nativeDiscoveryOutputs,
    toolEvents: result.row?.toolEvents ?? [], terminalEvent: snapshot.runEvents.finalizer.at(-1),
    runEventCount: snapshot.runEvents.finalizer.length, resultCount: snapshot.results.length, ...extra };
  appendFileSync(process.env.CONVENE_WIRE_QA080_CAPTURE, JSON.stringify(record) + "\n", { mode: 0o600 });
}

test("installed CLI resource/template discovery then scoped read reaches provider and actual Result", { timeout: 60000 }, async t => {
  const f = await sessionFixture(t);
  const r = await runAuthorityFinalizer(f); f.checkProvider();
  assert.equal(r.persistence, "result_proposed", JSON.stringify(r));
  assert.equal(r.row.outcome, "completed"); assert.equal(r.row.reads.length, 1);
  assert.equal(f.observations.nativeDiscoveryOutputs.length, 2);
  assert.ok(f.observations.sourceReachedProvider);
  assert.equal(r.row.toolEvents.filter(e => e.stage === "item.completed" && e.server === "codex" && e.decision === "metadata_only").length, 2);
  const snapshot = (await f.central({ mode: "inspect", meta: f.meta })).response;
  assert.equal(snapshot.results.length, 1); assert.equal(snapshot.results[0].review, null);
  assert.equal(snapshot.runEvents.finalizer.at(-1).status, "completed");
  assert.equal(snapshot.task.completionResultId, null); assert.ok(!existsSync(f.intentPath));
  capture("discovery_then_read", f, r, snapshot);
});

for (const [mode, expectedCause] of [["metadata_only", "EVIDENCE_INCOMPLETE"], ["raw_read", "TOOL_PROTOCOL"], ["revoked", "TOOL_PROTOCOL"],
  ["resource_read", "TOOL_PROTOCOL"], ["timeout", "TIMEOUT"], ["cancel", "CANCELED"], ["no_final", "NO_FINAL"], ["progress_only", "EVIDENCE_INCOMPLETE"]]) {
  test(`installed CLI ${mode} produces no Result and converges to a safe terminal`, { timeout: 60000 }, async t => {
    const f = await sessionFixture(t, mode);
    const r = await runAuthorityFinalizer(f); f.checkProvider();
    assert.equal(r.persistence, "terminal", JSON.stringify(r));
    assert.equal(r.intent.cause, expectedCause, JSON.stringify(r.row));
    assert.equal(r.row.reads.filter(r => r.receipt.status === "returned").length, 0);
    const snapshot = (await f.central({ mode: "inspect", meta: f.meta })).response;
    assert.equal(snapshot.results.length, 0);
    assert.equal(snapshot.runEvents.finalizer.at(-1).status, mode === "cancel" ? "canceled" : "failed");
    assert.equal(snapshot.runEvents.finalizer.length, 2);
    const shared = JSON.stringify(snapshot.runEvents.finalizer);
    for (const forbidden of ["fixture://private-owner-source", "Synthetic metadata-only reply", "operations_raw"]) assert.ok(!shared.includes(forbidden));
    const replay = await replayTerminalIntent({ ...f, deliveryDirectory: path.join(f.directory, "replay") });
    assert.equal(replay.disposition, "replayed");
    assert.equal((await f.central({ mode: "inspect", meta: f.meta })).response.runEvents.finalizer.length, 2);
    await assert.rejects(() => runAuthorityFinalizer(f), /replayed without invoking/);
    capture(mode, f, r, snapshot, { repeatedTerminalDisposition: replay.disposition });
  });
}

test("spawn error and thrown harness error both close Central without sharing private exception text", { timeout: 60000 }, async t => {
  for (const mode of ["spawn", "throw"]) {
    const f = await sessionFixture(t);
    if (mode === "spawn") f.runtime.executable = path.join(f.directory, "absent-executable");
    else f.invoke = async () => { throw new Error("PRIVATE_EXCEPTION_BODY"); };
    const r = await runAuthorityFinalizer(f);
    assert.equal(r.persistence, "terminal");
    assert.equal(r.intent.cause, mode === "spawn" ? "PROCESS" : "HARNESS");
    const snapshot = (await f.central({ mode: "inspect", meta: f.meta })).response;
    assert.equal(snapshot.results.length, 0); assert.equal(snapshot.runEvents.finalizer.at(-1).status, "failed");
    assert.ok(!JSON.stringify(snapshot).includes("PRIVATE_EXCEPTION_BODY"));
    capture(mode, f, r, snapshot);
  }
});

test("terminal persistence failure and killed post-commit acknowledgment replay the same intent without another session", { timeout: 60000 }, async t => {
  const f = await sessionFixture(t);
  const intent = terminalIntent(f.meta, "finalizer", "TOOL_PROTOCOL"); retainTerminalIntent(f.intentPath, intent);
  const before = readFileSync(f.intentPath);
  const unavailable = await replayTerminalIntent({ ...f, databasePath: path.join(f.directory, "missing.sqlite") });
  assert.equal(unavailable.persistence, "pending_terminal");
  const killed = await replayTerminalIntent({ ...f, deliveryDirectory: path.join(f.directory, "killed"), crashAfterCommit: true });
  assert.equal(killed.persistence, "pending_terminal");
  const replay = await replayTerminalIntent({ ...f, deliveryDirectory: path.join(f.directory, "replayed") });
  assert.equal(replay.persistence, "terminal"); assert.equal(replay.disposition, "replayed");
  assert.equal(f.observations.requests, 0); assert.deepEqual(readFileSync(f.intentPath), before);
  const snapshot = (await f.central({ mode: "inspect", meta: f.meta })).response;
  assert.equal(snapshot.runEvents.finalizer.length, 2); assert.equal(snapshot.results.length, 0);
  capture("terminal_delivery_recovery", f, { persistence: replay.persistence, intent }, snapshot,
    { unavailablePersistence: unavailable.persistence, lostAcknowledgementPersistence: killed.persistence, replayDisposition: replay.disposition,
      immutableIntentSha256: hash(before) });
});

test("terminal scope substitution is rejected and an existing completed Run is never overwritten", { timeout: 60000 }, async t => {
  const f = await sessionFixture(t);
  const intent = terminalIntent(f.meta, "finalizer", "HARNESS");
  for (const key of Object.keys(intent.scope)) {
    const wrong = structuredClone(intent); wrong.scope[key] += "_foreign";
    const denied = await childCommand(f.resources, "scripts/bench/authority-run-terminal.mts",
      { databasePath: f.databasePath, intent: wrong }, path.join(f.directory, `denied-${key}`), { typescript: true });
    assert.notEqual(denied.exitCode, 0);
  }
  assert.equal((await f.central({ mode: "inspect", meta: f.meta })).response.runEvents.finalizer.length, 1);
  const done = await f.central({ mode: "final", meta: f.meta, role: "finalizer", finalAnswer: "Synthetic existing final for terminal-conflict regression only." });
  assert.equal(done.exitCode, 0, done.diagnostic);
  retainTerminalIntent(f.intentPath, intent);
  const r = await replayTerminalIntent(f);
  assert.equal(r.persistence, "terminal_conflict"); assert.equal(r.runState, "completed");
  const snapshot = (await f.central({ mode: "inspect", meta: f.meta })).response;
  assert.equal(snapshot.results.length, 1); assert.equal(snapshot.runEvents.finalizer.length, 3);
  capture("scope_and_existing_terminal", f, r, snapshot, { rejectedScopeSubstitutions: 6, disposition: r.disposition });
});
