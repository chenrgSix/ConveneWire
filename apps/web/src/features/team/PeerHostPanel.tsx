import { useEffect, useRef, useState } from "react";
import type { PeerAgentAcceptanceRequest, PeerInvitationCreateRequest, PeerInvitationIssued, PeerLANSignedTransport } from "@convene-wire/contracts/peer";
import { captureWebSessionScope, HttpRequestError, isStaleWebSessionError, jsonRequest } from "../../api-client.js";
import type { Locale } from "../../i18n.js";
import type { Room } from "../../models.js";
import { PanelDialog } from "../navigation/PanelDialog.js";
import { LocalNetworkDialog } from "../local-node/LocalNodeNetwork.js";
import { currentPeerAcceptance, peerOperationId, type PeerHostAccess, type PeerHostOffer } from "./peer-host-model.js";

interface Props { teamId: string; teamName: string; rooms: Room[]; locale: Locale; sessionToken?: string | undefined; localNetworkToken?: string | undefined; lan?: boolean; canInvite?: boolean }
type Review = { kind: "accept"; item: PeerHostOffer } | { kind: "revoke-agent"; item: PeerHostOffer } |
  { kind: "revoke-membership"; item: PeerHostAccess["memberships"][number] } |
  { kind: "revoke-invitation"; item: PeerHostAccess["invitations"][number] };

export function PeerHostPanel(props: Props) {
  const [open, setOpen] = useState(false);
  const [networkToken, setNetworkToken] = useState<string | null>(null);
  const title = props.locale === "zh-CN" ? "跨节点协作" : "Node collaboration";
  return <>
    <button type="button" onClick={() => setOpen(true)}>{title}</button>
    {open && <PanelDialog title={title} locale={props.locale} onClose={() => setOpen(false)}>
      <PeerHostControls key={`${props.teamId}:${props.sessionToken ?? "cookie"}`} {...props}
        onOpenNetwork={props.localNetworkToken ? () => { setOpen(false); setNetworkToken(props.localNetworkToken!); } : undefined} />
    </PanelDialog>}
    {networkToken && networkToken === props.localNetworkToken && <LocalNetworkDialog key={networkToken} token={networkToken} locale={props.locale}
      onClose={() => { setNetworkToken(null); setOpen(true); }} />}
  </>;
}

