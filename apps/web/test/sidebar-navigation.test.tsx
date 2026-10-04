import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import React from "react";
import { JSDOM } from "jsdom";
import { useSidebarNavigation } from "../src/features/navigation/useSidebarNavigation.js";
import { WorkspaceSidebar } from "../src/features/navigation/WorkspaceSidebar.js";
import type { AgentTask, Room } from "../src/models.js";

async function fixture(t: TestContext, narrow = true) {
  const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost' });
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  for (const key of ["window", "document", "navigator", "HTMLElement", "localStorage"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
  let matches = narrow;
  const listeners = new Set<() => void>();
  Object.defineProperty(dom.window, "matchMedia", { value: () => ({
    get matches() { return matches; }, addEventListener: (_: string, callback: () => void) => listeners.add(callback),
    removeEventListener: (_: string, callback: () => void) => listeners.delete(callback)
  }) });
  const testing = await import("@testing-library/react");
  t.after(() => {
    testing.cleanup(); dom.window.close();
    for (const key of ["window", "document", "navigator", "HTMLElement", "localStorage", "IS_REACT_ACT_ENVIRONMENT"]) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else Reflect.deleteProperty(globalThis, key);
    }
  });
  return { ...testing, resize(value: boolean) { matches = value; listeners.forEach((listener) => listener()); } };
}

test("mobile navigation starts closed and never overwrites the desktop preference across breakpoints", async (t) => {
  const f = await fixture(t);
  localStorage.setItem("agent-room.sidebar-collapsed", "false");
  const { result } = f.renderHook(useSidebarNavigation);
  assert.equal(result.current.collapsed, true);
  f.act(() => result.current.toggle());
  assert.equal(result.current.collapsed, false);
  assert.equal(localStorage.getItem("agent-room.sidebar-collapsed"), "false");
  f.act(() => f.resize(false));
  assert.equal(result.current.collapsed, false);
  f.act(() => result.current.toggle());
  assert.equal(localStorage.getItem("agent-room.sidebar-collapsed"), "true");
  f.act(() => f.resize(true));
  assert.equal(result.current.collapsed, true);
  f.act(() => result.current.toggle());
  f.act(() => result.current.closeMobile());
  assert.equal(result.current.collapsed, true);
  f.act(() => f.resize(false));
  assert.equal(result.current.collapsed, true);
});

test("mobile drawer contains keyboard focus, keeps disclosure open, and closes on selection or Escape", async (t) => {
  const f = await fixture(t);
  const room = { teamId: "team_nav", roomId: "room_nav", name: "Design" } as Room;
  const task = { taskId: "task_nav", roomId: room.roomId, title: "Review UI", goal: "", state: "open", isDefault: false } as AgentTask;
  const destinations: string[] = [];
  function Harness() {
    const navigation = useSidebarNavigation();
    return <div className="product-shell">
      <button onClick={navigation.toggle}>Open navigation</button>
      <WorkspaceSidebar mobile={navigation.narrow} collapsed={navigation.collapsed} onCloseMobile={navigation.closeMobile}
        activeView="room" locale="en" teams={[]} teamId={room.teamId} rooms={[room]} roomId={room.roomId}
        session={null} tasks={[task]} taskId={task.taskId} onTask={(_room, taskId) => destinations.push(taskId)}
        onRoom={(id) => destinations.push(id)} onView={(view) => destinations.push(view)} onTeam={() => undefined}
        onNewRoom={() => undefined} onNewTeam={() => undefined}>
        <details className="product-participants"><summary>Room participants</summary><button>Manage participants</button></details>
      </WorkspaceSidebar>
    </div>;
  }
  const view = f.render(<Harness />);
  const open = view.getByRole("button", { name: "Open navigation" });
  assert.equal(view.queryByRole("dialog"), null);
  open.focus(); f.fireEvent.click(open);
  const dialog = view.getByRole("dialog", { name: "Workspace navigation" });
  assert.equal(view.queryByText("Room participants"), null);
  assert.equal(view.queryByRole("combobox", { name: "Select Room" }), null);
  assert.ok(document.querySelector(".product-shell")?.hasAttribute("inert"));
  f.fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
  const last = view.getByRole("button", { name: "Review UI" });
  assert.equal(document.activeElement, last);
  f.fireEvent.keyDown(last, { key: "Tab" });
  assert.equal(document.activeElement, view.getByRole("button", { name: "Close" }));
  f.fireEvent.click(view.getByRole("button", { name: "Design", exact: true }));
  assert.ok(view.getByRole("dialog"));
  assert.deepEqual(destinations, []);
  f.fireEvent.click(view.getByRole("button", { name: "Design", exact: true }));
  f.fireEvent.click(view.getByRole("button", { name: "Review UI" }));
  assert.deepEqual(destinations, ["task_nav"]);
  assert.equal(view.queryByRole("dialog"), null);
  assert.equal(document.activeElement, open);
  assert.equal(document.querySelector(".product-shell")?.hasAttribute("inert"), false);
  f.fireEvent.click(open);
  f.fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
  assert.equal(view.queryByRole("dialog"), null);
  assert.equal(document.activeElement, open);
});
