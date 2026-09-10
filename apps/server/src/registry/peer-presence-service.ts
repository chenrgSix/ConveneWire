import type Database from "better-sqlite3";
import type { PeerRuntimeSessions } from "../peer/runtime-sessions.js";

export type PeerAgentPresence = "offline" | "ready" | "busy";
export interface PeerAgentPresenceSource {
  getAvailability(agentId: string, now: string): PeerAgentPresence;
}

/** Reachability of an accepted projection, never a Runtime execution grant. */
export class PeerPresenceService implements PeerAgentPresenceSource {
  private refreshing = false;
  public constructor(private readonly database: Database.Database,
    private readonly sessions: PeerRuntimeSessions,
    private readonly onChanged: (teamId: string) => void = () => {}) {}

  public getAvailability(agentId: string, now: string): PeerAgentPresence {
    if (!Number.isFinite(Date.parse(now))) return "offline";
    const row = this.database.prepare(`SELECT p.peer_id FROM agents a
      JOIN peer_agent_room_authority p ON p.projection_agent_id = a.agent_id
      JOIN room_agent_participants r ON r.agent_id = a.agent_id AND r.room_id = p.room_id
      WHERE a.agent_id = ? AND a.integration_mode = 'peer' AND a.device_id IS NULL
        AND a.enabled = 1 AND a.team_id = p.team_id AND a.owner_member_id = p.member_id
        AND p.valid_until > ? AND json_extract(a.capabilities_json, '$.supportsStart') = 1
        AND json_extract(a.capabilities_json, '$.supportsTaskContextIsolation') = 1
      LIMIT 1`).get(agentId, now) as { peer_id: string } | undefined;
    if (!row || !this.sessions.get(row.peer_id, now)) return "offline";
    const busy = this.database.prepare(`SELECT 1 FROM runs WHERE target_agent_id = ?
      AND state IN ('delivered', 'working') LIMIT 1`).get(agentId);
    return busy ? "busy" : "ready";
  }

  // Refresh persisted UI/Workbench observations on connection, expiry and Run
  // changes. Only actual changes notify subscribers; no Device row is written.
  public refresh(now: string, teamId?: string): void {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const rows = this.database.prepare(`SELECT agent_id, team_id, presence FROM agents
        WHERE integration_mode = 'peer' AND (? IS NULL OR team_id = ?)`)
        .all(teamId ?? null, teamId ?? null) as Array<{ agent_id: string; team_id: string; presence: string }>;
      const changed = new Set<string>();
      for (const row of rows) {
        const presence = this.getAvailability(row.agent_id, now);
        if (row.presence === presence) continue;
        this.database.prepare("UPDATE agents SET presence = ?, updated_at = ? WHERE agent_id = ?")
          .run(presence, now, row.agent_id);
        changed.add(row.team_id);
      }
      for (const id of changed) this.onChanged(id);
    } finally { this.refreshing = false; }
  }
}
