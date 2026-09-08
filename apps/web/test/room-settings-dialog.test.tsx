import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import React, { useState } from "react";

import { RoomSettingsDialog } from "../src/features/room/RoomSettingsDialog.js";
import { defaultRoomCollaborationPolicy, type Agent, type Member } from "../src/models.js";
import type { Locale } from "../src/i18n.js";

const members: Member[] = [
  { memberId: "owner", teamId: "team", userId: "user", displayName: "陈", role: "owner", createdAt: "2026-09-01" },
  { memberId: "member_a", teamId: "team", userId: null, displayName: "小王", role: "member", createdAt: "2026-09-01" },
  { memberId: "member_b", teamId: "team", userId: null, displayName: "小李", role: "member", createdAt: "2026-09-01" }
];
const agents: Agent[] = [
  { agentId: "agent_a_shared", ownerMemberId: "member_a", name: "开发工程师", role: "Builder", integrationMode: "managed", presence: "ready" },
  { agentId: "agent_b_shared", ownerMemberId: "member_b", name: "开发工程师", role: "Reviewer", integrationMode: "manual", presence: "offline" },
  { agentId: "agent_disabled", ownerMemberId: "member_a", name: "停用助手", role: "Reviewer", integrationMode: "hosted", presence: "offline", enabled: false }
];

test("Room settings identifies and filters participants without changing hidden selections", async (t) => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  const globals = {
    document: dom.window.document, window: dom.window, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
  const page = within(dom.window.document.body);
  let submitted: { memberIds: string[]; agentIds: string[] } | undefined;
  function Harness({ locale = "zh-CN", selected = [agents[0]!.agentId] }: { locale?: Locale; selected?: string[] }) {
    const [memberIds, setMemberIds] = useState(["owner"]);
    const [agentIds, setAgentIds] = useState(selected);
    return <RoomSettingsDialog
      agents={agents} busy={false} currentMemberId="owner" locale={locale} members={members}
      joinedMemberIds={["owner"]} joinedAgentIds={[agents[0]!.agentId]}
      participantMemberIds={memberIds} participantAgentIds={agentIds}
      policy={defaultRoomCollaborationPolicy} room={{ roomId: "room", teamId: "team", name: "优化", settingsRevision: 1, createdAt: "2026-09-01" }}
      onClose={() => {}} onPolicyChange={() => {}}
      onSubmit={(event) => { event.preventDefault(); submitted = { memberIds, agentIds }; }}
      onToggleMember={(id) => setMemberIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])}
      onToggleAgent={(id) => {
        if (!agentIds.includes(id)) {
          const owner = agents.find((agent) => agent.agentId === id)!.ownerMemberId!;
          setMemberIds((ids) => ids.includes(owner) ? ids : [...ids, owner]);
        }
        setAgentIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
      }}
    />;
  }
  t.beforeEach(async () => { await act(async () => cleanup()); submitted = undefined; });
  try {
    await t.test("same-name Agents expose distinct owners and collision-free IDs, with truthful state", () => {
      render(<Harness />);
      assert.ok(page.getByRole("checkbox", { name: /开发工程师 · Builder · 小王 #a_shared/u }));
      const offline = page.getByRole("checkbox", { name: /开发工程师 · Reviewer · 小李 #b_shared/u }) as HTMLInputElement;
      assert.equal(offline.disabled, false);
      assert.ok(page.getByText("当前离线，仍可加入房间"));
      assert.ok(page.getByText("我"));
      assert.ok(page.getByText(/名下 Agent：2/u));
      assert.equal((page.getByRole("checkbox", { name: /团队所有者必须保留/u }) as HTMLInputElement).disabled, true);
      assert.equal((page.getByRole("checkbox", { name: /停用助手/u }) as HTMLInputElement).disabled, true);
      assert.ok(page.getByText("已停用，不能新增；已选项可取消"));
    });
    await t.test("search and saved-roster filtering retain hidden selections and do not submit on Enter", () => {
      render(<Harness />);
      const search = page.getByRole("searchbox");
      fireEvent.change(search, { target: { value: "小李" } });
      assert.equal(page.queryByRole("checkbox", { name: /开发工程师 · Builder/u }), null);
      fireEvent.click(page.getByRole("checkbox", { name: /开发工程师 · Reviewer/u }));
      assert.ok(page.getByText("已同时选择所属成员「小李」，可在成员列表单独取消。"));
      assert.ok(page.getByText("已选 2 位成员 · 2 个 Agent · 保存后生效"));
      fireEvent.click(page.getByRole("checkbox", { name: /^小李/u }));
      assert.equal(page.queryByText(/已同时选择所属成员/u), null);
      fireEvent.change(search, { target: { value: "" } });
      fireEvent.click(page.getByRole("checkbox", { name: "仅看已加入" }));
      assert.equal(page.queryByRole("checkbox", { name: /开发工程师 · Reviewer/u }), null);
      assert.ok(page.getByRole("checkbox", { name: /开发工程师 · Builder/u }));
      assert.equal(fireEvent.keyDown(search, { key: "Enter" }), false);
      assert.equal(submitted, undefined);
      fireEvent.click(page.getByRole("button", { name: "保存", exact: true }));
      assert.deepEqual(submitted, { memberIds: ["owner"], agentIds: [agents[0]!.agentId, agents[1]!.agentId] });
    });
    await t.test("role and ID searches explain empty results in both locales", () => {
      render(<Harness locale="en" />);
      const search = page.getByRole("searchbox", { name: "Search name, role, owner or model" });
      fireEvent.change(search, { target: { value: "  builder " } });
      assert.ok(page.getByRole("checkbox", { name: /开发工程师 · Builder/u }));
      assert.equal(page.queryByRole("checkbox", { name: /开发工程师 · Reviewer/u }), null);
      fireEvent.change(search, { target: { value: "b_shared" } });
      assert.ok(page.getByRole("checkbox", { name: /开发工程师 · Reviewer/u }));
      fireEvent.change(search, { target: { value: "no such person" } });
      assert.ok(page.getByText("No matching members"));
      assert.ok(page.getByText("No matching Agents"));
    });
    await t.test("a previously selected disabled Agent can be removed, then cannot be added", () => {
      render(<Harness selected={["agent_disabled"]} />);
      const disabled = page.getByRole("checkbox", { name: /停用助手/u }) as HTMLInputElement;
      assert.equal(disabled.checked, true);
      assert.equal(disabled.disabled, false);
      fireEvent.click(disabled);
      assert.equal(disabled.checked, false);
      assert.equal(disabled.disabled, true);
    });
  } finally {
    await act(async () => cleanup());
    dom.window.close();
    for (const key of Object.keys(globals)) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
