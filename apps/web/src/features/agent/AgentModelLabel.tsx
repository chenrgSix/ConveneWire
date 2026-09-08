import type { Locale } from "../../i18n.js";
import type { Agent } from "../../models.js";

export function agentModelLabel(agent: Agent, locale: Locale): string {
  if (!agent.configuredModel?.trim()) return locale === "zh-CN" ? "模型：未上报" : "Model: not reported";
  const stale = agent.integrationMode === "managed" && agent.presence === "offline";
  const label = locale === "zh-CN"
    ? (stale ? "上次上报模型" : "配置模型")
    : (stale ? "Last reported model" : "Configured model");
  return `${label}${locale === "zh-CN" ? "：" : ": "}${agent.configuredModel}`;
}

export function AgentModelLabel({ agent, locale, showUpdatedAt = false }: { agent: Agent; locale: Locale; showUpdatedAt?: boolean }) {
  const time = agent.modelReportedAt ? Date.parse(agent.modelReportedAt) : NaN;
  const title = Number.isFinite(time)
    ? `${locale === "zh-CN" ? "模型信息更新于" : "Model information updated at"} ${new Date(time).toLocaleString(locale)}`
    : undefined;
  const label = agentModelLabel(agent, locale);
  return <><small className="agent-model-label" title={title ? `${label} · ${title}` : label}>{label}</small>
    {showUpdatedAt && title && <small className="agent-model-label">{title}</small>}</>;
}
