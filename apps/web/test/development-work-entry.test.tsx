import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { DevelopmentWorkEntry } from "../src/features/room/DevelopmentWorkEntry.js";
import { VerificationLogPreview } from "../src/features/work/VerificationLogPreview.js";
import { advanceWebSessionGeneration } from "../src/api-client.js";

const choice = { agentId: "agent_development01", agentName: "Developer", deviceId: "device_development01", state: "available", blocker: null,
  policy: { policyId: "workpolicy_development01", digest: "a".repeat(64), alias: "前端项目", sourceRef: "refs/heads/main", baseCommit: "b".repeat(40),
    scope: {allowedPaths: ["src"], forbiddenPaths: []}, verificationProfiles: [{profileId: "profile_browser0001"}], maxRunAttempts: 3, maxTaskDurationSeconds: 1800 } };
const json = (value: unknown) => new Response(JSON.stringify(value), {headers: {"content-type": "application/json"}});
async function harness() {
  const dom = new JSDOM("<!doctype html><body></body>", {url: "https://team.example.com/"});
  for (const [key,value] of Object.entries({window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    navigator: dom.window.navigator, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true})) {
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
  }
  const testing = await import("@testing-library/react");
  return {...testing, dom, close: () => {testing.cleanup(); dom.window.close();}};
}

test("development entry freezes a lost request and reconciles replay after reopening", async () => {
  const h = await harness(); const original = globalThis.fetch;
  const posts: any[] = []; const opened: string[] = []; let observed: any[] = []; let lost = true;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("development-options")) return json({options: [choice]});
    if (init?.method === "POST") {
      const command = JSON.parse(String(init.body)); posts.push(command);
      assert.equal(sessionStorage.getItem("convenewire.development.v1:member_development01:room_development01"), JSON.stringify(command));
      if (lost) {lost = false; throw new Error("response lost");}
      observed = [{...command, taskId: "task_development01", rootTaskId: "task_developmentroot01", state: "authorized"}]; return json(observed[0]);
    }
    return json({items: observed});
  };
  try {
    h.render(<DevelopmentWorkEntry roomId="room_development01" memberId="member_development01" token="owner" locale="zh-CN" onCreated={() => {}} onOpenTask={(_room, task) => {opened.push(task);}} />);
    const ui = h.within(document.body);
    h.fireEvent.click(ui.getByRole("button", {name: "发起开发"}));
    await h.waitFor(() => assert.ok(ui.getByText("前端项目", {selector: "strong"})));
    h.fireEvent.change(ui.getByLabelText("任务标题"), {target: {value: "调整输入框"}});
    h.fireEvent.change(ui.getByLabelText("开发目标"), {target: {value: "支持多行输入"}});
    h.fireEvent.change(ui.getByLabelText("验收标准（每行一条）"), {target: {value: "回车换行\n按钮正常"}});
    h.fireEvent.click(ui.getByRole("button", {name: "开始开发"}));
    await h.waitFor(() => assert.ok(ui.getByText(/请求结果尚未确认/u)));
    assert.deepEqual(Object.keys(posts[0]).sort(), ["agentId","baseCommit","criteria","goal","operationId","policyDigest","policyId","title"]);
    h.fireEvent.click(ui.getByRole("button", {name: "关闭"}));
    h.fireEvent.click(ui.getByRole("button", {name: "发起开发"}));
    await h.waitFor(() => assert.ok(ui.getByRole("button", {name: "核对并重试"})));
    h.fireEvent.click(ui.getByRole("button", {name: "核对并重试"}));
    await h.waitFor(() => assert.ok(ui.getByText("已授权，执行与交付请查看任务")));
    assert.deepEqual(posts[1], posts[0]); assert.equal(sessionStorage.length, 0);
    assert.equal((ui.getByLabelText("任务标题") as HTMLInputElement).value, "");
    h.fireEvent.click(ui.getByRole("button", {name: "查看执行与交付"}));
    assert.deepEqual(opened, ["task_developmentroot01"]);
  } finally {h.close(); globalThis.fetch = original;}
});

