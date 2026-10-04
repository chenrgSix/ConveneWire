import { useEffect, useRef, type FormEvent } from "react";

import { type Locale, type TranslationKey, translate } from "../../i18n.js";
import type { Agent, AgentTask, AgentTaskState, Room } from "../../models.js";
import { appendCriteriaTemplate, parseTaskCriteria } from "./task-criteria.js";
import { TaskAssignmentFields, type TaskAssignmentInput } from "./TaskAssignmentFields.js";

const taskStateLabels: Record<AgentTaskState, { "zh-CN": string; en: string }> = {
  open: { "zh-CN": "待开始", en: "Ready to start" },
  working: { "zh-CN": "执行中", en: "Working" },
  blocked: { "zh-CN": "已阻塞", en: "Blocked" },
  review: { "zh-CN": "审核中", en: "In review" },
  completed: { "zh-CN": "已完成", en: "Completed" },
  canceled: { "zh-CN": "已取消", en: "Canceled" }
};

interface TaskSelectorProps {
  locale: Locale;
  selectedTask: AgentTask | null;
  selectedTaskId: string | null;
  tasks: AgentTask[];
  onCreate: () => void;
  onConfigureAgents?: () => void;
  onSelect: (taskId: string) => void;
}

export function TaskSelector({
  locale,
  onCreate,
  onConfigureAgents,
  onSelect,
  selectedTask,
  selectedTaskId,
  tasks
}: TaskSelectorProps) {
  return (
    <div className="task-context">
      <label>
        <span>{locale === "zh-CN" ? "当前任务" : "Current Task"}</span>
        <select
          aria-label={locale === "zh-CN" ? "当前任务" : "Current Task"}
          onChange={(event) => onSelect(event.target.value)}
          value={selectedTaskId ?? ""}
        >
          {tasks.map((task) => (
            <option key={task.taskId} value={task.taskId}>
              {task.isDefault && task.title === "Room work"
                ? (locale === "zh-CN" ? "默认对话" : "General conversation") : task.title}
              {task.isDefault ? "" : ` · ${taskStateLabels[task.state][locale]}`}
            </option>
          ))}
        </select>
      </label>
      {selectedTask && !selectedTask.isDefault && (
        <span className={`task-state ${selectedTask.state}`}>
          {taskStateLabels[selectedTask.state][locale]}
        </span>
      )}
      <button onClick={onCreate} type="button">
        {locale === "zh-CN" ? "+ 新任务" : "+ New Task"}
      </button>
      {selectedTask && !selectedTask.isDefault && onConfigureAgents && <button onClick={onConfigureAgents} type="button">
        {locale === "zh-CN" ? "任务 Agent" : "Task Agents"}
      </button>}
    </div>
  );
}

interface TaskCreateDialogProps {
  busy: boolean;
  criteria?: string;
  goal: string;
  locale: Locale;
  roomName: string;
  roomId?: string;
  rooms?: Room[];
  onRoomChange?: (roomId: string) => void;
  agentsLoading?: boolean;
  agentsError?: boolean;
  onRetryAgents?: () => void;
  error?: string | null;
  title: string;
  onClose: () => void;
  onCriteriaChange?: (value: string) => void;
  onGoalChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void | Promise<void>;
  onTitleChange: (value: string) => void;
  agents?: Agent[];
  assignments?: TaskAssignmentInput[];
  onAssignmentsChange?: (value: TaskAssignmentInput[]) => void;
}

