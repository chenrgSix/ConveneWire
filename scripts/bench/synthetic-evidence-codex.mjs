// Offline CLI substitute: exercise the real MCP transport, with no provider path.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
if (process.argv.includes("--version")) { console.log("synthetic-evidence-runtime 1"); process.exit(0); }
for await (const _chunk of process.stdin) { /* consume the instruction */ }
const settings = process.argv.filter((_, index) => process.argv[index - 1] === "-c");
const setting = (name) => JSON.parse(settings.find((entry) => entry.startsWith(name + "=")).slice(name.length + 1));
const transport = new StdioClientTransport({ command: setting("mcp_servers.evidence.command"),
  args: setting("mcp_servers.evidence.args"), env: { PATH: process.env.PATH }, stderr: "pipe" });
const client = new Client({ name: "offline-reader", version: "1" });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const ids = tools[0].inputSchema.properties.id.enum;
  for (const id of ids) {
    const result = await client.callTool({ name: "read_evidence", arguments: { id } });
    if (result.isError) throw new Error("Synthetic reader failed");
    console.log(JSON.stringify({ type: "item.completed", item: { type: "mcp_tool_call", server: "evidence", tool: "read_evidence", status: "completed" } }));
  }
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: `Synthetic transport check only: ${ids.join(", ")}.` } }));
} finally { await client.close(); }
