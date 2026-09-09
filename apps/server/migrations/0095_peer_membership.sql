-- Peer state is independent of legacy Device credentials and human invitations.
CREATE TABLE peer_bindings (
  peer_id TEXT PRIMARY KEY CHECK (peer_id GLOB 'peer_*'),
  host_node_id TEXT NOT NULL REFERENCES authority_identity(node_id) ON DELETE RESTRICT,
  participant_node_id TEXT NOT NULL CHECK (participant_node_id GLOB 'node_*'),
  participant_public_key TEXT NOT NULL CHECK (length(participant_public_key) = 43),
  local_user_id TEXT NOT NULL CHECK (local_user_id GLOB 'user_*'),
  created_at TEXT NOT NULL,
  CHECK (host_node_id <> participant_node_id)
) STRICT;

CREATE TABLE peer_memberships (
  membership_id TEXT PRIMARY KEY CHECK (membership_id GLOB 'peermember_*'),
  peer_id TEXT NOT NULL UNIQUE REFERENCES peer_bindings(peer_id) ON DELETE RESTRICT,
  team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE RESTRICT,
  member_id TEXT NOT NULL UNIQUE REFERENCES team_members(member_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL UNIQUE REFERENCES web_users(user_id) ON DELETE RESTRICT,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('team', 'room')),
  room_id TEXT REFERENCES rooms(room_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > created_at),
  CHECK ((scope_kind = 'team' AND room_id IS NULL) OR (scope_kind = 'room' AND room_id IS NOT NULL))
) STRICT;
CREATE INDEX peer_memberships_team_idx ON peer_memberships(team_id, state);

CREATE TABLE peer_invitations (
  invitation_id TEXT PRIMARY KEY CHECK (invitation_id GLOB 'peerinvite_*'),
  invitation_json TEXT NOT NULL CHECK (json_valid(invitation_json)),
  invitation_digest TEXT NOT NULL CHECK (length(invitation_digest) = 64),
  secret_hash TEXT NOT NULL UNIQUE CHECK (length(secret_hash) = 64),
  issued_by_member_id TEXT NOT NULL REFERENCES team_members(member_id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'claimed', 'revoked')),
  claim_operation_id TEXT UNIQUE,
  claim_digest TEXT,
  claimed_membership_id TEXT UNIQUE REFERENCES peer_memberships(membership_id) ON DELETE RESTRICT,
  claimed_at TEXT,
  claimed_credential_id TEXT UNIQUE REFERENCES peer_credentials(credential_id) ON DELETE RESTRICT,
  CHECK (json_extract(invitation_json, '$.invitationId') IS invitation_id),
  CHECK ((claimed_membership_id IS NULL AND claim_operation_id IS NULL AND claim_digest IS NULL AND claimed_at IS NULL AND claimed_credential_id IS NULL AND state <> 'claimed') OR
    (claimed_membership_id IS NOT NULL AND claim_operation_id IS NOT NULL AND length(claim_digest) = 64 AND claimed_at IS NOT NULL AND claimed_credential_id IS NOT NULL AND state <> 'open'))
) STRICT;

CREATE TABLE peer_credentials (
  credential_id TEXT PRIMARY KEY,
  membership_id TEXT NOT NULL REFERENCES peer_memberships(membership_id) ON DELETE RESTRICT,
  audience TEXT NOT NULL CHECK (audience IN ('peer.runtime', 'peer.human')),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('team', 'room')),
  room_id TEXT REFERENCES rooms(room_id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > created_at),
  consumed_at TEXT,
  revoked_at TEXT,
  CHECK ((scope_kind = 'team' AND room_id IS NULL) OR (scope_kind = 'room' AND room_id IS NOT NULL)),
  CHECK (audience = 'peer.human' OR consumed_at IS NULL)
) STRICT;
CREATE INDEX peer_credentials_membership_idx ON peer_credentials(membership_id, audience);

ALTER TABLE web_sessions ADD COLUMN peer_access_required INTEGER NOT NULL DEFAULT 0 CHECK (peer_access_required IN (0, 1));