test("unavailable policy blocks development and stale session cannot surface old readiness", async () => {
  const h = await harness(); const original = globalThis.fetch;
  let resolve!: (value: Response) => void;
  globalThis.fetch = async (url) => String(url).endsWith("development-options")
    ? json({options: [{...choice, state: "unavailable", blocker: "device_offline", policy: null}]}) : json({items: []});
  try {
    const props = {roomId: "room_development01", memberId: "member_development01", token: "owner", locale: "zh-CN" as const, onCreated: () => {}, onOpenTask: () => {}};
    h.render(<DevelopmentWorkEntry {...props} />); const ui = h.within(document.body);
    h.fireEvent.click(ui.getByRole("button", {name: "发起开发"}));
    await h.waitFor(() => assert.ok(ui.getByText(/请设备主人启动客户端/u)));
    assert.equal((ui.getByRole("button", {name: "开始开发"}) as HTMLButtonElement).disabled, true);
    globalThis.fetch = async (url) => String(url).endsWith("development-options") ? new Promise((done) => {resolve = done;}) : json({items: []});
    h.fireEvent.click(ui.getByRole("button", {name: "刷新可用范围"}));
    advanceWebSessionGeneration();
    await h.act(async () => {resolve(json({options: [choice]}));});
    assert.equal(ui.queryByText("前端项目", {selector: "strong"}), null);
  } finally {h.close(); globalThis.fetch = original;}
});

test("verification log checks receipt identity before displaying any image", async () => {
  const h = await harness(); const original = globalThis.fetch;
  let digest = "wrong";
  globalThis.fetch = async () => json({artifactId: "artifact_browser0001", taskId: "task_browser0001", artifactRevision: 1, sha256: digest, integrity: "verified", text: "verified diagnostic",
    browser: {startup: "passed", pageLoad: "passed", cleanup: "completed", reason: "completed", visualReview: "not_performed", steps: [], screenshot: {state: "captured", dataUrl: "data:image/svg+xml;base64,PHN2Zz4="}}});
  try {
    h.render(<React.StrictMode><VerificationLogPreview taskId="task_browser0001" artifactId="artifact_browser0001" digest={"a".repeat(64)} revision={1} token="owner" locale="zh-CN" /></React.StrictMode>);
    const ui = h.within(document.body); h.fireEvent.click(ui.getByRole("button", {name: "查看验证报告"}));
    await h.waitFor(() => assert.ok(ui.getByText(/报告与验证回执不匹配/u)));
    assert.equal(ui.queryByRole("img"), null);
    digest = "a".repeat(64); h.fireEvent.click(ui.getByRole("button", {name: "查看验证报告"}));
    await h.waitFor(() => assert.ok(ui.getByText("浏览器验证报告")));
    assert.equal(ui.queryByRole("img"), null);
    assert.ok(document.body.textContent?.includes("尚未"));
  } finally {h.close(); globalThis.fetch = original;}
});

test("corrupt recovery storage cannot be overwritten with a fresh development request", async () => {
  const h = await harness(); const original = globalThis.fetch;
  sessionStorage.setItem("convenewire.development.v1:member_development01:room_development01", "{broken");
  globalThis.fetch = async (url, init) => {
    assert.notEqual(init?.method, "POST");
    return json(String(url).endsWith("development-options") ? {options: [choice]} : {items: []});
  };
  try {
    h.render(<DevelopmentWorkEntry roomId="room_development01" memberId="member_development01" token="owner" locale="zh-CN" onCreated={() => {}} onOpenTask={() => {}} />);
    const ui = h.within(document.body); h.fireEvent.click(ui.getByRole("button", {name: "发起开发"}));
    await h.waitFor(() => assert.ok(ui.getByText("前端项目", {selector: "strong"})));
    assert.equal((ui.getByRole("button", {name: "开始开发"}) as HTMLButtonElement).disabled, true);
    assert.equal(sessionStorage.getItem("convenewire.development.v1:member_development01:room_development01"), "{broken");
  } finally {h.close(); globalThis.fetch = original;}
});
