import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {JSDOM} from "jsdom";
import {createPeerSharingController, sharingRooms} from "./static/peer-sharing.mjs";

const html = readFileSync(new URL("./static/index.html", import.meta.url), "utf8");
const recorded = JSON.parse(readFileSync(new URL("../../../packages/contracts/test/fixtures/peer-join.json", import.meta.url), "utf8"));
const membership = recorded.state.connections[0].receipt.membership, invitation = recorded.state.connections[0].receipt.invitation;
const capabilities = {supportsStart: true, supportsStreaming: true, supportsInterrupt: true, supportsResume: false, supportsTaskContextIsolation: true, supportsOwnerPrivateOutput: false};
const source = {localAgentId: "agent_uisharing001", name: "Local Writer", role: "Reviewer", workspace: "/private/local-workspace", sandbox: "workspace-write", capabilities, configurationDigest: "a".repeat(64), available: true};
const connection = {membership, invitation, state: "active", exports: []};
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, mutation = async () => { throw new Error("unexpected mutation"); }) {
  const dom = new JSDOM(html, {url: "http://127.0.0.1:40001"});
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const root = dom.window.document.getElementById("peer-sharing-panel");
  const c = name => root.querySelector(`[data-sharing-${name}]`);
  const calls = []; let seq = 0, clock = Date.parse(recorded.now);
  let data = {configurationAvailable: true, state: {participant: recorded.state.participant, revision: 1, connections: [structuredClone(connection)]}, sources: [structuredClone(source)]};
  const controller = createPeerSharingController({root, now: () => clock, newOperationId: () => `op_sharingtest${++seq}`, request: async (path, options) => {
    calls.push({path, body: options?.body ? JSON.parse(options.body) : undefined});
    if (!options?.method) { if (data instanceof Error) throw data; return structuredClone(data); }
    return mutation(path, calls.at(-1).body);
  }});
  const state = {localNodeId: recorded.state.participant.nodeId};
  t.after(() => { controller.dispose(); dom.window.close(); });
  return {dom, root, c, calls, controller, data, state, advance: ms => { clock += ms; }, replace: value => { data = value; },
    action(key) { return [...root.querySelectorAll("[data-sharing-key]")].find(node => node.dataset.sharingKey === key); },
    async start() { controller.render(state); controller.setActive(true); await flush(); },
    open() { this.action(`share:${membership.membershipId}`).click(); },
    review() { this.open(); c("review-submit").click(); }};
}
const exported = (revision = 1, grantState = "active") => ({offer: {displayName: source.name, role: source.role, grant: {schemaVersion: 1, exportId: "export_uisharing001", localAgentId: source.localAgentId,
  roomIds: [membership.scope.roomId], capabilities, expiresAt: membership.expiresAt, revision, state: grantState}}, current: grantState === "active", effectiveRoomIds: []});

test("sharing reviews local configuration, freezes capabilities and retries only the original ambiguous operation", async t => {
  let attempts = 0;
  const f = fixture(t, async (path, body) => {
    assert.equal(path, "/api/peers/exports");
    if (++attempts === 1) { f.data.state.revision++; throw new Error("response lost after commit"); }
    return {offer: exported().offer};
  });
  f.controller.render(f.state); await flush(); assert.deepEqual(f.calls, []);
  await f.start(); f.open();
  assert.match(f.c("source").textContent, /private\/local-workspace/);
  f.c("source").querySelector('[data-capability="supportsInterrupt"]').checked = false;
  f.c("review-submit").click();
  assert.equal(f.calls.filter(call => call.body).length, 0);
  assert.match(f.c("review").textContent, /Host 接纳/);
  f.c("confirm").click(); f.c("confirm").click(); await flush();
  assert.equal(attempts, 1); assert.match(f.c("error").textContent, /response lost/);
  const frozen = f.calls.find(call => call.body).body;
  assert.equal(frozen.configurationDigest, source.configurationDigest);
  assert.equal(frozen.request.capabilities.supportsInterrupt, false);
  assert.deepEqual(frozen.request.roomIds, [membership.scope.roomId]);
  assert.equal(frozen.expectedRevision, 1);
  assert.equal(JSON.stringify(frozen).includes(source.workspace), false);
  f.advance(2 * 86400_000); f.controller.render(f.state); await flush();
  f.c("confirm").click(); await flush();
  assert.deepEqual(f.calls.filter(call => call.body).map(call => call.body), [frozen, frozen]);
  assert.equal(f.c("dialog").open, false);
  assert.match(f.c("result").textContent, /授权已保存/);
  assert.equal(f.dom.window.localStorage.length + f.dom.window.sessionStorage.length, 0);
});

test("unsubmitted reviews cannot adopt a changed configuration, revision or membership", async t => {
  const f = fixture(t); await f.start(); f.review();
  assert.equal(f.c("confirm").disabled, false);
  f.data.sources[0].configurationDigest = "b".repeat(64);
  await f.controller.refresh();
  assert.equal(f.c("confirm").disabled, true); f.c("confirm").click(); assert.equal(f.calls.some(call => call.body), false);
  f.c("back").click(); f.c("review-submit").click(); assert.equal(f.c("confirm").disabled, false);
  f.data.state.revision++; await f.controller.refresh(); assert.equal(f.c("confirm").disabled, true);
  f.c("back").click(); f.c("review-submit").click();
  f.advance(Date.parse(membership.expiresAt) - Date.parse(recorded.now)); f.controller.render(f.state); await flush();
  assert.equal(f.c("confirm").disabled, true);
});

