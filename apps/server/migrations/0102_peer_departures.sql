-- One immutable Participant departure per membership. This receipt only narrows
-- authority and remains recoverable after business credentials expire/revoke.
CREATE TABLE peer_departures (
  membership_id TEXT PRIMARY KEY REFERENCES peer_memberships(membership_id) ON DELETE RESTRICT,
  participant_node_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  intent_digest TEXT NOT NULL CHECK (length(intent_digest) = 64),
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  UNIQUE (participant_node_id, operation_id)
);
CREATE TRIGGER peer_departure_insert BEFORE INSERT ON peer_departures
WHEN NOT EXISTS (
  SELECT 1 FROM peer_memberships m JOIN peer_bindings b ON b.peer_id = m.peer_id
  WHERE m.membership_id = NEW.membership_id AND m.state = 'revoked'
    AND b.participant_node_id = NEW.participant_node_id
    AND json_extract(NEW.receipt_json, '$.intent.membershipId') = m.membership_id
    AND json_extract(NEW.receipt_json, '$.intent.peerId') = m.peer_id
    AND json_extract(NEW.receipt_json, '$.intent.participant.nodeId') = b.participant_node_id
    AND json_extract(NEW.receipt_json, '$.intent.participant.publicKey') = b.participant_public_key
    AND json_extract(NEW.receipt_json, '$.intent.operationId') = NEW.operation_id
    AND json_extract(NEW.receipt_json, '$.state') = 'revoked')
BEGIN SELECT RAISE(ABORT, 'Peer departure requires the exact revoked membership'); END;
CREATE TRIGGER peer_departure_immutable BEFORE UPDATE ON peer_departures
BEGIN SELECT RAISE(ABORT, 'Peer departure is immutable'); END;
CREATE TRIGGER peer_departure_retained BEFORE DELETE ON peer_departures
BEGIN SELECT RAISE(ABORT, 'Peer departure is retained'); END;
