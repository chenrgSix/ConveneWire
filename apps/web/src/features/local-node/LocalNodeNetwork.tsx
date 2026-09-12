import { useEffect, useRef, useState } from "react";
import { captureWebSessionScope, isStaleWebSessionError, jsonRequest, webSessionExpiredEvent } from "../../api-client.js";
import type { Locale } from "../../i18n.js";
import type { LocalSession } from "../../models.js";
import { PanelDialog } from "../navigation/PanelDialog.js";
import { RelayNetworkDialog } from "./RelayNetworkDialog.js";

interface Configuration { enabled: boolean; origin: string; listenHost: string; certificateFingerprint: string | null; certificateExpiresAt: string | null }
interface NetworkState { revisionDigest: string; running: Configuration | null; saved: Configuration | null; pending: (Configuration & {reviewDigest: string}) | null }
interface Selection { enabled: boolean; origin: string; listenHost: string; certificatePem: string; privateKeyPem: string }
interface Review extends Configuration { revisionDigest: string; reviewDigest: string }
interface Save { revisionDigest: string; reviewDigest: string; selection: Selection }

export function LocalNodeNetwork({session, locale}: {session: LocalSession; locale: Locale}) {
  const [openToken, setOpenToken] = useState<string | null>(null);
  return <><button className="secondary-action" type="button" disabled={!session.token} onClick={() => setOpenToken(session.token ?? null)}>{locale === "zh-CN" ? "网络设置" : "Network settings"}</button>
    {openToken && openToken === session.token && <LocalNetworkDialog key={openToken} token={openToken} locale={locale} onClose={() => setOpenToken(null)} />}</>;
}

export function LocalNetworkDialog({token, locale, onClose}: {token: string; locale: Locale; onClose: () => void}) {
  const [advanced, setAdvanced] = useState(false);
  return advanced ? <DirectNetworkDialog token={token} locale={locale} onClose={onClose} onBack={() => setAdvanced(false)} />
    : <RelayNetworkDialog token={token} locale={locale} onClose={onClose} onAdvanced={() => setAdvanced(true)} />;
}

