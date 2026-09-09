-- convenewire:migration foreign_keys=off
-- Preserve external FK/trigger targets while replacing the integration-mode CHECK.
-- Only this connection temporarily uses legacy rename semantics; validation runs after rebuild.
PRAGMA legacy_alter_table = ON;

CREATE TABLE agents_peer (
  agent_id TEXT PRIMARY KEY CHECK (agent_id GLOB 'agent_*'),
  team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  owner_member_id TEXT NOT NULL REFERENCES team_members(member_id) ON DELETE CASCADE,
  device_id TEXT REFERENCES devices(device_id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  role TEXT NOT NULL CHECK (length(trim(role)) BETWEEN 1 AND 80),
  integration_mode TEXT NOT NULL CHECK (
    integration_mode IN ('managed', 'manual', 'fake', 'hosted', 'peer')
  ),
  capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  presence TEXT NOT NULL CHECK (
    presence IN ('ready', 'busy', 'degraded', 'manual', 'offline')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  runtime_scope_id TEXT CHECK (
    runtime_scope_id IS NULL OR (
      length(runtime_scope_id) = 64 AND
      runtime_scope_id NOT GLOB '*[^0-9a-f]*'
    )
  ),
  workspace_ref TEXT CHECK (
    workspace_ref IS NULL OR (
      length(workspace_ref) = 74 AND
      workspace_ref GLOB 'workspace_*' AND
      substr(workspace_ref, 11) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  workspace_generation TEXT CHECK (
    workspace_generation IS NULL OR (
      length(workspace_generation) = 64 AND
      workspace_generation NOT GLOB '*[^0-9a-f]*'
    )
  ),
  runtime_policy_json TEXT CHECK (
    runtime_policy_json IS NULL OR (
      json_valid(runtime_policy_json) AND
      json_type(runtime_policy_json) = 'object' AND
      json_type(runtime_policy_json, '$.filesystemAccess') = 'text' AND
      json_extract(runtime_policy_json, '$.filesystemAccess') IN (
        'read-only', 'workspace-write', 'local-policy'
      )
    )
  ),
  workspace_alias TEXT CHECK (
    workspace_alias IS NULL OR (
      length(workspace_alias) BETWEEN 1 AND 80 AND
      workspace_alias = trim(workspace_alias) AND
      workspace_alias NOT IN ('.', '..') AND
      instr(workspace_alias, '/') = 0 AND
      instr(workspace_alias, char(92)) = 0
    )
  ),
  configured_model TEXT,
  model_reported_at TEXT,
  CHECK (integration_mode <> 'peer' OR (
    device_id IS NULL AND runtime_policy_json IS NULL AND runtime_scope_id IS NULL
    AND workspace_ref IS NULL AND workspace_generation IS NULL AND workspace_alias IS NULL
    AND configured_model IS NULL AND model_reported_at IS NULL
    AND json_extract(capabilities_json, '$.supportsHandoff') IS 0
    AND COALESCE(json_extract(capabilities_json, '$.ownerPrivateOutput'), 0) IS 0
    AND json_type(capabilities_json, '$.governedExecution') IS NULL
    AND COALESCE(json_extract(capabilities_json, '$.supportsWorkspaceLeases'), 0) IS 0
    AND COALESCE(json_extract(capabilities_json, '$.supportsArtifactPublication'), 0) IS 0
    AND COALESCE(json_extract(capabilities_json, '$.supportsArtifactMaterialization'), 0) IS 0
    AND COALESCE(json_extract(capabilities_json, '$.supportsDiscussionSupplementalEvidence'), 0) IS 0
  ))
) STRICT;

INSERT INTO agents_peer (agent_id, team_id, owner_member_id, device_id, name, role, integration_mode, capabilities_json, enabled, presence, created_at, updated_at, runtime_scope_id, workspace_ref, workspace_generation, runtime_policy_json, workspace_alias, configured_model, model_reported_at)
SELECT agent_id, team_id, owner_member_id, device_id, name, role, integration_mode, capabilities_json, enabled, presence, created_at, updated_at, runtime_scope_id, workspace_ref, workspace_generation, runtime_policy_json, workspace_alias, configured_model, model_reported_at FROM agents;
DROP TABLE agents;
ALTER TABLE agents_peer RENAME TO agents;
CREATE INDEX agents_team_idx ON agents(team_id, enabled, agent_id);
PRAGMA legacy_alter_table = OFF;

CREATE TRIGGER peer_agent_identity_insert BEFORE INSERT ON agents
WHEN NEW.integration_mode = 'peer' AND NOT EXISTS (
  SELECT 1 FROM peer_agent_projections p JOIN peer_memberships m ON m.peer_id = p.peer_id
  WHERE p.projection_agent_id = NEW.agent_id AND m.team_id = NEW.team_id AND m.member_id = NEW.owner_member_id
)
BEGIN SELECT RAISE(ABORT, 'Peer Agent requires an accepted immutable projection identity'); END;
CREATE TRIGGER peer_agent_identity_update BEFORE UPDATE ON agents
WHEN ((OLD.integration_mode = 'peer' OR NEW.integration_mode = 'peer') AND NEW.integration_mode IS NOT OLD.integration_mode)
  OR (OLD.integration_mode = 'peer' AND (NEW.agent_id IS NOT OLD.agent_id
    OR NEW.team_id IS NOT OLD.team_id OR NEW.owner_member_id IS NOT OLD.owner_member_id))
BEGIN SELECT RAISE(ABORT, 'Peer Agent identity cannot be reinterpreted'); END;
CREATE TRIGGER peer_agent_identity_retained BEFORE DELETE ON agents
WHEN OLD.integration_mode = 'peer'
BEGIN SELECT RAISE(ABORT, 'Peer Agent identity is retained history'); END;

CREATE TRIGGER peer_agent_mcp_insert BEFORE INSERT ON mcp_credentials
WHEN EXISTS (SELECT 1 FROM agents WHERE agent_id = NEW.agent_id AND integration_mode = 'peer')
BEGIN SELECT RAISE(ABORT, 'Peer Agents cannot acquire manual MCP authority'); END;
CREATE TRIGGER peer_agent_mcp_update BEFORE UPDATE ON mcp_credentials
WHEN EXISTS (SELECT 1 FROM agents WHERE agent_id = NEW.agent_id AND integration_mode = 'peer')
BEGIN SELECT RAISE(ABORT, 'Peer Agents cannot acquire manual MCP authority'); END;

CREATE TRIGGER peer_agent_export_invalidated AFTER INSERT ON peer_export_revisions
WHEN EXISTS (SELECT 1 FROM peer_export_heads WHERE export_id = NEW.export_id)
BEGIN
  UPDATE rooms SET settings_revision = settings_revision + 1 WHERE room_id IN (
    SELECT rp.room_id FROM room_agent_participants rp JOIN peer_agent_projections p ON p.projection_agent_id = rp.agent_id
    JOIN peer_export_heads h ON h.peer_id = p.peer_id AND h.local_agent_id = p.local_agent_id WHERE h.export_id = NEW.export_id);
  DELETE FROM room_agent_participants WHERE agent_id IN (SELECT p.projection_agent_id FROM peer_agent_projections p
    JOIN peer_export_heads h ON h.peer_id = p.peer_id AND h.local_agent_id = p.local_agent_id WHERE h.export_id = NEW.export_id);
  UPDATE agents SET enabled = 0, presence = 'offline' WHERE agent_id IN (SELECT p.projection_agent_id FROM peer_agent_projections p
    JOIN peer_export_heads h ON h.peer_id = p.peer_id AND h.local_agent_id = p.local_agent_id WHERE h.export_id = NEW.export_id);
END;
CREATE TRIGGER peer_agent_acceptance_invalidated AFTER INSERT ON peer_acceptance_revisions
WHEN EXISTS (SELECT 1 FROM peer_acceptance_heads WHERE acceptance_id = NEW.acceptance_id)
BEGIN
  UPDATE rooms SET settings_revision = settings_revision + 1 WHERE room_id IN (
    SELECT rp.room_id FROM room_agent_participants rp JOIN peer_agent_projections p ON p.projection_agent_id = rp.agent_id
    JOIN peer_acceptance_heads h ON h.peer_id = p.peer_id AND h.local_agent_id = p.local_agent_id WHERE h.acceptance_id = NEW.acceptance_id);
  DELETE FROM room_agent_participants WHERE agent_id IN (SELECT p.projection_agent_id FROM peer_agent_projections p
    JOIN peer_acceptance_heads h ON h.peer_id = p.peer_id AND h.local_agent_id = p.local_agent_id WHERE h.acceptance_id = NEW.acceptance_id);
  UPDATE agents SET enabled = 0, presence = 'offline' WHERE agent_id IN (SELECT p.projection_agent_id FROM peer_agent_projections p
    JOIN peer_acceptance_heads h ON h.peer_id = p.peer_id AND h.local_agent_id = p.local_agent_id WHERE h.acceptance_id = NEW.acceptance_id);
END;
CREATE TRIGGER peer_agent_membership_revoked AFTER UPDATE ON peer_memberships
WHEN NEW.state = 'revoked'
BEGIN
  UPDATE rooms SET settings_revision = settings_revision + 1 WHERE room_id IN (
    SELECT room_id FROM room_agent_participants WHERE agent_id IN (SELECT projection_agent_id FROM peer_agent_projections WHERE peer_id = NEW.peer_id));
  DELETE FROM room_agent_participants WHERE agent_id IN (SELECT projection_agent_id FROM peer_agent_projections WHERE peer_id = NEW.peer_id);
  UPDATE agents SET enabled = 0, presence = 'offline' WHERE agent_id IN (SELECT projection_agent_id FROM peer_agent_projections WHERE peer_id = NEW.peer_id);
END;
CREATE TRIGGER peer_agent_human_removed AFTER DELETE ON room_human_participants
BEGIN
  DELETE FROM room_agent_participants WHERE room_id = OLD.room_id AND agent_id IN (
    SELECT p.projection_agent_id FROM peer_agent_projections p JOIN peer_memberships m ON m.peer_id = p.peer_id WHERE m.member_id = OLD.member_id);
END;

CREATE VIEW peer_agent_room_authority AS
SELECT p.projection_agent_id, p.peer_id, p.local_agent_id, m.member_id, m.team_id, room.room_id,
  min(m.expires_at, json_extract(e.payload_json, '$.expiresAt'), json_extract(a.payload_json, '$.expiresAt')) AS valid_until
FROM peer_agent_projections p JOIN peer_memberships m ON m.peer_id = p.peer_id
JOIN teams team ON team.team_id = m.team_id AND team.archived_at IS NULL
JOIN peer_export_heads eh ON eh.peer_id = p.peer_id AND eh.local_agent_id = p.local_agent_id
JOIN peer_export_revisions e ON e.export_id = eh.export_id
JOIN peer_acceptance_heads ah ON ah.peer_id = p.peer_id AND ah.local_agent_id = p.local_agent_id
JOIN peer_acceptance_revisions a ON a.acceptance_id = ah.acceptance_id
JOIN json_each(a.payload_json, '$.roomIds') permitted
JOIN rooms room ON room.room_id = permitted.value AND room.team_id = m.team_id AND room.archived_at IS NULL
JOIN room_human_participants human ON human.room_id = room.room_id AND human.member_id = m.member_id
WHERE m.state = 'active' AND (m.scope_kind = 'team' OR m.room_id = room.room_id)
  AND e.revision = (SELECT max(revision) FROM peer_export_revisions WHERE export_id = eh.export_id)
  AND a.revision = (SELECT max(revision) FROM peer_acceptance_revisions WHERE acceptance_id = ah.acceptance_id)
  AND e.state = 'active' AND a.state = 'active'
  AND json_extract(a.payload_json, '$.exportId') = e.export_id
  AND json_extract(a.payload_json, '$.grantRevision') = e.revision AND json_extract(a.payload_json, '$.grantDigest') = e.digest
  AND room.room_id IN (SELECT value FROM json_each(e.payload_json, '$.roomIds'));

CREATE TRIGGER peer_agent_room_insert BEFORE INSERT ON room_agent_participants
WHEN EXISTS (SELECT 1 FROM agents WHERE agent_id = NEW.agent_id AND integration_mode = 'peer') AND NOT EXISTS (
  SELECT 1 FROM peer_agent_room_authority WHERE projection_agent_id = NEW.agent_id AND room_id = NEW.room_id AND valid_until > NEW.added_at)
BEGIN SELECT RAISE(ABORT, 'Room exceeds current bilateral Peer Agent authority'); END;
CREATE TRIGGER peer_agent_room_update BEFORE UPDATE ON room_agent_participants
WHEN (EXISTS (SELECT 1 FROM agents WHERE agent_id IN (OLD.agent_id, NEW.agent_id) AND integration_mode = 'peer'))
  AND (NEW.agent_id IS NOT OLD.agent_id OR NEW.room_id IS NOT OLD.room_id OR NEW.added_at IS NOT OLD.added_at)
BEGIN SELECT RAISE(ABORT, 'Peer Agent Room binding must be explicitly reinserted'); END;

-- Upgrade accepted 0099 projections without allocating another identity or reviving stale grants.
INSERT INTO agents (agent_id, team_id, owner_member_id, device_id, name, role,
  integration_mode, capabilities_json, enabled, presence, created_at, updated_at)
SELECT p.projection_agent_id, m.team_id, m.member_id, NULL,
  json_extract(o.payload_json, '$.displayName'), json_extract(o.payload_json, '$.role'), 'peer',
  json_set(json_remove(json_extract(a.payload_json, '$.capabilities'), '$.supportsOwnerPrivateOutput'),
    '$.supportsHandoff', json('false'), '$.ownerPrivateOutput', json('false')),
  0, 'offline', p.created_at, a.issued_at
FROM peer_agent_projections p JOIN peer_memberships m ON m.peer_id = p.peer_id
JOIN peer_acceptance_heads h ON h.peer_id = p.peer_id AND h.local_agent_id = p.local_agent_id
JOIN peer_acceptance_revisions a ON a.acceptance_id = h.acceptance_id
JOIN peer_agent_offers o ON o.export_id = json_extract(a.payload_json, '$.exportId')
  AND o.grant_revision = json_extract(a.payload_json, '$.grantRevision')
WHERE a.revision = (SELECT max(revision) FROM peer_acceptance_revisions WHERE acceptance_id = h.acceptance_id);
UPDATE agents SET enabled = 1 WHERE integration_mode = 'peer' AND agent_id IN (
  SELECT projection_agent_id FROM peer_agent_room_authority WHERE valid_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO room_agent_participants (room_id, agent_id, added_at)
SELECT room_id, projection_agent_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM peer_agent_room_authority WHERE valid_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
UPDATE rooms SET settings_revision = settings_revision + 1 WHERE room_id IN (
  SELECT room_id FROM room_agent_participants rp JOIN agents a ON a.agent_id = rp.agent_id WHERE a.integration_mode = 'peer');
