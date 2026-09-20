import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestResources } from "../test/resources.mjs";
import { spawnTestProcess } from "../test/child-process.mjs";
import { handoffFixture } from "./codex-handoff-fixture.mjs";

const native = process.env.CONVENE_WIRE_CODEX_HANDOFF_TEST_BIN;
const bridge = fileURLToPath(new URL("../../bridge", import.meta.url));

test("installed Codex through the original-client stdio mediator", {
  skip: !native || !["darwin", "linux"].includes(process.platform), timeout: 120_000
}, async t => {
  const resources = await createTestResources(t, "convenewire-mediator-build-");
  const mediatorExecutable = path.join(resources.directory, "mediator-fixture");
  const build = spawnTestProcess(resources, "go", ["build", "-o", mediatorExecutable, "./internal/desktopcodex/testdata/mediator"], {
    cwd: bridge, stdio: ["ignore", "pipe", "pipe"]
  });
  let buildLog = "";
  for (const stream of [build.process.stdout, build.process.stderr]) stream.on("data", data => { buildLog = (buildLog + data).slice(-4096); });
  assert.equal((await build.terminal).code, 0, buildLog);

  await t.test("same ID, original callback, exact result, retry and return", async t => {
    const fixture = await handoffFixture(t, native);
    const desktop = await fixture.client({ mediatorExecutable, toolResult: "ORIGINAL_DESKTOP_CALLBACK" });
    const started = await desktop.rpc("thread/start", {
      cwd: fixture.workspace, sandbox: "read-only", approvalPolicy: "never",
      dynamicTools: [{ name: "desktop_fixture_tool", description: "Synthetic original-client tool",
        inputSchema: { type: "object", properties: {}, additionalProperties: false } }]
    });
    const threadId = started.thread.id, anchor = "SYNTHETIC_MEDIATOR_PRIVATE_ANCHOR";
    await desktop.turn(threadId, anchor);
    const { fence } = await desktop.control("hold", { threadId });
    const metadata = await desktop.control("read", { fence });
    assert.equal(metadata.thread.id, threadId);
    assert.deepEqual(metadata.thread.turns, []);
    await assert.rejects(desktop.control("read", { fence: "unissued" }), /not available/);
    for (const method of ["turn/start", "turn/steer", "thread/resume", "thread/queue/add", "thread/archive"]) {
      await assert.rejects(desktop.rpc(method, { threadId, input: [{ type: "text", text: "must be fenced" }] }), /return control/);
    }
    fixture.setResponder((input, index) => {
      assert.ok(JSON.stringify(input.input).includes(anchor));
      if (index === 2) return { id: "mediator_tool", type: "function_call", name: "desktop_fixture_tool",
        arguments: "{}", call_id: "mediator_call", status: "completed" };
      if (index === 3) {
        assert.equal(input.input.find(item => item.type === "function_call_output" && item.call_id === "mediator_call")?.output, "ORIGINAL_DESKTOP_CALLBACK");
        return "The reviewed continuation is complete.";
      }
      assert.equal(index, 4); return "Desktop control returned with the original history.";
    });
    const operation = { fence, operationId: randomUUID(), text: "Continue in this original Thread and use its synthetic tool." };
    const result = await desktop.control("execute", operation);
    assert.ok(result.TurnID);
    assert.equal(result.Text, "The reviewed continuation is complete.");
    assert.ok(!JSON.stringify(result).includes(anchor), "Old private content must not be bulk-returned");
    assert.equal(desktop.notifications.filter(item => item.method === "item/tool/call").length, 1);
    assert.equal(fixture.calls.length, 3);
    assert.deepEqual(await desktop.control("execute", operation), result);
    await assert.rejects(desktop.control("execute", { ...operation, text: "changed operation" }), /changed outside/);
    assert.equal(fixture.calls.length, 3, "Repeated operation cannot invoke the provider again");
    await desktop.control("release", { fence });
    await assert.rejects(desktop.control("execute", { ...operation, operationId: randomUUID() }), /not available/);
    await desktop.turn(threadId, "Continue after returning control.");
    const restored = await desktop.rpc("thread/read", { threadId, includeTurns: true });
    assert.equal(restored.thread.id, threadId);
    assert.equal(restored.thread.turns.length, 3);
    assert.ok(JSON.stringify(restored.thread.turns).includes(anchor));
    assert.equal(fixture.calls.length, 4);
    fixture.checkProvider();
  });

  await t.test("busy source is refused; an independent queued turn pauses the fence", async t => {
    const fixture = await handoffFixture(t, native);
    const desktop = await fixture.client({ mediatorExecutable });
    const started = await desktop.rpc("thread/start", { cwd: fixture.workspace, sandbox: "read-only", approvalPolicy: "never" });
    const threadId = started.thread.id;
    let release, entered;
    let gate = new Promise(resolve => { release = resolve; });
    let reached = new Promise(resolve => { entered = resolve; });
    fixture.setResponder(async () => { entered(); await gate; return "Original private turn."; });
    const original = desktop.turn(threadId, "Original context"); original.catch(() => {});
    await Promise.race([reached, original]);
    try { await assert.rejects(desktop.control("hold", { threadId }), /busy/); }
    finally { release(); await original; }

    const { fence } = await desktop.control("hold", { threadId });
    gate = new Promise(resolve => { release = resolve; });
    reached = new Promise(resolve => { entered = resolve; });
    fixture.setResponder(async (_input, index) => {
      if (index === 2) { entered(); await gate; return "Only this reviewed result is eligible."; }
      assert.equal(index, 3); return "EXTERNAL_PRIVATE_QUEUE_RESULT";
    });
    const own = desktop.control("execute", { fence, operationId: randomUUID(), text: "One reviewed continuation" }); own.catch(() => {});
    await Promise.race([reached, own]);
    const clientId = randomUUID();
    try {
      await assert.rejects(desktop.control("release", { fence }), /busy/);
      const producer = await fixture.client();
      await producer.rpc("thread/queue/add", { threadId, clientUserMessageId: clientId,
        input: [{ type: "text", text: "External private input, not a Room request." }] });
      await assert.rejects(desktop.rpc("turn/start", { threadId, input: [{ type: "text", text: "must not interleave" }] }), /return control/);
    } finally { release(); }
    const result = await own;
    assert.equal(result.Text, "Only this reviewed result is eligible.");
    const foreign = await desktop.waitFor(item => item.method === "item/started" && item.params.item.type === "userMessage" && item.params.item.clientId === clientId);
    await desktop.waitFor(item => item.method === "turn/completed" && item.params.turn.id === foreign.params.turnId);
    assert.equal((await desktop.control("state", { fence })).Paused, true);
    await assert.rejects(desktop.control("execute", { fence, operationId: randomUUID(), text: "must wait for reconciliation" }), /changed outside/);
    await desktop.control("release", { fence });
    assert.equal(fixture.calls.length, 3);
    fixture.checkProvider();
  });
});
