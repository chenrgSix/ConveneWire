-- Source conversation metadata and credentials remain in native private storage.
CREATE TABLE desktop_handoffs (
  task_id TEXT PRIMARY KEY REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
  adoption_id TEXT NOT NULL UNIQUE,
  scope_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('attached', 'released'))
) STRICT;
