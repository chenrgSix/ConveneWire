import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { handoffFixture } from "./codex-handoff-fixture.mjs";

const executable = process.env.CONVENE_WIRE_CODEX_HANDOFF_TEST_BIN;

const desktopTool = { name: "desktop_fixture_tool", description: "Synthetic desktop-owned tool",
  inputSchema: { type: "object", properties: {}, additionalProperties: false } };

function respondWithDesktopTool(fixture, anchor) {
  fixture.setResponder((input, index) => {
    assert.ok(JSON.stringify(input.input).includes(anchor), "Queued continuation must retain original history");
    if (index === 2) return { id: "tool_queued", type: "function_call", name: desktopTool.name,
      arguments: "{}", call_id: "call_queued", status: "completed" };
    assert.equal(index, 3);
    const output = input.input.find(item => item.type === "function_call_output" && item.call_id === "call_queued");
    assert.equal(output?.output, "DESKTOP_SYNTHETIC_CALLBACK");
    return "Queued continuation completed in the original writer.";
  });
}

async function expectQueuedCompletion(desktop, threadId, clientId) {
  const started = await desktop.waitFor(message => message.method === "item/started" &&
    message.params.threadId === threadId && message.params.item.type === "userMessage" &&
    message.params.item.clientId === clientId);
  const completed = await desktop.waitFor(message => message.method === "turn/completed" &&
    message.params.threadId === threadId && message.params.turn.id === started.params.turnId);
  assert.equal(completed.params.turn.status, "completed", JSON.stringify(completed.params.turn.error));
  return started.params.turnId;
}

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

test("a shared-service queue can continue an idle Thread without subscribing to desktop tool callbacks", {
  skip: !executable, timeout: 120_000
}, async t => {
  const fixture = await handoffFixture(t, executable);
  const desktop = await fixture.client({ shared: true, toolResult: "DESKTOP_SYNTHETIC_CALLBACK" });
  const start = await desktop.rpc("thread/start", { cwd: fixture.workspace, sandbox: "read-only", approvalPolicy: "never",
    dynamicTools: [desktopTool] });
  const anchor = "SYNTHETIC_IDLE_QUEUE_ANCHOR";
  const originalTurnId = await desktop.turn(start.thread.id, anchor);
  const room = await fixture.client({ shared: true });
  respondWithDesktopTool(fixture, anchor);
  const clientId = randomUUID();
  await room.rpc("thread/queue/add", { threadId: start.thread.id, clientUserMessageId: clientId,
    input: [{ type: "text", text: "Continue with the original desktop tool." }] });
  // No resume, subscription or queue/start: the original writer drains its queue.
  const queuedTurnId = await expectQueuedCompletion(desktop, start.thread.id, clientId);
  assert.notEqual(queuedTurnId, originalTurnId);
  assert.deepEqual((await room.rpc("thread/queue/list", { threadId: start.thread.id })).data, []);
  assert.equal(desktop.notifications.filter(message => message.method === "item/tool/call").length, 1);
  assert.equal(room.notifications.filter(message => message.method === "item/tool/call").length, 0);
  assert.equal(fixture.calls.length, 3);
  fixture.checkProvider();
});

test("an independent queue producer waits for the active original turn and preserves its tool handler", {
  skip: !executable, timeout: 120_000
}, async t => {
  const fixture = await handoffFixture(t, executable);
  const desktop = await fixture.client({ toolResult: "DESKTOP_SYNTHETIC_CALLBACK" });
  const start = await desktop.rpc("thread/start", { cwd: fixture.workspace, sandbox: "read-only", approvalPolicy: "never",
    dynamicTools: [desktopTool] });
  const anchor = "SYNTHETIC_ACTIVE_QUEUE_ANCHOR";
  let release, reached;
  const blocked = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { reached = resolve; });
  fixture.setResponder(async () => { reached(); await blocked; return "Original turn completed."; });
  const running = desktop.turn(start.thread.id, anchor);
  running.catch(() => {});
  const clientId = randomUUID();
  let room, originalTurnId;
  try {
    await Promise.race([entered, running]);
    room = await fixture.client();
    const queued = await room.rpc("thread/queue/add", { threadId: start.thread.id, clientUserMessageId: clientId,
      input: [{ type: "text", text: "After the current turn, continue using the desktop tool." }] });
    const listed = await desktop.rpc("thread/queue/list", { threadId: start.thread.id });
    assert.deepEqual(listed.data.map(item => item.id), [queued.queuedSubmission.id]);
    assert.equal(fixture.calls.length, 1, "Queueing must not start a concurrent provider request");
    assert.equal(desktop.notifications.filter(message => message.method === "turn/started").length, 1);
    respondWithDesktopTool(fixture, anchor);
  } finally {
    release();
    originalTurnId = await running;
  }
  const queuedTurnId = await expectQueuedCompletion(desktop, start.thread.id, clientId);
  assert.notEqual(queuedTurnId, originalTurnId, "Queue must create a later turn, not steer the active one");
  const completionIndex = desktop.notifications.findIndex(message => message.method === "turn/completed" && message.params.turn.id === originalTurnId);
  const nextStartIndex = desktop.notifications.findIndex(message => message.method === "turn/started" && message.params.turn.id === queuedTurnId);
  assert.ok(nextStartIndex > completionIndex);
  assert.deepEqual((await room.rpc("thread/queue/list", { threadId: start.thread.id })).data, []);
  assert.equal(desktop.notifications.filter(message => message.method === "item/tool/call").length, 1);
  assert.equal(room.notifications.filter(message => message.method === "item/tool/call").length, 0);
  assert.equal(fixture.calls.length, 3);
  fixture.checkProvider();
});

