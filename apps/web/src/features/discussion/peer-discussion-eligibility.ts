import type { Locale } from "../../i18n.js";
import type { Agent } from "../../models.js";

/** Presentation preflight only; the Host still checks current bilateral authority. */
export function peerDiscussionProblem(agents: Agent[], locale: Locale): string | null {
  const peers = agents.filter(agent => agent.integrationMode === "peer");
  if (!peers.length) return null;
  if (agents.some(agent => agent.capabilities?.ownerPrivateOutput === true)) return locale === "zh-CN"
    ? "跨节点讨论不能与私密输出 Agent 一起运行，请调整参与者。"
    : "Peer Discussion cannot include private-output Agents. Update the participants.";
  if (peers.some(agent => agent.enabled === false || agent.deviceId ||
    agent.capabilities?.supportsStart !== true || agent.capabilities?.supportsTaskContextIsolation !== true ||
    agent.runtimePolicy?.deviceTrust || agent.runtimePolicy?.centralApproval)) return locale === "zh-CN"
    ? "所选远端 Agent 尚不满足跨节点讨论条件，请查看分享状态后重新选择。"
    : "A selected Peer Agent cannot participate in Discussion. Review sharing and select the participants again.";
  return null;
}
