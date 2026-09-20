import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { DesktopHandoffRequest, DesktopHandoffScope } from "@convene-wire/contracts/local-node";
import type { CoreRepository } from "../data/core-repository.js";
import type { LocalNodeService } from "./local-node-service.js";

interface Row { task_id: string; adoption_id: string; scope_json: string; state: "attached" | "released" }
interface Task { task_id: string; team_id: string; room_id: string; title: string; primary_agent_id: string; owner_member_id: string; lifecycle_state: string }
const unavailable = () => new Error("Codex 接管范围已变化，或目标不是本机单 Agent 的新任务。请在本机重新确认。");
export function desktopAdoption(database: Database.Database, taskId: string): Row | undefined {
  return database.prepare("SELECT * FROM desktop_handoffs WHERE task_id = ?").get(taskId) as Row | undefined;
}

export function desktopScope(database: Database.Database, core: CoreRepository, taskId: string): DesktopHandoffScope {
  const installation = database.prepare("SELECT node_id FROM local_node_installation WHERE singleton = 1").get() as { node_id: string } | undefined;
  const binding = database.prepare("SELECT team_id, device_id FROM local_node_binding WHERE singleton = 1").get() as { team_id: string; device_id: string } | undefined;
  const task = database.prepare("SELECT * FROM agent_tasks WHERE task_id = ?").get(taskId) as Task | undefined;
  const room = task && core.getRoom(task.room_id);
  const agent = task && core.getAgent(task.primary_agent_id);
  const device = binding && core.getDevice(binding.device_id);
  const assignments = database.prepare("SELECT agent_id, role FROM task_agent_assignments WHERE task_id = ? ORDER BY agent_id").all(taskId) as { agent_id: string; role: string }[];
  if (!installation || !binding || !task || !room || room.archivedAt || core.getTeam(room.teamId)?.archivedAt || !agent || !agent.enabled || !device || device.status !== "active" ||
      task.team_id !== binding.team_id || room.teamId !== binding.team_id || agent.deviceId !== binding.device_id ||
      agent.ownerMemberId !== device.ownerMemberId || task.owner_member_id !== device.ownerMemberId ||
      agent.integrationMode !== "managed" || agent.capabilities.ownerPrivateOutput ||
      assignments.length !== 1 || assignments[0]?.agent_id !== agent.agentId || assignments[0]?.role !== "primary" ||
      !core.isRoomAgent(room.roomId, agent.agentId) || !core.isRoomMember(room.roomId, device.ownerMemberId) ||
      ["completed", "canceled"].includes(task.lifecycle_state)) throw unavailable();
  const participants = core.getRoomParticipants(room.roomId);
  const members = core.listMembers(room.teamId).filter(m => participants.memberIds.includes(m.memberId)).sort((a, b) => a.memberId.localeCompare(b.memberId));
  const agentIds = [...participants.agentIds].sort();
  const audience = [...members.map(m => m.displayName), ...agentIds.map(id => `${core.getAgent(id)?.name ?? id} (Agent)` )];
  if (audience.length > 256) throw unavailable();
  const pin = { nodeId: installation.node_id, teamId: task.team_id, roomId: room.roomId, taskId, agentId: agent.agentId,
    deviceId: device.deviceId, ownerMemberId: device.ownerMemberId };
  const audienceDigest = createHash("sha256").update(JSON.stringify({ ...pin, members, agentIds,
    roomRevision: room.settingsRevision, assignments, runtimeScopeId: agent.runtimeScopeId, policy: agent.runtimePolicy })).digest("hex");
  const record = desktopAdoption(database, taskId);
  if (!record && (database.prepare("SELECT 1 FROM runs WHERE task_id = ? LIMIT 1").get(taskId) || database.prepare("SELECT 1 FROM discussions WHERE task_id = ? LIMIT 1").get(taskId))) throw unavailable();
  return { ...pin, audienceDigest, audience, taskTitle: task.title, roomName: room.name, agentName: agent.name,
    state: record ? record.state === "released" ? "released" : JSON.parse(record.scope_json).audienceDigest === audienceDigest ? "attached" : "paused" : "available",
    adoptionId: record?.adoption_id ?? "" };
}

