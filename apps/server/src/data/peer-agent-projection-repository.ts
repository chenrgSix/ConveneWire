import type Database from "better-sqlite3";
import type { PeerAgentAcceptanceReceipt } from "@convene-wire/contracts/peer";
import type { AgentCapabilities } from "./core-repository.js";
import { PeerAuthorizationRepository } from "./peer-authorization-repository.js";

/** Materialize display/routing data only after an explicit Host decision. */
export class PeerAgentProjectionRepository {
  public constructor(private readonly database: Database.Database) {}

  public materialize(result: Omit<PeerAgentAcceptanceReceipt, "schemaVersion" | "proof">, now: string): void {
    const { acceptance: a, projection: p } = result;
    const grants = new PeerAuthorizationRepository(this.database);
    const rooms = a.state === "active" ? a.roomIds : [];
    for (const roomId of rooms) grants.requireEffective(a.peerId, p.localAgentId, roomId, now);
    const capabilities: AgentCapabilities = { supportsStart: a.capabilities.supportsStart,
      supportsInterrupt: a.capabilities.supportsInterrupt, supportsResume: a.capabilities.supportsResume,
      supportsStreaming: a.capabilities.supportsStreaming, supportsTaskContextIsolation: a.capabilities.supportsTaskContextIsolation,
      supportsHandoff: false, ownerPrivateOutput: false };
    this.database.prepare(`INSERT INTO agents (agent_id, team_id, owner_member_id, device_id, name, role,
      integration_mode, capabilities_json, enabled, presence, created_at, updated_at)
      VALUES (@agentId, @teamId, @memberId, NULL, @name, @role, 'peer', @capabilities, @enabled, 'offline', @now, @now)
      ON CONFLICT (agent_id) DO UPDATE SET name = excluded.name, role = excluded.role,
        integration_mode = excluded.integration_mode, capabilities_json = excluded.capabilities_json,
        enabled = excluded.enabled, presence = 'offline', updated_at = excluded.updated_at`).run({
      agentId: p.projectionAgentId, teamId: a.teamId, memberId: a.memberId, name: p.displayName, role: p.role,
      capabilities: JSON.stringify(capabilities), enabled: rooms.length > 0 ? 1 : 0, now
    });
    const insert = this.database.prepare("INSERT INTO room_agent_participants (room_id, agent_id, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING");
    const changed = this.database.prepare("UPDATE rooms SET settings_revision = settings_revision + 1 WHERE room_id = ?");
    for (const roomId of rooms) {
      if (insert.run(roomId, p.projectionAgentId, now).changes) changed.run(roomId);
    }
  }
}