test("an independent queue producer cannot immediately start an idle original writer", {
  skip: !executable, timeout: 120_000
}, async t => {
  const fixture = await handoffFixture(t, executable);
  const desktop = await fixture.client();
  const start = await desktop.rpc("thread/start", { cwd: fixture.workspace, sandbox: "read-only", approvalPolicy: "never" });
  await desktop.turn(start.thread.id, "SYNTHETIC_IDLE_INDEPENDENT_ANCHOR");
  const room = await fixture.client();
  const queued = await room.rpc("thread/queue/add", { threadId: start.thread.id, clientUserMessageId: randomUUID(),
    input: [{ type: "text", text: "SYNTHETIC_IDLE_INDEPENDENT_MESSAGE" }] });
  await assert.rejects(room.rpc("thread/queue/start", { threadId: start.thread.id,
    queuedSubmissionId: queued.queuedSubmission.id }), /resume the thread before starting a queued message/);
  await assert.rejects(room.rpc("thread/resume", { threadId: start.thread.id }), /active writer/);
  // This is a bounded observation, not a claim that no later desktop action can drain it.
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual((await desktop.rpc("thread/queue/list", { threadId: start.thread.id })).data.map(item => item.id), [queued.queuedSubmission.id]);
  assert.deepEqual(await room.rpc("thread/queue/delete", { threadId: start.thread.id,
    queuedSubmissionId: queued.queuedSubmission.id }), { deleted: true });
  assert.deepEqual((await desktop.rpc("thread/queue/list", { threadId: start.thread.id })).data, []);
  fixture.checkProvider();
});

test("queue client message IDs do not deduplicate retries or reject changed payloads", {
  skip: !executable, timeout: 120_000
}, async t => {
  const fixture = await handoffFixture(t, executable);
  const desktop = await fixture.client();
  const start = await desktop.rpc("thread/start", { cwd: fixture.workspace, sandbox: "read-only", approvalPolicy: "never" });
  await desktop.turn(start.thread.id, "SYNTHETIC_QUEUE_RETRY_ANCHOR");
  await desktop.stop(); // Keep the queue stationary while checking retry semantics.
  const room = await fixture.client();
  const request = { threadId: start.thread.id, clientUserMessageId: randomUUID(),
    input: [{ type: "text", text: "SYNTHETIC_ORIGINAL_QUEUED_PAYLOAD" }] };
  const original = await room.rpc("thread/queue/add", request);
  const retried = await room.rpc("thread/queue/add", request);
  const changed = await room.rpc("thread/queue/add", { ...request,
    input: [{ type: "text", text: "SYNTHETIC_CHANGED_QUEUED_PAYLOAD" }] });
  const ids = [original, retried, changed].map(result => result.queuedSubmission.id);
  assert.equal(new Set(ids).size, 3, "The native queue accepts every repeated request as a new entry");
  const listed = await room.rpc("thread/queue/list", { threadId: start.thread.id });
  assert.deepEqual(listed.data.map(item => item.id), ids);
  assert.ok(listed.data.every(item => item.clientUserMessageId === request.clientUserMessageId));
  assert.deepEqual(listed.data.map(item => item.input[0].text), [request.input[0].text, request.input[0].text, "SYNTHETIC_CHANGED_QUEUED_PAYLOAD"]);
  assert.equal(fixture.calls.length, 1, "Retry inspection must not execute queued messages");
  fixture.checkProvider();
});
