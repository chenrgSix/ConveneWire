CREATE TABLE evidence_disclosure_grants (
  grant_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  owner_member_id TEXT NOT NULL REFERENCES team_members(member_id),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  agent_id TEXT NOT NULL REFERENCES agents(agent_id),
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  task_id TEXT NOT NULL REFERENCES agent_tasks(task_id),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  intent_json TEXT NOT NULL,
  intent_sha256 TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision IN (1, 2)),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  result_id TEXT UNIQUE REFERENCES task_results(result_id),
  CHECK ((state = 'active' AND revision = 1 AND revoked_at IS NULL)
      OR (state = 'revoked' AND revision = 2 AND revoked_at IS NOT NULL))
);
CREATE INDEX evidence_disclosure_task ON evidence_disclosure_grants(task_id, owner_member_id);
