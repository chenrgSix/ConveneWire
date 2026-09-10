import { useEffect, useRef, useState } from "react";
import { captureWebSessionScope, isStaleWebSessionError, jsonRequest } from "../../api-client.js";
import type { Locale } from "../../i18n.js";
import type { LocalSession, Team } from "../../models.js";
import { LocalNodeNetwork } from "./LocalNodeNetwork.js";

interface Binding { nodeId: string; teamId: string | null; deviceId: string | null }

export function LocalNodeRuntime({ session, team, teams, locale }: { session: LocalSession; team: Team | null; teams: Team[]; locale: Locale }) {
  const [binding, setBinding] = useState<Binding | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const zh = locale === "zh-CN";
  useEffect(() => {
    generation.current++;
    let stopped = false;
    void jsonRequest<Binding>("/api/local-node", {}, session.token).then((value) => {
      if (!stopped) setBinding(value);
    }).catch((reason: unknown) => { if (!stopped && !isStaleWebSessionError(reason)) setError(zh ? "无法读取本机连接，请重新打开本地空间。" : "Reopen the local workspace to read its Runtime binding."); });
    return () => { stopped = true; generation.current++; };
  }, [session.token, zh]);
  async function open(bindTeam: boolean) {
    if (!binding || busy || (bindTeam && !binding.teamId && !team)) return;
    const sessionCurrent = captureWebSessionScope(), epoch = generation.current;
    const current = () => sessionCurrent() && generation.current === epoch;
    setBusy(true); setError(null);
    try {
      if (bindTeam && !binding.teamId && team) {
        const selected = await jsonRequest<Binding>(`/api/local-node/teams/${team.teamId}/bind`, { method: "POST" }, session.token);
        if (!current()) return;
        setBinding(selected);
      }
      await jsonRequest("/api/local-node/open-console", { method: "POST" }, session.token);
    } catch (reason) {
      if (current() && !isStaleWebSessionError(reason)) setError(reason instanceof Error ? reason.message : String(reason));
    } finally { if (current()) setBusy(false); }
  }
  const boundName = teams.find((candidate) => candidate.teamId === binding?.teamId)?.name ?? (zh ? "已选 Team" : "selected Team");
  return <section className="local-node-runtime" aria-label={zh ? "本地 Runtime" : "Local Runtime"}>
    <div><strong>{zh ? "本地空间" : "Local workspace"}</strong><span>{binding?.teamId
      ? (zh ? `本机 Runtime 已绑定 ${boundName}` : `Local Runtime is bound to ${boundName}`)
      : (zh ? (team ? `将本机 Runtime 连接到 ${team.name}；此版本绑定一个 Team。` : "先配置本机 Agent，再选择要连接的 Team。")
        : (team ? `Connect this computer to ${team.name}. This version binds one Team.` : "Set up local Agents, then choose a Team to connect."))}</span></div>
    {!binding?.teamId && <button type="button" disabled={busy || !binding} onClick={() => void open(false)}>{zh ? "本机 Agent" : "Local Agents"}</button>}
    <button type="button" disabled={busy || !binding || (!binding.teamId && !team)} onClick={() => void open(true)}>
      {busy ? (zh ? "正在打开…" : "Opening…") : binding?.teamId ? (zh ? "本机 Agent" : "Local Agents") : (zh ? "连接本机 Runtime" : "Connect local Runtime")}
    </button>
    <LocalNodeNetwork session={session} locale={locale} />
    {error && <p role="alert">{error}</p>}
  </section>;
}
