import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { advanceWebSessionGeneration } from "../src/api-client.js";
import { TaskSelector } from "../src/features/task/TaskControls.js";
import { useTaskCreationAgents } from "../src/features/task/useTaskCreationAgents.js";
import type { Agent, AgentTask, LocalSession } from "../src/models.js";

test("task selector labels internal default work and localizes every task state", () => {
  const defaultTask: AgentTask = { taskId: "default", roomId: "room", parentTaskId: null, title: "Room work", goal: "", state: "open", isDefault: true, primaryAgentId: null, updatedAt: "" };
  for (const [locale, title] of [["zh-CN", "默认对话"], ["en", "General conversation"]] as const) {
    const output = renderToStaticMarkup(<TaskSelector locale={locale} tasks={[defaultTask]} selectedTask={defaultTask} selectedTaskId={defaultTask.taskId} onCreate={() => undefined} onSelect={() => undefined} />);
    assert.ok(output.includes(title));
    assert.equal(output.includes("Room work"), false);
    assert.equal(output.includes("task-state"), false, "general conversation does not imply a task execution state");
  }
  for (const [state, label] of [["open", "待开始"], ["working", "执行中"], ["blocked", "已阻塞"], ["review", "审核中"], ["completed", "已完成"], ["canceled", "已取消"]] as const) {
    const task = { ...defaultTask, isDefault: false, title: "My task", state };
    const output = renderToStaticMarkup(<TaskSelector locale="zh-CN" tasks={[task]} selectedTask={task} selectedTaskId={task.taskId} onCreate={() => undefined} onSelect={() => undefined} />);
    assert.ok(output.includes(`My task · ${label}`));
    assert.ok(output.includes(`>${label}</span>`));
  }
  assert.equal(defaultTask.title, "Room work", "presentation never rewrites the stored task");
});

test("creation candidates ignore a late previous Room response and allow retry after a failed load", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://team.example.com/" });
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: dom.window.document },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    navigator: { configurable: true, value: dom.window.navigator },
    window: { configurable: true, value: dom.window },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true }
  });
  advanceWebSessionGeneration();
  const originalFetch = globalThis.fetch;
  const requests: Array<{ path: string; resolve: (response: Response) => void }> = [];
  globalThis.fetch = async (input) => new Promise<Response>((resolve) => { requests.push({ path: String(input), resolve }); });
  const session = { userId: "owner", token: "fixture" } as LocalSession;
  const agents = [{ agentId: "agent-a", name: "Room A helper" }, { agentId: "agent-b", name: "Room B helper" }] as Agent[];
  function Harness({ roomId }: { roomId: string }) {
    const candidates = useTaskCreationAgents(roomId, session, agents);
    return <div>
      {candidates.loading && <p>Loading</p>}
      {candidates.error && <p>Failed</p>}
      {candidates.agents.map((agent) => <p key={agent.agentId}>{agent.name}</p>)}
      <button onClick={candidates.retry}>Retry</button>
    </div>;
  }
  const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
  const response = (agentId: string) => new Response(JSON.stringify({ participants: { memberIds: [], agentIds: [agentId] } }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const view = render(<Harness roomId="room-a" />);
    const page = within(dom.window.document.body);
    await waitFor(() => assert.equal(requests.length, 1));
    view.rerender(<Harness roomId="room-b" />);
    await waitFor(() => assert.equal(requests.length, 2));
    assert.equal(page.queryByText("Room A helper"), null);
    await act(async () => { requests[1]!.resolve(response("agent-b")); });
    await page.findByText("Room B helper");
    await act(async () => { requests[0]!.resolve(response("agent-a")); });
    assert.equal(page.queryByText("Room A helper"), null);
    assert.ok(page.getByText("Room B helper"));
    view.rerender(<Harness roomId="room-a" />);
    await waitFor(() => assert.equal(requests.length, 3));
    await act(async () => { requests[2]!.resolve(new Response(JSON.stringify({ error: { message: "Room unavailable" } }), { status: 503 })); });
    await page.findByText("Failed");
    assert.equal(page.queryByText("Room B helper"), null);
    fireEvent.click(page.getByRole("button", { name: "Retry" }));
    await waitFor(() => assert.equal(requests.length, 4));
    await act(async () => { requests[3]!.resolve(response("agent-a")); });
    await page.findByText("Room A helper");
    assert.equal(page.queryByText("Failed"), null);
  } finally {
    cleanup(); globalThis.fetch = originalFetch; dom.window.close();
    for (const key of ["document", "HTMLElement", "navigator", "window", "IS_REACT_ACT_ENVIRONMENT"]) {
      const descriptor = descriptors[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
