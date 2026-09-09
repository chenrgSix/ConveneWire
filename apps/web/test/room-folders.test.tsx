import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { advanceWebSessionGeneration } from "../src/api-client.js";
import { WorkspaceSidebar } from "../src/features/navigation/WorkspaceSidebar.js";
import type { AgentTask, LocalSession, Room } from "../src/models.js";

const session: LocalSession = { userId: "user_folders", displayName: "Folder owner", token: "test-only-folders" };
const room = { teamId: "team_folders", roomId: "room_folders", name: "Project notes" } as Room;
const task = (id: string, roomId = room.roomId): AgentTask => ({ taskId: id, roomId, title: `Task ${id}`, goal: "", parentTaskId: null, state: "open", primaryAgentId: null, isDefault: false, updatedAt: "2026-09-09T00:00:00Z" });
const response = (items: AgentTask[], status = 200) => new Response(JSON.stringify(items), { status });
async function fixture(t: TestContext) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  const original = Object.getOwnPropertyDescriptors(globalThis);
  for (const key of ["document", "HTMLElement", "window", "navigator"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
  advanceWebSessionGeneration();
  const testing = await import("@testing-library/react");
  t.after(() => {
    testing.cleanup(); dom.window.close();
    for (const key of ["document", "HTMLElement", "window", "navigator", "IS_REACT_ACT_ENVIRONMENT", "fetch"]) {
      if (original[key]) Object.defineProperty(globalThis, key, original[key]); else Reflect.deleteProperty(globalThis, key);
    }
  });
  const opened: string[][] = [];
  const props = { activeView: "room" as const, locale: "en" as const, teams: [], teamId: room.teamId, rooms: [room], roomId: room.roomId,
    session, tasks: [task("first")], taskId: "first", onTask: (roomId: string, taskId: string) => opened.push([roomId, taskId]),
    onTeam: () => undefined, onNewTeam: () => undefined, onNewRoom: () => undefined, onRoom: (id: string) => opened.push([id]), onView: () => undefined, onCollaboration: () => undefined };
  return { ...testing, props, opened };
}

test("Room folders collapse without navigation and reflect current tasks, preserving an out-of-window selection", async (t) => {
  const f = await fixture(t);
  globalThis.fetch = async () => { assert.fail("the current Room must reuse its live snapshot"); };
  const tasks = Array.from({ length: 8 }, (_, index) => task(String(index)));
  const view = f.render(<WorkspaceSidebar {...f.props} tasks={tasks} taskId="7" />);
  assert.equal(view.getByRole("button", { name: "Task 7", exact: true }).getAttribute("aria-current"), "page");
  assert.equal(view.queryByRole("button", { name: "Task 6", exact: true }), null);
  f.fireEvent.click(view.getByRole("button", { name: "Show 3 more" }));
  assert.ok(view.getByRole("button", { name: "Task 6", exact: true }));
  f.fireEvent.click(view.getByRole("button", { name: room.name, exact: true }));
  assert.equal(view.queryByRole("group"), null);
  assert.deepEqual(f.opened, []);
  view.rerender(<WorkspaceSidebar {...f.props} tasks={[...tasks, task("new")]} taskId="new" />);
  assert.equal(view.getByRole("button", { name: room.name, exact: true }).getAttribute("aria-expanded"), "true");
  f.fireEvent.click(view.getByRole("button", { name: "Task new", exact: true }));
  assert.deepEqual(f.opened, [[room.roomId, "new"]]);
  assert.equal(view.getByRole("option").textContent, room.name);
});

test("inactive folders load on expansion, retry failures and filter tasks from another Room", async (t) => {
  const f = await fixture(t);
  let reads = 0;
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${session.token}`);
    reads += 1;
    return reads === 1 ? response([], 503) : response([task("visible"), task("wrong-room", "room_elsewhere")]);
  };
  const view = f.render(<WorkspaceSidebar {...f.props} roomId={null} taskId={null} tasks={[]} />);
  assert.equal(reads, 0);
  f.fireEvent.click(view.getByRole("button", { name: room.name, exact: true }));
  f.fireEvent.click(await view.findByRole("button", { name: "Could not load tasks. Retry" }));
  f.fireEvent.click(await view.findByRole("button", { name: "Task visible", exact: true }));
  assert.equal(view.queryByText("Task wrong-room"), null);
  assert.deepEqual(f.opened, [[room.roomId, "visible"]]);
  assert.equal(reads, 2);
});

for (const change of ["collapse", "team", "session"] as const) {
  test(`a late folder read is discarded after ${change}`, async (t) => {
    const f = await fixture(t);
    let deliver!: (value: Response) => void;
    let signal: AbortSignal | null | undefined;
    globalThis.fetch = async (_input, init) => { signal = init?.signal; return new Promise((resolve) => { deliver = resolve; }); };
    const view = f.render(<WorkspaceSidebar {...f.props} roomId={null} taskId={null} tasks={[]} />);
    f.fireEvent.click(view.getByRole("button", { name: room.name, exact: true }));
    await f.waitFor(() => assert.ok(deliver));
    if (change === "collapse") f.fireEvent.click(view.getByRole("button", { name: room.name, exact: true }));
    else if (change === "team") view.rerender(<WorkspaceSidebar {...f.props} teamId="team_other" roomId={null} taskId={null} tasks={[]} />);
    else {
      advanceWebSessionGeneration();
      view.rerender(<WorkspaceSidebar {...f.props} session={{ ...session, token: "new-session" }} roomId={null} taskId={null} tasks={[]} />);
    }
    assert.equal(signal?.aborted, true);
    await f.act(async () => { deliver(response([task("private-old")])); });
    assert.equal(view.queryByText("Task private-old"), null);
    assert.deepEqual(f.opened, []);
  });
}
