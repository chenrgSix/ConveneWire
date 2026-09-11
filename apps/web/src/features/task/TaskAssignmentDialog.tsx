import { useEffect, useRef, useState, type FormEvent } from "react";
import type { TaskProjection } from "@convene-wire/contracts/task-result";
import { captureWebSessionScope, HttpRequestError, jsonRequest } from "../../api-client.js";
import { createClientMessageId } from "../../message-outbox.js";
import type { Locale } from "../../i18n.js";
import type { Agent, Member } from "../../models.js";
import { PanelDialog } from "../navigation/PanelDialog.js";
import { TaskAssignmentFields, type TaskAssignmentInput } from "./TaskAssignmentFields.js";

export function TaskAssignmentDialog({ taskId, roomId, token, member, agents, locale, onClose, onChanged }: {
  taskId: string; roomId: string; token: string | undefined; member: Member | null; agents: Agent[]; locale: Locale;
  onClose: () => void; onChanged: () => void | Promise<void>;
}) {
  const [task, setTask] = useState<TaskProjection | null>(null);
  const [value, setValue] = useState<TaskAssignmentInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const pending = useRef<{ body: string } | null>(null);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const t = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController(); request.current = controller;
    const validSession = captureWebSessionScope();
    void jsonRequest<TaskProjection>(`/api/tasks/${taskId}`, { signal: controller.signal }, token).then((fresh) => {
      if (!mounted.current || controller.signal.aborted || !validSession()) return;
      if (fresh.taskId !== taskId || fresh.roomId !== roomId || fresh.isDefault) throw new Error("Task identity changed");
      setTask(fresh); setValue(fresh.assignments.map(({ agentId, role }) => ({ agentId, role })));
    }).catch(() => {
      if (mounted.current && !controller.signal.aborted && validSession()) setError(t("无法读取当前任务，请关闭后重新打开。", "Cannot load this Task. Close and reopen."));
    }).finally(() => { if (request.current === controller) request.current = null; });
    return () => { mounted.current = false; request.current?.abort(); };
  }, [taskId, roomId, token]);
  const canEdit = Boolean(task && member && (member.role === "owner" || member.memberId === task.ownerMemberId));
  async function save(event: FormEvent) {
    event.preventDefault(); event.stopPropagation();
    if (!task || !canEdit || request.current) return;
    const controller = new AbortController(); request.current = controller;
    const validSession = captureWebSessionScope();
    const valid = () => mounted.current && !controller.signal.aborted && validSession();
    const body = pending.current?.body ?? JSON.stringify({
      operationId: `op_${createClientMessageId()}`, expectedTaskRevision: task.taskRevision,
      title: task.title, goal: task.goal, ownerMemberId: task.ownerMemberId,
      completionPolicy: task.completionPolicy, priority: task.priority, dueAt: task.dueAt,
      criteria: task.criteria, budgetPolicy: task.budgetPolicy, assignments: value
    });
    pending.current = { body }; setBusy(true); setError(null);
    try {
      const saved = await jsonRequest<TaskProjection>(`/api/tasks/${taskId}/definition`, { method: "PUT", body, signal: controller.signal }, token);
      if (!valid()) return;
      pending.current = null; setRetry(false);
      setTask(saved);
      try { await onChanged(); } catch {
        if (valid()) setError(t("分工已保存，但页面刷新失败。请关闭后刷新任务。", "Assignments saved, but refresh failed. Close and refresh the Task."));
        return;
      }
      if (valid()) onClose();
    } catch (reason) {
      if (!valid()) return;
      const uncertain = !(reason instanceof HttpRequestError) || reason.status >= 500;
      setRetry(uncertain);
      if (!uncertain) pending.current = null;
      setError(uncertain
        ? t("保存结果尚未确认，可重试同一次保存；请勿更换分工后重复提交。", "Save is unconfirmed. Retry the same save before changing assignments.")
        : t("未能保存。任务版本、房间 Agent 或权限可能已变化，请关闭后重新检查。", "Save failed. Task revision, Room Agents or permissions may have changed. Close and review again."));
    } finally { if (request.current === controller) request.current = null; if (valid()) setBusy(false); }
  }
  return <PanelDialog title={t("配置任务 Agent", "Configure Task Agents")} locale={locale} error={error} onClose={() => { if (!busy) onClose(); }}>
    {!task && !error && <p>{t("正在读取任务…", "Loading Task…")}</p>}
    {task && <form onSubmit={(event) => void save(event)}>
      <p>{task.title}</p>
      {!canEdit && <p>{t("只有任务负责人或团队所有者可以调整分工。", "Only the Task Owner or Team Owner can change assignments.")}</p>}
      <TaskAssignmentFields agents={agents} value={value} onChange={setValue} disabled={busy || retry || !canEdit} locale={locale} />
      <div className="modal-actions"><button className="secondary-action" type="button" disabled={busy} onClick={onClose}>{t("取消", "Cancel")}</button>
        <button className="primary-action" type="submit" disabled={busy || !canEdit}>{busy ? t("保存中…", "Saving…") : retry ? t("重试同一次保存", "Retry same save") : t("保存分工", "Save assignments")}</button></div>
    </form>}
  </PanelDialog>;
}
