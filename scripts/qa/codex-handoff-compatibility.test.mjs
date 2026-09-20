import assert from "node:assert/strict";
import test from "node:test";
import { handoffFixture } from "./codex-handoff-fixture.mjs";

const executable = process.env.CONVENE_WIRE_CODEX_HANDOFF_TEST_BIN;

test("installed Codex preserves one conversation through exclusive handoff and return", {
  skip: !executable, timeout: 120_000
}, async t => {
  const fixture = await handoffFixture(t, executable);
  const desktop = await fixture.client();
  t.diagnostic(`Native initialization: ${JSON.stringify(desktop.initialized)}`);
  const start = await desktop.rpc("thread/start", { cwd: fixture.workspace, sandbox: "read-only", approvalPolicy: "never" });
  const id = start.thread.id;
  t.diagnostic(`Source classification: ${JSON.stringify(start.thread.source)}`);
  const privateAnchor = "Only the original conversation knows SYNTHETIC_ANCHOR_4826.";
  await desktop.turn(id, privateAnchor);

  const room = await fixture.client();
  const listed = await room.rpc("thread/list", { cwd: fixture.workspace, sourceKinds: ["appServer", "cli", "vscode"], limit: 10 });
  assert.ok(listed.data.some(thread => thread.id === id));
  const read = await room.rpc("thread/read", { threadId: id, includeTurns: false });
  assert.equal(read.thread.id, id);
  assert.deepEqual(read.thread.turns, []);
  assert.equal(fixture.calls.length, 1, "Discovery cannot invoke a model turn");

  let occupied;
  try { await room.rpc("thread/resume", { threadId: id }); }
  catch (error) { occupied = error; }
  t.diagnostic(`Other live writer rejected: ${occupied?.message ?? "NO: second client resumed"}`);
  assert.ok(occupied, "Provider must reject an independently owned live Thread");
  assert.match(occupied.message, /active writer|already.*(use|loaded)|in use|owned|busy/i);
  assert.equal(fixture.calls.length, 1);

  await desktop.stop();
  const resumed = await room.rpc("thread/resume", { threadId: id });
  assert.equal(resumed.thread.id, id);
  assert.equal(resumed.cwd, fixture.workspace);
  assert.equal(resumed.model, start.model);
  assert.equal(resumed.approvalPolicy, start.approvalPolicy);
  assert.deepEqual(resumed.sandbox, start.sandbox);
  assert.ok(JSON.stringify(resumed.thread.turns).includes(privateAnchor));
  await room.turn(id, "Continue from the Room without repeating the earlier background.");
  assert.equal(fixture.calls.length, 2);
  assert.ok(JSON.stringify(fixture.calls[1].input).includes(privateAnchor));
  await room.stop();

  const returned = await fixture.client();
  const restored = await returned.rpc("thread/resume", { threadId: id });
  assert.equal(restored.thread.id, id);
  assert.equal(restored.thread.turns.length, 2);
  await returned.turn(id, "Continue after returning control to the original client.");
  assert.equal(fixture.calls.length, 3);
  assert.ok(JSON.stringify(fixture.calls[2].input).includes(privateAnchor));
  fixture.checkProvider();
});

