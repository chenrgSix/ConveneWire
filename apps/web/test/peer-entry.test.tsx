import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import React from "react";
import { JSDOM } from "jsdom";
import Database from "better-sqlite3";
import { nativePeerIngressFixture } from "../../server/test/helpers/native-peer-ingress-fixture.js";
import { App } from "../src/App.js";
import { peerEntryFromFragment } from "../src/features/auth/PeerEntryGate.js";
import { advanceWebSessionGeneration, jsonRequest, webSessionExpiredEvent } from "../src/api-client.js";

async function fixture(t: TestContext) {
  const host = await nativePeerIngressFixture(t), joined = await host.join();
  const descriptors = Object.getOwnPropertyDescriptors(globalThis), originalFetch = globalThis.fetch;
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: `${host.origin}/#peerEntry=${joined.browser.credentialId}.${joined.browser.token}` });
  const globals = ["document", "HTMLElement", "localStorage", "sessionStorage", "navigator", "window"] as const;
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true });
  advanceWebSessionGeneration();
  let cookie = "", dropClaim = false, changeScope = false;
  let delayedClaim: Promise<void> | null = null;
  const calls: { url: string; body?: unknown; status?: number; authorization: string | null }[] = [];
  const pending = new Set<Promise<Response>>(), pollCancels = new Set<() => void>();
  const dispatch: typeof fetch = async (input, init = {}) => {
    const url = String(input), headers = new Headers(init.headers);
    const call = { url, body: init.body ? JSON.parse(String(init.body)) : undefined, status: undefined as number | undefined, authorization: headers.get("authorization") };
    calls.push(call);
    if (url.includes("/changes?")) return new Promise<Response>((_resolve, reject) => {
      if (init.signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      const cancel = () => { pollCancels.delete(cancel); reject(new DOMException("Aborted", "AbortError")); };
      pollCancels.add(cancel); init.signal?.addEventListener("abort", cancel, { once: true });
    });
    const response = await host.request(url, { method: init.method ?? "GET", headers: { ...Object.fromEntries(headers.entries()), origin: host.origin, ...(cookie ? { cookie } : {}) }, ...(call.body ? { payload: call.body } : {}) });
    call.status = response.status;
    const setCookie = response.headers["set-cookie"]?.[0]; if (setCookie) cookie = setCookie.split(";")[0]!;
    if (url.endsWith("/browser-entry/claim")) {
      if (delayedClaim) await delayedClaim;
      if (dropClaim) throw new Error("lost after actual consume");
      if (changeScope) {
        const body = response.json(); body.user.peerAccess.roomId = host.otherRoom.roomId;
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
  };
  globalThis.fetch = (input, init) => {
    const request = dispatch(input, init); pending.add(request);
    void request.then(() => pending.delete(request), () => pending.delete(request)); return request;
  };
  const { render, cleanup, within, fireEvent, waitFor, act } = await import("@testing-library/react");
  async function unmount() {
    await act(async () => {
      cleanup();
      while (pending.size) { for (const cancel of pollCancels) cancel(); await Promise.allSettled([...pending]); }
    });
  }
  t.after(async () => {
    await unmount(); globalThis.fetch = originalFetch; dom.window.close();
    for (const key of [...globals, "IS_REACT_ACT_ENVIRONMENT"]) {
      const descriptor = descriptors[key]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  });
  return { ...host, ...joined, calls, cookie: () => cookie, loseClaim: () => { dropClaim = true; },
    changeScope: () => { changeScope = true; },
    delayClaim() { let release!: () => void; delayedClaim = new Promise(resolve => { release = resolve; }); return () => release(); },
    revoke() { const db = new Database(host.databasePath); try { db.prepare("UPDATE peer_human_bindings SET revoked_at = ? WHERE membership_id = ?").run(host.now, joined.joined.runtime.membership.membershipId); } finally { db.close(); } },
    mount() { return within(render(<React.StrictMode><App /></React.StrictMode>).container); }, unmount, fireEvent, waitFor, act };
}

test("Peer fragments reject mixed, repeated, missing and malformed proof parameters", () => {
  const proof = `peerhuman_browser001.${"A".repeat(43)}`;
  assert.equal(peerEntryFromFragment(`#peerEntry=${proof}`), proof);
  for (const hash of [`#peerEntry=${proof}&clientEntry=${"A".repeat(43)}`, `#peerEntry=${proof}&peerEntry=${proof}`, "#peerEntry=", "#peerEntry=wrong", `#peerEntry=peerhuman_a.${"A".repeat(43)}`]) assert.equal(peerEntryFromFragment(hash), "");
  assert.equal(peerEntryFromFragment("#ordinary"), null);
});

test("real native HTTPS Peer entry confirms once and loads only its Room workspace", async t => {
  const f = await fixture(t), screen = f.mount();
  await screen.findByText("Invited Guest");
  assert.equal(window.location.hash, "");
  assert.equal(f.calls.some(call => call.url.endsWith("/claim")), false);
  sessionStorage.setItem("convenewire.local-node-session", "old-owner-tab");
  const button = screen.getByRole("button", { name: "确认并进入" });
  f.fireEvent.click(button); f.fireEvent.click(button);
  await screen.findByRole("textbox", { name: "消息" });
  await f.waitFor(() => assert.ok(f.calls.some(call => call.url.endsWith("/settings") && call.status === 200)));
  assert.equal(f.calls.filter(call => call.url.endsWith("/browser-entry/claim")).length, 1);
  assert.equal(sessionStorage.getItem("convenewire.local-node-session"), null);
  assert.equal(new URLSearchParams(window.location.search).get("room"), f.room.roomId);
  assert.equal(screen.queryByRole("button", { name: /创建 Team|新建房间/u }), null);
  assert.equal(f.calls.some(call => /\/teams\/[^/]+\/(members|agents|devices|changes)(?:\?|$)/u.test(call.url)), false);
  assert.equal(f.calls.some(call => call.url.includes("/bootstrap") || call.url.includes("runtime-approvals") || call.authorization), false);
  assert.deepEqual(f.calls.filter(call => call.status && call.status >= 400), []);
  const session = await f.request("/api/auth/session", { headers: { cookie: f.cookie() } });
  assert.equal(session.json().user.peerAccess.roomId, f.room.roomId);
  await f.unmount();
  const reloaded = f.mount();
  await reloaded.findByRole("textbox", { name: "消息" });
  assert.equal(f.calls.filter(call => call.url.endsWith("/browser-entry/claim")).length, 1);
  await f.unmount();
  window.history.replaceState(null, "", `/?team=${f.team.teamId}&room=${f.room.roomId}&view=devices`);
  const scoped = f.mount();
  await scoped.findByText("请在本机 Console 分享 Agent，并等待 Host 接纳。");
  assert.equal(scoped.queryByRole("button", { name: /新增智能体|查看设备|设备配对/u }), null);
  f.revoke();
  await f.act(async () => { await assert.rejects(jsonRequest(`/api/rooms/${f.room.roomId}/registry`)); });
  await scoped.findByRole("heading", { name: "从本机重新进入远端空间" });
  assert.equal(scoped.queryByRole("textbox"), null);
  assert.equal(scoped.queryByRole("button", { name: /恢复|登录|进入本地/u }), null);
});

test("a lost consumed entry never automatically retries or falls back to another authority", async t => {
  const f = await fixture(t); f.loseClaim();
  const screen = f.mount(); await screen.findByText("Invited Guest");
  f.fireEvent.click(screen.getByRole("button", { name: "确认并进入" }));
  await screen.findByRole("alert");
  f.fireEvent.click(screen.getByRole("button", { name: "确认并进入" }));
  assert.equal(f.calls.filter(call => call.url.endsWith("/browser-entry/claim")).length, 1);
  assert.equal(f.calls.some(call => call.url === "/api/auth/status"), false);
  const consumed = await f.request("/api/peer/browser-entry/preview", { method: "POST", headers: { origin: f.origin }, payload: f.browser });
  assert.equal(consumed.status, 410);
});

test("revoked preview does not issue global session expiry and offers native recovery", async t => {
  const f = await fixture(t); f.revoke();
  let expired = 0; window.addEventListener(webSessionExpiredEvent, () => expired++);
  const screen = f.mount(); await screen.findByRole("alert");
  assert.equal(expired, 0); assert.equal(f.cookie(), "");
  assert.equal(f.calls.some(call => call.url.endsWith("/claim")), false);
  f.fireEvent.click(screen.getByRole("button", { name: "取消，保留原登录" }));
  await screen.findByRole("heading", { name: "从本机重新进入远端空间" });
  assert.equal(screen.queryByRole("textbox"), null);
});


test("a changed claim scope is not activated and cannot restore a cached Owner session", async t => {
  const f = await fixture(t); f.changeScope();
  sessionStorage.setItem("convenewire.local-node-session", "older-owner");
  const screen = f.mount(); await screen.findByText("Invited Guest");
  f.fireEvent.click(screen.getByRole("button", { name: "确认并进入" }));
  await screen.findByRole("alert");
  assert.equal(f.calls.some(call => call.url === "/api/teams" || call.url.includes("/bootstrap")), false);
  assert.equal(sessionStorage.getItem("convenewire.local-node-session"), "older-owner");
});

test("a consumed response arriving after unmount cannot reopen the old workspace", async t => {
  const f = await fixture(t), release = f.delayClaim();
  const screen = f.mount(); await screen.findByText("Invited Guest");
  f.fireEvent.click(screen.getByRole("button", { name: "确认并进入" }));
  await f.waitFor(() => assert.ok(f.calls.some(call => call.url.endsWith("/claim") && call.status === 200)));
  const closing = f.unmount(); release(); await closing;
  assert.equal(f.calls.some(call => call.url === "/api/teams" || call.url === "/api/auth/status"), false);
});
