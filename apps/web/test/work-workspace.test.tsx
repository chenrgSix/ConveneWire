import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { WorkbenchPage } from "@convene-wire/contracts/task-result";
import { JSDOM } from "jsdom";
import React from "react";

import { WorkWorkspace } from "../src/features/work/WorkWorkspace.js";
import type { WorkFilters } from "../src/features/work/work-filters.js";

type Item = WorkbenchPage["items"][number];

function item(overrides: Partial<Item> = {}): Item {
  return {
    taskId: "task_opaque_workbench_0001",
    taskDisplayNumber: 17,
    roomId: "room_workbench_0001",
    title: "Verify the Workbench",
    ownerMemberId: "member_workbench_0001",
    lifecycleState: "active",
    schedulingState: "enabled",
    priority: "high",
    attentionReasons: [],
    primaryAttention: null,
    latestRun: {
      runId: "run_workbench_0001",
      taskId: "task_opaque_workbench_0001",
      agentId: "agent_workbench_0001",
      state: "working",
      phase: "unknown",
      attemptNumber: 2,
      retryOfRunId: "run_workbench_0000",
      createdAt: "2026-08-28T10:00:00.000Z",
      updatedAt: "2026-08-28T10:01:00.000Z"
    },
    latestResultId: null,
    latestResultCurrent: null,
    requiredCriteriaSatisfied: 1,
    requiredCriteriaTotal: 3,
    budgetUsage: {
      usageRevision: 2,
      runAttempts: 2,
      executionDurationSeconds: 42,
      providerTokens: null,
      providerCostUsd: null
    },
    nextAction: {
      actorKind: "agent",
      reason: "submit_result",
      sourceId: "task_opaque_workbench_0001",
      expectedMemberId: null,
      expectedAgentId: "agent_workbench_0001"
    },
    updatedAt: "2026-08-28T10:01:00.000Z",
    ...overrides
  };
}

function installDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://team.example.com/"
  });
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: dom.window.document },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    navigator: { configurable: true, value: dom.window.navigator },
    window: { configurable: true, value: dom.window }
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true
  });
  return dom;
}

test("Work groups authoritative items and opens by opaque Task identity", async () => {
  const dom = installDom();
  const opened: Array<{ taskId: string; roomId: string }> = [];
  const blocked = item({
    taskId: "task_opaque_workbench_0002",
    taskDisplayNumber: 18,
    title: "Resolve human and Runtime blocks",
    latestRun: null,
    attentionReasons: [
      {
        reason: "blocked",
        sourceId: "block_workbench_0001",
        occurredAt: "2026-08-28T10:02:00.000Z",
        actorKind: "member",
        expectedMemberId: "member_workbench_0001",
        expectedAgentId: null
      },
      {
        reason: "paused",
        sourceId: "task_opaque_workbench_0002",
        occurredAt: "2026-08-28T10:02:00.000Z",
        actorKind: "member",
        expectedMemberId: "member_workbench_0001",
        expectedAgentId: null
      },
      {
        reason: "runtime_unavailable",
        sourceId: "agent_workbench_0001",
        occurredAt: "2026-08-28T10:02:00.000Z",
        actorKind: "agent",
        expectedMemberId: null,
        expectedAgentId: "agent_workbench_0001"
      }
    ],
    primaryAttention: "blocked",
    schedulingState: "paused",
    nextAction: {
      actorKind: "member",
      reason: "resolve_block",
      sourceId: "block_workbench_0001",
      expectedMemberId: "member_workbench_0001",
      expectedAgentId: null
    }
  });
  const review = item({
    taskId: "task_opaque_workbench_0003",
    taskDisplayNumber: 19,
    title: "Review immutable Result",
    lifecycleState: "review",
    latestResultId: "result_workbench_0001",
    latestResultCurrent: false,
    attentionReasons: [{
      reason: "result_stale",
      sourceId: "result_workbench_0001",
      occurredAt: "2026-08-28T10:03:00.000Z",
      actorKind: "member",
      expectedMemberId: "member_workbench_0001",
      expectedAgentId: null
    }],
    primaryAttention: "result_stale"
  });
  const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
  try {
    render(
      <WorkWorkspace
        agentNames={new Map([["agent_workbench_0001", "Builder"]])}
        error={null}
        items={[item(), blocked, review]}
        loading={false}
        locale="zh-CN"
        memberNames={new Map([["member_workbench_0001", "Alice"]])}
        onOpenTask={(taskId, roomId) => opened.push({ taskId, roomId })}
        onRefresh={() => undefined}
        onScopeChange={() => undefined}
        roomNames={new Map([["room_workbench_0001", "delivery"]])}
        scope="mine"
      />
    );
    const page = within(dom.window.document.body);
    assert.ok(page.getByRole("heading", { name: "正在执行" }));
    assert.ok(page.getByRole("heading", { name: "等待审核" }));
    assert.ok(page.getByRole("heading", { name: "阻塞与风险" }));
    assert.ok(page.getByText("已阻塞"));
    assert.ok(page.getAllByText("已暂停").length >= 1);
    assert.ok(page.getByText("运行时不可用"));
    assert.equal(page.getAllByText("验收标准 · 1/3").length, 3);
    assert.equal(page.queryByText("提供方用量"), null);
    assert.equal(page.queryByText("运行尝试"), null);
    assert.doesNotMatch(dom.window.document.body.textContent ?? "", /task_opaque/u);
    assert.doesNotMatch(dom.window.document.body.textContent ?? "", /33%|percentage/u);
    fireEvent.click(page.getByRole("button", { name: "打开 TASK-18：Resolve human and Runtime blocks" }));
    assert.deepEqual(opened, [{
      taskId: "task_opaque_workbench_0002",
      roomId: "room_workbench_0001"
    }]);
  } finally {
    cleanup();
    dom.window.close();
  }
});

