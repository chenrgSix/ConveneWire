import { useEffect, useRef, useState } from "react";
import { captureWebSessionScope, isStaleWebSessionError, jsonRequest } from "../../api-client.js";
import type { Locale } from "../../i18n.js";
import type { LocalSession, Room, Team } from "../../models.js";
import { PanelDialog } from "../navigation/PanelDialog.js";
import { PeerHostControls } from "../team/PeerHostPanel.js";
import { LocalNetworkDialog } from "./LocalNodeNetwork.js";

interface LANStatus { enabled: boolean; ready: boolean; endpoints: {address: string; port: number}[]; error?: string | null; advancedInvitationReady?: boolean }
export function DeviceCollaboration({session, team, rooms, locale, canManage = false}: {
  session: LocalSession; team: Team | null; rooms: Room[]; locale: Locale; canManage?: boolean;
}) {
  const zh = locale === "zh-CN";
  const [open, setOpen] = useState(false), [advanced, setAdvanced] = useState<"network" | "invite" | null>(null);
  const [lan, setLAN] = useState<LANStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(false), inFlight = useRef(false), revision = useRef(0);
  const scope = useRef(captureWebSessionScope());
  const current = () => alive.current && scope.current();
  useEffect(() => {
    alive.current = true;
    async function refresh() {
      if (inFlight.current) return;
      const snapshot = revision.current;
      try { const value = await jsonRequest<LANStatus>("/api/local-node/lan", {}, session.token); if (current() && snapshot === revision.current) setLAN(value); }
      catch (reason) { if (current() && snapshot === revision.current && !isStaleWebSessionError(reason)) setLAN(null); }
    }
    void refresh(); const timer = setInterval(() => void refresh(), 5000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [session.token]);
  async function action(run: () => Promise<void>) {
    if (inFlight.current || !current()) return;
    revision.current++; inFlight.current = true; setBusy(true); setError("");
    try { await run(); }
    catch (reason) { if (current() && !isStaleWebSessionError(reason)) setError(reason instanceof Error ? reason.message : (zh ? "连接操作失败，请重试。" : "Connection failed. Try again.")); }
    finally { inFlight.current = false; if (current()) setBusy(false); }
  }
  const status = lan?.ready ? (zh ? "局域网已开启" : "LAN on") : lan?.enabled ? (zh ? "等待局域网" : "Waiting for LAN") : (zh ? "局域网未开启" : "LAN off");
  return <>
    <button type="button" className="secondary-action device-collaboration-entry" onClick={() => setOpen(true)}>
      <span aria-hidden="true">↔</span> {zh ? "设备与协作" : "Devices & collaboration"}<span className={`lan-indicator ${lan?.ready ? "online" : ""}`} title={status} aria-label={status} />
    </button>
    {open && !advanced && <PanelDialog title={zh ? "设备与协作" : "Devices & collaboration"} locale={locale} onClose={() => setOpen(false)}>
      <div className="device-collaboration">
        <p className="device-collaboration-intro">{zh ? "让同一局域网里的电脑一起工作。连接后，再选择要分享的 Agent。" : "Work together across computers on your local network. Choose which Agents to share after connecting."}</p>
        {error && <p className="error-banner" role="alert">{error}</p>}
        {lan?.error && <p className="error-banner" role="alert">{lan.error}</p>}
        <section className="lan-connection-card">
          <div><h3>{zh ? "局域网连接" : "Local network"}</h3><p role="status">{status}</p>
            <small>{zh ? "安全连接由应用自动配置，无需域名或证书文件。" : "The app configures secure connections. No domain or certificate files needed."}</small></div>
          <button type="button" className={lan?.enabled ? "secondary-action" : "primary-action"} disabled={busy || !lan}
            onClick={() => void action(async () => { const value = await jsonRequest<LANStatus>("/api/local-node/lan", {method: "POST", body: JSON.stringify({enabled: !lan?.enabled})}, session.token); if (current()) setLAN(value); })}>
            {busy ? (zh ? "正在更新…" : "Updating…") : lan?.enabled ? (zh ? "关闭局域网" : "Turn off") : (zh ? "开启局域网" : "Enable LAN")}
          </button>
        </section>
        {!lan && <p role="status">{zh ? "暂时无法读取局域网状态，正在重试。" : "LAN status is unavailable. Retrying."}</p>}
        <section className="lan-connection-card">
          <div><h3>{zh ? "连接其他电脑 / 分享 Agent" : "Connect / share Agents"}</h3><p>{zh ? "粘贴对方的连接码，确认房间后加入；已连接设备和分享也在这里管理。" : "Paste the other computer’s code and review the Room. Manage joined devices and sharing here."}</p></div>
          <button type="button" className="secondary-action" disabled={busy} onClick={() => void action(async () => {
            await jsonRequest("/api/local-node/open-console", {method: "POST", body: JSON.stringify({page: "peers"})}, session.token);
          })}>{zh ? "连接与分享" : "Connect & share"}</button>
        </section>
        {team && canManage ? <PeerHostControls key={`${team.teamId}:${lan?.ready ?? false}`} teamId={team.teamId} teamName={team.name}
          rooms={rooms} locale={locale} sessionToken={session.token} lan canInvite={!!lan?.ready} />
          : <p>{zh ? "选择你管理的团队，即可邀请其他电脑加入房间。" : "Select a Team you manage to invite another computer."}</p>}
        <details className="lan-advanced"><summary>{zh ? "高级网络设置" : "Advanced network settings"}</summary>
          <p>{zh ? "公网 Relay、已有 HTTPS 地址和手工证书。" : "Public Relay, existing HTTPS addresses and manual certificates."}</p>
          <button type="button" className="secondary-action" onClick={() => setAdvanced("network")}>{zh ? "打开高级设置" : "Open advanced settings"}</button>
          {team && canManage && lan?.advancedInvitationReady && <button type="button" className="secondary-action" onClick={() => setAdvanced("invite")}>
            {zh ? "使用高级网络地址邀请" : "Invite via advanced network"}
          </button>}
        </details>
      </div>
    </PanelDialog>}
    {open && advanced === "network" && session.token && <LocalNetworkDialog token={session.token} locale={locale} onClose={() => setAdvanced(null)} />}
    {open && advanced === "invite" && team && canManage && <PanelDialog title={zh ? "高级网络邀请" : "Advanced network invitation"} locale={locale} onClose={() => setAdvanced(null)}>
      <p>{zh ? "使用已配置的 Relay 或 HTTPS 地址。对方沿用已有的连接配置。" : "Use the configured Relay or HTTPS address and the recipient’s existing connection settings."}</p>
      <PeerHostControls teamId={team.teamId} teamName={team.name} rooms={rooms} locale={locale} sessionToken={session.token} canInvite={!!lan?.advancedInvitationReady} />
    </PanelDialog>}
  </>;
}