test("Team sharing accepts only explicit same-Host Room links and Room membership cannot widen", () => {
  const scoped = structuredClone(connection); scoped.membership.scope = {kind: "team", teamId: membership.scope.teamId, roomId: null};
  const link = `${invitation.hostOrigin}/?team=${membership.scope.teamId}&room=${membership.scope.roomId}&view=room`;
  assert.deepEqual(sharingRooms(link, scoped), [membership.scope.roomId]);
  for (const input of ["", `${link}\n${link}`, link.replace(invitation.hostOrigin, "https://foreign.example"), link.replace("team=", "team=wrong"), `${link}#peerEntry=secret`, `${link}&token=secret`, `${link}&room=room_other001`, "room_rawid001"]) assert.throws(() => sharingRooms(input, scoped));
  assert.deepEqual(sharingRooms("https://foreign.example", connection), [membership.scope.roomId]);
});

test("retained exports remain withdrawable without Runtime sources and distinguish old Host acceptance", async t => {
  let attempts = 0;
  const f = fixture(t, async (path, body) => {
    assert.equal(path, "/api/peers/exports/withdraw");
    if (++attempts === 1) {
      f.data.state.revision++; f.data.state.connections[0].exports[0].offer.grant.state = "revoked";
      throw new Error("lost withdrawal response");
    }
    return {offer: exported(2, "revoked").offer};
  });
  const entry = exported(); entry.current = false; entry.acceptance = {acceptance: {state: "active", expiresAt: membership.expiresAt, exportId: "export_oldsharing001", grantRevision: 1}};
  f.data.configurationAvailable = false; f.data.sources = []; f.data.state.connections[0].exports = [entry];
  await f.start(); assert.equal(f.action(`share:${membership.membershipId}`), undefined);
  assert.match(f.c("inventory").textContent, /配置不可用/); assert.match(f.c("inventory").textContent, /旧的分享版本/);
  f.action("withdraw:export_uisharing001").click(); assert.equal(f.calls.some(call => call.body), false);
  f.c("withdraw-confirm").click(); await flush();
  const frozen = f.calls.find(call => call.body).body;
  f.c("withdraw-confirm").click(); await flush();
  assert.deepEqual(f.calls.filter(call => call.body).map(call => call.body), [frozen, frozen]);
  assert.equal(f.c("withdraw-dialog").open, false); assert.match(f.c("result").textContent, /本机分享已撤回/);
});

test("sharing retirement clears local configuration details and ignores late mutation results", async t => {
  let resolve;
  const f = fixture(t, async () => new Promise(done => { resolve = done; })); await f.start(); f.review(); f.c("confirm").click();
  f.controller.setActive(false); resolve({offer: exported().offer}); await flush();
  assert.equal(f.c("dialog").open, false); assert.equal(f.c("source").textContent, ""); assert.equal(f.c("result").textContent, "");
  f.controller.setActive(true); await flush();
  f.controller.render(null); assert.equal(f.c("inventory").textContent, "");
});

test("sharing labels stay text and review dialogs retain both focus directions and Escape", async t => {
  const f = fixture(t); f.data.sources[0].name = '<img src=x onerror="bad()">'; await f.start(); f.review();
  assert.equal(f.c("dialog").querySelector("img"), null); assert.match(f.c("review").textContent, /<img/);
  f.c("confirm").focus(); f.c("confirm").dispatchEvent(new f.dom.window.KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true}));
  assert.equal(f.dom.window.document.activeElement, f.c("close"));
  f.c("close").dispatchEvent(new f.dom.window.KeyboardEvent("keydown", {key: "Tab", shiftKey: true, bubbles: true, cancelable: true}));
  assert.equal(f.dom.window.document.activeElement, f.c("confirm"));
  f.c("dialog").dispatchEvent(new f.dom.window.Event("cancel", {cancelable: true}));
  assert.equal(f.c("dialog").open, false); assert.equal(f.c("source").textContent, "");
  assert.equal(f.dom.window.document.activeElement, f.action(`share:${membership.membershipId}`));
});


test("changed configuration is shown again before the Owner can review it", async t => {
  const f = fixture(t); await f.start(); f.open();
  f.data.sources[0].workspace = "/private/new-workspace"; f.data.sources[0].configurationDigest = "b".repeat(64);
  await f.controller.refresh(); f.c("review-submit").click();
  assert.equal(f.c("confirm").hidden, true); assert.match(f.c("source").textContent, /new-workspace/);
  assert.match(f.c("error").textContent, /请核对更新后的工作区/);
  assert.equal(f.calls.some(call => call.body), false);
  f.c("review-submit").click(); assert.equal(f.c("confirm").disabled, false);
});

test("expired Console authentication immediately clears an open sharing review", async t => {
  const f = fixture(t); await f.start(); f.review();
  f.replace(Object.assign(new Error("expired"), {status: 401})); await f.controller.refresh();
  assert.equal(f.c("dialog").open, false); assert.equal(f.c("source").textContent, ""); assert.equal(f.c("inventory").textContent, "");
});


test("Room-only sharing hides Room-link inputs even under the dialog label style", async t => {
  const f = fixture(t); const style = f.dom.window.document.createElement("style");
  style.textContent = readFileSync(new URL("./static/styles.css", import.meta.url), "utf8");
  f.dom.window.document.head.append(style); await f.start(); f.open();
  assert.equal(f.dom.window.getComputedStyle(f.c("rooms-label")).display, "none");
  f.c("close").click(); const button = f.action(`share:${membership.membershipId}`); button.focus();
  f.data.state.revision++; await f.controller.refresh();
  assert.equal(f.dom.window.document.activeElement, f.action(`share:${membership.membershipId}`));
});
