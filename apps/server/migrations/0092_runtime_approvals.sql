CREATE TABLE runtime_approvals (
  request_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  owner_member_id TEXT NOT NULL REFERENCES team_members(member_id),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  connection_epoch INTEGER NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  digest TEXT NOT NULL CHECK (length(digest) = 64),
  state TEXT NOT NULL CHECK (state IN ('pending', 'allow', 'deny', 'expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  decided_decision TEXT CHECK (decided_decision IN ('allow', 'deny')),
  decided_by_session_id TEXT
) STRICT;
CREATE INDEX runtime_approvals_owner_state ON runtime_approvals(team_id, owner_member_id, state);
CREATE INDEX runtime_approvals_run ON runtime_approvals(run_id);
