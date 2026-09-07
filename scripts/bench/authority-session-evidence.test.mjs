import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { hash } from "./authority-collaboration.mjs";

const file = "docs/acceptance/evidence/qa-080-session-recovery.json";
test("retained QA-080 loopback and terminal evidence matches its implementation commit and unchanged QA-079", { skip: !existsSync(file) }, () => {
  const r = JSON.parse(readFileSync(file));
  assert.equal(r.externalModelCalls, 0); assert.match(r.sourceCommit, /^[0-9a-f]{40}$/u);
  for (const pin of r.implementationFiles) {
    assert.equal(hash(execFileSync("git", ["show", `${r.sourceCommit}:${pin.path}`])), pin.sha256);
  }
  for (const pin of r.historicalRecords) assert.equal(hash(readFileSync(pin.path)), pin.sha256);
  assert.equal(r.rows.length, 13); assert.equal(new Set(r.rows.map(row => row.scenario)).size, 13);
  for (const row of r.rows) {
    assert.equal(row.externalModelCalls, 0); assert.notEqual(row.terminalEvent.status, "working");
    assert.equal(row.resultCount, ["discovery_then_read", "scope_and_existing_terminal"].includes(row.scenario) ? 1 : 0);
    assert.equal(row.sourceReturns, row.scenario === "discovery_then_read" ? 1 : 0);
  }
  const normal = r.rows.find(row => row.scenario === "discovery_then_read");
  assert.ok(normal.sourceReachedFixtureProvider); assert.equal(normal.persistence, "result_proposed");
  assert.deepEqual(normal.metadataOutputs.map(JSON.parse), [{ resources: [] }, { resourceTemplates: [] }]);
  const recovery = r.rows.find(row => row.scenario === "terminal_delivery_recovery");
  assert.equal(recovery.fixtureProviderRequests, 0);
  assert.equal(recovery.lostAcknowledgementPersistence, "pending_terminal"); assert.equal(recovery.replayDisposition, "replayed");
  assert.equal(recovery.runEventCount, 2);
  const conflict = r.rows.find(row => row.scenario === "scope_and_existing_terminal");
  assert.equal(conflict.rejectedScopeSubstitutions, 6); assert.equal(conflict.persistence, "terminal_conflict");
  assert.equal(conflict.terminalEvent.status, "completed");
});
