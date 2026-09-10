import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {JSDOM} from "jsdom";
import {createPeerApprovalsController} from "./static/peer-approvals.mjs";

const html = readFileSync(new URL("./static/index.html", import.meta.url), "utf8");
const binding = JSON.parse(readFileSync(new URL("../../../packages/contracts/test/fixtures/peer-run.json", import.meta.url), "utf8")).request.binding;
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, mutation = async () => { throw new Error("unexpected decision"); }) {
  const dom = new JSDOM(html, {url: "http://127.0.0.1:40001"});
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const root = dom.window.document.getElementById("peer-approvals-panel"), badge = dom.window.document.getElementById("peer-approval-badge");
  const c = name => root.querySelector(`[data-approval-${name}]`);
  let clock = Date.parse("2026-09-10T01:00:00Z"), data = {approvals: [{requestId: "approval_uipeer001", processId: "process_uipeer001", binding: structuredClone(binding),
    bindingDigest: "b".repeat(64), consentRevision: binding.grantRevision, operationKind: "command", details: "Command: pwd", expiresAt: new Date(clock + 60000).toISOString()}]};
  const calls = [], controller = createPeerApprovalsController({root, badge, now: () => clock, request: async (path, options) => {
    calls.push({path, body: options?.body ? JSON.parse(options.body) : undefined});
    if (!options?.method) { if (data instanceof Error) throw data; return structuredClone(data); }
    return mutation(path, calls.at(-1).body);
  }}), state = {localNodeId: binding.participantNodeId};
  t.after(() => { controller.dispose(); dom.window.close(); });
  return {dom, root, c, badge, calls, data, controller, state, advance: ms => { clock += ms; }, replace: value => { data = value; },
    button: () => c("list").querySelector("button"),
    async start(active = true) { controller.render(state); controller.setActive(active); await flush(); },
    open() { this.button().click(); }};
}

test("native approval polls for attention without granting and reviews the exact single decision", async t => {
  let resolve;
  const f = fixture(t, async () => new Promise(done => { resolve = done; })); await f.start(false);
  assert.equal(f.badge.textContent, "1 待审批"); assert.equal(f.c("list").textContent, ""); assert.equal(f.calls.some(call => call.body), false);
  f.controller.setActive(true); await flush(); f.open();
  assert.match(f.c("scope").textContent, new RegExp(binding.roomId)); assert.match(f.c("scope").textContent, new RegExp(binding.localAgentId));
  assert.equal(f.c("details").textContent, "Command: pwd");
  f.c("allow").click(); f.c("allow").click(); f.c("deny").click(); await flush();
  assert.deepEqual(f.calls.filter(call => call.body), [{path: "/api/peers/approvals/approval_uipeer001", body: {
    processId: "process_uipeer001", bindingDigest: "b".repeat(64), consentRevision: binding.grantRevision, allow: true}}]);
  f.data.approvals = []; resolve({status: "recorded"}); await flush();
  assert.equal(f.c("dialog").open, false); assert.match(f.c("result").textContent, /仍会检查/); assert.equal(f.badge.hidden, true);
  assert.equal(f.dom.window.localStorage.length + f.dom.window.sessionStorage.length, 0);
});

test("polling preserves the review trigger and denial is an explicit exact false decision", async t => {
  const f = fixture(t, async () => { f.data.approvals = []; return {status: "recorded"}; }); await f.start();
  const button = f.button(); button.focus(); await f.controller.refresh();
  assert.equal(f.button(), button); assert.equal(f.dom.window.document.activeElement, button);
  f.open(); assert.equal(f.c("dialog").open, true); f.c("deny").click(); await flush();
  assert.equal(f.calls.find(call => call.body).body.allow, false); assert.match(f.c("result").textContent, /拒绝/);
});

