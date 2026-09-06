// Explicit local CLI gate. The provider is a loopback fixture, never a model.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { spawnTestProcess } from "../test/child-process.mjs";
import { sha256, workspaceTaskInput } from "./workspace-evidence.mjs";

for (const suppressWarning of [false, true]) {
  test(`real CLI discovers and reads fixed evidence with startup-warning suppression ${suppressWarning}`, { timeout: 60_000 }, async (t) => {
    const resources = await createTestResources(t, "convenewire-codex-evidence-bootstrap-");
    const directory = resources.directory;
    const workspace = path.join(directory, "workspace"), quota = path.join(directory, "quota"), codexHome = path.join(directory, "codex-home");
    for (const target of [workspace, quota, codexHome]) await mkdir(target);
    const content = "Synthetic bootstrap evidence only.";
    await writeFile(path.join(workspace, "evidence.json"), JSON.stringify({ cases: [{ id: "delivery",
      documents: [{ id: "fixture", content, sha256: sha256(content), source: {} }] }] }));
    let calls = 0;
    let serverError;
    const server = http.createServer(async (request, response) => {
      try {
        assert.equal(request.url, "/v1/responses");
        assert.equal(request.method, "POST");
        assert.equal(request.headers.authorization, undefined);
        let body = "";
        for await (const chunk of request) body += chunk;
        const input = JSON.parse(body);
        calls += 1;
        assert.ok(calls <= 3, "Fixture never loops or delegates to an external provider");
        assert.ok(input.tools.some((tool) => tool.type === "tool_search"));
        assert.ok(!input.tools.some((tool) => ["shell", "exec_command", "web_search", "spawn_agent"].includes(tool.name ?? tool.type)));
        let item;
        if (calls === 1) {
          assert.ok(JSON.stringify(input.input).includes("Use tool_search to discover evidence.read_evidence"));
          item = { id: "ts_fixture", type: "tool_search_call", execution: "client", call_id: "call_search", status: "completed",
            arguments: { query: "evidence read_evidence", limit: 1 } };
        } else if (calls === 2) {
          const discovered = input.input.find((entry) => entry.type === "tool_search_output");
          assert.deepEqual(discovered.tools.map((tool) => tool.name), ["mcp__evidence"]);
          assert.deepEqual(discovered.tools[0].tools.map((tool) => tool.name), ["read_evidence"]);
          item = { id: "fc_fixture", type: "function_call", call_id: "call_read", status: "completed",
            namespace: "mcp__evidence", name: "read_evidence", arguments: JSON.stringify({ id: "fixture" }) };
        } else {
          const output = input.input.find((entry) => entry.type === "function_call_output" && entry.call_id === "call_read");
          assert.ok(JSON.stringify(output).includes(content));
          item = { id: "msg_fixture", type: "message", role: "assistant", status: "completed",
            content: [{ type: "output_text", text: "Offline reader completed.", annotations: [] }] };
        }
        response.writeHead(200, { "content-type": "text/event-stream" });
        for (const event of [
          { type: "response.created", response: { id: `resp_${calls}`, status: "in_progress" } },
          { type: "response.output_item.added", output_index: 0, item },
          { type: "response.output_item.done", output_index: 0, item },
          { type: "response.completed", response: { id: `resp_${calls}`, status: "completed", output: [item] } }
        ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
        response.end();
      } catch (error) {
        serverError = error;
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "OFFLINE_FIXTURE_FAILED", type: "invalid_request_error" } }));
      }
    });
    resources.defer(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const cli = process.env.CONVENE_WIRE_CODEX_BIN ?? execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
    const overrides = [
      'model_provider="fixture"', 'model_providers.fixture.name="Offline fixture"',
      `model_providers.fixture.base_url="http://127.0.0.1:${server.address().port}/v1"`,
      'model_providers.fixture.wire_api="responses"', 'model_providers.fixture.requires_openai_auth=false',
      'model_providers.fixture.request_max_retries=0', 'model_providers.fixture.stream_max_retries=0',
      `suppress_unstable_features_warning=${suppressWarning}`
    ];
    const shim = path.join(directory, "offline-codex.mjs");
    await writeFile(shim, `#!${process.execPath}\nimport {spawn} from "node:child_process";
const args=process.argv.slice(2); args.pop();
const child=spawn(${JSON.stringify(cli)}, [...args,...${JSON.stringify(overrides)}.flatMap(value=>["-c",value]),"-"], {stdio:"inherit"});
child.on("error",()=>process.exit(1)); child.on("exit",code=>process.exit(code??1));\n`);
    await chmod(shim, 0o700);
    const child = spawnTestProcess(resources, process.execPath,
      [path.resolve("scripts/bench/codex-evidence-answer.mjs"), shim, "gpt-5.4-mini", quota, "12", "Baseline"],
      { cwd: workspace, env: { PATH: process.env.PATH, CODEX_HOME: codexHome }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.process.stdout.on("data", (chunk) => { stdout += chunk; });
    child.process.stderr.on("data", (chunk) => { stderr += chunk; });
    const closed = new Promise((resolve) => child.process.once("close", resolve));
    child.process.stdin.end(workspaceTaskInput({ id: "delivery", prompt: "Read the fixture." }, "Check facts."));
    const result = await child.terminal;
    await closed;
    if (serverError) throw serverError;
    assert.equal(calls, 3);
    assert.equal(result.code, suppressWarning ? 0 : 1, stderr);
    assert.equal(stdout, suppressWarning ? "Offline reader completed.\n" : "");
    const metadata = JSON.parse(await readFile(path.join(quota, "receipt-0/invocation.json"), "utf8"));
    assert.equal(metadata.runtimeSucceeded, suppressWarning);
    assert.deepEqual(metadata.diagnostics.failureReasons, suppressWarning ? [] : ["item_error"]);
    assert.equal(metadata.diagnostics.exitCode, 0);
    const receipt = JSON.parse(await readFile(path.join(quota, "receipt-0/read-0.json"), "utf8"));
    assert.deepEqual(receipt, { accepted: true, id: "fixture", sha256: sha256(content) });
  });
}
