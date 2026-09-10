import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import test from "node:test";
import React from "react";
import { JSDOM } from "jsdom";
import { createTestResources } from "../../../scripts/test/resources.mjs";
import { createServerApp } from "../../server/src/app.js";
import { App } from "../src/App.js";
import { advanceWebSessionGeneration } from "../src/api-client.js";

test("native empty-Team and Room cards open the Owner Console without Bridge pairing or implicit binding", async t => {
  const resources = await createTestResources(t, "convenewire-native-onboarding-");
  const secret = () => randomBytes(32).toString("base64url");
  const localNode = { schemaVersion: 1 as const, controlToken: secret(), identity: {
    schemaVersion: 1 as const, nodeId: `node_${secret()}`, ownerUserId: `user_${secret()}`, port: 48123, secret: secret()
  } };
  const app = await createServerApp({ databasePath: path.join(resources.directory, "hub.sqlite"), localNode });
  resources.defer(() => app.close());
  const origin = "http://127.0.0.1:48123", host = new URL(origin).host;
  const control = { host, "x-convenewire-node-control": localNode.controlToken };
  const entry = async () => {
    const response = await app.inject({ method: "POST", url: "/api/local-node/control/entry", headers: control });
    assert.equal(response.statusCode, 200);
    return response.json().url as string;
  };
  const claim = await app.inject({ method: "POST", url: "/api/local-node/session", headers: { host, origin },
    payload: { ticket: (await entry()).split("/").at(-1) } });
  assert.equal(claim.statusCode, 200);
  const owner = { host, origin, authorization: `Bearer ${claim.json().session.token}` };
  const teamResponse = await app.inject({ method: "POST", url: "/api/teams", headers: owner, payload: { name: "Native onboarding" } });
  assert.equal(teamResponse.statusCode, 200);
  const teamId = teamResponse.json().team.teamId as string;
  const roomResponse = await app.inject({ method: "POST", url: `/api/teams/${teamId}/rooms`, headers: owner, payload: { name: "Native Room" } });
  assert.equal(roomResponse.statusCode, 200);

  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: await entry() });
  const descriptors = Object.getOwnPropertyDescriptors(globalThis), originalFetch = globalThis.fetch;
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    navigator: dom.window.navigator, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  advanceWebSessionGeneration();
  const calls: { method: string; url: string; status?: number }[] = [], pending = new Set<Promise<Response>>();
  const dispatch: typeof fetch = async (input, init = {}) => {
    const url = String(input), method = init.method ?? "GET", call = { method, url, status: undefined as number | undefined };
    calls.push(call);
    if (url.includes("/changes?")) return new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (init.signal?.aborted) abort(); else init.signal?.addEventListener("abort", abort, { once: true });
    });
    const response = await app.inject({ method: method as "GET" | "POST", url,
      headers: { host, origin, ...Object.fromEntries(new Headers(init.headers).entries()) },
      ...(init.body ? { payload: String(init.body) } : {}) });
    call.status = response.statusCode;
    return new Response(response.body, { status: response.statusCode, headers: { "content-type": "application/json" } });
  };
  globalThis.fetch = (input, init) => {
    const request = dispatch(input, init); pending.add(request);
    void request.then(() => pending.delete(request), () => pending.delete(request)); return request;
  };
  const { render, within, fireEvent, waitFor, cleanup, act } = await import("@testing-library/react");
  resources.defer(async () => {
    await act(async () => { cleanup(); while (pending.size) await Promise.allSettled([...pending]); });
    await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); });
    globalThis.fetch = originalFetch; dom.window.close();
    for (const key of Object.keys(globals)) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]); else Reflect.deleteProperty(globalThis, key);
    }
  });
  const screen = within(render(<App />).container);
  await screen.findByRole("heading", { name: "团队工作台" });
  for (let index = 0; index < 2; index++) {
    if (index) fireEvent.click(screen.getByRole("button", { name: "对话", exact: true }));
    const card = within(await screen.findByRole("region", { name: "选择开始方式" }));
    assert.equal(Boolean(card.queryByText(/需要在执行工作的电脑安装客户端/u)), false);
    const beforeUrl = window.location.href;
    fireEvent.click(card.getByRole("button", { name: "配置本机 Agent" }));
    await waitFor(() => assert.equal(calls.filter(call => call.url === "/api/local-node/open-console" && call.status === 200).length, index + 1));
    const state = (await app.inject({ url: "/api/local-node/control/state", headers: control })).json();
    assert.equal(state.binding, null);
    assert.match(state.consoleRequestId, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(window.location.href, beforeUrl);
    assert.equal(Boolean(screen.queryByText("在 Codex 所在机器上启动 Bridge")), false);
  }
  assert.deepEqual(calls.filter(call => call.method !== "GET").map(call => call.url), [
    "/api/local-node/session", "/api/local-node/open-console", "/api/local-node/open-console"
  ]);
  assert.equal(calls.some(call => call.status && call.status >= 400), false);
});
