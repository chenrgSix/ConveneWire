-- A signed offer is an inbox entry. Only explicit Host acceptance allocates a projection.
CREATE TABLE peer_agent_offers (
  export_id TEXT NOT NULL,
  grant_revision INTEGER NOT NULL,
  grant_digest TEXT NOT NULL CHECK (length(grant_digest) = 64),
  offer_digest TEXT NOT NULL CHECK (length(offer_digest) = 64),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  received_at TEXT NOT NULL,
  PRIMARY KEY (export_id, grant_revision),
  FOREIGN KEY (export_id, grant_revision) REFERENCES peer_export_revisions(export_id, revision) ON DELETE RESTRICT,
  CHECK (json_extract(payload_json, '$.grant.exportId') IS export_id),
  CHECK (json_extract(payload_json, '$.grant.revision') IS grant_revision)
) STRICT;
CREATE TRIGGER peer_agent_offer_binding BEFORE INSERT ON peer_agent_offers
WHEN NOT EXISTS (SELECT 1 FROM peer_export_revisions r WHERE r.export_id = NEW.export_id
  AND r.revision = NEW.grant_revision AND r.digest = NEW.grant_digest)
BEGIN SELECT RAISE(ABORT, 'Peer offer must bind an exact verified grant'); END;
CREATE TRIGGER peer_agent_offer_immutable BEFORE UPDATE ON peer_agent_offers
BEGIN SELECT RAISE(ABORT, 'Peer offer is immutable'); END;
CREATE TRIGGER peer_agent_offer_retained BEFORE DELETE ON peer_agent_offers
BEGIN SELECT RAISE(ABORT, 'Peer offer is retained evidence'); END;

CREATE TABLE peer_agent_projections (
  peer_id TEXT NOT NULL REFERENCES peer_bindings(peer_id) ON DELETE RESTRICT,
  local_agent_id TEXT NOT NULL CHECK (local_agent_id GLOB 'agent_*'),
  projection_agent_id TEXT NOT NULL UNIQUE CHECK (projection_agent_id GLOB 'agent_*'),
  created_at TEXT NOT NULL,
  PRIMARY KEY (peer_id, local_agent_id)
) STRICT;
CREATE TRIGGER peer_agent_projection_accepted BEFORE INSERT ON peer_agent_projections
WHEN NOT EXISTS (SELECT 1 FROM peer_acceptance_heads h
  JOIN peer_acceptance_revisions r ON r.acceptance_id = h.acceptance_id
  JOIN peer_agent_offers o ON o.export_id = json_extract(r.payload_json, '$.exportId')
    AND o.grant_revision = json_extract(r.payload_json, '$.grantRevision')
    AND o.grant_digest = json_extract(r.payload_json, '$.grantDigest')
  WHERE h.peer_id = NEW.peer_id AND h.local_agent_id = NEW.local_agent_id AND r.state = 'active'
    AND r.revision = (SELECT max(revision) FROM peer_acceptance_revisions WHERE acceptance_id = h.acceptance_id))
BEGIN SELECT RAISE(ABORT, 'Peer projection requires explicit acceptance of a verified offer'); END;
CREATE TRIGGER peer_agent_projection_immutable BEFORE UPDATE ON peer_agent_projections
BEGIN SELECT RAISE(ABORT, 'Peer projection identity is immutable'); END;
CREATE TRIGGER peer_agent_projection_retained BEFORE DELETE ON peer_agent_projections
BEGIN SELECT RAISE(ABORT, 'Peer projection identity is retained'); END;

CREATE TABLE peer_agent_operations (
  owner_member_id TEXT NOT NULL REFERENCES team_members(member_id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL CHECK (operation_id GLOB 'op_*'),
  intent_digest TEXT NOT NULL CHECK (length(intent_digest) = 64),
  acceptance_id TEXT NOT NULL,
  acceptance_revision INTEGER NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_member_id, operation_id),
  FOREIGN KEY (acceptance_id, acceptance_revision) REFERENCES peer_acceptance_revisions(acceptance_id, revision) ON DELETE RESTRICT,
  CHECK (json_extract(result_json, '$.acceptance.acceptanceId') IS acceptance_id),
  CHECK (json_extract(result_json, '$.acceptance.revision') IS acceptance_revision)
) STRICT;
CREATE TRIGGER peer_agent_operation_owner BEFORE INSERT ON peer_agent_operations
WHEN NOT EXISTS (SELECT 1 FROM team_members m WHERE m.member_id = NEW.owner_member_id
  AND m.role = 'owner' AND m.team_id = json_extract(NEW.result_json, '$.acceptance.teamId'))
BEGIN SELECT RAISE(ABORT, 'Peer acceptance operation requires the Host owner'); END;
CREATE TRIGGER peer_agent_operation_immutable BEFORE UPDATE ON peer_agent_operations
BEGIN SELECT RAISE(ABORT, 'Peer acceptance operation is immutable'); END;
CREATE TRIGGER peer_agent_operation_retained BEFORE DELETE ON peer_agent_operations
BEGIN SELECT RAISE(ABORT, 'Peer acceptance operation is retained'); END;
