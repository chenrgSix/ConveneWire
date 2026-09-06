// Persist only bounded event identity and reply text, never tool arguments or provider diagnostics.
const identity = value => typeof value === "string" && /^[a-zA-Z_][a-zA-Z0-9_.:-]{0,95}$/u.test(value) ? value : null;
const knownKinds = new Set(["agent_message", "reasoning", "mcp_tool_call", "tool_search", "error"]);
export function boundedUtf8(value, maximumBytes) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let end = Math.min(bytes.length, maximumBytes);
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}
export function createInvocationObserver({ treatment, maximumAnswerBytes, maximumReadCalls }) {
  const state = { failures: [], itemKinds: [], toolEvents: [], messages: [], turnCompleted: false,
    turnFailed: false, omittedToolEvents: 0, omittedMessages: 0 };
  const calls = new Map();
  const fail = reason => { if (!state.failures.includes(reason)) state.failures.push(reason); };
  const observe = (event, observedAt = new Date().toISOString()) => {
    if (!event || typeof event !== "object" || typeof event.type !== "string") {
      fail("invalid_cli_event"); return true;
    }
    if (event.type === "turn.completed") {
      state.turnCompleted = true;
      for (const call of calls.values()) {
        if (call.kind !== "mcp_tool_call" || call.complete) continue;
        fail(call.server && call.tool ? "tool_call_incomplete" : "tool_identity_missing");
      }
    }
    if (["turn.failed", "error"].includes(event.type)) { state.turnFailed = true; fail(event.type); }
    if (!event.type?.startsWith("item.") || !event.item?.type) return false;
    const item = event.item;
    const kind = knownKinds.has(item.type) ? item.type : "other";
    if (!state.itemKinds.includes(kind)) state.itemKinds.push(kind);
    if (kind === "agent_message" && event.type === "item.completed") {
      if (typeof item.text !== "string") { fail("invalid_answer"); return false; }
      if (Buffer.byteLength(item.text) > maximumAnswerBytes) fail("answer_byte_limit");
      const message = { itemId: identity(item.id), phase: ["commentary", "final_answer"].includes(item.phase) ? item.phase : "unspecified",
        text: boundedUtf8(item.text, maximumAnswerBytes), observedAt };
      if (state.messages.length === 16) { state.messages.shift(); state.omittedMessages++; }
      state.messages.push(message);
      return false;
    }
    if (kind === "mcp_tool_call" || kind === "tool_search" || kind === "other") {
      const itemId = identity(item.id);
      const previous = itemId ? calls.get(itemId) : undefined;
      // Some versions announce a call before attaching its identity. Wait for an update;
      // only an explicit foreign identity or an unresolved terminal identity is rejected.
      const server = identity(item.server) ?? previous?.server ?? null;
      const tool = identity(item.tool) ?? previous?.tool ?? null;
      const complete = event.type === "item.completed";
      const malformed = (item.server !== undefined && identity(item.server) === null) ||
        (item.tool !== undefined && identity(item.tool) === null);
      let decision = "pending_identity";
      if (kind === "tool_search") decision = "metadata_only";
      else if (kind === "other" || malformed || (server && server !== "evidence") ||
        (tool && tool !== "read_evidence") || (treatment === "A" && kind === "mcp_tool_call")) decision = "rejected";
      else if (server === "evidence" && tool === "read_evidence") decision = "allowed";
      else if (complete) decision = "missing_identity";
      if (!itemId && kind === "mcp_tool_call") decision = "missing_identity";
      if (itemId && calls.size < 65) calls.set(itemId, { server, tool, kind, complete: complete || previous?.complete });
      const record = { itemId, kind, rawKind: identity(item.type),
        stage: ["item.started", "item.updated", "item.completed"].includes(event.type) ? event.type : "other",
        server, tool, decision, status: ["in_progress", "completed", "failed"].includes(item.status) ? item.status : null, observedAt };
      if (state.toolEvents.length < 64) state.toolEvents.push(record);
      else { state.omittedToolEvents++; fail("tool_event_limit"); return true; }
      if (decision === "rejected") { fail("unapproved_tool"); return true; }
      if (decision === "missing_identity") { fail("tool_identity_missing"); return true; }
      if ([...calls.values()].filter(value => value.kind === "mcp_tool_call").length > maximumReadCalls) {
        fail("tool_call_limit"); return true;
      }
      if (item.status === "failed" || item.error) fail("tool_return_failed");
    } else if (kind === "error") fail("item_error");
    return false;
  };
  return { state, fail, observe };
}