test("resumed desktop dynamic tools require a real client handler", {
  skip: !executable, timeout: 120_000
}, async t => {
  const fixture = await handoffFixture(t, executable);
  const desktop = await fixture.client();
  const start = await desktop.rpc("thread/start", { cwd: fixture.workspace, sandbox: "read-only", approvalPolicy: "never",
    dynamicTools: [{ name: "desktop_fixture_tool", description: "Synthetic desktop-owned tool", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] });
  await desktop.turn(start.thread.id, "Remember this synthetic desktop tool configuration.");
  const metadata = await desktop.rpc("thread/read", { threadId: start.thread.id, includeTurns: false });
  assert.equal(metadata.thread.dynamicTools, undefined, "Metadata cannot certify a complete desktop tool inventory");
  await desktop.stop();
  const room = await fixture.client();
  const resumed = await room.rpc("thread/resume", { threadId: start.thread.id });
  assert.equal(resumed.dynamicTools, undefined);
  assert.equal(resumed.thread.dynamicTools, undefined);
  fixture.setResponder((input, index) => {
    if (index === 2) {
      assert.ok(JSON.stringify(input.tools).includes("desktop_fixture_tool"), "Resume retains dynamic tool registration");
      return { id: "tool_fixture", type: "function_call", name: "desktop_fixture_tool", arguments: "{}", call_id: "call_desktop", status: "completed" };
    }
    assert.equal(index, 3);
    const output = input.input.find(item => item.type === "function_call_output" && item.call_id === "call_desktop");
    assert.ok(output, "Missing desktop handler must be represented as a tool result");
    assert.equal(output.output, "dynamic tool request failed");
    t.diagnostic(`Missing desktop handler result: ${JSON.stringify(output.output)}`);
    return "The desktop tool has no handler in this fixture.";
  });
  await room.turn(start.thread.id, "Use the synthetic desktop tool.");
  assert.ok(room.notifications.some(item => item.method === "item/tool/call"));
  assert.equal(fixture.calls.length, 3);
  fixture.checkProvider();
});

test("unsubscribe is not immediate cross-process writer release", {
  skip: !executable, timeout: 120_000
}, async t => {
  const fixture = await handoffFixture(t, executable);
  const desktop = await fixture.client();
  const start = await desktop.rpc("thread/start", { cwd: fixture.workspace, sandbox: "read-only", approvalPolicy: "never" });
  await desktop.turn(start.thread.id, "Persist the disposable original conversation.");
  const result = await desktop.rpc("thread/unsubscribe", { threadId: start.thread.id });
  t.diagnostic(`Unsubscribe response: ${JSON.stringify(result)}`);
  const room = await fixture.client();
  await assert.rejects(room.rpc("thread/resume", { threadId: start.thread.id }), /active writer/);
  assert.equal(fixture.calls.length, 1, "An unsubscribe acknowledgment must not authorize a competing turn");
  await desktop.stop();
  const resumed = await room.rpc("thread/resume", { threadId: start.thread.id });
  assert.equal(resumed.thread.id, start.thread.id);
  assert.equal(fixture.calls.length, 1);
  fixture.checkProvider();
});

test("a competing client cannot take over an in-flight native turn", {
  skip: !executable, timeout: 120_000
}, async t => {
  const fixture = await handoffFixture(t, executable);
  const desktop = await fixture.client();
  const start = await desktop.rpc("thread/start", { cwd: fixture.workspace, sandbox: "read-only", approvalPolicy: "never" });
  let release, reached;
  const blocked = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { reached = resolve; });
  fixture.setResponder(async () => { reached(); await blocked; return "Original turn completed once."; });
  const running = desktop.turn(start.thread.id, "Hold this deterministic response until the competing client has checked.");
  running.catch(() => {}); // Preserve the error for await after releasing the fixture.
  try {
    await Promise.race([entered, running]);
    const room = await fixture.client();
    const read = await room.rpc("thread/read", { threadId: start.thread.id, includeTurns: false });
    t.diagnostic(`Other process metadata while original is active: ${JSON.stringify(read.thread.status)}`);
    await assert.rejects(room.rpc("thread/resume", { threadId: start.thread.id }), /active writer/);
    assert.equal(fixture.calls.length, 1, "Competing discovery and resume must not start another turn");
  } finally {
    release();
    await running;
  }
  fixture.checkProvider();
});

test("sharing an app-server does not establish exclusive client control", {
  skip: !executable, timeout: 120_000
}, async t => {
  const fixture = await handoffFixture(t, executable);
  const desktop = await fixture.client({ shared: true, toolResult: "DESKTOP_SYNTHETIC_CALLBACK" });
  const start = await desktop.rpc("thread/start", { cwd: fixture.workspace, sandbox: "read-only", approvalPolicy: "never",
    dynamicTools: [{ name: "desktop_fixture_tool", description: "Synthetic desktop-owned tool", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] });
  await desktop.turn(start.thread.id, "Persist the original shared-service conversation.");
  const room = await fixture.client({ shared: true, toolResult: "ROOM_SYNTHETIC_CALLBACK" });
  const resumed = await room.rpc("thread/resume", { threadId: start.thread.id });
  assert.equal(resumed.thread.id, start.thread.id, "Another client can subscribe to the same loaded Thread");
  fixture.setResponder((input, index) => {
    if (index === 2) return { id: "tool_shared", type: "function_call", name: "desktop_fixture_tool", arguments: "{}", call_id: "call_shared", status: "completed" };
    if (index === 3) {
      const output = input.input.find(item => item.type === "function_call_output" && item.call_id === "call_shared");
      assert.ok(output);
      assert.match(JSON.stringify(output.output), /(DESKTOP|ROOM)_SYNTHETIC_CALLBACK/);
      t.diagnostic(`Shared-service tool callback result: ${JSON.stringify(output.output)}`);
    }
    assert.ok(index === 3 || index === 4);
    return "Shared-service fixture turn completed.";
  });
  await room.turn(start.thread.id, "Continue from the receiving client and invoke the synthetic tool.");
  await Promise.all([desktop, room].map(client => client.waitFor(item => item.method === "item/tool/call")));
  const sourceCalls = desktop.notifications.filter(item => item.method === "item/tool/call").length;
  const receiverCalls = room.notifications.filter(item => item.method === "item/tool/call").length;
  assert.equal(sourceCalls, 1);
  assert.equal(receiverCalls, 1);
  t.diagnostic(`Shared-service callback recipients: source=${sourceCalls}, receiver=${receiverCalls}`);
  await desktop.turn(start.thread.id, "The original client can still start a turn without an explicit return operation.");
  assert.equal(fixture.calls.length, 4, "Shared subscription has not fenced the original client");
  fixture.checkProvider();
});
