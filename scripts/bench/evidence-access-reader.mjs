// Only this experiment's owner-authored grant is authority. Model arguments are selectors.
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
export const hash = value => createHash("sha256").update(value).digest("hex");
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validRange = r => r && Object.keys(r).sort().join() === "end,start" &&
  Number.isSafeInteger(r.start) && Number.isSafeInteger(r.end) && r.start >= 0 && r.end > r.start;

export function readEvidence({ bundle, grant, currentRun, call, attempt = 0, now = new Date().toISOString() }) {
  const args = call.arguments;
  const doc = bundle.documents.find(d => d.evidenceRef === args?.evidenceRef);
  const suppliedRange = args?.range;
  const requestedRange = validRange(suppliedRange) ? suppliedRange : suppliedRange === undefined ? doc?.allowedRange ?? null : null;
  const receipt = { version: 1, experimentId: bundle.experimentId, authorityId: bundle.authorityId,
    taskId: bundle.taskId, roomId: bundle.roomId, runId: currentRun.runId,
    evidenceRef: doc?.evidenceRef ?? null, revision: typeof args?.revision === "string" && /^[a-f0-9]{40}$/u.test(args.revision) ? args.revision : null,
    sourceContentSha256: doc?.contentSha256 ?? null, contentSha256: null,
    requestedRange, returnedRange: null, returnedBytes: 0, truncated: false,
    status: "denied", failureReason: null, observedAt: now };
  const fail = reason => { receipt.failureReason = reason; return { receipt, content: null }; };
  if (!grant || bundle.runId !== currentRun.runId || grant.runId !== currentRun.runId || currentRun.state !== "active" ||
    !["experimentId", "authorityId", "taskId", "roomId"].every(key =>
      bundle[key] === grant[key] && currentRun[key] === grant[key]) ||
    currentRun.grantSha256 !== hash(JSON.stringify(grant)) || Date.parse(now) >= Date.parse(grant.expiresAt) ||
    !Number.isFinite(Date.parse(grant.expiresAt))) return fail("authorization_mismatch");
  if (attempt >= bundle.maximumReadCalls) return fail("read_limit");
  if (call.name !== "read_evidence" || !args || Object.keys(args).some(k => !["evidenceRef", "revision", "range"].includes(k)) ||
    !doc || !requestedRange) return fail("invalid_selector");
  const scope = grant.sources.find(s => s.evidenceRef === doc.evidenceRef);
  if (!scope || args.revision !== doc.revision || scope.revision !== doc.revision ||
    scope.contentSha256 !== doc.contentSha256 || !equal(scope.allowedRange, doc.allowedRange)) return fail("source_pin_mismatch");
  if (hash(doc.content) !== doc.contentSha256) { receipt.status = "failed"; return fail("source_digest_mismatch"); }
  if (requestedRange.start < scope.allowedRange.start || requestedRange.end > scope.allowedRange.end) return fail("range_outside_grant");
  const bytes = Buffer.from(doc.content);
  if (scope.allowedRange.end > bytes.length) { receipt.status = "failed"; return fail("source_range_unavailable"); }
  let end = Math.min(requestedRange.end, requestedRange.start + bundle.maximumReturnBytes);
  // Ranges are UTF-8 byte offsets. Never return a replacement character for a split code point.
  if ((bytes[requestedRange.start] & 0xc0) === 0x80) return fail("invalid_utf8_boundary");
  if (end === requestedRange.end && end < bytes.length && (bytes[end] & 0xc0) === 0x80) return fail("invalid_utf8_boundary");
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
  if (end <= requestedRange.start) return fail("return_limit_too_small");
  const content = bytes.subarray(requestedRange.start, end).toString("utf8");
  receipt.status = "returned";
  receipt.contentSha256 = hash(content);
  receipt.returnedRange = { start: requestedRange.start, end };
  receipt.returnedBytes = Buffer.byteLength(content);
  receipt.truncated = end !== requestedRange.end;
  return { receipt, content };
}

export function evidenceToolDefinition(bundle) {
  return { name: "read_evidence",
    description: "Evidence source reader for original fixed-version source excerpts. Use evidence.read_evidence to read a source by its evidenceRef and revision. " +
      "Available evidence identities: " + bundle.documents.map(doc => doc.evidenceRef).join(", ") +
      ". Returns authorized UTF-8 bytes and a receipt, not a truth verdict. Omit range for the full permitted excerpt.",
    inputSchema: { type: "object", properties: {
      evidenceRef: { type: "string", enum: bundle.documents.map(d => d.evidenceRef) },
      revision: { type: "string", enum: [...new Set(bundle.documents.map(d => d.revision))] },
      range: { type: "object", properties: { start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 1 } }, required: ["start", "end"], additionalProperties: false }
    }, required: ["evidenceRef", "revision"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  };
}

export async function serve(bundlePath, controlPath, receiptDirectory, expectedRunId, grantDigest) {
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  let observations = 0;
  const observe = (stage, detail = {}) => {
    if (observations++ >= 64) return;
    appendFileSync(path.join(receiptDirectory, "../reader-lifecycle.jsonl"),
      JSON.stringify({ version: 1, runId: expectedRunId, stage, ...detail, observedAt: new Date().toISOString() }) + "\n", { mode: 0o600 });
  };
  observe("startup");
  const server = new Server({ name: "evidence", version: "2.1.0-experiment" }, { capabilities: { tools: {} } });
  server.oninitialized = () => observe("initialized");
  const definition = evidenceToolDefinition(bundle);
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    observe("tools_listed", { definitionSha256: hash(JSON.stringify(definition)),
      tools: [{ name: definition.name, schemaSha256: hash(JSON.stringify(definition.inputSchema)) }] });
    return { tools: [definition] };
  });
  // Sequential handling makes the persisted count authoritative across restarts.
  let queue = Promise.resolve();
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const result = queue.then(() => {
      observe("call_started", { recognizedTool: params.name === "read_evidence" });
      const control = JSON.parse(readFileSync(controlPath, "utf8"));
      if (control.run.runId !== expectedRunId || hash(JSON.stringify(control.grant)) !== grantDigest) {
        control.run = { ...control.run, runId: expectedRunId, state: "invalid" };
      }
      const attempt = readdirSync(receiptDirectory).filter(name => name.startsWith("read-")).length;
      const returned = readEvidence({ bundle, grant: control.grant, currentRun: control.run, call: params, attempt });
      // Persist before returning to MCP. This is a server return receipt, not delivery acknowledgement.
      writeFileSync(path.join(receiptDirectory, `read-${String(attempt).padStart(3, "0")}-${randomUUID()}.json`),
        JSON.stringify(returned), { flag: "wx", mode: 0o600 });
      observe("call_returned", { status: returned.receipt.status, failureReason: returned.receipt.failureReason });
      return { ...(returned.receipt.status === "returned" ? {} : { isError: true }),
        content: [{ type: "text", text: JSON.stringify(returned) }] };
    });
    queue = result.catch(() => {});
    return result;
  });
  await server.connect(new StdioServerTransport());
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void serve(...process.argv.slice(2)).catch(() => { process.stderr.write("Experiment reader startup failed.\n"); process.exitCode = 1; });