function DirectNetworkDialog({token, locale, onClose, onBack}: {token: string; locale: Locale; onClose: () => void; onBack: () => void}) {
  const zh = locale === "zh-CN", text = (cn: string, en: string) => zh ? cn : en;
  const [state, setState] = useState<NetworkState | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [readError, setReadError] = useState(""), [message, setMessage] = useState("");
  const [enabled, setEnabled] = useState(false), [origin, setOrigin] = useState(""), [listenHost, setListenHost] = useState("127.0.0.1");
  const [review, setReview] = useState<{view: Review; input: Save} | null>(null), [submitted, setSubmitted] = useState(false);
  const [discard, setDiscard] = useState<NetworkState | null>(null);
  const certificate = useRef<HTMLInputElement>(null), key = useRef<HTMLInputElement>(null);
  const lifetime = useRef<object | null>(null), mutating = useRef(false), reading = useRef<object | null>(null), initialized = useRef(false);
  const retired = useRef(false);
  const currentScope = () => { const scope = captureWebSessionScope(), epoch = lifetime.current; return () => !retired.current && epoch !== null && lifetime.current === epoch && scope(); };
  function clearFiles() { if (certificate.current) certificate.current.value = ""; if (key.current) key.current.value = ""; }
  function close() { retired.current = true; lifetime.current = null; clearFiles(); setReview(null); onClose(); }
  async function refresh() {
    if (reading.current || retired.current) return;
    const current = currentScope(), read = {}; reading.current = read;
    try {
      const value = await jsonRequest<NetworkState>("/api/local-node/network", {}, token);
      if (!current()) return;
      setState(value); setReadError("");
      if (!initialized.current) {
        initialized.current = true; const initial = value.saved ?? value.running;
        if (initial) { setEnabled(initial.enabled); setOrigin(initial.origin); setListenHost(initial.listenHost); }
      }
    } catch (reason) {
      if (!current()) return;
      setState(null);
      if (!isStaleWebSessionError(reason)) setReadError(text("无法读取当前网络配置，请刷新或重新打开本地空间。", "Refresh or reopen the local workspace to read current network settings."));
    } finally { if (reading.current === read) reading.current = null; }
  }
  useEffect(() => {
    const epoch = {}; lifetime.current = epoch; retired.current = false;
    void refresh(); const timer = setInterval(() => void refresh(), 5000);
    window.addEventListener(webSessionExpiredEvent, close);
    return () => { lifetime.current = null; reading.current = null; clearInterval(timer); clearFiles(); window.removeEventListener(webSessionExpiredEvent, close); };
  }, [token]);
  const freshReview = Boolean(review && state?.revisionDigest === review.input.revisionDigest &&
    (!review.view.enabled || (review.view.certificateExpiresAt && Date.parse(review.view.certificateExpiresAt) > Date.now())));
  async function prepare() {
    if (!state || mutating.current) return;
    const current = currentScope(), revisionDigest = state.revisionDigest;
    const cert = certificate.current?.files?.[0], privateKey = key.current?.files?.[0];
    const fields = {enabled, origin, listenHost};
    mutating.current = true; setBusy(true); setError(""); setMessage("");
    try {
      if (enabled && (!cert || !privateKey || cert.size > 64 * 1024 || privateKey.size > 16 * 1024)) throw new Error(text("请选择 PEM 证书链（最多 64 KB）和未加密私钥（最多 16 KB）。", "Select a PEM certificate chain (up to 64 KB) and an unencrypted private key (up to 16 KB)."));
      const [certificatePem, privateKeyPem] = enabled ? await Promise.all([cert!.text(), privateKey!.text()]) : ["", ""];
      if (!current()) return;
      const selection = {...fields, certificatePem: certificatePem!, privateKeyPem: privateKeyPem!};
      const view = await jsonRequest<Review>("/api/local-node/network/review", {method: "POST", body: JSON.stringify({revisionDigest, selection})}, token);
      if (!current()) return;
      if (view.revisionDigest !== revisionDigest || view.enabled !== selection.enabled || view.origin !== selection.origin || view.listenHost !== selection.listenHost) throw new Error(text("返回的范围与本次选择不一致，请重新审阅。", "Returned scope differs from your selection; review again."));
      setReview({view, input: {revisionDigest, reviewDigest: view.reviewDigest, selection}}); setSubmitted(false); clearFiles();
    } catch (reason) { if (current() && !isStaleWebSessionError(reason)) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (current()) { mutating.current = false; setBusy(false); } }
  }
  async function save() {
    if (!review || mutating.current || (!submitted && !freshReview)) return;
    const current = currentScope(), input = review.input;
    mutating.current = true; setBusy(true); setSubmitted(true); setError("");
    try {
      const result = await jsonRequest<{status: string; reviewDigest: string}>("/api/local-node/network/save", {method: "POST", body: JSON.stringify(input)}, token);
      if (!current()) return;
      if (result.status !== "pending" || result.reviewDigest !== input.reviewDigest) throw new Error(text("保存结果尚未确认。", "Save result is unconfirmed."));
      setReview(null); setSubmitted(false); clearFiles(); setMessage(text("已保存为待生效配置。退出并重新打开本机 Node 后应用；当前连接继续使用原配置。", "Saved for the next startup. Quit and reopen this Node to apply; current connections keep their configuration."));
    } catch (reason) { if (current() && !isStaleWebSessionError(reason)) setError(text("保存结果尚未确认。可重试原操作，或查看待生效配置；不会自动重启。", "Save is unconfirmed. Retry the original operation or inspect pending settings; the Node will not restart automatically.")); }
    finally { if (current()) { mutating.current = false; setBusy(false); await refresh(); } }
  }
  async function discardPending() {
    if (!discard?.pending || !state || state.revisionDigest !== discard.revisionDigest || mutating.current) return;
    const current = currentScope(); mutating.current = true; setBusy(true); setError("");
    try {
      await jsonRequest("/api/local-node/network/discard", {method: "POST", body: JSON.stringify({revisionDigest: discard.revisionDigest})}, token);
      if (current()) { setDiscard(null); setMessage(text("已取消待生效配置。", "Pending settings discarded.")); }
    } catch (reason) { if (current() && !isStaleWebSessionError(reason)) setError(text("取消结果尚未确认，请刷新查看当前待生效配置。", "Discard is unconfirmed; refresh to inspect current pending settings.")); }
    finally { if (current()) { mutating.current = false; setBusy(false); await refresh(); } }
  }
  const summary = (value: Configuration | null) => value ? <dl className="local-network-details">
    <dt>{text("接入", "Access")}</dt><dd>{value.enabled ? text("启用 HTTPS", "HTTPS enabled") : text("关闭外部接入", "External access disabled")}</dd>
    <dt>{text("HTTPS 地址", "HTTPS origin")}</dt><dd>{value.origin}</dd><dt>{text("监听地址", "Listen address")}</dt><dd>{value.listenHost}</dd>
    {value.certificateFingerprint && <><dt>{text("证书 SHA-256", "Certificate SHA-256")}</dt><dd>{value.certificateFingerprint}</dd><dt>{text("证书有效至", "Certificate expires")}</dt><dd>{new Date(value.certificateExpiresAt!).toLocaleString()}</dd></>}
  </dl> : <p>{text("未配置外部接入。", "External access is not configured.")}</p>;
  return <PanelDialog title={text("本机网络设置", "Local network settings")} locale={locale} onClose={close} error={error || readError} focusKey={review ? "review" : discard ? "discard" : "settings"}>
    <div className="local-network-panel">
      <button className="secondary-action" type="button" disabled={busy} onClick={onBack}>{text("返回便捷接入", "Back to convenient access")}</button>
      <h3>{text("手动 HTTPS 接入", "Manual HTTPS access")}</h3>
      <p>{text("让受邀成员通过 HTTPS 访问本机托管的空间。本机 Owner 和控制接口只在回环地址开放。", "Invite members over HTTPS to spaces hosted here. Local Owner and control endpoints remain on loopback.")}</p>
      <section><h3>{text("正在使用", "Currently running")}</h3>{state ? summary(state.running) : <p>{text("正在读取或暂不可用。", "Loading or unavailable.")}</p>}</section>
      {state?.pending && <section><h3>{text("等待重启生效", "Pending next startup")}</h3>{summary(state.pending)}
        {!review && !discard && <button type="button" disabled={busy} onClick={() => { setDiscard(state); setError(""); }}>{text("取消待生效配置…", "Discard pending settings…")}</button>}</section>}
      <p role="status">{message}</p>
      {review ? <section><h3>{text("确认下次启动配置", "Review next startup")}</h3>{summary(review.view)}
        {!submitted && !freshReview && <p role="alert">{text("配置或证书有效期已变化，请返回重新审阅。", "Configuration or certificate validity changed; review again.")}</p>}
        <p>{review.view.enabled ? text("保存后，下次启动才会应用。请确认目标设备能够访问该地址，并已信任证书。", "Changes apply on next startup. Verify that intended devices can reach this origin and trust its certificate.")
          : text("下次启动将关闭此 HTTPS 入口；已有邀请和成员关系不会自动撤销。", "The next startup disables this HTTPS entry; existing invitations and memberships are not automatically revoked.")}</p>
        <div className="local-network-actions">{!submitted && <button type="button" disabled={busy} onClick={() => { setReview(null); setError(""); }}>{text("返回重新选择", "Back to selection")}</button>}
          <button type="button" disabled={busy || (!submitted && !freshReview)} onClick={() => void save()}>{submitted ? text("重试原保存操作", "Retry original save") : text("保存，重启后生效", "Save for next startup")}</button></div>
      </section> : discard ? <section><h3>{text("取消以上待生效配置", "Discard the pending settings above")}</h3>
        <p>{text("当前正在使用的配置继续保留。", "The currently running configuration remains in place.")}</p>
        {discard.revisionDigest !== state?.revisionDigest && <p role="alert">{text("记录已变化，请返回查看当前状态。", "Settings changed; return to inspect current state.")}</p>}
        <div className="local-network-actions"><button type="button" disabled={busy} onClick={() => setDiscard(null)}>{text("返回", "Back")}</button><button type="button" disabled={busy || discard.revisionDigest !== state?.revisionDigest} onClick={() => void discardPending()}>{text("确认取消待生效配置", "Confirm discard")}</button></div>
      </section> : <form onSubmit={event => { event.preventDefault(); void prepare(); }}>
        <h3>{text("准备下次启动配置", "Prepare next startup")}</h3>
        <fieldset disabled={busy || !state}>
          <label className="local-network-toggle"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />{text("启用外部 HTTPS 接入", "Enable external HTTPS access")}</label>
          <label>{text("HTTPS 地址", "HTTPS origin")}<input type="url" required maxLength={2048} value={origin} readOnly={Boolean(state?.saved || state?.running)} onChange={event => setOrigin(event.target.value)} placeholder="https://node.example:9443" /></label>
          <label>{text("监听 IP 地址", "Listen IP address")}<input required maxLength={64} value={listenHost} onChange={event => setListenHost(event.target.value)} /></label>
          <p>{text("127.0.0.1 仅限本机；0.0.0.0 监听所有 IPv4 网卡。已有 HTTPS 地址的变更需先按停机流程处理原有邀请和成员关系。", "127.0.0.1 is local only; 0.0.0.0 listens on all IPv4 interfaces. Changing an existing HTTPS origin requires the stopped procedure for prior invitations and memberships.")}</p>
          {enabled && <><label>{text("PEM 证书链（最多 64 KB）", "PEM certificate chain (up to 64 KB)")}<input ref={certificate} type="file" accept=".pem,.crt" /></label>
            <label>{text("未加密 PEM 私钥（最多 16 KB）", "Unencrypted PEM private key (up to 16 KB)")}<input ref={key} type="file" accept=".pem,.key" /></label></>}
          <p>{text("文件只提交给当前本机 Node。这里不会安装 CA 信任或更改 DNS、防火墙与 NAT；私有 CA 的浏览器信任需另行配置。", "Files go only to this local Node. This does not install CA trust or change DNS, firewall or NAT; browser trust for a private CA requires separate setup.")}</p>
          <button type="submit">{text("验证并审阅配置", "Validate and review")}</button>
        </fieldset>
      </form>}
      <button type="button" disabled={busy} onClick={() => void refresh()}>{text("刷新当前状态", "Refresh current state")}</button>
    </div>
  </PanelDialog>;
}
