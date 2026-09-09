import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { JSDOM } from "jsdom";
import { LocalNodeRuntime } from "../src/features/local-node/LocalNodeRuntime.js";
import type { Team } from "../src/models.js";

test("local Runtime connection is explicit and keeps its original Team after navigation", async (t) => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:48123" });
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  const originalFetch = globalThis.fetch;
  for (const key of ["window", "document", "HTMLElement", "navigator"]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key as keyof typeof dom.window] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true });
  const { render, within, fireEvent, waitFor, cleanup } = await import("@testing-library/react");
  t.after(async () => {
    cleanup();
    // React may have a queued scheduler callback after the final async render.
    await new Promise((resolve) => setTimeout(resolve, 20));
    globalThis.fetch = originalFetch; dom.window.close();
    for (const key of ["window", "document", "HTMLElement", "navigator", "IS_REACT_ACT_ENVIRONMENT"]) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else Reflect.deleteProperty(globalThis, key);
    }
  });
  const first: Team = { teamId: "team_first_12345", name: "First Team", createdAt: "2026-09-09T00:00:00Z" };
  const second: Team = { ...first, teamId: "team_second_12345", name: "Second Team" };
  let bound: string | null = null;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/bind")) { assert.equal(url, `/api/local-node/teams/${first.teamId}/bind`); bound = first.teamId; }
    return Response.json(url.endsWith("/open-console") ? { requested: true } : { nodeId: "node_fixture_12345", teamId: bound, deviceId: bound ? "device_fixture_12345" : null });
  };
  const props = { session: { userId: "user_fixture_12345", displayName: "Local Owner", token: "fixture" }, teams: [first, second], locale: "zh-CN" as const };
  const view = render(<LocalNodeRuntime {...props} team={first} />);
  const screen = within(view.container);
  await waitFor(() => assert.equal((screen.getByRole("button", { name: "连接本机 Runtime" }) as HTMLButtonElement).disabled, false));
  assert.ok(calls.every((call) => call.startsWith("GET")), "mount must not bind a Team");
  fireEvent.click(screen.getByRole("button", { name: "连接本机 Runtime" }));
  await screen.findByRole("button", { name: "配置本机 Agent" });
  await waitFor(() => assert.equal(calls.filter((call) => call.endsWith("/open-console")).length, 1));
  view.rerender(<LocalNodeRuntime {...props} team={second} />);
  assert.ok(screen.getByText("本机 Runtime 已绑定 First Team"));
  fireEvent.click(screen.getByRole("button", { name: "配置本机 Agent" }));
  await waitFor(() => assert.equal(calls.filter((call) => call.endsWith("/open-console")).length, 2));
  assert.equal(calls.filter((call) => call.endsWith("/bind")).length, 1);
});
