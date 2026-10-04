import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Agent } from "../src/models.js";
import { conversationReadiness, RoomConversationIntro } from "../src/features/room/RoomConversationIntro.js";

const real = { agentId: "real", name: "真实助手", enabled: true, presence: "ready", integrationMode: "managed" } as Agent;
const demo = { ...real, agentId: "demo", name: "演示助手", integrationMode: "fake" } as Agent;
const defaults = {
  canManageRoom: true, empty: true, hasTeamAgents: false, loaded: true, localNode: false,
  locale: "zh-CN" as const, onAssignAgents: () => {}, onChooseSetup: () => {}, onManageAgents: () => {},
  onManageRoom: () => {}, onSelectAgent: () => {}, roomAgents: [] as Agent[]
};

test("readiness uses Room membership, Task assignment and actual enabled presence before offering an Agent", () => {
  assert.equal(conversationReadiness([], undefined, false).kind, "loading");
  assert.equal(conversationReadiness([], undefined, true).kind, "empty");
  assert.equal(conversationReadiness([real], [], true).kind, "unassigned");
  for (const agent of [{ ...real, enabled: false }, { ...real, presence: "offline" as const }]) {
    assert.equal(conversationReadiness([agent], [real.agentId], true).kind, "unavailable");
  }
  assert.equal(conversationReadiness([real], ["removed-from-room"], true).kind, "unavailable");
  assert.deepEqual(conversationReadiness([demo, real], [demo.agentId], true), { kind: "demo", agent: demo });
  assert.deepEqual(conversationReadiness([demo, real], undefined, true), { kind: "ready", agent: real });
});

test("the compact guide distinguishes offline and demo Agents in both languages", () => {
  for (const locale of ["zh-CN", "en"] as const) {
    const offline = renderToStaticMarkup(<RoomConversationIntro {...defaults} empty={false} locale={locale}
      roomAgents={[{ ...real, presence: "offline" }]} assignedAgentIds={[real.agentId]} />);
    assert.match(offline, locale === "zh-CN" ? /此任务的 Agent 暂未就绪/u : /This Task’s Agents are not ready/u);
    assert.doesNotMatch(offline, /先配置并授权|No Agents are assigned|还未指派|agent-setup-choices/u);
    const simulated = renderToStaticMarkup(<RoomConversationIntro {...defaults} locale={locale} roomAgents={[demo]} />);
    assert.match(simulated, locale === "zh-CN" ? /不调用真实模型/u : /no real model calls/u);
    const loading = renderToStaticMarkup(<RoomConversationIntro {...defaults} locale={locale} loaded={false} />);
    assert.doesNotMatch(loading, /<button/u);
  }
});

test("setup paths are opt-in and retain Owner-only setup without running an Agent", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://team.example.com" });
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { cleanup, fireEvent, render } = await import("@testing-library/react");
  const actions: string[] = [];
  try {
    const view = render(<RoomConversationIntro {...defaults} canManageRoom={false} localNode
      onChooseSetup={(target) => actions.push(target)} onSelectAgent={() => actions.push("select")} />);
    assert.equal(view.queryByRole("region", { name: "选择开始方式" }), null);
    const add = view.getByRole("button", { name: "添加 Agent" });
    assert.equal(add.getAttribute("aria-expanded"), "false");
    fireEvent.click(add);
    assert.equal(add.getAttribute("aria-expanded"), "true");
    assert.ok(dom.window.document.getElementById(add.getAttribute("aria-controls")!));
    assert.equal((view.getByRole("button", { name: "创建中央 Agent" }) as HTMLButtonElement).disabled, true);
    fireEvent.click(view.getByRole("button", { name: "创建中央 Agent" }));
    assert.deepEqual(actions, []);
    fireEvent.click(view.getByRole("button", { name: "配置本机 Agent" }));
    assert.deepEqual(actions, ["local"]);
    fireEvent.click(add);
    assert.equal(view.queryByRole("region", { name: "选择开始方式" }), null);
  } finally {
    cleanup(); dom.window.close();
    for (const key of Object.keys(globals)) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("each readiness action reuses the appropriate configuration or mention entry", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://team.example.com" });
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { cleanup, fireEvent, render } = await import("@testing-library/react");
  const actions: string[] = [];
  const callbacks = { onManageRoom: () => actions.push("room"), onAssignAgents: () => actions.push("task"),
    onManageAgents: () => actions.push("status"), onSelectAgent: (agent: Agent) => actions.push(agent.agentId) };
  try {
    const view = render(<RoomConversationIntro {...defaults} {...callbacks} hasTeamAgents />);
    fireEvent.click(view.getByRole("button", { name: "选择房间 Agent" }));
    view.rerender(<RoomConversationIntro {...defaults} {...callbacks} roomAgents={[real]} assignedAgentIds={[]} />);
    fireEvent.click(view.getByRole("button", { name: "指派任务 Agent" }));
    view.rerender(<RoomConversationIntro {...defaults} {...callbacks} roomAgents={[{ ...real, enabled: false }]} assignedAgentIds={[real.agentId]} />);
    fireEvent.click(view.getByRole("button", { name: "查看 Agent 状态" }));
    view.rerender(<RoomConversationIntro {...defaults} {...callbacks} roomAgents={[demo, real]} />);
    fireEvent.click(view.getByRole("button", { name: "选择 Agent 提问" }));
    assert.deepEqual(actions, ["room", "task", "status", "real"]);
  } finally {
    cleanup(); dom.window.close();
    for (const key of Object.keys(globals)) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
