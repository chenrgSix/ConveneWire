CREATE TABLE conversation_development_requests (
  source_run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE RESTRICT,
  source_task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
  source_definition_revision INTEGER NOT NULL,
  source_criteria_revision INTEGER NOT NULL,
  reply_sequence INTEGER NOT NULL,
  proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
  operation_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending', 'started', 'blocked', 'canceled', 'settled')),
  reason TEXT NOT NULL,
  reserved_attempts INTEGER NOT NULL DEFAULT 0 CHECK (reserved_attempts >= 0),
  reserved_seconds INTEGER NOT NULL DEFAULT 0 CHECK (reserved_seconds >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX conversation_development_pending ON conversation_development_requests(state, created_at);
CREATE INDEX conversation_development_source_task ON conversation_development_requests(source_task_id);

CREATE TRIGGER conversation_development_immutable
BEFORE UPDATE ON conversation_development_requests
WHEN NEW.source_run_id IS NOT OLD.source_run_id OR NEW.source_task_id IS NOT OLD.source_task_id
  OR NEW.source_definition_revision IS NOT OLD.source_definition_revision
  OR NEW.source_criteria_revision IS NOT OLD.source_criteria_revision
  OR NEW.reply_sequence IS NOT OLD.reply_sequence OR NEW.proposal_json IS NOT OLD.proposal_json
  OR NEW.operation_id IS NOT OLD.operation_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'conversation development source is immutable');
END;

CREATE TRIGGER conversation_development_no_delete
BEFORE DELETE ON conversation_development_requests
BEGIN
  SELECT RAISE(ABORT, 'conversation development history cannot be deleted');
END;

-- A concurrent ordinary Run must not spend capacity reserved by a continuation.
CREATE TRIGGER conversation_development_reserve_budget
BEFORE INSERT ON runs
WHEN EXISTS (
  SELECT 1 FROM agent_tasks t
  WHERE t.task_id = NEW.task_id AND EXISTS (
    SELECT 1 FROM conversation_development_requests c WHERE c.source_task_id = t.task_id
  ) AND (
    t.budget_run_attempts + (SELECT coalesce(sum(reserved_attempts), 0)
      FROM conversation_development_requests WHERE source_task_id = t.task_id)
      >= t.max_run_attempts
    OR t.budget_execution_duration_seconds + (SELECT coalesce(sum(reserved_seconds), 0)
      FROM conversation_development_requests WHERE source_task_id = t.task_id)
      >= t.max_execution_duration_seconds
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Task budget is reserved for conversation development');
END;
