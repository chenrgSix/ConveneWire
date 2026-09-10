import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { JSDOM } from "jsdom";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { PeerHostPanel } from "../src/features/team/PeerHostPanel.js";
import type { PeerHostAccess, PeerHostOffer } from "../src/features/team/peer-host-model.js";
import { advanceWebSessionGeneration } from "../src/api-client.js";

test("Host collaboration requires explicit review and retains exact operation and session scope", async t => {
  const dom = new JSDOM("<!doctype html><html><body><main class='product-shell'></main></body></html>", { url: "https://host.example.test" });
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { render, fireEvent, within, waitFor, act, cleanup } = await import("@testing-library/react");
  const page = within(dom.window.document.body);
  const teamId = "team_hostfixture001", roomId = "room_hostfixture001", secondRoom = "room_hostfixture002";
  const now = new Date().toISOString(), expiry = new Date(Date.now() + 86400_000).toISOString();
  const host = { nodeId: "node_hostfixture001", publicKey: "A".repeat(43) };
  const rooms = [{ teamId, roomId, name: "设计评审", createdAt: now }, { teamId, roomId: secondRoom, name: "实现", createdAt: now }];
  const props = { teamId, teamName: "Host Team", rooms, locale: "zh-CN" as const, sessionToken: "owner-web-only" };
  const initialAccess: PeerHostAccess = { host, hostOrigin: "https://host.example.test", invitationSupported: true, invitations: [], memberships: [{
    membershipId: "peermembership_00001", peerId: "peer_hostfixture001", memberId: "member_remotefixture01", participantNodeId: "node_remote0000001",
    scope: { kind: "team", teamId, roomId: null }, createdAt: now, expiresAt: expiry, state: "active", displayName: "小王", roomLabel: null
  }] };
  const initialOffer: PeerHostOffer = { offerDigest: "a".repeat(64), grantDigest: "b".repeat(64), acceptance: null, offer: {
    schemaVersion: 1, displayName: "代码审阅", role: "Reviewer", grant: { schemaVersion: 1, exportId: "export_hostfixture01", revision: 1, state: "active",
      issuedAt: now, expiresAt: expiry, peerId: initialAccess.memberships[0]!.peerId, teamId, participantNodeId: "node_remote0000001",
      authorityNodeId: host.nodeId, localAgentId: "agent_remotefixture1", roomIds: [roomId, secondRoom], capabilities: {
        supportsStart: true, supportsInterrupt: true, supportsStreaming: true, supportsResume: false, supportsTaskContextIsolation: true, supportsOwnerPrivateOutput: false
      } }
  } };
  let access: PeerHostAccess, offers: PeerHostOffer[], calls: Array<{ path: string; method: string; body: any }>;
  let write: (path: string, body: any) => Promise<Response>, read: ((path: string) => Promise<Response>) | undefined;
  let poll: () => void, copied: string[];
  const acceptance = () => {
    const g = offers[0]!.offer.grant;
    offers[0]!.acceptance = { ...g, memberId: initialAccess.memberships[0]!.memberId, acceptanceId: "acceptance_fixture01",
      revision: 1, grantRevision: g.revision, grantDigest: offers[0]!.grantDigest };
  };
  t.beforeEach(() => {
    access = structuredClone(initialAccess); offers = [structuredClone(initialOffer)]; calls = []; copied = []; read = undefined;
    write = async () => Response.json({ status: "recorded" });
    globalThis.setInterval = ((callback: () => void, delay: number) => {
      if (delay === 5000) { poll = callback; return 12345; }
      return previous.setInterval!.value(callback, delay);
    }) as typeof setInterval;
    Object.defineProperty(dom.window.navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
    globalThis.fetch = async (input, init) => {
      const path = String(input), method = init?.method ?? "GET";
      assert.match(path, /^\/api\/peer\//u, "browser never forwards Owner credentials to a remote Host");
      assert.equal(init?.credentials, "same-origin");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer owner-web-only");
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, method, body });
      if (method !== "GET") return write(path, body);
      if (read) return read(path);
      return Response.json(path.endsWith("/access") ? access : { offers });
    };
  });
  t.afterEach(async () => { await act(async () => cleanup()); });
  t.after(async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    dom.window.close();
    for (const key of [...Object.keys(globals), "fetch", "setInterval"]) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else Reflect.deleteProperty(globalThis, key);
    }
  });
  const open = async () => {
    const view = render(<PeerHostPanel {...props} />);
    assert.equal(calls.length, 0, "the closed management panel makes no requests");
    fireEvent.click(page.getByRole("button", { name: "跨节点协作" }));
    await page.findByText("小王");
    return view;
  };
  const refresh = async () => { await act(async () => { poll(); }); };

  await t.test("invitation defaults to one Room, recovers an ambiguous response with identical bytes, and clears the secret on close", async () => {
    let attempts = 0;
    write = async (path, body) => {
      assert.equal(path, "/api/peer/invitations");
      assert.ok(validatePeer("PeerInvitationCreateRequest", body));
      if (++attempts === 1) throw new Error("response lost after commit");
      return Response.json({ schemaVersion: 1, secret: "s".repeat(43), invitation: { schemaVersion: 1, invitationId: "peerinvite_fixture01",
        host, hostOrigin: access.hostOrigin, scope: body.scope, teamLabel: props.teamName, roomLabel: rooms[0]!.name,
        expiresAt: body.expiresAt, membershipExpiresAt: body.membershipExpiresAt } });
    };
    await open();
    assert.ok(calls.every(call => call.method === "GET"));
    fireEvent.click(page.getByRole("button", { name: "创建节点邀请" }));
    assert.equal((page.getByRole("combobox", { name: "访问范围" }) as HTMLSelectElement).value, roomId);
    fireEvent.click(page.getByRole("button", { name: "创建邀请", exact: true }));
    await page.findByRole("alert");
    await refresh();
    assert.match(page.getByRole("alert").textContent!, /暂时无法确认/u, "polling must not hide an ambiguous mutation");
    assert.equal((page.getByRole("combobox", { name: "成员访问期限" }) as HTMLSelectElement).disabled, true);
    fireEvent.click(page.getByRole("button", { name: "重试同一邀请" }));
    const invitation = await page.findByRole("textbox", { name: "一次性邀请" }) as HTMLTextAreaElement;
    const writes = calls.filter(call => call.method === "POST");
    assert.deepEqual(writes[0], writes[1]);
    assert.deepEqual(writes[0]!.body.scope, { kind: "room", teamId, roomId });
    assert.equal(Date.parse(writes[0]!.body.membershipExpiresAt) - Date.parse(writes[0]!.body.expiresAt), 7 * 86400_000 - 3600_000);
    assert.equal(copied.length, 0, "creating does not send or copy the invitation");
    fireEvent.click(page.getByRole("button", { name: "复制邀请" }));
    await page.findByRole("button", { name: "已复制" });
    assert.deepEqual(copied, [invitation.value]);
    assert.equal(dom.window.localStorage.length + dom.window.sessionStorage.length, 0);
    fireEvent.keyDown(document, { key: "Escape" });
    assert.equal(page.queryByRole("dialog"), null);
    fireEvent.click(page.getByRole("button", { name: "跨节点协作" }));
    await page.findByText("小王");
    assert.equal(page.queryByRole("textbox", { name: "一次性邀请" }), null);
  });

  await t.test("Agent acceptance reviews a Room subset and exact offer/CAS, including lost response after another read sees acceptance", async () => {
    let attempts = 0;
    write = async (path, body) => {
      assert.equal(path, "/api/peer/agents/accept");
      assert.ok(validatePeer("PeerAgentAcceptanceRequest", body));
      acceptance();
      if (++attempts === 1) throw new Error("acceptance committed but response lost");
      return Response.json({ acceptance: offers[0]!.acceptance });
    };
    await open();
    fireEvent.click(page.getByRole("button", { name: "审阅并接纳" }));
    assert.equal(calls.filter(call => call.method === "POST").length, 0);
    fireEvent.click(page.getByRole("checkbox", { name: "实现" }));
    fireEvent.click(page.getByRole("button", { name: "接纳此 Agent" }));
    await page.findByRole("alert");
    await refresh();
    const retry = page.getByRole("button", { name: "重试同一操作" }) as HTMLButtonElement;
    assert.equal(retry.disabled, false, "an already committed acceptance still permits the original idempotent retry");
    fireEvent.click(retry);
    await page.findByText("操作已记录。");
    const writes = calls.filter(call => call.method === "POST");
    assert.deepEqual(writes[0], writes[1]);
    assert.equal(writes[0]!.body.offerDigest, initialOffer.offerDigest);
    assert.equal(writes[0]!.body.grantDigest, initialOffer.grantDigest);
    assert.deepEqual(writes[0]!.body.roomIds, [roomId]);
    assert.equal(writes[0]!.body.expectedAcceptanceId, null);
    assert.equal(writes[0]!.body.expectedAcceptanceRevision, null);
    assert.equal((page.getByRole("button", { name: "审阅并接纳" }) as HTMLButtonElement).disabled, true);
    fireEvent.click(page.getByRole("button", { name: "撤销接纳" }));
    write = async (path, body) => {
      assert.equal(path, "/api/peer/agents/revoke");
      assert.equal(body.acceptanceId, offers[0]!.acceptance!.acceptanceId);
      assert.equal(body.expectedRevision, 1);
      offers[0]!.acceptance!.state = "revoked";
      return Response.json({ status: "revoked" });
    };
    fireEvent.click(page.getByRole("button", { name: "确认撤销" }));
    await page.findByText("操作已记录。");
    await waitFor(() => assert.equal(page.queryByRole("button", { name: "撤销接纳" }), null));
  });

  await t.test("changed offers, concurrent acceptance and revoked membership invalidate the displayed review", async () => {
    await open();
    fireEvent.click(page.getByRole("button", { name: "审阅并接纳" }));
    offers[0]!.offerDigest = "c".repeat(64);
    await refresh();
    assert.equal((page.getByRole("button", { name: "接纳此 Agent" }) as HTMLButtonElement).disabled, true);
    fireEvent.click(page.getByRole("button", { name: "返回协作管理" }));
    await page.findByRole("button", { name: "审阅并接纳" });
    fireEvent.click(page.getByRole("button", { name: "审阅并接纳" }));
    acceptance(); await refresh();
    assert.equal((page.getByRole("button", { name: "接纳此 Agent" }) as HTMLButtonElement).disabled, true);
    access.memberships[0]!.state = "revoked";
    fireEvent.click(page.getByRole("button", { name: "返回协作管理" }));
    await page.findByText(/Reviewer · 分享不可用/u);
    assert.equal((page.getByRole("button", { name: "审阅并接纳" }) as HTMLButtonElement).disabled, true);
    assert.equal(calls.filter(call => call.method !== "GET").length, 0);
  });

  await t.test("membership and invitation revocation target only the explicitly reviewed record", async () => {
    access.invitations = [{ state: "open", invitation: { schemaVersion: 1, invitationId: "peerinvite_fixture01", host,
      hostOrigin: access.hostOrigin, scope: { kind: "room", teamId, roomId }, teamLabel: props.teamName, roomLabel: rooms[0]!.name,
      expiresAt: expiry, membershipExpiresAt: expiry } }];
    await open();
    fireEvent.click(page.getByRole("button", { name: "撤销成员访问" }));
    assert.equal(calls.filter(call => call.method === "DELETE").length, 0);
    fireEvent.click(page.getByRole("button", { name: "确认撤销" }));
    await page.findByText("操作已记录。");
    fireEvent.click(page.getByRole("button", { name: "撤销邀请" }));
    fireEvent.click(page.getByRole("button", { name: "确认撤销" }));
    await page.findByText("操作已记录。");
    assert.deepEqual(calls.filter(call => call.method === "DELETE").map(call => call.path), [
      "/api/peer/memberships/peermembership_00001", "/api/peer/invitations/peerinvite_fixture01"
    ]);
  });

  await t.test("non-HTTPS Host and unavailable data cannot create invitations or accept Agents", async () => {
    access.invitationSupported = false; access.hostOrigin = "http://127.0.0.1:3000";
    await open();
    assert.equal((page.getByRole("button", { name: "创建节点邀请" }) as HTMLButtonElement).disabled, true);
    read = async () => Response.json({ error: { message: "forbidden" } }, { status: 403 });
    await refresh();
    await page.findByRole("alert");
    assert.equal(page.queryByText("小王"), null);
    assert.equal(page.queryByRole("button", { name: "审阅并接纳" }), null);
  });

  await t.test("late invitation response cannot appear in a different Team or after logout", async () => {
    for (const change of ["team", "logout"] as const) {
      await act(async () => cleanup());
      calls = []; read = undefined;
      let resolve!: (response: Response) => void;
      write = () => new Promise<Response>(done => { resolve = done; });
      const view = await open();
      fireEvent.click(page.getByRole("button", { name: "创建节点邀请" }));
      fireEvent.click(page.getByRole("button", { name: "创建邀请", exact: true }));
      await waitFor(() => assert.ok(resolve));
      if (change === "team") view.rerender(<PeerHostPanel {...props} teamId="team_otherfixture01" teamName="Another Team" rooms={[]} />);
      else advanceWebSessionGeneration();
      await act(async () => resolve(Response.json({ schemaVersion: 1, secret: "must-not-display", invitation: { expiresAt: expiry } })));
      assert.equal(page.queryByRole("textbox", { name: "一次性邀请" }), null);
      assert.equal(dom.window.document.body.textContent?.includes("must-not-display"), false);
      if (change === "logout") { const before = calls.length; await refresh(); assert.equal(calls.length, before, "retired sessions stop polling"); }
    }
  });
});
