-- The 60-second exchange deadline is separate from the bounded eight-hour session authority.
CREATE TABLE peer_human_entries (
  credential_id TEXT PRIMARY KEY REFERENCES peer_credentials(credential_id) ON DELETE RESTRICT,
  binding_credential_id TEXT NOT NULL REFERENCES peer_human_bindings(credential_id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL,
  intent_digest TEXT NOT NULL CHECK (length(intent_digest) = 64),
  created_at TEXT NOT NULL,
  exchange_expires_at TEXT NOT NULL CHECK (exchange_expires_at > created_at),
  UNIQUE (binding_credential_id, operation_id)
) STRICT;
CREATE INDEX peer_human_entries_binding ON peer_human_entries(binding_credential_id, exchange_expires_at);
CREATE TRIGGER peer_human_entry_scope BEFORE INSERT ON peer_human_entries
WHEN NOT EXISTS (
  SELECT 1 FROM peer_credentials c JOIN peer_human_bindings b ON b.membership_id = c.membership_id
  WHERE c.credential_id = NEW.credential_id AND b.credential_id = NEW.binding_credential_id
    AND c.audience = 'peer.human' AND c.consumed_at IS NULL AND c.revoked_at IS NULL
    AND b.revoked_at IS NULL AND c.expires_at <= b.expires_at AND NEW.exchange_expires_at <= c.expires_at
)
BEGIN SELECT RAISE(ABORT, 'Peer human entry lineage denied'); END;
CREATE TRIGGER peer_human_entry_immutable BEFORE UPDATE ON peer_human_entries
BEGIN SELECT RAISE(ABORT, 'Peer human entry operation is immutable'); END;
CREATE TRIGGER peer_human_entry_retained BEFORE DELETE ON peer_human_entries
BEGIN SELECT RAISE(ABORT, 'Peer human entry operation is retained'); END;
