// Auth-free installed-CLI fixture. This server never forwards requests to a model.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { createTestResources } from "../test/resources.mjs";
import { childCommand, pinDocument, replayFor } from "./authority-collaboration.mjs";

export async function sessionFixture(t, mode = "read") {
  const resources = await createTestResources(t, "convene-wire-qa080-");
  const directory = resources.directory, databasePath = path.join(directory, "central.sqlite");
  let sequence = 0;
  const central = (request, name = "central") => childCommand(resources, "scripts/bench/authority-central.mts",
    { databasePath, ...request }, path.join(directory, `${name}-${sequence++}`), { typescript: true });
  const initialized = await central({ mode: "init", scenario: "qa080" });
  assert.equal(initialized.exitCode, 0, initialized.diagnostic);
  const meta = initialized.response;
  assert.equal((await central({ mode: "start", meta, roles: ["finalizer"] })).exitCode, 0);
  const document = pinDocument("evidence_qa080_permitted", "Permitted synthetic observation. No operational inventory is released.");
  const replay = replayFor(meta, [document]);
  const runtimeDirectory = path.join(directory, "runtime"), codexHome = path.join(directory, "codex-home");
  mkdirSync(runtimeDirectory); mkdirSync(codexHome);
  const controller = new AbortController();
  let calls = 0, serverError;
  const observations = { nativeDiscoveryOutputs: [], catalogs: [], sourceReachedProvider: false, requests: 0 };
  const collect = (tools, namespace) => (tools ?? []).flatMap(tool => tool.type === "namespace" ? collect(tool.tools, tool.name) :
    [{ namespace, name: tool.name ?? tool.type, type: tool.type }]);
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.url, "/v1/responses");
      let body = ""; for await (const chunk of request) body += chunk;
      const input = JSON.parse(body), catalog = collect(input.tools);
      observations.catalogs.push(catalog); calls++; observations.requests = calls;
      assert.ok(calls <= 6, "Offline provider must not loop");
      assert.ok(!catalog.some(t => ["shell", "exec_command", "web_search", "spawn_agent"].includes(t.name)));
      const native = (name, args = {}) => {
        const found = catalog.find(t => t.name === name);
        assert.ok(found, `Missing native ${name}; catalog: ${JSON.stringify(catalog)}`);
        return { id: `fc_${calls}`, type: "function_call", call_id: `call_${calls}`, status: "completed",
          ...(found.namespace ? { namespace: found.namespace } : {}), name, arguments: JSON.stringify(args) };
      };
      if (mode === "timeout") return;
      if (mode === "cancel") { controller.abort(); return; }
      let item;
      if (calls === 1) item = native("list_mcp_resources");
      else if (calls === 2) {
        const output = input.input.find(e => e.type === "function_call_output" && e.call_id === "call_1");
        assert.ok(output); assert.ok(!JSON.stringify(output).includes(document.content));
        observations.nativeDiscoveryOutputs.push(output.output);
        item = mode === "resource_read" ? native("read_mcp_resource", { server: "evidence", uri: "fixture://private-owner-source" }) : native("list_mcp_resource_templates");
      } else if (calls === 3) {
        const output = input.input.find(e => e.type === "function_call_output" && e.call_id === "call_2");
        assert.ok(output); assert.ok(!JSON.stringify(output).includes(document.content));
        observations.nativeDiscoveryOutputs.push(output.output);
        if (mode === "no_final") item = null;
        else if (["metadata_only", "progress_only"].includes(mode)) item = { id: "msg_final", type: "message", role: "assistant",
          phase: mode === "progress_only" ? "commentary" : "final_answer", status: "completed",
          content: [{ type: "output_text", text: "Synthetic metadata-only reply; no source was read.", annotations: [] }] };
        else item = { id: "search", type: "tool_search_call", execution: "client", call_id: "call_search", status: "completed",
          arguments: { query: "evidence read_evidence", limit: 1 } };
      } else if (calls === 4) {
        const found = input.input.find(e => e.type === "tool_search_output");
        assert.deepEqual(found.tools.map(t => t.name), ["mcp__evidence"]);
        if (mode === "revoked") {
          const p = path.join(runtimeDirectory, "control.json"), control = JSON.parse(readFileSync(p));
          control.run.state = "revoked"; writeFileSync(p, JSON.stringify(control));
        }
        item = { id: "read", type: "function_call", call_id: "call_read", namespace: "mcp__evidence", name: "read_evidence", status: "completed",
          arguments: JSON.stringify({ evidenceRef: mode === "raw_read" ? "evidence_qa079_operations_raw" : document.evidenceRef, revision: document.revision }) };
      } else {
        assert.equal(calls, 5);
        const output = input.input.find(e => e.type === "function_call_output" && e.call_id === "call_read");
        assert.ok(JSON.stringify(output).includes(document.content));
        observations.sourceReachedProvider = true;
        item = { id: "msg_final", type: "message", role: "assistant", phase: "final_answer", status: "completed",
          content: [{ type: "output_text", text: "Synthetic protocol check only. Permitted observation read; operations remains unavailable. No action or approval.", annotations: [] }] };
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [{ type: "response.created", response: { id: `resp_${calls}`, status: "in_progress" } },
        ...(item ? [{ type: "response.output_item.added", output_index: 0, item }, { type: "response.output_item.done", output_index: 0, item }] : []),
        { type: "response.completed", response: { id: `resp_${calls}`, status: "completed", output: item ? [item] : [] } }]) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end();
    } catch (error) { serverError = error; response.writeHead(400, { "content-type": "application/json" }); response.end('{"error":{"message":"OFFLINE_FIXTURE_FAILED","type":"invalid_request_error"}}'); }
  });
  resources.defer(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  replay.fixture.runtime.timeoutMilliseconds = mode === "timeout" ? 1200 : 15000;
  const runtime = { replay, scheduled: { treatment: "B", runId: meta.runs.finalizer },
    instruction: "Offline protocol check: discover resources and templates, discover evidence.read_evidence, read the permitted source and report unavailable operations without guessing.",
    executable: execFileSync("which", ["codex"], { encoding: "utf8" }).trim(), directory: runtimeDirectory,
    signal: controller.signal, env: { PATH: process.env.PATH, CODEX_HOME: codexHome }, configOverrides: [
      'model_provider="fixture"', 'model_providers.fixture.name="QA-080 offline fixture"',
      `model_providers.fixture.base_url="http://127.0.0.1:${server.address().port}/v1"`, 'model_providers.fixture.wire_api="responses"',
      'model_providers.fixture.requires_openai_auth=false', 'model_providers.fixture.request_max_retries=0',
      'model_providers.fixture.stream_max_retries=0', 'model_providers.fixture.supports_websockets=false'
    ] };
  return { resources, directory, databasePath, meta, central, runtime, observations, controller,
    intentPath: path.join(directory, "terminal-intent.json"), deliveryDirectory: path.join(directory, "terminal-delivery"),
    checkProvider: () => { if (serverError) throw serverError; } };
}
