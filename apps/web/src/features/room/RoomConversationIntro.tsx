import { useId, useState } from "react";

import type { Locale } from "../../i18n.js";
import type { Agent } from "../../models.js";
import { AgentSetupChoices, type AgentSetupTarget } from "../agent/AgentSetupChoices.js";

type ConversationReadiness =
  | { kind: "loading" | "empty" | "unassigned" | "unavailable" }
  | { kind: "ready" | "demo"; agent: Agent };

export function conversationReadiness(
  roomAgents: Agent[],
  assignedAgentIds: string[] | undefined,
  loaded: boolean
): ConversationReadiness {
  if (!loaded) return { kind: "loading" };
  if (roomAgents.length === 0) return { kind: "empty" };
  if (assignedAgentIds?.length === 0) return { kind: "unassigned" };
  const candidates = roomAgents.filter((agent) => agent.enabled !== false &&
    agent.presence === "ready" && (!assignedAgentIds || assignedAgentIds.includes(agent.agentId)));
  const realAgent = candidates.find((agent) => agent.integrationMode !== "fake");
  if (realAgent) return { kind: "ready", agent: realAgent };
  if (candidates[0]) return { kind: "demo", agent: candidates[0] };
  return { kind: "unavailable" };
}

interface RoomConversationIntroProps {
  assignedAgentIds?: string[] | undefined;
  canManageRoom: boolean;
  empty: boolean;
  hasTeamAgents: boolean;
  loaded: boolean;
  localNode: boolean;
  locale: Locale;
  onAssignAgents: () => void;
  onChooseSetup: (target: AgentSetupTarget) => void;
  onManageAgents: () => void;
  onManageRoom: () => void;
  onSelectAgent: (agent: Agent) => void;
  roomAgents: Agent[];
  taskTitle?: string | undefined;
}

export function RoomConversationIntro(props: RoomConversationIntroProps) {
  const { empty, locale, roomAgents, assignedAgentIds, loaded, taskTitle } = props;
  const zh = locale === "zh-CN";
  const readiness = conversationReadiness(roomAgents, assignedAgentIds, loaded);
  const [setupOpen, setSetupOpen] = useState(false);
  const setupId = useId();
  const hasExistingAgents = props.hasTeamAgents && props.canManageRoom;
  const text = {
    loading: zh ? "正在检查房间的 Agent 状态…" : "Checking this Room’s Agents…",
    empty: zh
      ? "房间还没有 Agent。可以先聊天，也可以添加 Agent 参与。"
      : "No Agents have joined this Room. You can chat now, or add an Agent.",
    unassigned: zh
      ? "此任务还未指派 Agent。可以先记录需求，再选择参与的 Agent。"
      : "No Agents are assigned to this Task. You can record your request, then choose who should help.",
    unavailable: assignedAgentIds
      ? (zh ? "此任务的 Agent 暂未就绪。可以继续聊天，或查看 Agent 状态。" : "This Task’s Agents are not ready. You can keep chatting or check their status.")
      : (zh ? "房间里的 Agent 暂未就绪。可以继续聊天，或查看 Agent 状态。" : "This Room’s Agents are not ready. You can keep chatting or check their status."),
    demo: zh ? "当前可用的是演示 Agent，只模拟回复，不调用真实模型。" : "A demo Agent is available. Its replies are simulated, with no real model calls.",
    ready: zh ? "Agent 已就绪。输入 @ 选择回复对象，或直接发送消息与成员聊天。" : "Agents are ready. Use @ to ask one to reply, or send a message to chat with members."
  }[readiness.kind];
  const label = {
    loading: "",
    empty: hasExistingAgents ? (zh ? "选择房间 Agent" : "Choose Room Agents") : (zh ? "添加 Agent" : "Add an Agent"),
    unassigned: zh ? "指派任务 Agent" : "Assign Task Agents",
    unavailable: zh ? "查看 Agent 状态" : "Check Agent status",
    demo: zh ? "试用演示 Agent" : "Try the demo Agent",
    ready: zh ? "选择 Agent 提问" : "Ask an Agent"
  }[readiness.kind];
  function act() {
    if (readiness.kind === "empty") {
      if (hasExistingAgents) props.onManageRoom();
      else setSetupOpen((open) => !open);
    } else if (readiness.kind === "unassigned") props.onAssignAgents();
    else if (readiness.kind === "unavailable") props.onManageAgents();
    else if (readiness.kind === "ready" || readiness.kind === "demo") props.onSelectAgent(readiness.agent);
  }
  const guide = <>
    <div className="conversation-readiness" role="status">
      <p>{text}</p>
      {readiness.kind !== "loading" && <button
        aria-controls={readiness.kind === "empty" && !hasExistingAgents ? setupId : undefined}
        aria-expanded={readiness.kind === "empty" && !hasExistingAgents ? setupOpen : undefined}
        onClick={act}
        type="button"
      >{label}</button>}
    </div>
    {readiness.kind === "empty" && setupOpen && !hasExistingAgents && <div className="conversation-setup" id={setupId}>
      <AgentSetupChoices currentMemberIsOwner={props.canManageRoom} localNode={props.localNode}
        locale={locale} onSelect={props.onChooseSetup} />
    </div>}
  </>;
  return empty ? <section className="empty-stage room-onboarding conversation-intro">
    <h3>{taskTitle ?? (zh ? "开始对话" : "Start a conversation")}</h3>
    <p>{taskTitle
      ? (zh ? "在下方写下需求，这个任务的对话会独立保存。" : "Describe what you need below. This Task keeps its own conversation.")
      : (zh ? "在下方发送第一条消息。" : "Send your first message below.")}</p>
    {guide}
  </section> : <div className="first-reply-guide conversation-guide">{guide}</div>;
}
