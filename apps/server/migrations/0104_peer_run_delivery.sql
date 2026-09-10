-- Host delivery identity is durable before content can leave the Node.
-- Tokens are reproducible from the installation signer and never stored here.
CREATE TABLE peer_run_deliveries (
  run_id TEXT PRIMARY KEY REFERENCES peer_run_requests(run_id) ON DELETE RESTRICT,
  capability_id TEXT NOT NULL UNIQUE,
  capability_json TEXT NOT NULL CHECK (json_valid(capability_json)),
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
  receipt_digest TEXT NOT NULL CHECK (length(receipt_digest) = 64),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (julianday(expires_at) > julianday(created_at) AND julianday(expires_at) <= julianday(created_at) + 7),
  CHECK (json_extract(capability_json, '$.token') IS NULL),
  CHECK (json_extract(capability_json, '$.audience') = 'peer.settlement'),
  CHECK (json_extract(capability_json, '$.capabilityId') = capability_id),
  CHECK (json_extract(capability_json, '$.issuedAt') = created_at),
  CHECK (json_extract(capability_json, '$.expiresAt') = expires_at)
);
CREATE TRIGGER peer_run_delivery_binding BEFORE INSERT ON peer_run_deliveries
WHEN NOT EXISTS (
  SELECT 1 FROM peer_run_requests r WHERE r.run_id = NEW.run_id
    AND json_extract(NEW.capability_json, '$.binding') = json_extract(r.request_json, '$.binding')
)
BEGIN SELECT RAISE(ABORT, 'Peer delivery requires its exact retained execution'); END;
CREATE TRIGGER peer_run_delivery_immutable BEFORE UPDATE ON peer_run_deliveries
BEGIN SELECT RAISE(ABORT, 'Peer delivery is immutable'); END;
CREATE TRIGGER peer_run_delivery_retained BEFORE DELETE ON peer_run_deliveries
BEGIN SELECT RAISE(ABORT, 'Peer delivery is retained'); END;

-- Original event digests support exact retries. Only sanitized projections in
-- run_events/messages contain text; this ledger contains no raw Runtime output.
CREATE TABLE peer_run_events (
  run_id TEXT NOT NULL REFERENCES peer_run_deliveries(run_id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
  event_digest TEXT NOT NULL CHECK (length(event_digest) = 64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, sequence)
);
CREATE TRIGGER peer_run_event_immutable BEFORE UPDATE ON peer_run_events
BEGIN SELECT RAISE(ABORT, 'Peer event identity is immutable'); END;
CREATE TRIGGER peer_run_event_retained BEFORE DELETE ON peer_run_events
BEGIN SELECT RAISE(ABORT, 'Peer event identity is retained'); END;

CREATE TABLE peer_run_settlements (
  run_id TEXT PRIMARY KEY REFERENCES peer_run_deliveries(run_id) ON DELETE RESTRICT,
  settlement_json TEXT NOT NULL CHECK (json_valid(settlement_json)),
  settlement_digest TEXT NOT NULL CHECK (length(settlement_digest) = 64),
  created_at TEXT NOT NULL,
  CHECK (json_extract(settlement_json, '$.sequence') = 1),
  CHECK (json_extract(settlement_json, '$.state') IN ('completed', 'failed', 'canceled', 'expired', 'outcome_unknown', 'delivery_denied'))
);
CREATE TRIGGER peer_run_settlement_binding BEFORE INSERT ON peer_run_settlements
WHEN NOT EXISTS (
  SELECT 1 FROM peer_run_deliveries d WHERE d.run_id = NEW.run_id
    AND json_extract(NEW.settlement_json, '$.capabilityId') = d.capability_id
    AND json_extract(NEW.settlement_json, '$.receiptDigest') = d.receipt_digest
)
BEGIN SELECT RAISE(ABORT, 'Peer settlement requires its exact delivery receipt'); END;
CREATE TRIGGER peer_run_settlement_immutable BEFORE UPDATE ON peer_run_settlements
BEGIN SELECT RAISE(ABORT, 'Peer settlement is immutable'); END;
CREATE TRIGGER peer_run_settlement_retained BEFORE DELETE ON peer_run_settlements
BEGIN SELECT RAISE(ABORT, 'Peer settlement is retained'); END;

-- Cancellation narrows authority immediately; a possibly delivered execution
-- becomes outcome_unknown after the acknowledgment deadline, never not-started.
CREATE TABLE peer_run_cancellations (
  run_id TEXT PRIMARY KEY REFERENCES peer_run_requests(run_id) ON DELETE RESTRICT,
  requested_by_member_id TEXT REFERENCES team_members(member_id) ON DELETE RESTRICT,
  cause TEXT NOT NULL CHECK (cause IN ('requester', 'authorization_lost', 'deadline')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 512),
  created_at TEXT NOT NULL,
  ack_deadline_at TEXT NOT NULL,
  CHECK (ack_deadline_at > created_at),
  CHECK ((cause = 'requester' AND requested_by_member_id IS NOT NULL) OR
    (cause <> 'requester' AND requested_by_member_id IS NULL))
);
CREATE TRIGGER peer_run_cancellation_immutable BEFORE UPDATE ON peer_run_cancellations
BEGIN SELECT RAISE(ABORT, 'Peer cancellation is immutable'); END;
CREATE TRIGGER peer_run_cancellation_retained BEFORE DELETE ON peer_run_cancellations
BEGIN SELECT RAISE(ABORT, 'Peer cancellation is retained'); END;
