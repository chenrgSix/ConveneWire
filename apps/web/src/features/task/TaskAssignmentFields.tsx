import type { TaskProjectionAssignment } from "@convene-wire/contracts/task-result";
import type { Locale } from "../../i18n.js";
import type { Agent } from "../../models.js";

export type TaskAssignmentInput = Pick<TaskProjectionAssignment, "agentId" | "role">;

export function TaskAssignmentFields({ agents, value, onChange, disabled = false, locale }: {
  agents: Agent[]; value: TaskAssignmentInput[]; onChange: (value: TaskAssignmentInput[]) => void;
  disabled?: boolean; locale: Locale;
}) {
  const t = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const available = agents.filter((agent) => agent.enabled !== false);
  const rows = [...available.map(({ agentId, name }) => ({ agentId, name, available: true })),
    ...value.filter(({ agentId }) => !available.some((agent) => agent.agentId === agentId))
      .map(({ agentId }) => ({ agentId, name: t("已不可用的 Agent", "Unavailable Agent"), available: false }))];
  return <fieldset disabled={disabled} className="task-assignment-fields">
    <legend>{t("任务 Agent", "Task Agents")}</legend>
    <p>{t("选择参与这个任务的 Agent 和分工。保存只更新指派；发送消息后才会执行。", "Choose this Task's Agents and roles. Saving updates assignments; sending a message starts execution.")}</p>
    {rows.length === 0 && <p>{t("房间暂无可用 Agent，可先创建任务，配置房间 Agent 后再指派。", "No Agents are available in this Room. Create the Task first and assign Agents after configuring the Room.")}</p>}
    {rows.map(({ agentId, name, available: enabled }) => <label key={agentId}>
      <span>{name}</span>
      <select aria-label={t(`任务分工：${name}`, `Task role: ${name}`)} value={value.find((assignment) => assignment.agentId === agentId)?.role ?? ""}
        onChange={(event) => {
          const role = event.target.value as TaskAssignmentInput["role"] | "";
          const next = value.filter((assignment) => assignment.agentId !== agentId)
            .map((assignment) => role === "primary" && assignment.role === "primary" ? { ...assignment, role: "contributor" as const } : assignment);
          onChange(role ? [...next, { agentId, role }] : next);
        }}>
        <option value="">{t("不参与", "Not assigned")}</option>
        <option value="primary" disabled={!enabled}>{t("主负责人", "Primary")}</option>
        <option value="contributor" disabled={!enabled}>{t("参与者", "Contributor")}</option>
        <option value="reviewer" disabled={!enabled}>{t("审阅者", "Reviewer")}</option>
      </select>
    </label>)}
  </fieldset>;
}