test("changed process, consent, content, scope or expiry invalidates an unsubmitted review", async t => {
  for (const change of [v => { v.processId += "replacement"; }, v => { v.consentRevision++; }, v => { v.details = "Command: changed"; },
    v => { v.binding.roomId = "room_changed001"; }, v => { v.expiresAt = "2026-09-10T00:00:00Z"; }]) {
    const f = fixture(t); await f.start(); f.open(); change(f.data.approvals[0]); await f.controller.refresh();
    assert.equal(f.c("allow").disabled, true); assert.equal(f.c("deny").disabled, true); f.c("allow").click();
    assert.equal(f.calls.some(call => call.body), false); assert.match(f.c("error").textContent, /已结束|已变化/);
  }
});

test("an ambiguous consumed decision never replays or claims an outcome after refresh or reopening", async t => {
  const f = fixture(t, async () => { throw new Error("response lost"); }); await f.start(); f.open(); f.c("allow").click(); await flush();
  assert.match(f.c("error").textContent, /尚未确认/); assert.equal(f.c("deny").disabled, true);
  f.c("allow").click(); await f.controller.refresh(); assert.equal(f.calls.filter(call => call.body).length, 1);
  f.c("close").click(); assert.equal(f.button().disabled, true); f.button().click(); assert.equal(f.c("dialog").open, false);
  f.controller.setActive(false); f.controller.setActive(true); await flush(); assert.equal(f.button().disabled, true);
  f.data.approvals = []; await f.controller.refresh(); assert.match(f.c("result").textContent, /尚未确认/);
});

test("failed reads and elapsed expiry stop decisions while 401 retires private details and attention", async t => {
  const f = fixture(t); await f.start(); f.open(); f.advance(60000); f.controller.render(f.state);
  assert.equal(f.c("allow").disabled, true); assert.equal(f.badge.hidden, true); await flush();
  f.data.approvals[0].expiresAt = "2026-09-10T01:05:00Z"; await f.controller.refresh(); f.c("close").click(); f.open();
  f.replace(new Error("offline")); await f.controller.refresh(); assert.equal(f.c("deny").disabled, true);
  f.replace(Object.assign(new Error("expired"), {status: 401})); await f.controller.refresh();
  assert.equal(f.c("dialog").open, false); assert.equal(f.c("details").textContent, ""); assert.equal(f.badge.hidden, true);
  assert.equal(f.calls.some(call => call.body), false);
});

test("Node retirement ignores an outstanding decision and another Participant never appears", async t => {
  let resolve;
  const f = fixture(t, async () => new Promise(done => { resolve = done; })); await f.start(); f.open(); f.c("deny").click();
  f.controller.render({localNodeId: "node_replacement001"}); resolve({status: "recorded"}); await flush();
  assert.equal(f.c("result").textContent, ""); assert.equal(f.c("details").textContent, ""); assert.equal(f.badge.hidden, true);
  assert.equal(f.button(), null);
});

test("Runtime text stays inert and closing or keyboard navigation never decides", async t => {
  const f = fixture(t); f.data.approvals[0].operationKind = "file_change"; f.data.approvals[0].details = '<img src=x onerror="alert(1)">\n/private/file.txt';
  await f.start(); f.open(); assert.equal(f.c("details").querySelector("img"), null); assert.match(f.c("details").textContent, /onerror/);
  assert.match(f.c("scope").textContent, /修改文件/);
  const keydown = shiftKey => new f.dom.window.KeyboardEvent("keydown", {key: "Tab", shiftKey, bubbles: true, cancelable: true});
  f.c("close").focus(); f.c("dialog").dispatchEvent(keydown(true)); assert.equal(f.dom.window.document.activeElement, f.c("allow"));
  f.c("dialog").dispatchEvent(keydown(false)); assert.equal(f.dom.window.document.activeElement, f.c("close"));
  f.c("dialog").dispatchEvent(new f.dom.window.Event("cancel", {cancelable: true}));
  assert.equal(f.c("dialog").open, false); assert.equal(f.dom.window.document.activeElement, f.button());
  assert.equal(f.calls.some(call => call.body), false);
});
