import type Database from "better-sqlite3";

export interface PeerAccessScope {
  membershipId: string;
  credentialId: string;
  peerId: string;
  teamId: string;
  memberId: string;
  kind: "team" | "room";
  roomId: string | null;
}

/** No session, including a legacy full login, can promote a Peer-bound Host user. */
export function peerHumanAuthority(database: Database.Database, userId: string, sessionId: string, now: string): {
  recognized: boolean; scope?: PeerAccessScope;
} {
  const member = database.prepare("SELECT membership_id FROM peer_memberships WHERE user_id = ?").get(userId);
  if (!member) return { recognized: false };
  const row = database.prepare(`
    SELECT p.membership_id, p.peer_id, p.team_id, p.member_id, c.credential_id, c.scope_kind, c.room_id
    FROM peer_memberships p
    JOIN team_members m ON m.member_id = p.member_id AND m.user_id = p.user_id AND m.team_id = p.team_id AND m.role = 'member'
    JOIN teams t ON t.team_id = p.team_id AND t.archived_at IS NULL
    JOIN peer_credentials c ON c.membership_id = p.membership_id AND c.audience = 'peer.human'
      AND c.revoked_at IS NULL AND c.consumed_at IS NOT NULL AND c.expires_at > @now AND c.expires_at <= p.expires_at
    JOIN peer_web_sessions ps ON ps.credential_id = c.credential_id AND ps.session_id = @sessionId
    JOIN web_sessions s ON s.session_id = ps.session_id AND s.user_id = p.user_id
      AND s.peer_access_required = 1 AND s.revoked_at IS NULL AND s.expires_at > @now AND s.expires_at <= c.expires_at
    WHERE p.user_id = @userId AND p.state = 'active' AND p.expires_at > @now
      AND (p.scope_kind = 'team' OR (c.scope_kind = 'room' AND c.room_id = p.room_id))
      AND (c.room_id IS NULL OR EXISTS (SELECT 1 FROM rooms r WHERE r.room_id = c.room_id AND r.team_id = p.team_id))
  `).get({ userId, sessionId, now }) as {
    membership_id: string; peer_id: string; team_id: string; member_id: string;
    credential_id: string; scope_kind: "team" | "room"; room_id: string | null;
  } | undefined;
  return { recognized: true, ...(row ? { scope: {
    membershipId: row.membership_id, credentialId: row.credential_id, peerId: row.peer_id,
    teamId: row.team_id, memberId: row.member_id, kind: row.scope_kind, roomId: row.room_id
  } } : {}) };
}
