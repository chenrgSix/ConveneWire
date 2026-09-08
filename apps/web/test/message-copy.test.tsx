import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { RoomTimeline } from "../src/features/room/RoomTimeline.js";
import type { Message } from "../src/models.js";

test("Agent replies copy their exact Markdown and report clipboard failure without changing content", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://localhost/" });
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
  const { act, cleanup, render, fireEvent, waitFor } = await import("@testing-library/react");
  const content = "结果 **已完成**\n\n```ts\nconst value = 1;\n```\n\n[详情](https://example.com)";
  const base: Message = { messageId: "msg_agent", roomId: "room_test", taskId: "task_test", sequence: 1,
    senderType: "agent", senderId: "agent_test", content, parentMessageId: null, mentions: [], createdAt: "2026-09-09T00:00:00Z" };
  const copied: string[] = [];
  let fail = false;
  Object.defineProperty(dom.window.navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => {
    if (fail) throw new Error("Clipboard denied");
    copied.push(text);
  } } });
  try {
    const props = { agentsById: new Map(), composerBusy: false, locale: "zh-CN" as const, membersById: new Map(),
      messages: [base, { ...base, messageId: "msg_member", senderType: "member" as const }, { ...base, messageId: "msg_system", senderType: "system" as const }],
      pendingMessages: [], runActivities: {}, runDiagnostics: {}, runOutputs: {}, runs: [], runsById: new Map(), session: null,
      onCancelRun: () => {}, onOpenWorkTask: () => {}, onRetryPendingMessage: () => {} };
    const view = render(<RoomTimeline {...props} />);
    assert.equal(view.getAllByRole("button", { name: "复制回复" }).length, 1);
    fireEvent.click(view.getByRole("button", { name: "复制回复" }));
    await waitFor(() => assert.ok(view.getByRole("button", { name: "已复制" })));
    assert.deepEqual(copied, [content]);
    fail = true;
    fireEvent.click(view.getByRole("button", { name: "已复制" }));
    await waitFor(() => assert.equal(view.getByRole("status").textContent, "复制失败，请选择文字复制"));
    assert.deepEqual(copied, [content]);
    assert.equal(view.container.querySelectorAll(".markdown-message pre").length, 3);
    view.rerender(<RoomTimeline {...props} locale="en" />);
    assert.ok(view.getByRole("button", { name: "Copy reply" }));
  } finally {
    await act(async () => cleanup());
    dom.window.close();
    for (const key of Object.keys(globals)) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
