-- Stable order is private to one Peer/local Agent, never a Team activity cursor.
CREATE TABLE peer_agent_acceptance_log (
  peer_id TEXT NOT NULL,
  local_agent_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0 AND sequence <= 9007199254740991),
  owner_member_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  acceptance_id TEXT NOT NULL,
  acceptance_revision INTEGER NOT NULL,
  PRIMARY KEY (peer_id, local_agent_id, sequence),
  UNIQUE (acceptance_id, acceptance_revision),
  FOREIGN KEY (peer_id, local_agent_id) REFERENCES peer_agent_projections(peer_id, local_agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_member_id, operation_id) REFERENCES peer_agent_operations(owner_member_id, operation_id) ON DELETE RESTRICT,
  FOREIGN KEY (acceptance_id, acceptance_revision) REFERENCES peer_acceptance_revisions(acceptance_id, revision) ON DELETE RESTRICT
) STRICT;
INSERT INTO peer_agent_acceptance_log
SELECT json_extract(result_json, '$.acceptance.peerId'), json_extract(result_json, '$.projection.localAgentId'),
  row_number() OVER (PARTITION BY json_extract(result_json, '$.acceptance.peerId'),
    json_extract(result_json, '$.projection.localAgentId') ORDER BY rowid),
  owner_member_id, operation_id, acceptance_id, acceptance_revision FROM peer_agent_operations;
CREATE TRIGGER peer_agent_acceptance_log_append AFTER INSERT ON peer_agent_operations
BEGIN
  INSERT INTO peer_agent_acceptance_log SELECT
    json_extract(NEW.result_json, '$.acceptance.peerId'), json_extract(NEW.result_json, '$.projection.localAgentId'),
    coalesce(max(sequence), 0) + 1, NEW.owner_member_id, NEW.operation_id, NEW.acceptance_id, NEW.acceptance_revision
  FROM peer_agent_acceptance_log WHERE peer_id = json_extract(NEW.result_json, '$.acceptance.peerId')
    AND local_agent_id = json_extract(NEW.result_json, '$.projection.localAgentId');
END;
CREATE TRIGGER peer_agent_acceptance_log_binding BEFORE INSERT ON peer_agent_acceptance_log
WHEN NEW.sequence != (SELECT coalesce(max(sequence), 0) + 1 FROM peer_agent_acceptance_log
  WHERE peer_id = NEW.peer_id AND local_agent_id = NEW.local_agent_id)
  OR NOT EXISTS (SELECT 1 FROM peer_agent_operations o WHERE o.owner_member_id = NEW.owner_member_id
    AND o.operation_id = NEW.operation_id AND o.acceptance_id = NEW.acceptance_id
    AND o.acceptance_revision = NEW.acceptance_revision
    AND json_extract(o.result_json, '$.acceptance.peerId') = NEW.peer_id
    AND json_extract(o.result_json, '$.projection.localAgentId') = NEW.local_agent_id)
BEGIN SELECT RAISE(ABORT, 'Peer acceptance log must append the exact Owner decision'); END;
CREATE TRIGGER peer_agent_acceptance_log_immutable BEFORE UPDATE ON peer_agent_acceptance_log
BEGIN SELECT RAISE(ABORT, 'Peer acceptance history is immutable'); END;
CREATE TRIGGER peer_agent_acceptance_log_retained BEFORE DELETE ON peer_agent_acceptance_log
BEGIN SELECT RAISE(ABORT, 'Peer acceptance history is retained'); END;