export function TaskCreateDialog({
  busy,
  criteria = "",
  goal,
  locale,
  onClose,
  onCriteriaChange,
  onGoalChange,
  onSubmit,
  onTitleChange,
  roomName,
  roomId, rooms = [], onRoomChange,
  agentsLoading = false, agentsError = false, onRetryAgents, error,
  title,
  agents = [], assignments = [], onAssignmentsChange
}: TaskCreateDialogProps) {
  const t = (key: TranslationKey) => translate(locale, key);
  const returnFocus = useRef(typeof document === "undefined" ? null : document.activeElement);
  useEffect(() => () => {
    const previous = returnFocus.current;
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
  }, []);
  let criteriaError: string | null = null;
  try { parseTaskCriteria(criteria, locale); } catch (reason) {
    criteriaError = reason instanceof Error ? reason.message : String(reason);
  }
  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) onClose();
    }}>
      <section
        aria-labelledby="new-task-dialog-title"
        aria-modal="true"
        className="modal-card"
        role="dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onClose();
          }
          if (event.key !== "Tab") return;
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex]"
          )).filter((element) => element.tabIndex >= 0 && !element.closest("[hidden]") &&
            (!element.closest("details:not([open])") || element.tagName === "SUMMARY"));
          const first = focusable[0];
          const last = focusable.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{roomName}</p>
            <h3 id="new-task-dialog-title">
              {locale === "zh-CN" ? "新建任务" : "New task"}
            </h3>
          </div>
          <button aria-label={t("cancel")} disabled={busy} onClick={onClose} type="button">×</button>
        </div>
        <p>
          {locale === "zh-CN"
            ? "写下要完成的工作。相关对话、执行进度和成果会集中保存在这个任务中。"
            : "Describe the work to complete. Conversations, progress, and results stay together in this task."}
        </p>
        <form className="modal-form" onSubmit={(event) => {
          if (busy || agentsLoading || agentsError || criteriaError) { event.preventDefault(); return; }
          void onSubmit(event);
        }}>
          {onRoomChange && <>
            <label htmlFor="new-task-room">{locale === "zh-CN" ? "所属房间" : "Room"}</label>
            <select disabled={busy} id="new-task-room" onChange={(event) => onRoomChange(event.target.value)} required value={roomId ?? ""}>
              {rooms.map((room) => <option key={room.roomId} value={room.roomId}>{room.name}</option>)}
            </select>
          </>}
          <label htmlFor="new-task-title">
            {locale === "zh-CN" ? "任务名称" : "Task title"}
          </label>
          <input
            autoComplete="off"
            autoFocus
            disabled={busy}
            id="new-task-title"
            maxLength={160}
            onChange={(event) => onTitleChange(event.target.value)}
            required
            value={title}
          />
          <label htmlFor="new-task-goal">
            {locale === "zh-CN" ? "任务目标" : "Task goal"}
          </label>
          <textarea
            disabled={busy}
            id="new-task-goal"
            maxLength={20_000}
            onChange={(event) => onGoalChange(event.target.value)}
            required
            rows={4}
            value={goal}
          />
          {agentsLoading && <p role="status">{locale === "zh-CN" ? "正在加载该房间的 Agent…" : "Loading Agents in this Room…"}</p>}
          {agentsError && <p role="alert">{locale === "zh-CN" ? "无法加载房间 Agent。请重试后创建。" : "Could not load Room Agents. Retry before creating."} <button disabled={busy} onClick={onRetryAgents} type="button">{locale === "zh-CN" ? "重试" : "Retry"}</button></p>}
          {onAssignmentsChange && !agentsLoading && !agentsError && <TaskAssignmentFields agents={agents} value={assignments} onChange={onAssignmentsChange} disabled={busy} locale={locale} />}
          {onCriteriaChange && <details className="task-delivery-options">
            <summary>{locale === "zh-CN" ? "交付要求（可选）" : "Delivery requirements (optional)"}</summary>
            <p>{locale === "zh-CN"
              ? "每行一条可核验的验收标准；创建后会随任务传给 Agent。填写标准不会自动完成任务。"
              : "One verifiable acceptance criterion per line, shared with the Agent. Criteria never automatically complete the Task."}</p>
            <div className="task-criteria-templates">
              <button disabled={busy} onClick={() => onCriteriaChange(appendCriteriaTemplate(criteria, locale === "zh-CN" ? [
                "结论回答任务目标，并说明适用范围。", "关键结论附有可核查的来源或证据。", "明确列出不确定性、风险和建议的下一步。"
              ] : [
                "The conclusion answers the goal and states its scope.", "Key findings include verifiable sources or evidence.", "Uncertainty, risks, and recommended next steps are explicit."
              ]))} type="button">{locale === "zh-CN" ? "+ 调研分析标准" : "+ Research criteria"}</button>
              <button disabled={busy} onClick={() => onCriteriaChange(appendCriteriaTemplate(criteria, locale === "zh-CN" ? [
                "交付内容覆盖任务目标，说明变更范围。", "提供验证步骤、结果和可核查的成果证据。", "明确列出未验证事项、已知限制和使用说明。"
              ] : [
                "The deliverable covers the goal and describes its change scope.", "Verification steps, results, and inspectable evidence are included.", "Untested areas, known limitations, and usage instructions are explicit."
              ]))} type="button">{locale === "zh-CN" ? "+ 实现验证标准" : "+ Delivery criteria"}</button>
            </div>
            <label htmlFor="new-task-criteria">{locale === "zh-CN" ? "验收标准" : "Acceptance criteria"}</label>
            <textarea aria-describedby="new-task-criteria-help" aria-invalid={criteriaError !== null} disabled={busy} id="new-task-criteria" onChange={(event) => onCriteriaChange(event.target.value)} rows={4} value={criteria} />
            <small id="new-task-criteria-help">{locale === "zh-CN" ? "最多 100 条，每条最多 2,000 字符。参考标准只会追加，不会覆盖已有内容。" : "Up to 100 criteria, 2,000 characters each. Templates append without replacing your text."}</small>
            {criteriaError && <p role="alert">{criteriaError}</p>}
          </details>}
          {error && <p role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="secondary-action" disabled={busy} onClick={onClose} type="button">{t("cancel")}</button>
            <button className="primary-action" disabled={busy || agentsLoading || agentsError || !title.trim() || !goal.trim() || criteriaError !== null}>
              {busy
                ? (locale === "zh-CN" ? "创建中…" : "Creating…")
                : (locale === "zh-CN" ? "创建并切换" : "Create and switch")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
