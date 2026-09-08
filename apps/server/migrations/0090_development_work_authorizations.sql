CREATE TABLE development_work_authorizations (
  operation_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(team_id) ON DELETE RESTRICT,
  room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE RESTRICT,
  initiator_member_id TEXT NOT NULL REFERENCES team_members(member_id) ON DELETE RESTRICT,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE RESTRICT,
  agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
  root_task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
  task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
  plan_id TEXT NOT NULL UNIQUE REFERENCES execution_plans(plan_id) ON DELETE RESTRICT,
  plan_revision INTEGER NOT NULL CHECK (plan_revision > 0),
  command_digest TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  receipt_json TEXT CHECK (receipt_json IS NULL OR json_valid(receipt_json)),
  state TEXT NOT NULL CHECK (state IN ('pending', 'authorized', 'denied', 'expired', 'canceled')),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX development_work_pending_device
  ON development_work_authorizations(device_id, state, created_at);

CREATE TRIGGER development_work_immutable_request
BEFORE UPDATE ON development_work_authorizations
WHEN NEW.operation_id IS NOT OLD.operation_id OR NEW.team_id IS NOT OLD.team_id
  OR NEW.room_id IS NOT OLD.room_id OR NEW.initiator_member_id IS NOT OLD.initiator_member_id
  OR NEW.device_id IS NOT OLD.device_id OR NEW.agent_id IS NOT OLD.agent_id
  OR NEW.root_task_id IS NOT OLD.root_task_id OR NEW.task_id IS NOT OLD.task_id
  OR NEW.plan_id IS NOT OLD.plan_id OR NEW.plan_revision IS NOT OLD.plan_revision
  OR NEW.command_digest IS NOT OLD.command_digest OR NEW.request_digest IS NOT OLD.request_digest
  OR NEW.request_json IS NOT OLD.request_json OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'development work request is immutable');
END;

CREATE TRIGGER development_work_terminal_receipt
BEFORE UPDATE ON development_work_authorizations
WHEN OLD.state <> 'pending' AND (
  NEW.state IS NOT OLD.state OR NEW.reason IS NOT OLD.reason OR NEW.receipt_json IS NOT OLD.receipt_json
)
BEGIN
  SELECT RAISE(ABORT, 'development work receipt is immutable');
END;

CREATE TRIGGER development_work_no_delete
BEFORE DELETE ON development_work_authorizations
BEGIN
  SELECT RAISE(ABORT, 'development work authority cannot be deleted');
END;
