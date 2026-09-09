CREATE TABLE local_node_installation (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  node_id TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL REFERENCES web_users(user_id),
  origin TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE local_node_binding (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  credential_envelope TEXT NOT NULL,
  created_at TEXT NOT NULL
);
