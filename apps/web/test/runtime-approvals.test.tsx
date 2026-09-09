import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { RuntimeApprovals } from "../src/features/room/RuntimeApprovals.js";

test("Central requests open for explicit review and submit only the exact allow/deny decision", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://localhost/" });
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  const writes: Array<{ url: string; body: unknown }> = [];
  const item = { requestId: "approval_browser01", runId: "run_browser01", digest: "a".repeat(64), decision: "pending",
    agentName: "核心开发工程师", deviceName: "我的设备", roomName: "测试", roomId: "room_browser01", taskId: "task_browser01",
    request: { requestId: "approval_browser01", runId: "run_browser01", agentId: "agent_browser01", revision: 1,
      operationKind: "command", details: "printf approved > permission-test.txt\n/tmp/approval-fixture",
      expiresAt: "2026-09-09T00:05:00.000Z" } };
  let fail = false;
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, options: RequestInit) => {
      if (options.method === "POST") {
        const body = JSON.parse(String(options.body)); writes.push({ url, body });
        return new Response(JSON.stringify(fail ? { error: { message: "Lost response" } } : { ...item, decision: body.decision }), { status: fail ? 503 : 200 });
      }
      return new Response(JSON.stringify({ items: [item] }));
    } };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
  const { act, cleanup, render, fireEvent, waitFor } = await import("@testing-library/react");
  try {
    const view = render(<RuntimeApprovals teamId="team_browser01" token="owner-token" locale="zh-CN" />);
    await waitFor(() => assert.ok(view.getByRole("dialog", { name: "权限审批" })));
    assert.equal(writes.length, 0);
    assert.equal(document.querySelector(".runtime-approval-details")?.textContent, item.request.details);
    fireEvent.click(view.getByRole("button", { name: "关闭" }));
    assert.ok(!view.queryByRole("dialog"));
    assert.equal(writes.length, 0);
    fireEvent.click(view.getByRole("button", { name: "待审批权限 · 1" }));
    fail = true;
    fireEvent.click(view.getByRole("button", { name: "允许本次" }));
    await waitFor(() => assert.ok(view.getByRole("alert")));
    assert.deepEqual(writes[0], { url: "/api/runtime-approvals/approval_browser01/decision", body: { digest: item.digest, decision: "allow" } });
    fail = false;
    fireEvent.click(view.getByRole("button", { name: "允许本次" }));
    await waitFor(() => assert.ok(!view.queryByRole("dialog")));
    assert.deepEqual(writes[1], writes[0]);
    view.unmount();
    const english = render(<RuntimeApprovals teamId="team_browser01" token="owner-token" locale="en" />);
    await waitFor(() => assert.ok(english.getByRole("dialog", { name: "Permission request" })));
    fireEvent.click(english.getByRole("button", { name: "Deny" }));
    await waitFor(() => assert.ok(!english.queryByRole("dialog")));
    assert.deepEqual(writes[2]?.body, { digest: item.digest, decision: "deny" });
  } finally {
    await act(async () => cleanup()); dom.window.close();
    for (const key of Object.keys(globals)) { if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else Reflect.deleteProperty(globalThis, key); }
  }
});
