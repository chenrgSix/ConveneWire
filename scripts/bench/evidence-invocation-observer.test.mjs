import assert from "node:assert/strict";
import test from "node:test";
import { boundedUtf8, createInvocationObserver } from "./evidence-invocation-observer.mjs";

const observer = (options = {}) => createInvocationObserver({ treatment: "B", maximumAnswerBytes: 128, maximumReadCalls: 2, ...options });
const call = (stage, overrides = {}) => ({ type: `item.${stage}`, item: {
  id: "call_1", type: "mcp_tool_call", server: "evidence", tool: "read_evidence", ...overrides } });

test("started foreign calls retain identity and rejection without tool arguments or raw errors", () => {
  const log = observer();
  assert.equal(log.observe(call("started", { server: "foreign", tool: "list_resources",
    arguments: { secret: "DO_NOT_RETAIN", path: "/private/owner" }, error: "DO_NOT_RETAIN" })), true);
  assert.deepEqual(log.state.failures, ["unapproved_tool"]);
  assert.equal(log.state.toolEvents[0].stage, "item.started");
  assert.equal(log.state.toolEvents[0].server, "foreign");
  assert.equal(log.state.toolEvents[0].tool, "list_resources");
  assert.equal(log.state.toolEvents[0].decision, "rejected");
  assert.ok(!JSON.stringify(log.state).includes("DO_NOT_RETAIN"));
  assert.ok(!JSON.stringify(log.state).includes("/private/owner"));
});

test("incomplete starts join updates and terminal calls without double counting", () => {
  const log = observer({ maximumReadCalls: 1 });
  assert.equal(log.observe(call("started", { server: undefined, tool: undefined })), false);
  assert.equal(log.state.toolEvents[0].decision, "pending_identity");
  assert.equal(log.observe(call("updated")), false);
  assert.equal(log.observe(call("completed", { server: undefined, tool: undefined, status: "completed" })), false);
  assert.equal(log.state.toolEvents[2].decision, "allowed");
  assert.deepEqual(log.state.failures, []);
  assert.equal(log.observe(call("started", { id: "call_2" })), true);
  assert.deepEqual(log.state.failures, ["tool_call_limit"]);
});

test("missing terminal identity, anonymous calls, malformed identities and baseline reads fail closed", () => {
  for (const item of [call("completed", { server: undefined, tool: undefined }), call("started", { id: undefined })]) {
    const log = observer(); assert.equal(log.observe(item), true);
    assert.deepEqual(log.state.failures, ["tool_identity_missing"]);
  }
  const malformed = observer();
  assert.equal(malformed.observe(call("started", { tool: "/private/owner" })), true);
  assert.equal(malformed.state.toolEvents[0].tool, null);
  assert.ok(!JSON.stringify(malformed.state).includes("/private/owner"));
  const baseline = observer({ treatment: "A" });
  assert.equal(baseline.observe(call("started")), true);
});

test("native search is metadata only; resource fallback and command execution are rejected", () => {
  const log = observer();
  assert.equal(log.observe(call("completed", { type: "tool_search", server: undefined, tool: undefined })), false);
  assert.equal(log.state.toolEvents[0].decision, "metadata_only");
  for (const type of ["command_execution", "file_change"]) {
    assert.equal(log.observe(call("started", { type })), true);
    assert.equal(log.state.toolEvents.at(-1).rawKind, type);
  }
});

test("retained progress, terminal events and tool returns remain separate", () => {
  const log = observer();
  log.observe({ type: "item.completed", item: { type: "agent_message", id: "message_1", phase: "commentary", text: "Checking evidence." } });
  log.observe(call("completed", { status: "failed" }));
  log.observe({ type: "turn.failed" });
  assert.equal(log.state.turnCompleted, false);
  assert.equal(log.state.turnFailed, true);
  assert.deepEqual(log.state.failures, ["tool_return_failed", "turn.failed"]);
  assert.equal(log.state.messages[0].phase, "commentary");
  for (const completeIdentity of [false, true]) {
    const incomplete = observer();
    incomplete.observe(call("started", completeIdentity ? {} : { server: undefined, tool: undefined }));
    incomplete.observe({ type: "turn.completed" });
    assert.deepEqual(incomplete.state.failures, [completeIdentity ? "tool_call_incomplete" : "tool_identity_missing"]);
  }
});

test("malformed CLI events fail closed without throwing", () => {
  for (const event of [null, [], "invalid", { type: 123 }]) {
    const log = observer(); assert.equal(log.observe(event), true);
    assert.deepEqual(log.state.failures, ["invalid_cli_event"]);
  }
});

test("telemetry caps and UTF-8 limits preserve bounded valid records", () => {
  const log = observer({ maximumAnswerBytes: 3 });
  assert.equal(boundedUtf8("A中B", 3), "A");
  for (let i = 0; i < 18; i++) log.observe({ type: "item.completed", item: { type: "agent_message", text: "A中B" } });
  assert.equal(log.state.messages.length, 16); assert.equal(log.state.omittedMessages, 2);
  assert.ok(log.state.messages.every(message => message.text === "A"));
  for (let i = 0; i < 65; i++) log.observe(call("updated"));
  assert.equal(log.state.toolEvents.length, 64); assert.equal(log.state.omittedToolEvents, 1);
  assert.deepEqual(log.state.failures, ["answer_byte_limit", "tool_event_limit"]);
});
