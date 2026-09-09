-- Invitation operation receipts recover exactly the originally approved scope.
CREATE TABLE peer_invitation_operations (
  owner_member_id TEXT NOT NULL REFERENCES team_members(member_id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL,
  intent_digest TEXT NOT NULL CHECK (length(intent_digest) = 64),
  invitation_id TEXT NOT NULL UNIQUE REFERENCES peer_invitations(invitation_id) ON DELETE RESTRICT,
  PRIMARY KEY (owner_member_id, operation_id)
) STRICT;
CREATE TRIGGER peer_invitation_operation_immutable BEFORE UPDATE ON peer_invitation_operations
BEGIN SELECT RAISE(ABORT, 'Peer invitation operation is immutable'); END;
CREATE TRIGGER peer_invitation_operation_retained BEFORE DELETE ON peer_invitation_operations
BEGIN SELECT RAISE(ABORT, 'Peer invitation operation is retained'); END;

-- Challenges are ephemeral and bind one recipient key, operation and semantic digest.
CREATE TABLE peer_claim_challenges (
  challenge_id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES peer_invitations(invitation_id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL,
  participant_node_id TEXT NOT NULL,
  participant_public_key TEXT NOT NULL,
  subject_digest TEXT NOT NULL CHECK (length(subject_digest) = 64),
  nonce TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
) STRICT;
CREATE INDEX peer_claim_challenge_expiry ON peer_claim_challenges(expires_at);
CREATE TRIGGER peer_claim_challenge_immutable BEFORE UPDATE ON peer_claim_challenges
WHEN NEW.challenge_id IS NOT OLD.challenge_id OR NEW.invitation_id IS NOT OLD.invitation_id
  OR NEW.operation_id IS NOT OLD.operation_id OR NEW.participant_node_id IS NOT OLD.participant_node_id
  OR NEW.participant_public_key IS NOT OLD.participant_public_key OR NEW.subject_digest IS NOT OLD.subject_digest
  OR NEW.nonce IS NOT OLD.nonce OR NEW.expires_at IS NOT OLD.expires_at
  OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'Peer challenge cannot change or regain authority'); END;

-- Runtime never receives this independent human-entry binding. Only its hash is retained.
CREATE TABLE peer_human_bindings (
  credential_id TEXT PRIMARY KEY CHECK (credential_id GLOB 'peeraccess_*'),
  membership_id TEXT NOT NULL UNIQUE REFERENCES peer_memberships(membership_id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > created_at),
  revoked_at TEXT
) STRICT;
CREATE TRIGGER peer_human_binding_scope BEFORE INSERT ON peer_human_bindings
WHEN NEW.revoked_at IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM peer_memberships p WHERE p.membership_id = NEW.membership_id
    AND p.state = 'active' AND NEW.expires_at <= p.expires_at
)
BEGIN SELECT RAISE(ABORT, 'Peer human binding ceiling denied'); END;
CREATE TRIGGER peer_human_binding_immutable BEFORE UPDATE ON peer_human_bindings
WHEN NEW.credential_id IS NOT OLD.credential_id OR NEW.membership_id IS NOT OLD.membership_id
  OR NEW.token_hash IS NOT OLD.token_hash OR NEW.created_at IS NOT OLD.created_at
  OR NEW.expires_at IS NOT OLD.expires_at OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
BEGIN SELECT RAISE(ABORT, 'Peer human binding cannot change or regain authority'); END;
CREATE TRIGGER peer_human_binding_retained BEFORE DELETE ON peer_human_bindings
BEGIN SELECT RAISE(ABORT, 'Peer human binding is retained'); END;