-- A human browser exchange keeps the credential ceiling even if session lookup changes.
CREATE TABLE peer_web_sessions (
  session_id TEXT PRIMARY KEY REFERENCES web_sessions(session_id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE REFERENCES peer_credentials(credential_id) ON DELETE RESTRICT
) STRICT;

CREATE TRIGGER peer_binding_immutable BEFORE UPDATE ON peer_bindings
BEGIN SELECT RAISE(ABORT, 'Peer binding is immutable'); END;
CREATE TRIGGER peer_binding_no_delete BEFORE DELETE ON peer_bindings
BEGIN SELECT RAISE(ABORT, 'Peer binding history cannot be deleted'); END;
CREATE TRIGGER peer_membership_insert BEFORE INSERT ON peer_memberships
WHEN NEW.revision <> 1 OR NEW.state <> 'active' OR NOT EXISTS (
  SELECT 1 FROM team_members m WHERE m.member_id = NEW.member_id
    AND m.team_id = NEW.team_id AND m.user_id = NEW.user_id AND m.role = 'member'
) OR (NEW.room_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM rooms r WHERE r.room_id = NEW.room_id AND r.team_id = NEW.team_id
)) OR EXISTS (
  SELECT 1 FROM room_human_participants rp JOIN rooms r ON r.room_id = rp.room_id
  WHERE rp.member_id = NEW.member_id AND
    (r.team_id <> NEW.team_id OR (NEW.scope_kind = 'room' AND r.room_id <> NEW.room_id))
)
BEGIN SELECT RAISE(ABORT, 'Invalid Peer membership ceiling'); END;
CREATE TRIGGER peer_membership_transition BEFORE UPDATE ON peer_memberships
WHEN NEW.membership_id IS NOT OLD.membership_id OR NEW.peer_id IS NOT OLD.peer_id
  OR NEW.team_id IS NOT OLD.team_id OR NEW.member_id IS NOT OLD.member_id OR NEW.user_id IS NOT OLD.user_id
  OR NEW.scope_kind IS NOT OLD.scope_kind OR NEW.room_id IS NOT OLD.room_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
  OR OLD.state <> 'active' OR NEW.state <> 'revoked' OR NEW.revision <> OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'Peer membership cannot change identity or regain authority'); END;
CREATE TRIGGER peer_membership_no_delete BEFORE DELETE ON peer_memberships
BEGIN SELECT RAISE(ABORT, 'Peer membership history cannot be deleted'); END;
CREATE TRIGGER peer_member_no_promotion BEFORE UPDATE ON team_members
WHEN EXISTS (SELECT 1 FROM peer_memberships p WHERE p.member_id = OLD.member_id)
  AND (NEW.member_id IS NOT OLD.member_id OR NEW.team_id IS NOT OLD.team_id
    OR NEW.user_id IS NOT OLD.user_id OR NEW.role IS NOT OLD.role)
BEGIN SELECT RAISE(ABORT, 'Peer member ceiling is immutable'); END;
CREATE TRIGGER peer_user_no_implicit_membership BEFORE INSERT ON team_members
WHEN EXISTS (SELECT 1 FROM peer_memberships p WHERE p.user_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'Peer user requires a separately authorized association'); END;
CREATE TRIGGER peer_room_ceiling_insert BEFORE INSERT ON room_human_participants
WHEN EXISTS (
  SELECT 1 FROM peer_memberships p WHERE p.member_id = NEW.member_id AND
    (p.state <> 'active' OR NOT EXISTS (SELECT 1 FROM rooms r WHERE r.room_id = NEW.room_id AND r.team_id = p.team_id)
      OR (p.scope_kind = 'room' AND p.room_id <> NEW.room_id))
)
BEGIN SELECT RAISE(ABORT, 'Peer Room ceiling denied'); END;
CREATE TRIGGER peer_room_ceiling_update BEFORE UPDATE ON room_human_participants
WHEN EXISTS (
  SELECT 1 FROM peer_memberships p WHERE p.member_id = NEW.member_id AND
    (p.state <> 'active' OR NOT EXISTS (SELECT 1 FROM rooms r WHERE r.room_id = NEW.room_id AND r.team_id = p.team_id)
      OR (p.scope_kind = 'room' AND p.room_id <> NEW.room_id))
)
BEGIN SELECT RAISE(ABORT, 'Peer Room ceiling denied'); END;
CREATE TRIGGER peer_invitation_transition BEFORE UPDATE ON peer_invitations
WHEN NEW.invitation_id IS NOT OLD.invitation_id OR NEW.invitation_json IS NOT OLD.invitation_json
  OR NEW.invitation_digest IS NOT OLD.invitation_digest OR NEW.secret_hash IS NOT OLD.secret_hash
  OR NEW.issued_by_member_id IS NOT OLD.issued_by_member_id OR NEW.created_at IS NOT OLD.created_at
  OR OLD.state = 'revoked' OR NEW.state = 'open'
  OR (OLD.state = 'claimed' AND (NEW.state <> 'revoked'
    OR NEW.claim_operation_id IS NOT OLD.claim_operation_id OR NEW.claim_digest IS NOT OLD.claim_digest
    OR NEW.claimed_membership_id IS NOT OLD.claimed_membership_id OR NEW.claimed_at IS NOT OLD.claimed_at
    OR NEW.claimed_credential_id IS NOT OLD.claimed_credential_id))
