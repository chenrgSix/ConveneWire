import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {JSDOM} from "jsdom";
import {createPeerSpacesController, parsePeerInvitation} from "./static/peer-spaces.mjs";

const html = readFileSync(new URL("./static/index.html", import.meta.url), "utf8");
const recorded = JSON.parse(readFileSync(new URL("../../../packages/contracts/test/fixtures/peer-join.json", import.meta.url), "utf8"));
const participant = recorded.state.participant;
const invitation = recorded.state.connections[0].receipt.invitation;
const membership = recorded.state.connections[0].receipt.membership;
const issued = {schemaVersion: 1, invitation, secret: "A".repeat(43)};
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, operation = async () => { throw new Error("unexpected mutation"); }) {
  const dom = new JSDOM(html, {url: "http://127.0.0.1:40001"});
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const root = dom.window.document.getElementById("peer-spaces-page");
  const e = name => root.querySelector(`[data-peer-${name}]`);
  const calls = [];
  let sequence = 0, clock = Date.parse(recorded.now);
  const replies = {spaces: {participant, localUserId: recorded.state.localUserId, connections: []}, joins: {pending: []},
    departures: {departures: []}, status: {state: "running", connections: []}};
  const controller = createPeerSpacesController({root, newOperationId: () => `op_uifixture${++sequence}`, now: () => clock,
    request: async (path, options) => {
      const body = options?.body ? JSON.parse(options.body) : undefined;
      calls.push({path, body});
      if (!options?.method) {
        const value = replies[path.split("/").at(-1)];
        if (value instanceof Error) throw value;
        return structuredClone(value);
      }
      return operation(path, body);
    }});
  const state = {localNodeId: participant.nodeId, paired: false, bridgeRunning: true};
  t.after(() => { controller.dispose(); dom.window.close(); });
  return {dom, root, e, calls, controller, replies, state, advance: value => { clock += value; },
    async start() { controller.render(state); controller.setActive(true); await flush(); },
    async preview() {
      e("invite").click(); e("invitation").value = JSON.stringify(issued); e("preview").click(); await flush();
    }};
}
function preview(body, edits = {}) {
  return {operationId: body.operationId, participant, localUserId: recorded.state.localUserId,
    invitation: structuredClone(invitation), invitationDigest: "b".repeat(64), ...edits};
}
function enterName(f, name = "Local Owner") {
  f.e("display-name").value = name;
  f.e("display-name").dispatchEvent(new f.dom.window.Event("input"));
}

test("native invitations are explicit, reviewed and retry the exact ambiguous join without storing secrets", async (t) => {
  let confirms = 0;
  const f = fixture(t, async (path, body) => {
    if (path.endsWith("/preview")) return preview(body);
    assert.equal(path, "/api/peers/invitations/confirm");
    if (++confirms === 1) throw new Error("lost join response");
    return {state: "active", membership};
  });
  f.controller.render(f.state); await flush();
  assert.deepEqual(f.calls, []);
  await f.start();
  assert.equal(f.calls.length, 4);
  await f.preview();
  f.e("join").focus();
  assert.equal(f.e("invitation").value, "");
  assert.equal(f.e("join").hidden, false);
  assert.equal(f.e("join").disabled, true);
  assert.match(f.e("invite-details").textContent, /Invited room/);
  assert.match(f.e("invite-details").textContent, /node_hostfixture001/);
  assert.equal(f.dom.window.localStorage.length, 0);
  assert.equal(f.dom.window.sessionStorage.length, 0);
  assert.equal(f.dom.window.location.search + f.dom.window.location.hash, "");
  enterName(f);
  f.e("join").focus();
  f.e("join").dispatchEvent(new f.dom.window.KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true}));
  assert.equal(f.dom.window.document.activeElement, f.e("invite-close"));
  f.e("invite-close").dispatchEvent(new f.dom.window.KeyboardEvent("keydown", {key: "Tab", shiftKey: true, bubbles: true, cancelable: true}));
  assert.equal(f.dom.window.document.activeElement, f.e("join"));
  f.e("join").click(); f.e("join").click(); await flush();
  assert.equal(confirms, 1);
  assert.match(f.e("invite-error").textContent, /lost join response/);
  await f.controller.refresh();
  assert.match(f.e("invite-error").textContent, /lost join response/);
  const original = f.calls.find(call => call.path.endsWith("/confirm")).body;
  assert.deepEqual(original, {...parsePeerInvitation(JSON.stringify(issued), original.operationId, Date.parse(recorded.now)),
    displayName: "Local Owner", reviewedInvitationDigest: "b".repeat(64)});
  assert.equal(f.e("display-name").disabled, true);
  f.e("display-name").value = "Changed after possible commit";
  f.advance(2 * 3600_000); f.controller.render(f.state);
  f.e("join").click(); await flush();
  assert.deepEqual(f.calls.filter(call => call.path.endsWith("/confirm")).map(call => call.body), [original, original]);
  assert.equal(f.e("invite-dialog").open, false);
  assert.equal(f.e("display-name").value, "");
  assert.match(f.e("result").textContent, /已加入远端空间/);
});

test("invalid or expired invitations never leave the Console and stale proof cannot enable confirmation", async (t) => {
  for (const invalid of ["not-json", JSON.stringify({...issued, invitation: {...invitation, hostOrigin: "http://host.example.test"}}),
    JSON.stringify({...issued, invitation: {...invitation, hostOrigin: "https://host.example.test/path"}}),
    JSON.stringify({...issued, invitation: {...invitation, expiresAt: recorded.now}})]) {
    assert.throws(() => parsePeerInvitation(invalid, "op_uifixture001", Date.parse(recorded.now)));
  }
  const f = fixture(t, async (_, body) => preview(body, {participant: {...participant, nodeId: "node_anotherlocal001"}}));
  await f.start(); await f.preview();
  assert.match(f.e("invite-error").textContent, /不匹配/);
  enterName(f); f.e("join").click(); await flush();
  assert.equal(f.calls.some(call => call.path.endsWith("/confirm")), false);
  f.e("invite-close").click();
  assert.equal(f.e("invite-details").textContent, "");
  assert.equal(f.e("invitation").value, "");
});

