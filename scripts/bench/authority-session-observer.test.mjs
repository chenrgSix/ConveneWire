import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createAuthorityObserver } from "./authority-session-observer.mjs";
import { createInvocationObserver } from "./evidence-invocation-observer.mjs";

const options = { treatment: "B", maximumAnswerBytes: 1024, maximumReadCalls: 1, maximumDiscoveryCalls: 2 };
const event = (stage, extra = {}) => ({ type: `item.${stage}`, item: { id: "call_one", type: "mcp_tool_call",
  server: "codex", tool: "list_mcp_resources", status: stage === "completed" ? "completed" : "in_progress", ...extra } });

test("actual QA-079 rejected start is now classified as metadata, while historical evidence stays failed", () => {
  const r = JSON.parse(readFileSync("docs/acceptance/evidence/qa-079-authority-experiment.json"));
  const row = r.scenarios.find(s => s.scenario === "revoked").final.row;
  assert.equal(row.outcome, "failed"); assert.equal(row.reads.length, 0);
  const rejected = row.toolEvents[0];
  const e = event("started", { id: rejected.itemId, server: rejected.server, tool: rejected.tool });
  assert.equal(createInvocationObserver(options).observe(e), true);
  const current = createAuthorityObserver(options);
  assert.equal(current.observe(e), false); assert.equal(current.state.toolEvents[0].decision, "metadata_only");
  assert.equal(current.state.toolEvents[0].kind, "mcp_tool_call");
});

test("resource and template discovery have a separate bound and preserve reader budget", () => {
  const o = createAuthorityObserver(options);
  for (const [i, tool] of ["list_mcp_resources", "list_mcp_resource_templates"].entries()) {
    assert.equal(o.observe(event("started", { id: `meta_${i}`, tool })), false);
    assert.equal(o.observe(event("completed", { id: `meta_${i}`, tool })), false);
  }
  assert.equal(o.observe(event("completed", { id: "read_one", server: "evidence", tool: "read_evidence" })), false);
  assert.deepEqual(o.state.failures, []);
  assert.equal(o.observe(event("started", { id: "meta_extra" })), true);
  assert.ok(o.state.failures.includes("discovery_call_limit"));
});

test("resource reads, foreign discovery, changed and malformed identities still fail closed without retaining arguments", () => {
  for (const extra of [{ tool: "read_mcp_resource" }, { server: "foreign" }, { tool: "/private/hidden" }, { id: undefined }]) {
    const o = createAuthorityObserver(options);
    assert.equal(o.observe(event("started", { ...extra, arguments: { secret: "DO_NOT_RETAIN" } })), true);
    assert.ok(!JSON.stringify(o.state).includes("DO_NOT_RETAIN"));
  }
  const o = createAuthorityObserver(options); o.observe(event("started"));
  assert.equal(o.observe(event("completed", { tool: "list_mcp_resource_templates" })), true);
  assert.ok(o.state.failures.includes("tool_identity_changed"));
});

test("failed or incomplete discovery does not become a successful terminal turn", () => {
  const failed = createAuthorityObserver(options);
  assert.equal(failed.observe(event("completed", { status: "failed", error: "PRIVATE_ERROR" })), true);
  assert.ok(failed.state.failures.includes("tool_return_failed"));
  assert.ok(!JSON.stringify(failed.state).includes("PRIVATE_ERROR"));
  const pending = createAuthorityObserver(options); pending.observe(event("started"));
  pending.observe({ type: "turn.completed" });
  assert.ok(pending.state.failures.includes("tool_call_incomplete"));
});