export function requireDesktopRun(database: Database.Database, core: CoreRepository, runId: string): void {
  const run = database.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId) as { task_id: string; room_id: string; target_agent_id: string; parent_run_id: string | null } | undefined;
  if (!run) throw unavailable();
  const record = desktopAdoption(database, run.task_id);
  if (!record) return;
  const scope = desktopScope(database, core, run.task_id);
  const delivery = database.prepare("SELECT payload_json FROM run_deliveries WHERE run_id = ?").get(runId) as { payload_json: string } | undefined;
  if (delivery && (JSON.parse(delivery.payload_json).desktopAdoptionId !== record.adoption_id || JSON.parse(delivery.payload_json).desktopAudienceDigest !== scope.audienceDigest)) throw unavailable();
  if (scope.state !== "attached" || scope.agentId !== run.target_agent_id || scope.roomId !== run.room_id || run.parent_run_id ||
      database.prepare("SELECT 1 FROM discussion_turns WHERE run_id = ?").get(runId)) throw unavailable();
}

export function controlDesktopHandoff(database: Database.Database, core: CoreRepository, node: LocalNodeService,
  input: DesktopHandoffRequest, now: string): DesktopHandoffScope {
  const binding = node.binding(now); // Recheck revocation for every native control request.
  return database.transaction((): DesktopHandoffScope => {
    const record = desktopAdoption(database, input.taskId);
    if (input.action === "release") {
      if (!binding || !input.adoptionId) throw unavailable();
      if (!record) {
        // Cancel a provisional native review even if ordinary work or assignment
        // changed meanwhile. No adoption or permission is created by this ack.
        const task = database.prepare("SELECT * FROM agent_tasks WHERE task_id = ?").get(input.taskId) as Task | undefined;
        if (!task || task.team_id !== binding.teamId || task.owner_member_id !== binding.ownerMemberId) throw unavailable();
        return { nodeId: node.launch.identity.nodeId, teamId: task.team_id, roomId: task.room_id, taskId: task.task_id,
          agentId: task.primary_agent_id, deviceId: binding.deviceId, ownerMemberId: binding.ownerMemberId,
          audienceDigest: "0".repeat(64), audience: [], taskTitle: task.title,
          roomName: core.getRoom(task.room_id)?.name ?? "Room", agentName: core.getAgent(task.primary_agent_id)?.name ?? "Agent",
          adoptionId: "", state: "released" };
      }
      if (record.adoption_id !== input.adoptionId) throw unavailable();
      const previous = JSON.parse(record.scope_json) as DesktopHandoffScope;
      if (previous.nodeId !== node.launch.identity.nodeId || previous.deviceId !== binding.deviceId || previous.teamId !== binding.teamId || previous.ownerMemberId !== binding.ownerMemberId) throw unavailable();
      database.prepare("UPDATE desktop_handoffs SET state = 'released' WHERE task_id = ?").run(input.taskId);
      return {...previous, adoptionId: record.adoption_id, state: "released"};
    }
    const scope = desktopScope(database, core, input.taskId);
    if (input.action === "scope") {
      if (!record && (database.prepare("SELECT 1 FROM runs WHERE task_id = ? LIMIT 1").get(input.taskId) ||
          database.prepare("SELECT 1 FROM discussions WHERE task_id = ? LIMIT 1").get(input.taskId))) throw unavailable();
      return scope;
    }
    if (input.action === "confirm") {
      if (!input.adoptionId || input.audienceDigest !== scope.audienceDigest) throw unavailable();
      if (record) {
        if (record.adoption_id !== input.adoptionId || record.state === "released" ||
            database.prepare("SELECT 1 FROM runs WHERE task_id = ? AND state IN ('queued','delivered','working') LIMIT 1").get(input.taskId)) throw unavailable();
        database.prepare("UPDATE desktop_handoffs SET scope_json = ? WHERE task_id = ?").run(JSON.stringify(scope), input.taskId);
        return { ...scope, state: "attached" };
      }
      if (database.prepare("SELECT 1 FROM runs WHERE task_id = ? LIMIT 1").get(input.taskId) ||
          database.prepare("SELECT 1 FROM discussions WHERE task_id = ? LIMIT 1").get(input.taskId)) throw unavailable();
      database.prepare("INSERT INTO desktop_handoffs VALUES (?, ?, ?, 'attached')").run(input.taskId, input.adoptionId, JSON.stringify(scope));
      return { ...scope, adoptionId: input.adoptionId, state: "attached" };
    }
    if (!record || input.adoptionId !== record.adoption_id) throw unavailable();
    if (input.action === "validate") {
      if (!input.runId || input.audienceDigest !== scope.audienceDigest) throw unavailable();
      const run = database.prepare("SELECT task_id FROM runs WHERE run_id = ?").get(input.runId) as { task_id: string } | undefined;
      if (run?.task_id !== input.taskId) throw unavailable();
      requireDesktopRun(database, core, input.runId);
      return scope;
    }
    throw unavailable();
  }).immediate();
}