test("Work layout collapses to one card column on narrow screens", async () => {
  const css = await readFile(
    new URL("../src/styles.css", import.meta.url),
    "utf8"
  );
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.work-card-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/u);
  assert.doesNotMatch(css, /\.work-card[^}]*min-width:\s*[4-9]\d\dpx/u);
});

test("work filters and pagination use explicit root callbacks and preserve authoritative rows", async () => {
  const dom = installDom();
  const states: string[] = [];
  const owners: string[] = [];
  let pages = 0;
  const props = {
    agentNames: new Map<string, string>(), error: null, items: [item()], loading: false,
    locale: "en" as const, memberNames: new Map([["member_workbench_0001", "Alice"]]),
    onOpenTask: () => undefined, onRefresh: () => undefined, onScopeChange: () => undefined,
    roomNames: new Map<string, string>(), scope: "team" as const,
    lifecycleState: "active", ownerMemberId: "member_workbench_0001", hasMore: true,
    onLifecycleStateChange: (value: string) => states.push(value),
    onOwnerMemberIdChange: (value: string) => owners.push(value), onLoadMore: () => { pages += 1; }
  };
  const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
  try {
    const view = render(<WorkWorkspace {...props} />);
    const page = within(dom.window.document.body);
    fireEvent.click(page.getByRole("button", { name: "Filters (2)" }));
    fireEvent.change(page.getByRole("combobox", { name: "Task state" }), { target: { value: "completed" } });
    fireEvent.change(page.getByRole("combobox", { name: "Owner" }), { target: { value: "" } });
    assert.deepEqual(states, ["completed"]);
    assert.deepEqual(owners, [""]);
    assert.ok(page.getByText("Verify the Workbench"), "the component must not filter a partial page itself");
    fireEvent.click(page.getByRole("button", { name: "Load more work" }));
    assert.equal(pages, 1);
    view.rerender(<WorkWorkspace {...props} loadingMore />);
    assert.equal((page.getByRole("button", { name: "Loading…" }) as HTMLButtonElement).disabled, true);
    view.rerender(<WorkWorkspace {...props} hasMore={false} />);
    assert.equal(page.queryByRole("button", { name: "Load more work" }), null);
    assert.ok(page.getByText("All work matching the current filters is shown"));
    fireEvent.click(page.getByRole("button", { name: "Clear filters" }));
    assert.deepEqual(states, ["completed", ""]);
  } finally {
    cleanup();
    dom.window.close();
  }
});

