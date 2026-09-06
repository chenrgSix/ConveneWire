import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";
import { createTestResources } from "../test/resources.mjs";
import { loadReplay, treatmentInstruction } from "./evidence-access-replay.js";
import { hash } from "./evidence-access-reader.mjs";
import { invokeFinalizer } from "./evidence-access-runtime.mjs";

// Inspect actual nested MCP text/Responses blocks; never manufacture a receipt.
function returnedEvidence(value: any): any {
  if (typeof value === "string") {
    try { return returnedEvidence(JSON.parse(value)); } catch { return undefined; }
  }
  if (!value || typeof value !== "object") return undefined;
  if (value.receipt && typeof value.content === "string") return value;
  return Object.values(value).map(returnedEvidence).find(Boolean);
}

for (const provider of ["fixture", "openai"] as const) test(`installed CLI discovers fixed sources with ${provider} loopback`,
  { timeout: 120_000 }, async t => {
    const resources = await createTestResources(t, "convenewire-qa073-catalog-");
    const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
    const replay = loadReplay(); replay.fixture.runtime.timeoutMilliseconds = 20_000;
    let accessCatalog: unknown;
    for (const treatment of ["A", "B", "C"] as const) {
      const directory = path.join(resources.directory, treatment), codexHome = path.join(directory, "codex-home");
      mkdirSync(directory); mkdirSync(codexHome);
      let calls = 0, serverError: unknown, httpCalls = 0, websocketCalls = 0;
      const catalogHashes = new Set<string>();
      const finalText = "Offline visibility probe complete.";
      const finalItem = { id: "msg_fixture", type: "message", role: "assistant", status: "completed", phase: "final_answer",
        content: [{ type: "output_text", text: finalText, annotations: [] }] };
      function responseEvents(item?: any, warmup = false) {
        const id = warmup ? "resp_warmup" : `resp_${calls}`;
        return [{ type: "response.created", response: { id, status: "in_progress" } },
          ...(item ? [{ type: "response.output_item.added", output_index: 0, item },
            { type: "response.output_item.done", output_index: 0, item }] : []),
          { type: "response.completed", response: { id, status: "completed", output: item ? [item] : [] } }];
      }
      function respond(body: any) {
        try {
          // Builtin WebSocket warmup has no user input and generates no answer.
          if (body.generate === false) return responseEvents(undefined, true);
          calls++;
          assert.equal(body.model, replay.fixture.runtime.model);
          assert.ok(calls <= 2 * replay.documents.length + 1);
          assert.ok(!body.tools.some((tool: any) => ["shell", "exec_command", "web_search", "spawn_agent"].includes(tool.name ?? tool.type)));
          if (calls === 1) {
            if (treatment === "A") assert.ok(!JSON.stringify(body.tools).includes("mcp__evidence"));
            else {
              assert.ok(body.tools.some((tool: any) => tool.type === "tool_search" && tool.description.includes("evidence")));
              if (treatment === "B") accessCatalog = body.tools;
              else assert.deepEqual(body.tools, accessCatalog, "B/C tool advertisement must be identical");
            }
          }
          if (treatment === "A") return responseEvents(finalItem);
          if (calls % 2 === 0) {
            const doc = replay.documents[calls / 2 - 1]!;
            const discovered = body.input.findLast((entry: any) => entry.type === "tool_search_output");
            const namespace = discovered?.tools?.find((entry: any) => entry.tools?.some((tool: any) =>
              tool.parameters?.properties?.evidenceRef?.enum?.includes(doc.evidenceRef)));
            assert.ok(namespace, `No advertised reader for ${doc.evidenceRef}`);
            const tool = namespace.tools.find((entry: any) => entry.parameters?.properties?.evidenceRef?.enum?.includes(doc.evidenceRef));
            assert.equal(namespace.name, "mcp__evidence"); assert.equal(tool.name, "read_evidence");
            assert.deepEqual(tool.parameters.required, ["evidenceRef", "revision"]);
            assert.ok(tool.parameters.properties.revision.enum.includes(doc.revision));
            assert.equal(tool.parameters.additionalProperties, false);
            catalogHashes.add(hash(JSON.stringify(namespace)));
            return responseEvents({ id: `fc_${calls}`, type: "function_call", call_id: `read_${calls}`, status: "completed",
              namespace: namespace.name, name: tool.name, arguments: JSON.stringify({ evidenceRef: doc.evidenceRef, revision: doc.revision }) });
          }
          if (calls > 1) {
            const output = body.input.findLast((entry: any) => entry.type === "function_call_output" && entry.call_id === `read_${calls - 1}`);
            const returned = returnedEvidence(output);
            const doc = replay.documents[(calls - 3) / 2]!;
            assert.ok(returned, "Actual MCP return must reach the next provider request");
            assert.equal(returned.content, doc.content);
            assert.equal(returned.receipt.contentSha256, hash(doc.content));
            assert.equal(returned.receipt.returnedBytes, Buffer.byteLength(doc.content));
            assert.equal(returned.receipt.truncated, false);
          }
          if (calls === 2 * replay.documents.length + 1) return responseEvents(finalItem);
          assert.ok(body.tools.some((tool: any) => tool.type === "tool_search"));
          return responseEvents({ id: `ts_${calls}`, type: "tool_search_call", execution: "client", call_id: `search_${calls}`, status: "completed",
            arguments: { query: replay.documents[(calls - 1) / 2]!.evidenceRef, limit: 1 } });
        } catch (error) {
          serverError ??= error;
          // Finish the local simulation promptly; the stored assertion still fails.
          return responseEvents(finalItem);
        }
      }
      function checkRequest(request: http.IncomingMessage) {
        assert.equal(request.url, "/v1/responses");
        assert.equal(request.headers.authorization, provider === "openai" ? "Bearer offline-fixture-not-a-credential" : undefined);
      }
      const server = http.createServer(async (request, response) => {
        try {
          checkRequest(request); httpCalls++;
          let text = ""; for await (const chunk of request) text += chunk;
          const events = respond(JSON.parse(text));
          response.writeHead(200, { "content-type": "text/event-stream" });
          for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
          response.end();
        } catch (error) { serverError ??= error; response.writeHead(400); response.end(); }
      });
      const sockets = new WebSocketServer({ noServer: true });
      server.on("upgrade", (request, socket, head) => {
        try {
          checkRequest(request);
          sockets.handleUpgrade(request, socket, head, client => {
            client.on("message", data => {
              try { websocketCalls++; respond(JSON.parse(data.toString())).forEach(event => client.send(JSON.stringify(event))); }
              catch (error) { serverError ??= error; client.close(); }
            });
          });
        } catch (error) { serverError ??= error; socket.destroy(); }
      });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as { port: number };
      try {
        const configOverrides = provider === "fixture" ? ['model_provider="fixture"', 'model_providers.fixture.name="Offline fixture"',
          `model_providers.fixture.base_url="http://127.0.0.1:${address.port}/v1"`, 'model_providers.fixture.wire_api="responses"',
          'model_providers.fixture.requires_openai_auth=false', 'model_providers.fixture.request_max_retries=0', 'model_providers.fixture.stream_max_retries=0'] :
          ['model_provider="openai"', `openai_base_url="http://127.0.0.1:${address.port}/v1"`];
        const result = await invokeFinalizer({ resources, replay, scheduled: replay.fixture.order.find(row => row.treatment === treatment), executable,
          directory, instruction: treatmentInstruction(treatment, replay),
          env: { PATH: process.env.PATH, CODEX_HOME: codexHome, ...(provider === "openai" ? { CODEX_API_KEY: "offline-fixture-not-a-credential" } : {}) }, configOverrides });
        if (serverError) throw serverError;
        assert.equal(result.outcome, "completed", JSON.stringify(result.failures));
        assert.equal(result.finalAnswer, finalText); assert.deepEqual(result.progressMessages, []);
        assert.equal(calls, treatment === "A" ? 1 : 9);
        assert.equal(result.reads.length, treatment === "A" ? 0 : replay.documents.length);
        assert.equal(result.evidenceAccess.catalogListed, treatment !== "A");
        assert.equal(result.evidenceAccess.modelDiscovery, "not_observable_in_cli_json");
        if (treatment !== "A") {
          assert.equal(catalogHashes.size, 1, "All searches must return the same reader definition");
          assert.ok(result.readerLifecycle.some((event: any) => event.stage === "initialized"));
          assert.equal(result.toolEvents.filter((event: any) => event.kind === "mcp_tool_call" && event.stage === "item.started").length, 4);
        }
        if (provider === "openai") assert.ok(websocketCalls > 0, "Builtin WebSocket path must be exercised");
        else { assert.equal(websocketCalls, 0); assert.equal(httpCalls, calls); }
      } finally {
        for (const client of sockets.clients) client.terminate();
        sockets.close(); server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    }
  });
