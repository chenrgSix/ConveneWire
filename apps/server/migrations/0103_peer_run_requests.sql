-- Host-owned immutable execution content. Transport retries and refreshed
-- attestations cannot replace a Run's context or bilateral authorization pins.
CREATE TABLE peer_run_requests (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE RESTRICT,
  peer_id TEXT NOT NULL REFERENCES peer_bindings(peer_id) ON DELETE RESTRICT,
  membership_id TEXT NOT NULL REFERENCES peer_memberships(membership_id) ON DELETE RESTRICT,
  request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  created_at TEXT NOT NULL
);
CREATE INDEX peer_run_requests_peer ON peer_run_requests(peer_id, created_at, run_id);
CREATE TRIGGER peer_run_request_insert BEFORE INSERT ON peer_run_requests
WHEN NOT EXISTS (
  SELECT 1 FROM runs r
  JOIN agents a ON a.agent_id = r.target_agent_id AND a.integration_mode = 'peer' AND a.device_id IS NULL
  JOIN peer_agent_projections p ON p.projection_agent_id = a.agent_id
  JOIN peer_memberships m ON m.peer_id = p.peer_id
  WHERE r.run_id = NEW.run_id AND p.peer_id = NEW.peer_id AND m.membership_id = NEW.membership_id
    AND json_extract(NEW.request_json, '$.binding.runId') = r.run_id
    AND json_extract(NEW.request_json, '$.binding.peerId') = p.peer_id
    AND json_extract(NEW.request_json, '$.binding.teamId') = a.team_id
    AND json_extract(NEW.request_json, '$.binding.roomId') = r.room_id
    AND json_extract(NEW.request_json, '$.binding.projectionAgentId') = a.agent_id
    AND json_extract(NEW.request_json, '$.binding.localAgentId') = p.local_agent_id
    AND json_extract(NEW.request_json, '$.binding.requestDigest') = NEW.request_digest
    AND json_extract(NEW.request_json, '$.payload.runId') = r.run_id
    AND json_extract(NEW.request_json, '$.payload.taskId') = r.task_id
    AND json_extract(NEW.request_json, '$.payload.targetAgentId') = a.agent_id
)
BEGIN SELECT RAISE(ABORT, 'Peer Run requires its exact Host Run and projection'); END;
CREATE TRIGGER peer_run_request_immutable BEFORE UPDATE ON peer_run_requests
BEGIN SELECT RAISE(ABORT, 'Peer Run request is immutable'); END;
CREATE TRIGGER peer_run_request_retained BEFORE DELETE ON peer_run_requests
BEGIN SELECT RAISE(ABORT, 'Peer Run request is retained'); END;