test("review expiration blocks a new join and Host labels render as text", async (t) => {
  const f = fixture(t, async (_, body) => preview(body, {invitation: {...invitation, teamLabel: '<img src=x onerror="unsafe()">'}}));
  await f.start(); await f.preview(); enterName(f);
  assert.equal(f.e("invite-details").querySelector("img"), null);
  assert.match(f.e("invite-details").textContent, /<img/);
  f.advance(3600_001); f.controller.render(f.state);
  assert.equal(f.e("join").disabled, true);
  f.e("join").click(); await flush();
  assert.equal(f.calls.some(call => call.path.endsWith("/confirm")), false);
});

test("a recovered confirmation cannot present a departed membership as joined", async (t) => {
  const f = fixture(t, async (path, body) => path.endsWith("/preview") ? preview(body) : {state: "left", membership});
  await f.start(); await f.preview(); enterName(f);
  f.e("join").click(); await flush();
  assert.match(f.e("result").textContent, /当前成员关系不可用/);
  assert.doesNotMatch(f.e("result").textContent, /已加入远端空间/);
});

test("navigation and local identity changes retire late invitation responses", async (t) => {
  let release;
  const f = fixture(t, async (_, body) => new Promise(resolve => { release = () => resolve(preview(body)); }));
  await f.start(); await f.preview();
  assert.ok(release);
  f.controller.setActive(false);
  const count = f.calls.length;
  release(); await flush();
  assert.equal(f.e("invite-dialog").open, false);
  assert.equal(f.e("invite-details").textContent, "");
  assert.equal(f.calls.length, count);
  f.controller.setActive(true); await flush(); await f.preview();
  f.controller.render({localNodeId: "node_different001"});
  release(); await flush();
  assert.equal(f.e("invite-dialog").open, false);
  assert.equal(f.e("invite-details").textContent, "");
  assert.equal(f.calls.some(call => call.path.endsWith("/confirm")), false);
});

test("local departure and Host confirmation remain distinct and retain the original retry target", async (t) => {
  let attempts = 0;
  const intent = {membershipId: membership.membershipId, peerId: membership.peerId, hostOrigin: invitation.hostOrigin};
  const f = fixture(t, async (path, body) => {
    if (path === "/api/peers/departures") {
      if (++attempts === 1) throw new Error("lost local departure response");
      f.replies.spaces.connections[0].state = "left";
      f.replies.departures.departures = [{intent, localState: "left", hostState: "pending"}];
      return {departure: f.replies.departures.departures[0], code: "PEER_DEPARTURE_PENDING"};
    }
    assert.equal(path, `/api/peers/departures/${membership.membershipId}/recover`);
    assert.deepEqual(body, {});
    f.replies.departures.departures[0].hostState = "confirmed";
    return {departure: f.replies.departures.departures[0]};
  });
  f.replies.spaces.connections = [{invitation, membership, state: "active"}];
  f.replies.status = new Error("Runtime unavailable");
  f.replies.joins = new Error("human vault unavailable");
  await f.start();
  assert.match(f.e("status").textContent, /读取失败/);
  f.e("spaces").querySelector("button").click();
  assert.equal(f.calls.some(call => call.body), false);
  f.e("leave-confirm").click(); await flush();
  const first = f.calls.find(call => call.path === "/api/peers/departures" && call.body).body;
  assert.equal(first.membershipId, membership.membershipId);
  assert.match(f.e("leave-error").textContent, /lost local departure response/);
  f.e("leave-confirm").click(); await flush();
  assert.deepEqual(f.calls.filter(call => call.path === "/api/peers/departures" && call.body).map(call => call.body), [first, first]);
  assert.match(f.e("result").textContent, /Host 尚未确认/);
  assert.equal(f.e("spaces").querySelector("button"), null);
  f.e("departures").querySelector("button").click(); await flush();
  assert.match(f.e("departures").textContent, /Host 已确认离开/);
});

test("pending join recovery uses its stored operation and polling never creates access", async (t) => {
  const f = fixture(t, async (path, body) => {
    assert.equal(path, "/api/peers/joins/op_retainedjoin001/recover");
    assert.deepEqual(body, {});
    f.replies.joins.pending = [];
    return {state: "active", membership};
  });
  f.replies.joins.pending = [{operationId: "op_retainedjoin001", invitation, displayName: "Recovered Owner", createdAt: recorded.now}];
  f.replies.spaces.connections = [{invitation, membership, state: "active"}];
  await f.start();
  const existing = f.e("spaces").querySelector("button");
  existing.focus(); await f.controller.refresh();
  assert.equal(f.dom.window.document.activeElement, existing);
  f.advance(31 * 86400_000); f.controller.render(f.state); await flush();
  assert.match(f.e("spaces").textContent, /成员关系不可用/);
  assert.equal(f.calls.some(call => call.body), false);
  f.e("joins").querySelector("button").click(); await flush();
  assert.match(f.e("result").textContent, /已恢复原加入结果/);
  assert.equal(f.calls.filter(call => call.body).length, 1);
  f.controller.render(null);
  assert.equal(f.e("spaces").textContent, "");
  assert.equal(f.e("invite").disabled, true);
});
