import { type FormEvent, useState } from "react";

import { integrationLabel, presenceHelp, presenceLabel, roleLabel } from "../agent/AgentWorkspace.js";
import { AgentModelLabel, agentModelLabel } from "../agent/AgentModelLabel.js";
import { type Locale, type TranslationKey, translate } from "../../i18n.js";
import type {
  Agent,
  Member,
  Room,
  RoomCollaborationPolicy
} from "../../models.js";

interface RoomSettingsDialogProps {
  agents: Agent[];
  busy: boolean;
  currentMemberId: string | null;
  locale: Locale;
  members: Member[];
  participantAgentIds: string[];
  participantMemberIds: string[];
  policy: RoomCollaborationPolicy;
  room: Room;
  joinedAgentIds: string[];
  joinedMemberIds: string[];
  onClose: () => void;
  onPolicyChange: (policy: RoomCollaborationPolicy) => void;
  onSubmit: (event: FormEvent) => void | Promise<void>;
  onToggleAgent: (agentId: string) => void;
  onToggleMember: (memberId: string) => void;
}

export function RoomSettingsDialog({
  agents,
  busy,
  currentMemberId,
  joinedAgentIds,
  joinedMemberIds,
  locale,
  members,
  onClose,
  onPolicyChange,
  onSubmit,
  onToggleAgent,
  onToggleMember,
  participantAgentIds,
  participantMemberIds,
  policy,
  room
}: RoomSettingsDialogProps) {
  const t = (key: TranslationKey) => translate(locale, key);
  const zh = locale === "zh-CN";
  const [search, setSearch] = useState("");
  const [joinedOnly, setJoinedOnly] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState("");
  const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase(locale);
  const query = normalize(search);
  const matches = (...values: string[]) => values.some((value) => normalize(value).includes(query));
  const memberById = new Map(members.map((member) => [member.memberId, member]));
  const identities = [
    ...members.map((member) => ({ id: member.memberId, name: member.displayName })),
    ...agents.map((agent) => ({ id: agent.agentId, name: agent.name }))
  ];
  const duplicateId = (id: string, name: string) => {
    const others = identities.filter((item) => item.id !== id && normalize(item.name) === normalize(name));
    if (others.length === 0) return "";
    let length = 6;
    while (length < id.length && others.some((item) => item.id.endsWith(id.slice(-length)))) length += 1;
    return `#${id.slice(-length)}`;
  };
  const ownerLabel = (agent: Agent) => {
    const owner = memberById.get(agent.ownerMemberId ?? "");
    return owner
      ? [owner.displayName, duplicateId(owner.memberId, owner.displayName)].filter(Boolean).join(" ")
      : (zh ? "所属成员未知" : "Unknown owner");
  };
  const visibleMembers = members.filter((member) =>
    (!joinedOnly || joinedMemberIds.includes(member.memberId)) &&
    matches(member.displayName, member.memberId, member.role === "owner" ? t("teamOwner") : t("teamMember"))
  );
  const visibleAgents = agents.filter((agent) =>
    (!joinedOnly || joinedAgentIds.includes(agent.agentId)) &&
    matches(agent.name, agent.agentId, agent.role, roleLabel(agent.role, locale), ownerLabel(agent), integrationLabel(agent.integrationMode, locale), agent.configuredModel ?? "")
  );
  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section aria-labelledby="room-settings-dialog-title" aria-modal="true" className="modal-card participant-modal" role="dialog">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{room.name}</p>
            <h3 id="room-settings-dialog-title">{t("roomSettings")}</h3>
          </div>
          <button aria-label={t("cancel")} onClick={onClose} type="button">×</button>
        </div>
        <p>{t("roomSettingsHelp")}</p>
        <form className="modal-form" onSubmit={(event) => void onSubmit(event)}>
          <fieldset className="room-policy-editor">
            <legend>{locale === "zh-CN" ? "Agent 协作" : "Agent collaboration"}</legend>
            <div className="room-policy-options">
              <label className="room-policy-switch">
                <input checked={policy.allowDiscussion} onChange={(event) => onPolicyChange({ ...policy, allowDiscussion: event.target.checked })} type="checkbox" />
                <span>
                  <strong>{locale === "zh-CN" ? "允许多 Agent 讨论" : "Allow multi-Agent Discussions"}</strong>
                  <small>{locale === "zh-CN"
                    ? "开启后，多 Agent 提及进入有轮次和结论的讨论；关闭后只并行回复一次。"
                    : "When on, multi-Agent mentions start a governed Discussion; when off, each Agent replies once."}</small>
                </span>
              </label>
              <label className="room-policy-switch">
                <input checked={policy.allowAll} onChange={(event) => onPolicyChange({ ...policy, allowAll: event.target.checked })} type="checkbox" />
                <span>
                  <strong>{locale === "zh-CN" ? "允许 @all" : "Allow @all"}</strong>
                  <small>{locale === "zh-CN"
                    ? "允许成员用精确 @all 指令选择当前房间全部已启用 Agent。"
                    : "Let members use the exact @all command for every enabled Agent in this Room."}</small>
                </span>
              </label>
              <label className="room-policy-switch">
                <input checked={policy.allowAgentMentions} onChange={(event) => onPolicyChange({ ...policy, allowAgentMentions: event.target.checked })} type="checkbox" />
                <span>
                  <strong>{locale === "zh-CN" ? "允许 Agent 互相点名" : "Allow Agent-to-Agent mentions"}</strong>
                  <small>{locale === "zh-CN"
                    ? "Agent 回复中的完整名称 @指令可触发受限接力；模糊名称不会路由。"
                    : "Exact full-name @ commands in Agent replies can trigger bounded handoffs; fuzzy names never route."}</small>
                </span>
              </label>
            </div>
            <label className="room-policy-depth">
              <span>
                <strong>{locale === "zh-CN" ? "最大接力深度" : "Maximum handoff depth"}</strong>
                <small>{locale === "zh-CN" ? "限制 Agent 连续互相点名的层数" : "Limits chained Agent-to-Agent mentions"}</small>
              </span>
              <select
                aria-label={locale === "zh-CN" ? "最大接力深度" : "Maximum handoff depth"}
                disabled={!policy.allowAgentMentions}
                onChange={(event) => onPolicyChange({
                  ...policy,
                  maxAgentMentionDepth: Number(event.target.value)
                })}
                value={policy.maxAgentMentionDepth}
              >
                {[1, 2, 3, 4].map((depth) => (
                  <option key={depth} value={depth}>{depth}</option>
                ))}
              </select>
            </label>
          </fieldset>
          <div className="participant-search">
            <input
              aria-label={zh ? "搜索成员、角色、所属成员或模型" : "Search name, role, owner or model"}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
              placeholder={zh ? "搜索名称、角色、所属成员、模型或编号" : "Search name, role, owner, model or ID"}
              type="search"
              value={search}
            />
            <label><input checked={joinedOnly} onChange={(event) => setJoinedOnly(event.target.checked)} type="checkbox" />{zh ? "仅看已加入" : "Already in Room only"}</label>
          </div>
          <p className="participant-selection-summary" role="status">{zh
            ? `已选 ${participantMemberIds.length} 位成员 · ${participantAgentIds.length} 个 Agent · 保存后生效`
            : `${participantMemberIds.length} members · ${participantAgentIds.length} Agents selected · applied on save`}</p>
          {selectionNotice && <p className="participant-selection-notice" role="status">{selectionNotice}</p>}
          <fieldset className="participant-editor-group">
            <legend>{t("teamMembers")}</legend>
            <div className="participant-editor-list">
              {visibleMembers.map((member) => (
                <label className="participant-choice" key={member.memberId}>
                  <input checked={participantMemberIds.includes(member.memberId)} disabled={busy || member.role === "owner"} onChange={() => { setSelectionNotice(""); onToggleMember(member.memberId); }} type="checkbox" />
                  <span aria-hidden="true" className="participant-avatar human">{Array.from(member.displayName)[0]?.toUpperCase()}</span>
                  <span className="participant-choice-copy">
                    <span className="participant-choice-heading"><strong title={member.displayName}>{member.displayName}</strong>
                      {member.memberId === currentMemberId && <small className="participant-badge">{zh ? "我" : "You"}</small>}
                      {duplicateId(member.memberId, member.displayName) && <small title={member.memberId}>{duplicateId(member.memberId, member.displayName)}</small>}
                      {joinedMemberIds.includes(member.memberId) && <small className="participant-badge">{zh ? "已加入房间" : "In Room"}</small>}
                    </span>
                    <small>{member.role === "owner" ? t("teamOwner") : t("teamMember")} · {zh ? "名下 Agent" : "Agents owned"}：{agents.filter((agent) => agent.ownerMemberId === member.memberId).length}</small>
                    {member.role === "owner" && <small>{zh ? "团队所有者必须保留在房间内" : "Team owners must remain in the Room"}</small>}
                  </span>
                </label>
              ))}
            </div>
            {visibleMembers.length === 0 && <p>{zh ? "没有符合条件的成员" : "No matching members"}</p>}
          </fieldset>
          <fieldset className="participant-editor-group">
            <legend>{t("teamAgents")} · {locale === "zh-CN" ? "单独启用" : "Per-Agent access"}</legend>
            <p>{locale === "zh-CN" ? "添加 Agent 时默认同时勾选它的主人。只邀请 Agent 时，可在上方取消该成员；移除 Agent 不会自动移除成员。" : "Adding an Agent also selects its owner by default. Deselect that person above for Agent-only access. Removing an Agent does not remove its owner."}</p>
            <div className="participant-editor-list">
              {visibleAgents.map((agent) => (
                <label className="participant-choice" key={agent.agentId}>
                  <input
                    aria-label={`${agent.name} · ${roleLabel(agent.role, locale)} · ${ownerLabel(agent)} ${duplicateId(agent.agentId, agent.name)} · ${agentModelLabel(agent, locale)}`.trim()}
                    aria-describedby={`participant-agent-${agent.agentId}`}
                    checked={participantAgentIds.includes(agent.agentId)}
                    disabled={busy || (agent.enabled === false && !participantAgentIds.includes(agent.agentId))}
                    onChange={() => {
                      const owner = memberById.get(agent.ownerMemberId ?? "");
                      const selectsOwner = !participantAgentIds.includes(agent.agentId) && owner && !participantMemberIds.includes(owner.memberId);
                      setSelectionNotice(selectsOwner
                        ? (zh ? `已同时选择所属成员「${ownerLabel(agent)}」，可在成员列表单独取消。` : `Also selected owner “${ownerLabel(agent)}”; you can deselect that member separately.`)
                        : "");
                      onToggleAgent(agent.agentId);
                    }}
                    type="checkbox"
                  />
                  <span aria-hidden="true" className="participant-avatar agent">AI</span>
                  <span className="participant-choice-copy">
                    <span className="participant-choice-heading"><strong title={agent.name}>{agent.name}</strong>
                      {duplicateId(agent.agentId, agent.name) && <small title={agent.agentId}>{duplicateId(agent.agentId, agent.name)}</small>}
                      <small className="participant-badge" title={presenceHelp(agent, locale)}>{agent.enabled === false ? (zh ? "已停用" : "Disabled") : presenceLabel(agent.presence, locale)}</small>
                      {joinedAgentIds.includes(agent.agentId) && <small className="participant-badge">{zh ? "已加入房间" : "In Room"}</small>}
                    </span>
                    <small>{roleLabel(agent.role, locale)}</small>
                    <AgentModelLabel agent={agent} locale={locale} />
                    <small>{zh ? "所属" : "Owner"}：{ownerLabel(agent)} · {integrationLabel(agent.integrationMode, locale)}</small>
                    <small id={`participant-agent-${agent.agentId}`}>{agent.enabled === false
                      ? (zh ? "已停用，不能新增；已选项可取消" : "Disabled; cannot be added, but can be deselected")
                      : agent.presence === "offline" ? (zh ? "当前离线，仍可加入房间" : "Offline; can still join the Room") : presenceHelp(agent, locale)}</small>
                  </span>
                </label>
              ))}
            </div>
            {visibleAgents.length === 0 && <p>{zh ? "没有符合条件的 Agent" : "No matching Agents"}</p>}
          </fieldset>
          <div className="modal-actions">
            <button className="secondary-action" onClick={onClose} type="button">{t("cancel")}</button>
            <button className="primary-action" disabled={busy}>{busy ? t("saving") : t("save")}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