test("advanced filters stay compact and show restored selections before the panel opens", async () => {
  const dom = installDom();
  const changes: WorkFilters[] = [];
  let cleared = 0;
  const props = {
    agentNames: new Map([["agent_workbench_0001", "Builder"]]), error: null, items: [], loading: false,
    locale: "zh-CN" as const, memberNames: new Map([["member_workbench_0001", "Alice"]]),
    roomNames: new Map([["room_workbench_0001", "delivery"]]), scope: "team" as const,
    onOpenTask: () => undefined, onRefresh: () => undefined, onScopeChange: () => undefined,
    onSearchChange: () => undefined, onLifecycleStateChange: () => undefined, onOwnerMemberIdChange: () => undefined,
    onFiltersChange: (filters: WorkFilters) => changes.push(filters), onClearFilters: () => { cleared += 1; }
  };
  const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
  try {
    const view = render(<WorkWorkspace {...props} />);
    const page = within(dom.window.document.body);
    assert.equal(page.getByRole("button", { name: "筛选", exact: true }).getAttribute("aria-expanded"), "false");
    assert.equal(page.queryAllByRole("combobox").length, 0);
    assert.ok(page.getByRole("searchbox", { name: "搜索工作" }));
    fireEvent.click(page.getByRole("button", { name: "待输入", exact: true }));
    assert.deepEqual(changes, [{ attention: "needs_input" }]);

    view.rerender(<WorkWorkspace {...props} attention="needs_input" filterRoomId="room_workbench_0001"
      filterAgentId="agent_workbench_0001" priority="urgent" lifecycleState="active" ownerMemberId="member_workbench_0001" />);
    const toggle = page.getByRole("button", { name: "筛选 (6)", exact: true });
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(page.queryAllByRole("combobox").length, 0);
    const selections = page.getByRole("list", { name: "已选筛选" });
    assert.ok(within(selections).getByText("房间: delivery"));
    assert.ok(within(selections).getByText("负责人: Alice"));
    assert.equal(within(selections).getAllByRole("listitem").length, 6);
    assert.ok(page.getByText("没有匹配的任务"));
    assert.equal(page.getByRole("button", { name: "待输入", exact: true }).getAttribute("aria-pressed"), "true");
    fireEvent.click(toggle);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(page.getAllByRole("combobox").length, 6);
    assert.equal((page.getByRole("combobox", { name: "筛选房间" }) as HTMLSelectElement).value, "room_workbench_0001");
    fireEvent.change(page.getByRole("combobox", { name: "筛选房间" }), { target: { value: "" } });
    assert.deepEqual(changes.at(-1), { filterRoomId: "" });
    fireEvent.click(toggle);
    fireEvent.click(page.getByRole("button", { name: "清除筛选" }));
    assert.equal(cleared, 1, "clearing stays available while advanced controls are hidden");
    view.rerender(<WorkWorkspace {...props} />);
    assert.equal(page.queryByRole("list", { name: "已选筛选" }), null);
    assert.equal(page.queryByRole("button", { name: "清除筛选" }), null);
    assert.ok(page.getByText("还没有任务"));
  } finally { cleanup(); dom.window.close(); }
});

test("cards name the actual next actor without claiming that another member's work is mine", async () => {
  const dom = installDom();
  const pending = item({ latestRun: null, requiredCriteriaSatisfied: 0, requiredCriteriaTotal: 0,
    nextAction: { actorKind: "member", reason: "provide_input", sourceId: null,
      expectedMemberId: "member_workbench_0002", expectedAgentId: null } });
  const props = {
    agentNames: new Map<string, string>(), error: null, items: [pending], loading: false,
    locale: "zh-CN" as const, memberNames: new Map([["member_workbench_0001", "Alice"], ["member_workbench_0002", "Bob"]]),
    roomNames: new Map([["room_workbench_0001", "delivery"]]), onOpenTask: () => undefined,
    onOpenAction: () => undefined, onRefresh: () => undefined, onScopeChange: () => undefined
  };
  const { cleanup, render, within } = await import("@testing-library/react");
  try {
    const view = render(<WorkWorkspace {...props} scope="team" />);
    const page = within(dom.window.document.body);
    assert.ok(page.getByRole("button", { name: "打开 TASK-17：Verify the Workbench" }));
    assert.ok(page.getByRole("heading", { name: "待处理", exact: true }));
    assert.ok(page.getByText("下一步由 Bob"));
    assert.ok(page.getByText(/负责人 Alice/u));
    assert.ok(page.getByRole("button", { name: /查看 TASK-17 的下一步：提供输入/u }));
    assert.doesNotMatch(dom.window.document.body.textContent ?? "", /需要我处理|0\/0|提供方用量|运行尝试/u);
    view.rerender(<WorkWorkspace {...props} scope="mine" />);
    assert.ok(page.getByText("下一步由 Bob"), "owning a task does not mean owning its next action");
    assert.equal(page.queryByText("需要我处理"), null);
  } finally { cleanup(); dom.window.close(); }
});
