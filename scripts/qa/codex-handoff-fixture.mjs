// Native compatibility fixture, not a production Codex control endpoint.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import WebSocket from "ws";
import { createTestResources } from "../test/resources.mjs";
import { spawnTestProcess } from "../test/child-process.mjs";

export async function handoffFixture(t, executable) {
  assert.ok(path.isAbsolute(executable), "Use an explicit installed Codex executable");
  const resources = await createTestResources(t, "convenewire-codex-handoff-");
  const home = path.join(resources.directory, "home");
  const workspace = path.join(resources.directory, "workspace");
  const codexHome = path.join(home, ".codex");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  const calls = [];
  let providerError;
  let respond = () => "Offline continuation completed.";
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.url, "/v1/responses");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.authorization, undefined);
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        assert.ok(bytes <= 1024 * 1024, "Bound offline provider input");
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const index = calls.push(input);
      assert.ok(index <= 12, "No retries or unbounded fixture turns");
      const answer = await respond(input, index);
      const item = typeof answer === "string"
        ? { id: `msg_${index}`, type: "message", role: "assistant", phase: "final_answer", status: "completed",
          content: [{ type: "output_text", text: answer, annotations: [] }] }
        : answer;
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { type: "response.created", response: { id: `resp_${index}`, status: "in_progress" } },
        { type: "response.output_item.added", output_index: 0, item },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: { id: `resp_${index}`, status: "completed", output: [item] } }
      ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end();
    } catch (error) {
      providerError = error;
      response.writeHead(400, { "content-type": "application/json" });
      response.end('{"error":{"message":"OFFLINE_FIXTURE_FAILED","type":"invalid_request_error"}}');
    }
  });
  resources.defer(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const overrides = [
    'model="gpt-5.4-mini"', 'model_provider="fixture"',
    'model_providers.fixture.name="ConveneWire offline fixture"',
    `model_providers.fixture.base_url="http://127.0.0.1:${server.address().port}/v1"`,
    'model_providers.fixture.wire_api="responses"', 'model_providers.fixture.requires_openai_auth=false',
    'model_providers.fixture.request_max_retries=0', 'model_providers.fixture.stream_max_retries=0',
    'model_providers.fixture.supports_websockets=false', 'analytics.enabled=false',
    'check_for_update_on_startup=false', 'web_search="disabled"'
  ];
  const environment = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, CODEX_HOME: codexHome,
    TMPDIR: resources.directory, TEMP: resources.directory, TMP: resources.directory,
    ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}) };
  let sharedAddress;
  let sharedServer;
  let sharedServerLog = "";
  async function startSharedServer() {
    sharedServer ??= (async () => {
      const reservation = net.createServer();
      resources.defer(() => new Promise(resolve => { if (reservation.listening) reservation.close(resolve); else resolve(); }));
      await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
      const port = reservation.address().port;
      await new Promise(resolve => reservation.close(resolve));
      sharedAddress = `ws://127.0.0.1:${port}`;
      const owned = spawnTestProcess(resources, executable,
        ["app-server", "--listen", sharedAddress, ...overrides.flatMap(value => ["-c", value])],
        { cwd: workspace, env: environment, stdio: ["pipe", "pipe", "pipe"] });
      for (const output of [owned.process.stdout, owned.process.stderr]) {
        output.on("data", value => { sharedServerLog = (sharedServerLog + value).slice(-4096); });
      }
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        assert.equal(owned.process.exitCode, null, "Shared fixture server exited before listening");
        if (await new Promise(resolve => {
          const probe = net.createConnection({ host: "127.0.0.1", port });
          probe.once("connect", () => { probe.destroy(); resolve(true); });
          probe.once("error", () => { probe.destroy(); resolve(false); });
          probe.setTimeout(200, () => { probe.destroy(); resolve(false); });
        })) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error("Shared fixture server did not start listening");
    })();
    await sharedServer;
  }
  let clientNumber = 0;
  async function queueCLI(threadId, message, { shared = false } = {}) {
    if (shared) await startSharedServer();
    const owned = spawnTestProcess(resources, executable,
      ["queue", "--thread", threadId, "--message", message,
        ...(shared ? ["--remote", sharedAddress] : []), ...overrides.flatMap(value => ["-c", value])],
      { cwd: workspace, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [owned.process.stdout, owned.process.stderr]) stream.on("data", value => { output = (output + value).slice(-8192); });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void owned.stop().catch(() => {}); }, 10_000);
    try {
      const result = await owned.terminal;
      assert.equal(timedOut, false, "Native queue CLI exceeded the fixture deadline");
      return { ...result, output };
    } finally { clearTimeout(timer); await owned.stop(); }
  }
  async function client({ shared = false, toolResult, dropQueueAddReply = false } = {}) {
    assert.ok(!dropQueueAddReply || shared, "Lost-acknowledgment injection requires the owned shared transport");
    if (shared) await startSharedServer();
    const owned = shared ? undefined : spawnTestProcess(resources, executable,
      ["app-server", "--listen", "stdio://", ...overrides.flatMap(value => ["-c", value])], {
        cwd: workspace, env: environment,
        stdio: ["pipe", "pipe", "pipe"]
      });
    const child = owned?.process;
    const connection = shared ? new WebSocket(sharedAddress, { handshakeTimeout: 10_000 }) : undefined;
    const stop = owned?.stop ?? (async () => {
      if (connection.readyState === WebSocket.CLOSED) return;
      await new Promise(resolve => { connection.once("close", resolve); connection.terminate(); });
    });
    if (shared) {
      resources.defer(stop);
      await new Promise((resolve, reject) => {
        connection.once("open", resolve);
        connection.once("error", error => reject(new Error(`${error.message}: ${sharedServerLog}`)));
      });
    }
    const write = text => shared ? connection.send(text.trimEnd()) : child.stdin.write(text);
    const pending = new Map();
    const notifications = [];
    const waiters = new Set();
    let nextID = 0, receivedBytes = 0, buffer = "", stderr = "", failure;
    function fail(error) {
      failure ??= error;
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(failure); }
      pending.clear();
      for (const entry of waiters) { clearTimeout(entry.timer); entry.reject(failure); }
      waiters.clear();
    }
    if (child) {
      child.stderr.on("data", data => { stderr = (stderr + data).slice(-4096); });
      child.stdin.on("error", fail);
      child.stdout.setEncoding("utf8");
    }
    const receive = data => {
      try {
        receivedBytes += Buffer.byteLength(data);
        assert.ok(receivedBytes <= 4 * 1024 * 1024, "Bound native fixture protocol output");
        buffer += data;
        while (buffer.includes("\n")) {
          const end = buffer.indexOf("\n"), line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.method && message.id !== undefined) {
            notifications.push(message);
            // Only this explicitly configured synthetic tool can return fixture
            // text. Never execute a real tool or grant an approval/user-input request.
            const result = message.method === "item/tool/call" && message.params.tool === "desktop_fixture_tool" && typeof toolResult === "string"
              ? { id: message.id, result: { contentItems: [{ type: "inputText", text: toolResult }], success: true } }
              : { id: message.id, error: { code: -32601, message: "Fixture has no desktop tool handler" } };
            write(`${JSON.stringify(result)}\n`);
          } else if (message.id !== undefined) {
            const entry = pending.get(message.id);
            assert.ok(entry, "Response must match one pending request");
            if (dropQueueAddReply && entry.method === "thread/queue/add") {
              fail(new Error("Injected lost queue acknowledgment"));
              connection.terminate();
              return;
            }
            pending.delete(message.id); clearTimeout(entry.timer);
            if (message.error) entry.reject(Object.assign(new Error(message.error.message), { rpcCode: message.error.code }));
            else entry.resolve(message.result);
          } else notifications.push(message);
          for (const entry of waiters) {
            const match = notifications.find(entry.predicate);
            if (match) { clearTimeout(entry.timer); waiters.delete(entry); entry.resolve(match); }
          }
        }
      } catch (error) { fail(error); }
    };
    if (shared) connection.on("message", data => receive(`${data.toString("utf8")}\n`));
    else child.stdout.on("data", receive);
    (connection ?? child).on("error", fail);
    (connection ?? child).on("close", () => fail(new Error(`Native fixture closed: ${stderr}`)));
    const rpc = (method, params = {}) => new Promise((resolve, reject) => {
      if (failure) { reject(failure); return; }
      const id = ++nextID;
      const timer = setTimeout(() => fail(new Error(`Timed out waiting for ${method}: ${stderr}`)), 20_000);
      pending.set(id, { resolve, reject, timer, method });
      write(`${JSON.stringify({ id, method, params })}\n`);
    });
    const waitFor = predicate => new Promise((resolve, reject) => {
      const match = notifications.find(predicate);
      if (match) { resolve(match); return; }
      if (failure) { reject(failure); return; }
      const entry = { predicate, resolve, reject,
        timer: setTimeout(() => { waiters.delete(entry); reject(new Error("Native event timeout")); }, 20_000) };
      waiters.add(entry);
    });
    const initialized = await rpc("initialize", { clientInfo: { name: `convenewire_handoff_${++clientNumber}`, version: "0.1.0" },
      capabilities: { experimentalApi: true } });
    assert.equal(initialized.codexHome, codexHome, "Every client must reach the owned disposable profile");
    write('{"method":"initialized","params":{}}\n');
    return { rpc, waitFor, initialized, notifications, stop,
      async turn(threadId, text) {
        const { turn } = await rpc("turn/start", { threadId, input: [{ type: "text", text }] });
        const completed = await waitFor(m => m.method === "turn/completed" && m.params.threadId === threadId && m.params.turn.id === turn.id);
        assert.equal(completed.params.turn.status, "completed", JSON.stringify(completed.params.turn.error));
        return turn.id;
      }
    };
  }
  return { client, queueCLI, workspace, calls, setResponder(value) { respond = value; },
    checkProvider() { if (providerError) throw providerError; } };
}