BEGIN SELECT RAISE(ABORT, 'Peer invitation history is immutable'); END;
CREATE TRIGGER peer_invitation_no_delete BEFORE DELETE ON peer_invitations
BEGIN SELECT RAISE(ABORT, 'Peer invitation history cannot be deleted'); END;
CREATE TRIGGER peer_credential_insert BEFORE INSERT ON peer_credentials
WHEN NEW.consumed_at IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM peer_memberships p WHERE p.membership_id = NEW.membership_id AND p.state = 'active'
    AND NEW.expires_at <= p.expires_at
    AND (NEW.scope_kind = 'room' OR p.scope_kind = 'team')
    AND (NEW.room_id IS NULL OR EXISTS (SELECT 1 FROM rooms r WHERE r.room_id = NEW.room_id AND r.team_id = p.team_id))
    AND (p.scope_kind = 'team' OR NEW.room_id = p.room_id)
)
BEGIN SELECT RAISE(ABORT, 'Peer credential ceiling denied'); END;
CREATE TRIGGER peer_credential_transition BEFORE UPDATE ON peer_credentials
WHEN NEW.credential_id IS NOT OLD.credential_id OR NEW.membership_id IS NOT OLD.membership_id
  OR NEW.audience IS NOT OLD.audience OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.scope_kind IS NOT OLD.scope_kind OR NEW.room_id IS NOT OLD.room_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
  OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS NOT OLD.consumed_at)
  OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
BEGIN SELECT RAISE(ABORT, 'Peer credential cannot change identity or regain authority'); END;
CREATE TRIGGER peer_credential_no_delete BEFORE DELETE ON peer_credentials
BEGIN SELECT RAISE(ABORT, 'Peer credential history cannot be deleted'); END;
CREATE TRIGGER peer_web_session_insert BEFORE INSERT ON peer_web_sessions
WHEN NOT EXISTS (
  SELECT 1 FROM peer_credentials c JOIN peer_memberships p ON p.membership_id = c.membership_id
  JOIN web_sessions s ON s.session_id = NEW.session_id AND s.user_id = p.user_id
  WHERE c.credential_id = NEW.credential_id AND c.audience = 'peer.human' AND c.consumed_at IS NOT NULL
    AND c.revoked_at IS NULL AND p.state = 'active' AND s.expires_at <= c.expires_at
)
BEGIN SELECT RAISE(ABORT, 'Peer human session binding denied'); END;
CREATE TRIGGER peer_web_session_immutable BEFORE UPDATE ON peer_web_sessions
BEGIN SELECT RAISE(ABORT, 'Peer human session binding is immutable'); END;
CREATE TRIGGER peer_web_session_mark AFTER INSERT ON peer_web_sessions
BEGIN UPDATE web_sessions SET peer_access_required = 1 WHERE session_id = NEW.session_id; END;
CREATE TRIGGER peer_web_session_marker_immutable BEFORE UPDATE OF peer_access_required ON web_sessions
WHEN OLD.peer_access_required = 1 AND NEW.peer_access_required <> 1
BEGIN SELECT RAISE(ABORT, 'Peer credential ceiling marker is immutable'); END;
