-- Append-only bilateral authorization. Projection identifiers do not grant rights.
CREATE TABLE peer_export_lineages (
  export_id TEXT PRIMARY KEY CHECK (export_id GLOB 'export_*'),
  peer_id TEXT NOT NULL REFERENCES peer_bindings(peer_id) ON DELETE RESTRICT,
  local_agent_id TEXT NOT NULL CHECK (local_agent_id GLOB 'agent_*'),
  retired_at TEXT
) STRICT;
CREATE TABLE peer_acceptance_lineages (
  acceptance_id TEXT PRIMARY KEY CHECK (acceptance_id GLOB 'acceptance_*'),
  export_id TEXT NOT NULL REFERENCES peer_export_lineages(export_id) ON DELETE RESTRICT,
  peer_id TEXT NOT NULL REFERENCES peer_bindings(peer_id) ON DELETE RESTRICT,
  local_agent_id TEXT NOT NULL CHECK (local_agent_id GLOB 'agent_*'),
  retired_at TEXT
) STRICT;

CREATE TABLE peer_export_revisions (
  export_id TEXT NOT NULL REFERENCES peer_export_lineages(export_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  digest TEXT NOT NULL CHECK (length(digest) = 64),
  state TEXT NOT NULL CHECK (state IN ('active', 'revoked')),
  issued_at TEXT NOT NULL,
  PRIMARY KEY (export_id, revision),
  CHECK (json_extract(payload_json, '$.exportId') IS export_id),
  CHECK (json_extract(payload_json, '$.revision') IS revision),
  CHECK (json_extract(payload_json, '$.state') IS state),
  CHECK (json_extract(payload_json, '$.issuedAt') IS issued_at)
) STRICT;
CREATE TABLE peer_export_heads (
  peer_id TEXT NOT NULL REFERENCES peer_bindings(peer_id) ON DELETE RESTRICT,
  local_agent_id TEXT NOT NULL,
  export_id TEXT NOT NULL UNIQUE REFERENCES peer_export_lineages(export_id) ON DELETE RESTRICT,
  PRIMARY KEY (peer_id, local_agent_id)
) STRICT;
CREATE TRIGGER peer_export_revision_order BEFORE INSERT ON peer_export_revisions
WHEN NEW.revision <> COALESCE((SELECT max(revision) FROM peer_export_revisions WHERE export_id = NEW.export_id), 0) + 1
  OR EXISTS (SELECT 1 FROM peer_export_revisions WHERE export_id = NEW.export_id AND (state = 'revoked' OR issued_at > NEW.issued_at))
  OR (NEW.state = 'active' AND EXISTS (SELECT 1 FROM peer_export_lineages WHERE export_id = NEW.export_id AND retired_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'Peer export history cannot skip or revive authority'); END;
CREATE TRIGGER peer_export_revision_immutable BEFORE UPDATE ON peer_export_revisions
BEGIN SELECT RAISE(ABORT, 'Peer export revision is immutable'); END;
CREATE TRIGGER peer_export_revision_no_delete BEFORE DELETE ON peer_export_revisions
BEGIN SELECT RAISE(ABORT, 'Peer export history cannot be deleted'); END;
CREATE TRIGGER peer_export_lineage_immutable BEFORE UPDATE ON peer_export_lineages
WHEN NEW.export_id IS NOT OLD.export_id OR NEW.peer_id IS NOT OLD.peer_id OR NEW.local_agent_id IS NOT OLD.local_agent_id
  OR OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
BEGIN SELECT RAISE(ABORT, 'Peer export lineage is immutable'); END;
CREATE TRIGGER peer_export_lineage_no_delete BEFORE DELETE ON peer_export_lineages
BEGIN SELECT RAISE(ABORT, 'Peer export lineage cannot be deleted'); END;
CREATE TRIGGER peer_export_head_insert BEFORE INSERT ON peer_export_heads
WHEN NOT EXISTS (SELECT 1 FROM peer_export_lineages h WHERE h.export_id = NEW.export_id
  AND h.peer_id = NEW.peer_id AND h.local_agent_id = NEW.local_agent_id AND h.retired_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Peer export head cannot restore retired authority'); END;
CREATE TRIGGER peer_export_head_update BEFORE UPDATE ON peer_export_heads
WHEN NOT EXISTS (SELECT 1 FROM peer_export_lineages h WHERE h.export_id = NEW.export_id
  AND h.peer_id = NEW.peer_id AND h.local_agent_id = NEW.local_agent_id AND h.retired_at IS NULL)
  OR NEW.peer_id IS NOT OLD.peer_id OR NEW.local_agent_id IS NOT OLD.local_agent_id
  OR NOT EXISTS (SELECT 1 FROM peer_export_lineages h WHERE h.export_id = OLD.export_id AND h.retired_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Peer export head cannot restore retired authority'); END;
CREATE TRIGGER peer_export_head_no_delete BEFORE DELETE ON peer_export_heads
BEGIN SELECT RAISE(ABORT, 'Peer export head history cannot be deleted'); END;

CREATE TABLE peer_acceptance_revisions (
  acceptance_id TEXT NOT NULL REFERENCES peer_acceptance_lineages(acceptance_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  digest TEXT NOT NULL CHECK (length(digest) = 64),
  state TEXT NOT NULL CHECK (state IN ('active', 'revoked')),
  issued_at TEXT NOT NULL,
  PRIMARY KEY (acceptance_id, revision),
  CHECK (json_extract(payload_json, '$.acceptanceId') IS acceptance_id),
  CHECK (json_extract(payload_json, '$.revision') IS revision),
  CHECK (json_extract(payload_json, '$.state') IS state),
  CHECK (json_extract(payload_json, '$.issuedAt') IS issued_at)
) STRICT;
CREATE TABLE peer_acceptance_heads (
  peer_id TEXT NOT NULL REFERENCES peer_bindings(peer_id) ON DELETE RESTRICT,
  local_agent_id TEXT NOT NULL,
  acceptance_id TEXT NOT NULL UNIQUE REFERENCES peer_acceptance_lineages(acceptance_id) ON DELETE RESTRICT,
  PRIMARY KEY (peer_id, local_agent_id)
) STRICT;
CREATE TRIGGER peer_acceptance_revision_order BEFORE INSERT ON peer_acceptance_revisions
WHEN NEW.revision <> COALESCE((SELECT max(revision) FROM peer_acceptance_revisions WHERE acceptance_id = NEW.acceptance_id), 0) + 1
  OR EXISTS (SELECT 1 FROM peer_acceptance_revisions WHERE acceptance_id = NEW.acceptance_id AND (state = 'revoked' OR issued_at > NEW.issued_at))
  OR (NEW.state = 'active' AND EXISTS (SELECT 1 FROM peer_acceptance_lineages WHERE acceptance_id = NEW.acceptance_id AND retired_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'Peer acceptance history cannot skip or revive authority'); END;
CREATE TRIGGER peer_acceptance_revision_immutable BEFORE UPDATE ON peer_acceptance_revisions
BEGIN SELECT RAISE(ABORT, 'Peer acceptance revision is immutable'); END;
CREATE TRIGGER peer_acceptance_revision_no_delete BEFORE DELETE ON peer_acceptance_revisions
BEGIN SELECT RAISE(ABORT, 'Peer acceptance history cannot be deleted'); END;
CREATE TRIGGER peer_acceptance_lineage_immutable BEFORE UPDATE ON peer_acceptance_lineages
WHEN NEW.acceptance_id IS NOT OLD.acceptance_id OR NEW.peer_id IS NOT OLD.peer_id OR NEW.local_agent_id IS NOT OLD.local_agent_id
  OR NEW.export_id IS NOT OLD.export_id
  OR OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
BEGIN SELECT RAISE(ABORT, 'Peer acceptance lineage is immutable'); END;
CREATE TRIGGER peer_acceptance_lineage_no_delete BEFORE DELETE ON peer_acceptance_lineages
BEGIN SELECT RAISE(ABORT, 'Peer acceptance lineage cannot be deleted'); END;
CREATE TRIGGER peer_acceptance_head_insert BEFORE INSERT ON peer_acceptance_heads
WHEN NOT EXISTS (SELECT 1 FROM peer_acceptance_lineages h WHERE h.acceptance_id = NEW.acceptance_id
  AND h.peer_id = NEW.peer_id AND h.local_agent_id = NEW.local_agent_id AND h.retired_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Peer acceptance head cannot restore retired authority'); END;
CREATE TRIGGER peer_acceptance_head_update BEFORE UPDATE ON peer_acceptance_heads
WHEN NOT EXISTS (SELECT 1 FROM peer_acceptance_lineages h WHERE h.acceptance_id = NEW.acceptance_id
  AND h.peer_id = NEW.peer_id AND h.local_agent_id = NEW.local_agent_id AND h.retired_at IS NULL)
  OR NEW.peer_id IS NOT OLD.peer_id OR NEW.local_agent_id IS NOT OLD.local_agent_id
  OR NOT EXISTS (SELECT 1 FROM peer_acceptance_lineages h WHERE h.acceptance_id = OLD.acceptance_id AND h.retired_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Peer acceptance head cannot restore retired authority'); END;
CREATE TRIGGER peer_acceptance_head_no_delete BEFORE DELETE ON peer_acceptance_heads
BEGIN SELECT RAISE(ABORT, 'Peer acceptance head history cannot be deleted'); END;
