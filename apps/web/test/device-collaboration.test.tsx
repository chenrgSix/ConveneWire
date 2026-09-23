import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import {JSDOM} from "jsdom";
import {DeviceCollaboration} from "../src/features/local-node/DeviceCollaboration.js";
import {validatePeer} from "@convene-wire/contracts/peer-validation";

test("visible device controls enable LAN, issue a scoped code and open native sharing directly", async t => {
  const dom = new JSDOM("<body><main class='product-shell'></main></body>", {url: "http://127.0.0.1:48123"});
  const previous = Object.getOwnPropertyDescriptors(globalThis), originalFetch = globalThis.fetch;
  const globals = {window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true};
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
  const {render, fireEvent, within, waitFor, cleanup} = await import("@testing-library/react");
  t.after(async () => {cleanup(); await new Promise(resolve => setTimeout(resolve, 20)); globalThis.fetch = originalFetch; dom.window.close();
    for (const key of Object.keys(globals)) {if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else Reflect.deleteProperty(globalThis, key);}});
  let enabled = false, copied = "";
  Object.defineProperty(dom.window.navigator, "clipboard", {value: {writeText: async (text: string) => {copied = text;}}});
  const calls: {url: string; method: string; body: any}[] = [];
  const host = {nodeId: "node_lanhostfixture1", publicKey: "A".repeat(43)}, origin = "https://lan.convenewire.invalid";
  const team = {teamId: "team_lanfixture001", name: "协作测试", createdAt: new Date().toISOString()};
  const room = {teamId: team.teamId, roomId: "room_lanfixture001", name: "产品评审", createdAt: team.createdAt};
  globalThis.fetch = async (input, init) => {
    const url = String(input), method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({url, method, body});
    if (url === "/api/local-node/lan") {if (method === "POST") enabled = body.enabled; return Response.json({enabled, ready: enabled, endpoints: enabled ? [{address: "192.168.1.254", port: 48124}] : [], advancedInvitationReady: true});}
    if (url.endsWith("/access")) return Response.json({host, hostOrigin: origin, invitationSupported: enabled, invitations: [], memberships: []});
    if (url.endsWith("/agent-offers")) return Response.json({offers: []});
    if (url.endsWith("/lan/transport")) return Response.json({transport: {schemaVersion: 1, host, hostOrigin: origin, caCertificatePem: "X".repeat(100),
      endpoints: [{address: "192.168.1.254", port: 48124}], expiresAt: new Date(Date.now()+3600_000).toISOString()}, signature: "A".repeat(86)});
    if (url === "/api/peer/invitations") return Response.json({schemaVersion: 1, secret: "A".repeat(43), invitation: {schemaVersion: 1, invitationId: "peerinvite_lanfixture1",
      host, hostOrigin: origin, scope: body.scope, teamLabel: team.name, roomLabel: room.name, expiresAt: body.expiresAt, membershipExpiresAt: body.membershipExpiresAt}});
    if (url === "/api/local-node/open-console") return Response.json({requested: true});
    throw new Error("Unexpected test route "+url);
  };
  render(<DeviceCollaboration session={{userId: "user_lanfixture001", displayName: "Owner", token: "test-owner"}} team={team} rooms={[room]} locale="zh-CN" canManage />);
  const page = within(dom.window.document.body);
  fireEvent.click(page.getByRole("button", {name: /设备与协作/u}));
  const enable = await page.findByRole("button", {name: "开启局域网"});
  await waitFor(() => assert.equal((enable as HTMLButtonElement).disabled, false));
  assert.equal(calls.some(call => call.method === "POST"), false, "opening never expands access");
  assert.equal((page.getByRole("button", {name: "邀请其他电脑"}) as HTMLButtonElement).disabled, true);
  fireEvent.click(enable);
  await waitFor(() => assert.equal((page.getByRole("button", {name: "邀请其他电脑"}) as HTMLButtonElement).disabled, false));
  fireEvent.click(page.getByRole("button", {name: "邀请其他电脑"}));
  assert.equal((page.getByRole("combobox", {name: "访问范围"}) as HTMLSelectElement).value, room.roomId);
  fireEvent.click(page.getByRole("button", {name: "创建邀请", exact: true}));
  fireEvent.click(await page.findByRole("button", {name: "复制连接码"}));
  await waitFor(() => assert.ok(copied.startsWith("CWLAN1.")));
  const code = JSON.parse(Buffer.from(copied.slice(7), "base64url").toString());
  assert.ok(validatePeer("PeerLANConnectionCode", code));
  assert.equal(code.issued.invitation.scope.roomId, room.roomId);
  assert.equal(copied.includes("PRIVATE KEY"), false);
  assert.equal(page.queryByText(origin), null, "logical transport address is not a user setup step");
  fireEvent.click(page.getByRole("button", {name: "连接与分享"}));
  await waitFor(() => assert.ok(calls.some(call => call.url === "/api/local-node/open-console" && call.body.page === "peers")));
  assert.equal(calls.filter(call => call.url.endsWith("/bind")).length, 0);
  fireEvent.click(page.getByText("高级网络设置"));
  fireEvent.click(page.getByRole("button", {name: "使用高级网络地址邀请"}));
  assert.ok(await page.findByRole("heading", {name: "高级网络邀请"}));
  fireEvent.click(await page.findByRole("button", {name: "邀请其他电脑"}));
  fireEvent.click(page.getByRole("button", {name: "创建邀请", exact: true}));
  fireEvent.click(await page.findByRole("button", {name: "复制连接码"}));
  await waitFor(() => assert.ok(copied.startsWith("{")));
  assert.equal(JSON.parse(copied).invitation.hostOrigin, origin);
  assert.equal(calls.filter(call => call.url.endsWith("/lan/transport")).length, 1, "advanced invitation retains its existing transport");
});
