-- Allocate once in the migration. Missing identity after migration is an error,
-- never an instruction to generate a replacement key.
CREATE TABLE authority_identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  node_id TEXT NOT NULL UNIQUE,
  seed_hex TEXT,
  public_key TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('unbound', 'central', 'local'))
);
INSERT INTO authority_identity VALUES
  (1, 'node_' || lower(hex(randomblob(16))), lower(hex(randomblob(32))), NULL, 'unbound');
CREATE TRIGGER authority_identity_no_delete BEFORE DELETE ON authority_identity
BEGIN SELECT RAISE(ABORT, 'Authority identity cannot be deleted'); END;
CREATE TRIGGER authority_identity_immutable BEFORE UPDATE ON authority_identity
WHEN OLD.kind <> 'unbound'
BEGIN SELECT RAISE(ABORT, 'Authority identity is immutable'); END;
