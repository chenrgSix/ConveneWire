// Test-only stdio MCP reader. The owner supplies scope; the model supplies an ID.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const [bundlePath, caseId, receiptDirectory] = process.argv.slice(2);
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const sample = bundle.cases.find((item) => item.id === caseId);
if (!sample || !receiptDirectory) throw new Error("Missing owner-selected evidence scope");
const docs = new Map(sample.documents.map((doc) => [doc.id, doc]));
for (const doc of docs.values()) {
  if (createHash("sha256").update(doc.content).digest("hex") !== doc.sha256) throw new Error("Evidence digest mismatch");
}
const server = new Server({ name: "evidence", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
  name: "read_evidence", description: "Read one immutable historical source document. Available IDs: " + [...docs.keys()].join(", "),
  inputSchema: { type: "object", properties: { id: { type: "string", enum: [...docs.keys()] } }, required: ["id"], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
}] }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const args = params.arguments;
  const doc = args && Object.keys(args).length === 1 && typeof args.id === "string" ? docs.get(args.id) : undefined;
  const accepted = params.name === "read_evidence" && doc !== undefined;
  let reserved = false;
  for (let slot = 0; slot < 8; slot += 1) {
    try {
      // Atomic persisted receipts bound reads even if the MCP process restarts.
      writeFileSync(path.join(receiptDirectory, `read-${slot}.json`), JSON.stringify(accepted
        ? { accepted: true, id: doc.id, sha256: doc.sha256 }
        : { accepted: false, reason: "outside fixed scope" }), { flag: "wx", mode: 0o600 });
      reserved = true;
      break;
    } catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  if (!reserved || !accepted) return { isError: true, content: [{ type: "text", text: reserved ? "Document not available" : "Eight-read limit reached" }] };
  return { content: [{ type: "text", text: JSON.stringify({ id: doc.id, source: doc.source, content: doc.content, sha256: doc.sha256 }) }] };
});
await server.connect(new StdioServerTransport());