export function PeerHostControls({ teamId, teamName, rooms, locale, sessionToken, onOpenNetwork, lan = false, canInvite = true }: Props & { onOpenNetwork?: (() => void) | undefined }) {
  const zh = locale === "zh-CN";
  const [data, setData] = useState<{ access: PeerHostAccess; offers: PeerHostOffer[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const availableRooms = rooms.filter(room => room.teamId === teamId && !room.archivedAt);
  const [scope, setScope] = useState(availableRooms[0]?.roomId ?? "team");
  const [days, setDays] = useState("7");
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [issued, setIssued] = useState<PeerInvitationIssued | null>(null);
  const [lanTransport, setLANTransport] = useState<PeerLANSignedTransport | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<{ path: string; method: string; body?: unknown } | null>(null);
  const preparing = useRef(false);
  const alive = useRef(true), inFlight = useRef(false), loading = useRef(false);
  const sessionScope = useRef(captureWebSessionScope());
  const heading = useRef<HTMLHeadingElement>(null);
  const current = () => () => alive.current && sessionScope.current();
  const stamp = (value: string) => new Date(value).toLocaleString(locale);
  const roomName = (id: string) => availableRooms.find(room => room.roomId === id)?.name ?? id;
  const scopeName = (scope: { kind: string; roomId?: string | null }) => scope.kind === "room"
    ? `Room: ${scope.roomId ? roomName(scope.roomId) : ""}` : (zh ? "整个 Team" : "Entire Team");
  const fail = (reason: unknown) => reason instanceof HttpRequestError && [403, 409, 410].includes(reason.status)
    ? (zh ? "授权或分享状态已变化，请返回刷新并重新审阅。" : "Access or sharing changed. Refresh and review the current scope.")
    : (zh ? "暂时无法确认操作。可重试同一操作，或刷新查看当前状态。" : "The operation is unconfirmed. Retry the same operation or refresh its current state.");

  async function refresh() {
    if (loading.current || !current()()) return;
    loading.current = true;
    const active = current();
    try {
      const [access, offered] = await Promise.all([
        jsonRequest<PeerHostAccess>(`/api/peer/teams/${teamId}/access`, {}, sessionToken),
        jsonRequest<{ offers: PeerHostOffer[] }>(`/api/peer/teams/${teamId}/agent-offers`, {}, sessionToken)
      ]);
      if (!Array.isArray(access.invitations) || !Array.isArray(access.memberships) || !Array.isArray(offered.offers)) throw new Error("Invalid Host view");
      if (active()) { setData({ access, offers: offered.offers }); setLoadError(null); }
    } catch (reason) {
      if (active() && !isStaleWebSessionError(reason)) {
        setData(null); setLoadError(zh ? "无法读取协作状态，请刷新。" : "Collaboration status is unavailable. Refresh to retry.");
        if (reason instanceof HttpRequestError && [401, 403].includes(reason.status)) { setIssued(null); setCopied(false); }
      }
    } finally { loading.current = false; }
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => { if (!inFlight.current) void refresh(); }, 5000);
    return () => { alive.current = false; clearInterval(timer); };
  }, []);
  useEffect(() => { heading.current?.focus(); }, [inviting, review]);
  useEffect(() => {
    if (!issued) return;
    const timer = setTimeout(() => { setIssued(null); setCopied(false); setNotice(zh ? "本次邀请已过期。" : "This invitation expired."); },
      Math.max(0, Date.parse(issued.invitation.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [issued, zh]);

  async function mutate<T>(operation: NonNullable<typeof pending>): Promise<T | undefined> {
    if (inFlight.current || !data || !current()()) return;
    inFlight.current = true; setBusy(true); setPending(operation); setError(null); setNotice(null);
    const active = current();
    try {
      const result = await jsonRequest<T>(operation.path, { method: operation.method,
        ...(operation.body === undefined ? {} : { body: JSON.stringify(operation.body) }) }, sessionToken);
      if (!active()) return;
      setPending(null);
      return result;
    } catch (reason) {
      if (active() && !isStaleWebSessionError(reason)) setError(fail(reason));
    } finally {
      inFlight.current = false;
      if (active()) setBusy(false);
    }
  }
  const back = () => {
    if (busy) return;
    setInviting(false); setReview(null); setPending(null); setIssued(null); setCopied(false); setError(null); void refresh();
  };
  async function createInvitation() {
    if (!canInvite || !data?.access.invitationSupported || issued || busy || preparing.current || (scope !== "team" && !availableRooms.some(room => room.roomId === scope))) return;
    const time = Date.now();
    const body: PeerInvitationCreateRequest = { schemaVersion: 1, operationId: peerOperationId(),
      scope: scope === "team" ? { kind: "team", teamId, roomId: null } : { kind: "room", teamId, roomId: scope },
      expiresAt: new Date(time + 3600_000).toISOString(), membershipExpiresAt: new Date(time + Number(days) * 86400_000).toISOString() };
    if (lan) {
      preparing.current = true; setBusy(true);
      try { const value = await jsonRequest<PeerLANSignedTransport>("/api/local-node/lan/transport", {}, sessionToken); if (!current()()) return; setLANTransport(value); }
      catch (reason) { if (current()() && !isStaleWebSessionError(reason)) setError(zh ? "局域网连接未就绪，请先开启后重试。" : "Enable LAN before creating a code."); return; }
      finally { preparing.current = false; if (current()()) setBusy(false); }
    }
    const result = await mutate<PeerInvitationIssued>(pending ?? { path: "/api/peer/invitations", method: "POST", body });
    if (result) { setIssued(result); setCopied(false); void refresh(); }
  }
  const connectionCode = issued && lanTransport && lan ? "CWLAN1." + btoa(Array.from(new TextEncoder().encode(JSON.stringify({schemaVersion: 1, kind: "convenewire.lan", issued, lan: lanTransport})), byte => String.fromCharCode(byte)).join("")).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "") : issued ? JSON.stringify(issued) : "";
  async function copyInvitation() {
    if (!issued || Date.parse(issued.invitation.expiresAt) <= Date.now()) return;
    const active = current(), value = connectionCode;
    try { await navigator.clipboard.writeText(value); if (active()) setCopied(true); }
    catch { if (active()) setError(zh ? "无法访问剪贴板，请手动复制下方邀请。" : "Clipboard unavailable. Copy the invitation below manually."); }
  }
  function inspect(value: Review) {
    setReview(value); setInviting(false); setPending(null); setError(null); setNotice(null);
    setSelectedRooms(value.kind === "accept" ? value.item.offer.grant.roomIds.filter(id => availableRooms.some(room => room.roomId === id)) : []);
  }
  const offerAvailable = (item: PeerHostOffer) => item.offer.grant.state === "active" && Date.parse(item.offer.grant.expiresAt) > Date.now() &&
    data?.access.memberships.some(m => m.peerId === item.offer.grant.peerId && m.state === "active" && Date.parse(m.expiresAt) > Date.now());
  const accepted = (item: PeerHostOffer) => Boolean(offerAvailable(item) && currentPeerAcceptance(item));
  const exactOffer = review?.kind === "accept" && data?.offers.some(item => item.offerDigest === review.item.offerDigest &&
    item.grantDigest === review.item.grantDigest && item.offer.grant.peerId === review.item.offer.grant.peerId &&
    item.acceptance?.acceptanceId === review.item.acceptance?.acceptanceId && item.acceptance?.revision === review.item.acceptance?.revision && offerAvailable(item));

  async function confirmReview() {
    if (!review || busy || !data) return;
    let operation = pending;
    if (!operation) {
      if (review.kind === "accept") {
        const [firstRoom, ...remainingRooms] = [...selectedRooms].sort();
        if (!exactOffer || !firstRoom) return;
        const { offer, offerDigest, grantDigest, acceptance } = review.item, g = offer.grant;
        const body: PeerAgentAcceptanceRequest = { schemaVersion: 1, operationId: peerOperationId(), peerId: g.peerId,
          localAgentId: g.localAgentId, exportId: g.exportId, grantRevision: g.revision, grantDigest, offerDigest,
          roomIds: [firstRoom, ...remainingRooms], capabilities: g.capabilities, expiresAt: g.expiresAt,
          expectedAcceptanceId: acceptance?.acceptanceId ?? null, expectedAcceptanceRevision: acceptance?.revision ?? null };
        operation = { path: "/api/peer/agents/accept", method: "POST", body };
      } else if (review.kind === "revoke-agent") {
        const acceptance = review.item.acceptance!;
        operation = { path: "/api/peer/agents/revoke", method: "POST", body: { schemaVersion: 1, operationId: peerOperationId(),
          acceptanceId: acceptance.acceptanceId, expectedRevision: acceptance.revision } };
      } else {
        operation = { path: review.kind === "revoke-membership" ? `/api/peer/memberships/${review.item.membershipId}` :
          `/api/peer/invitations/${review.item.invitation.invitationId}`, method: "DELETE" };
      }
    }
    if (await mutate(operation)) {
      setReview(null); setNotice(zh ? "操作已记录。" : "The decision is recorded."); void refresh();
    }
  }

  const states: Record<string, string> = zh
    ? { open: "待加入", claimed: "已使用", active: "有效", revoked: "已撤销", expired: "已过期" }
    : { open: "Open", claimed: "Claimed", active: "Active", revoked: "Revoked", expired: "Expired" };
  return <div className="peer-host-panel">
    {error && <p className="error-banner" role="alert">{error}</p>}
    {loadError && <p className="error-banner" role="alert">{loadError}</p>}
    {notice && <p role="status">{notice}</p>}
    {(inviting || review) && <button type="button" disabled={busy} onClick={back}>{zh ? "返回协作管理" : "Back to collaboration"}</button>}
    {inviting ? <section>
      <h3 ref={heading} tabIndex={-1}>{zh ? "邀请其他电脑加入房间" : "Invite another computer to a Room"}</h3>
      <p>{zh ? "对方在自己的 ConveneWire App 中审阅邀请并加入。本次邀请一小时内有效，只能使用一次。" : "The recipient reviews and joins in their ConveneWire app. This one-use invitation expires in one hour."}</p>
      {!issued ? <form onSubmit={event => { event.preventDefault(); void createInvitation(); }}>
        <label>{zh ? "访问范围" : "Access scope"}<select value={scope} disabled={busy || !!pending} onChange={event => setScope(event.target.value)}>
          {availableRooms.map(room => <option key={room.roomId} value={room.roomId}>{`Room: ${room.name}`}</option>)}
          <option value="team">{zh ? `整个 Team：${teamName}` : `Entire Team: ${teamName}`}</option>
        </select></label>
        <label>{zh ? "成员访问期限" : "Membership duration"}<select value={days} disabled={busy || !!pending} onChange={event => setDays(event.target.value)}>
          {[1, 7, 30].map(day => <option key={day} value={day}>{zh ? `${day} 天` : `${day} days`}</option>)}
        </select></label>
        <button className="primary-action" type="submit" disabled={busy || !data?.access.invitationSupported}>{busy ? (zh ? "正在创建…" : "Creating…") : pending ? (zh ? "重试同一邀请" : "Retry this invitation") : (zh ? "创建邀请" : "Create invitation")}</button>
      </form> : <>
        <p>{scopeName(issued.invitation.scope)} · {zh ? "成员访问截止" : "Membership until"} {stamp(issued.invitation.membershipExpiresAt)}</p>
        <details className="lan-code"><summary>{zh ? "查看连接码（手动复制）" : "Show connection code"}</summary><textarea aria-label={zh ? "一次性连接码" : "One-use connection code"} readOnly spellCheck={false} rows={5} value={connectionCode} /></details>
        <button className="primary-action" type="button" onClick={() => void copyInvitation()}>{copied ? (zh ? "已复制" : "Copied") : (zh ? "复制连接码" : "Copy connection code")}</button>
        <p>{zh ? "把连接码发给对方，在“设备与协作 → 连接与分享”中粘贴。仅发给被邀请人。" : "Share only with the intended recipient. Revoke it from the invitation list if needed."}</p>
      </>}
    </section> : review ? <section>
      <h3 ref={heading} tabIndex={-1}>{review.kind === "accept" ? (zh ? "审阅远端 Agent 分享" : "Review shared Agent") : (zh ? "确认撤销范围" : "Review revocation")}</h3>
      {review.kind === "accept" || review.kind === "revoke-agent" ? <>
        <strong>{review.item.offer.displayName}</strong><p>{review.item.offer.role}</p>
        <p>{zh ? "来源成员" : "Shared by"}: {data?.access.memberships.find(m => m.peerId === review.item.offer.grant.peerId)?.displayName}</p>
        <p>{zh ? "有效期至" : "Expires"}: {stamp(review.item.offer.grant.expiresAt)}</p>
        {review.kind === "accept" ? <>
          <fieldset disabled={busy || !!pending}><legend>{zh ? "允许使用的 Room" : "Allowed Rooms"}</legend>
            {review.item.offer.grant.roomIds.filter(id => availableRooms.some(room => room.roomId === id)).map(id =>
              <label className="peer-room-choice" key={id}><input type="checkbox" checked={selectedRooms.includes(id)} onChange={event =>
                setSelectedRooms(previous => event.target.checked ? [...previous, id] : previous.filter(value => value !== id))} />{roomName(id)}</label>)}
          </fieldset>
          <p>{zh ? "接纳后可在选定 Room 中派发任务。执行和临时权限仍由对方本机策略控制。" : "Acceptance enables tasks in the selected Rooms. The participant's local policy still controls execution and temporary permissions."}</p>
          {!exactOffer && !pending && <p role="status">{zh ? "分享已变化或不可用，请返回刷新。" : "This offer changed or is unavailable. Go back and refresh."}</p>}
        </> : <p>{zh ? "撤销后，此 Agent 无法再接收本 Team 的新任务。已启动的执行仍需等待停止确认。" : "Revocation stops new tasks for this Agent. A running process still needs a confirmed stop."}</p>}
      </> : review.kind === "revoke-membership" ? <>
        <strong>{review.item.displayName}</strong><p>{scopeName(review.item.scope)}</p>
        <p>{zh ? "撤销该成员在此范围的访问，并停止接受其 Agent 的新执行。" : "Revoke this member's access in this scope and new execution by their Agents."}</p>
      </> : <p>{scopeName(review.item.invitation.scope)} · {zh ? "此邀请将无法再用于加入。" : "This invitation will no longer permit joining."}</p>}
      <button type="button" disabled={busy || !data || (!pending && review.kind === "accept" && (!exactOffer || selectedRooms.length === 0))} onClick={() => void confirmReview()}>
        {busy ? (zh ? "正在提交…" : "Submitting…") : pending ? (zh ? "重试同一操作" : "Retry this operation") : review.kind === "accept" ? (zh ? "接纳此 Agent" : "Accept Agent") : (zh ? "确认撤销" : "Revoke access")}
      </button>
    </section> : <>
      <div className="panel-header"><h3>{teamName}</h3><button type="button" disabled={busy} onClick={() => void refresh()}>{zh ? "刷新" : "Refresh"}</button></div>
      {!data ? (!loadError && <p role="status">{zh ? "正在读取协作状态…" : "Loading collaboration status…"}</p>) : <>
        {!lan && <p className="peer-host-origin">{data.access.hostOrigin}</p>}
        {(!canInvite || !data.access.invitationSupported) && <><p role="status">{zh ? lan ? "开启局域网连接后，即可邀请其他电脑。" : "网络接入尚未就绪，请检查高级网络设置。" : "Enable network access to invite another computer."}</p>
          {onOpenNetwork && <button className="secondary-action" type="button" onClick={onOpenNetwork}>{zh ? "打开网络设置" : "Open network settings"}</button>}</>}
        <button className="primary-action" type="button" disabled={!canInvite || !data.access.invitationSupported} onClick={() => { setInviting(true); setIssued(null); setPending(null); setNotice(null); }}>{zh ? "邀请其他电脑" : "Invite another computer"}</button>
        <section><h3>{zh ? "远端成员" : "Remote members"}</h3>
          {data.access.memberships.length === 0 && <p>{zh ? "还没有通过节点邀请加入的成员。" : "No members have joined through a Node invitation."}</p>}
          {data.access.memberships.map(item => <article className="peer-access-row" key={item.membershipId}>
            <div><strong>{item.displayName}</strong><p>{scopeName(item.scope)} · {states[item.state]}</p><small>{stamp(item.expiresAt)}</small></div>
            <button type="button" disabled={item.state === "revoked"} onClick={() => inspect({ kind: "revoke-membership", item })}>{zh ? "撤销成员访问" : "Revoke membership"}</button>
          </article>)}
        </section>
        <section><h3>{zh ? "收到的 Agent 分享" : "Shared Agents"}</h3>
          {data.offers.length === 0 && <p>{zh ? "对方在本机分享 Agent 后，会显示在这里。" : "Agents appear here after the participant shares them locally."}</p>}
          {data.offers.map(item => <article className="peer-access-row" key={`${item.offer.grant.peerId}:${item.offer.grant.localAgentId}`}>
            <div><strong>{item.offer.displayName}</strong><p>{item.offer.role} · {accepted(item) ? (zh ? "已接纳" : "Accepted") : offerAvailable(item) ? (zh ? "待审阅" : "Awaiting review") : (zh ? "分享不可用" : "Unavailable")}</p></div>
            <div className="peer-access-actions">
              <button type="button" disabled={!offerAvailable(item) || accepted(item)} onClick={() => inspect({ kind: "accept", item })}>{zh ? "审阅并接纳" : "Review and accept"}</button>
              {item.acceptance?.state === "active" && <button type="button" onClick={() => inspect({ kind: "revoke-agent", item })}>{zh ? "撤销接纳" : "Revoke acceptance"}</button>}
            </div>
          </article>)}
        </section>
        <section><h3>{zh ? "邀请记录" : "Invitations"}</h3>
          {data.access.invitations.length === 0 && <p>{zh ? "尚未创建节点邀请。" : "No Node invitations yet."}</p>}
          {data.access.invitations.map(item => <article className="peer-access-row" key={item.invitation.invitationId}>
            <div><strong>{scopeName(item.invitation.scope)}</strong><p>{states[item.state]} · {stamp(item.invitation.expiresAt)}</p></div>
            {item.state === "open" && <button type="button" onClick={() => inspect({ kind: "revoke-invitation", item })}>{zh ? "撤销邀请" : "Revoke invitation"}</button>}
          </article>)}
        </section>
      </>}
    </>}
  </div>;
}
