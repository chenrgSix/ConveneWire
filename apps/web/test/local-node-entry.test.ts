import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createTestResources } from "../../../scripts/test/resources.mjs";
import { createServerApp } from "../../server/src/app.js";
import { localBootstrap } from "../src/api-client.js";

test("desktop entry ignores browser User identity, scrubs the ticket and keeps only a tab session", async (t) => {
  const resources = await createTestResources(t, "convenewire-local-node-web-");
  const secret = () => randomBytes(32).toString("base64url");
  const launch = { schemaVersion: 1, controlToken: secret(), identity: { schemaVersion: 1, nodeId: `node_${secret()}`, ownerUserId: `user_${secret()}`, port: 48123, secret: secret() } };
  const app = await createServerApp({ databasePath: path.join(resources.directory, "hub.sqlite"), localNode: launch });
  resources.defer(() => app.close());
  const dom = new JSDOM("", { url: "http://127.0.0.1:48123" });
  resources.defer(() => dom.window.close());
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const fetchBefore = globalThis.fetch;
  resources.defer(() => {
    globalThis.fetch = fetchBefore;
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  });
  const paths: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); paths.push(url);
    const response = await app.inject({ method: (init?.method ?? "GET") as "POST" | "GET", url,
      headers: { host: "127.0.0.1:48123", origin: "http://127.0.0.1:48123", ...Object.fromEntries(new Headers(init?.headers).entries()) },
      ...(init?.body ? { payload: String(init.body) } : {}) });
    return new Response(response.body, { status: response.statusCode, headers: { "content-type": "application/json" } });
  };
  const freshEntry = async () => {
    const response = await app.inject({ method: "POST", url: "/api/local-node/control/entry", headers: {
      host: "127.0.0.1:48123", "x-convenewire-node-control": launch.controlToken
    } });
    dom.reconfigure({ url: response.json().url });
  };
  localStorage.setItem("agent-room.local-user", JSON.stringify({ userId: "user_another_123", displayName: "Impostor" }));
  await freshEntry();
  const first = await localBootstrap(true);
  assert.equal(first.userId, launch.identity.ownerUserId);
  assert.equal(dom.window.location.hash, "");
  assert.ok(first.token);
  assert.ok(!JSON.stringify(localStorage).includes(first.token));
  assert.equal((await localBootstrap(true)).token, first.token);
  localStorage.clear(); sessionStorage.clear();
  await assert.rejects(localBootstrap(true), /desktop app/u);
  await freshEntry();
  assert.equal((await localBootstrap(true)).userId, first.userId);
  sessionStorage.setItem("convenewire.local-node-session", "invalid");
  await assert.rejects(localBootstrap(true), /desktop app/u);
  assert.equal(sessionStorage.getItem("convenewire.local-node-session"), null);
  assert.ok(!paths.includes("/api/bootstrap"));
});
