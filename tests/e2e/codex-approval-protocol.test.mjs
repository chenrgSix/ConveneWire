// Opt-in installed CLI compatibility gate. The provider is a loopback fixture.
import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { createTestResources } from "../../scripts/test/resources.mjs";
import { spawnTestProcess } from "../../scripts/test/child-process.mjs";

test("installed Codex emits a local command approval and honors denial", {
  skip: !process.env.CONVENE_WIRE_CODEX_BIN,
  timeout: 45_000
}, async (t) => {
  const resources = await createTestResources(t, "convenewire-codex-approval-");
  const workspace = path.join(resources.directory, "workspace");
  const codexHome = path.join(resources.directory, "codex-home");
  const target = path.join(resources.directory, "permission-test.txt");
  await mkdir(workspace);
  await mkdir(codexHome);
  const command = `printf approval-ok > '${target.replaceAll("'", "'\\''")}'`;
  let calls = 0, approval, threadId;
  let complete, fail;
  const completed = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/v1/responses");
      assert.equal(request.headers.authorization, undefined);
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      assert.ok(input.tools.some((tool) => tool.name === "exec_command"));
      assert.ok(++calls <= 2, "Fixture must never loop or use an external provider");
      const item = calls === 1 ? {
        id: "fc_fixture", type: "function_call", call_id: "call_fixture", status: "completed", name: "exec_command",
        arguments: JSON.stringify({ cmd: command, sandbox_permissions: "require_escalated",
          justification: "Review this isolated file write", max_output_tokens: 1000 })
      } : {
        id: "msg_fixture", type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: "Fixture ended.", annotations: [] }]
      };
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { type: "response.created", response: { id: `resp_${calls}`, status: "in_progress" } },
        { type: "response.output_item.added", output_index: 0, item },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: { id: `resp_${calls}`, status: "completed", output: [item] } }
      ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end();
    } catch (error) {
      response.writeHead(400);
      response.end();
      fail(error);
    }
  });
  resources.defer(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const overrides = [
    'model="gpt-5.4-mini"', 'model_provider="fixture"', 'model_providers.fixture.name="Offline approval fixture"',
    `model_providers.fixture.base_url="http://127.0.0.1:${server.address().port}/v1"`,
    'model_providers.fixture.wire_api="responses"', 'model_providers.fixture.requires_openai_auth=false',
    'model_providers.fixture.request_max_retries=0', 'model_providers.fixture.stream_max_retries=0', 'web_search="disabled"'
  ];
  const child = spawnTestProcess(resources, process.env.CONVENE_WIRE_CODEX_BIN,
    ["app-server", "--listen", "stdio://", ...overrides.flatMap((value) => ["-c", value])], {
      cwd: workspace, env: { HOME: process.env.HOME, PATH: process.env.PATH, CODEX_HOME: codexHome, NO_PROXY: "*" },
      stdio: ["pipe", "pipe", "pipe"]
    });
  let stderr = "";
  child.process.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  const send = (value) => child.process.stdin.write(JSON.stringify(value) + "\n");
  child.process.stdin.on("error", fail);
  const lines = createInterface({ input: child.process.stdout });
  resources.defer(() => lines.close());
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      assert.equal(message.error, undefined);
      if (message.id === 1 && !message.method) {
        send({ method: "initialized", params: {} });
        send({ id: 2, method: "thread/start", params: { cwd: workspace, model: "gpt-5.4-mini",
          sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user", ephemeral: true } });
      } else if (message.id === 2 && !message.method) {
        assert.equal(message.result.approvalPolicy, "on-request");
        assert.equal(message.result.approvalsReviewer, "user");
        threadId = message.result.thread.id;
        send({ id: 3, method: "turn/start", params: { threadId,
          input: [{ type: "text", text: "Run the isolated fixture command and request permission." }] } });
      }
      if (message.method?.endsWith("/requestApproval")) {
        assert.equal(approval, undefined, "Expected only one operation");
        assert.equal(message.method, "item/commandExecution/requestApproval");
        assert.equal(message.params.threadId, threadId);
        assert.equal(message.params.environmentId, "local");
        assert.equal(message.params.kind, "command");
        assert.equal(message.params.cwd, workspace);
        assert.ok(message.params.command.includes(target));
        approval = message;
        send({ id: message.id, result: { decision: "decline" } });
      }
      if (message.method === "turn/completed") {
        assert.equal(message.params.turn.status, "completed");
        complete();
      }
    } catch (error) { fail(error); }
  });
  const timer = setTimeout(() => fail(new Error(`Approval protocol timed out: ${stderr}`)), 30_000);
  resources.defer(() => clearTimeout(timer));
  void child.terminal.then((result) => fail(result.error ?? new Error(`CLI exited before completion: ${stderr}`)));
  send({ id: 1, method: "initialize", params: { clientInfo: { name: "convenewire_approval_fixture", version: "1" } } });
  await completed;
  assert.ok(approval, "Installed Runtime did not request approval");
  assert.equal(calls, 2);
  await assert.rejects(access(target), { code: "ENOENT" });
});
