import assert from "node:assert/strict";
import test from "node:test";

import { TeamChangeService } from "../src/team-room/team-change-service.js";

test("Team change waits wake once with a monotonic cursor", async () => {
  const changes = new TeamChangeService();
  const first = changes.wait("team_test", 0, { timeoutMilliseconds: 1_000 });
  const second = changes.wait("team_test", 0, { timeoutMilliseconds: 1_000 });
  assert.equal(changes.notify("team_test"), 1);
  assert.deepEqual(await first, {
    changed: true, cursor: 1, reset: false, team: true, roomIds: [], runRoomIds: []
  });
  assert.deepEqual(await second, {
    changed: true, cursor: 1, reset: false, team: true, roomIds: [], runRoomIds: []
  });
  assert.deepEqual(await changes.wait("team_test", 0), {
    changed: true,
    cursor: 1,
    reset: false,
    team: true,
    roomIds: [],
    runRoomIds: []
  });
});

test("Team change waits expose timeout, restart reset, and cancellation", async () => {
  const changes = new TeamChangeService();
  assert.deepEqual(await changes.wait("team_test", 0, { timeoutMilliseconds: 1 }), {
    changed: false,
    cursor: 0,
    reset: false,
    team: false,
    roomIds: [],
    runRoomIds: []
  });
  assert.deepEqual(await changes.wait("team_test", 9), {
    changed: false,
    cursor: 0,
    reset: true,
    team: true,
    roomIds: [],
    runRoomIds: []
  });
  const controller = new AbortController();
  const pending = changes.wait("team_test", 0, {
    signal: controller.signal,
    timeoutMilliseconds: 1_000
  });
  controller.abort(new Error("test abort"));
  await assert.rejects(pending, /test abort/u);
});

test("Team change cursors aggregate scoped Room hints without losing Team changes", async () => {
  const changes = new TeamChangeService();
  changes.notify("team_test", { kind: "room", roomId: "room_a" });
  changes.notify("team_test", { kind: "room", roomId: "room_b" });
  changes.notify("team_test", { kind: "run", roomId: "room_c" });
  assert.deepEqual(await changes.wait("team_test", 0), {
    changed: true,
    cursor: 3,
    reset: false,
    team: false,
    roomIds: ["room_a", "room_b"],
    runRoomIds: ["room_c"]
  });
  changes.notify("team_test");
  assert.deepEqual(await changes.wait("team_test", 1), {
    changed: true,
    cursor: 4,
    reset: false,
    team: true,
    roomIds: ["room_b"],
    runRoomIds: ["room_c"]
  });
});

test("Room cursors do not advance for another Room or Team and retain only local hints", async () => {
  const changes = new TeamChangeService();
  const initial = await changes.waitRoom("team_one", "room_a", 0);
  assert.equal(initial.team, true);
  for (let i = 0; i < 20; i++) {
    changes.notify("team_one", { kind: "room", roomId: "room_b" });
    changes.notify("team_other", { kind: "run", roomId: "room_a" });
  }
  const unchanged = await changes.waitRoom("team_one", "room_a", initial.cursor, { timeoutMilliseconds: 1 });
  assert.equal(unchanged.cursor, initial.cursor); assert.equal(unchanged.changed, false);
  const pending = changes.waitRoom("team_one", "room_a", initial.cursor);
  changes.notify("team_one", { kind: "run", roomId: "room_a" });
  const updated = await pending;
  assert.equal(updated.cursor, initial.cursor + 1); assert.deepEqual(updated.runRoomIds, ["room_a"]);
  assert.deepEqual(updated.roomIds, []); assert.equal(updated.team, false);
  changes.notify("team_one");
  const registry = await changes.waitRoom("team_one", "room_a", updated.cursor);
  assert.equal(registry.team, true); assert.deepEqual(registry.roomIds, []); assert.deepEqual(registry.runRoomIds, []);
  assert.equal((await new TeamChangeService().waitRoom("team_one", "room_a", registry.cursor)).reset, true);
  const controller = new AbortController();
  const canceled = changes.waitRoom("team_one", "room_a", registry.cursor, { signal: controller.signal });
  controller.abort(new Error("Room closed"));
  await assert.rejects(canceled, /Room closed/u);
});
