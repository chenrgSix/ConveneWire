import { useEffect, useRef, useState } from "react";
import { captureWebSessionScope, HttpRequestError, isStaleWebSessionError, jsonRequest, webSessionExpiredEvent } from "../../api-client.js";
import type { Locale } from "../../i18n.js";
import { PanelDialog } from "../navigation/PanelDialog.js";

export interface RelayProvider {
  id: string; displayName: string; relayOrigin: string; nodeDomain: string; acmeDirectoryUrl: string; termsUrl: string;
}
export interface RelayNetworkState {
  revisionDigest: string;
  termsAcceptanceRequired?: boolean;
  provider: RelayProvider | null;
  saved: { enabled: boolean; origin: string | null };
  running: { state: "disabled" | "connecting" | "issuing_certificate" | "ready" | "retrying" | "unavailable";
    origin: string | null; errorCode: string | null; certificateExpiresAt: string | null };
  pending: { enabled: boolean; origin: string; reviewDigest: string } | null;
}
interface Selection { revisionDigest: string; enabled: boolean; termsAccepted: boolean }
interface Review { revisionDigest: string; reviewDigest: string; enabled: boolean; origin: string; provider: RelayProvider }
interface Save extends Selection { reviewDigest: string }

function httpsURL(value: string, originOnly = false): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!originOnly || url.origin === value);
  } catch { return false; }
}
function sameProvider(left: RelayProvider | null, right: RelayProvider | null): boolean {
  return Boolean(left && right && (["id", "displayName", "relayOrigin", "nodeDomain", "acmeDirectoryUrl", "termsUrl"] as const)
    .every(key => left[key] === right[key]));
}

export function RelayNetworkDialog({ token, locale, onClose, onAdvanced }: {
  token: string; locale: Locale; onClose: () => void; onAdvanced: () => void;
}) {
  const zh = locale === "zh-CN", text = (cn: string, en: string) => zh ? cn : en;
  const [state, setState] = useState<RelayNetworkState | null>(null);
  const [error, setError] = useState(""), [readError, setReadError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [termsAccepted, setTermsAccepted] = useState(false);
  const [review, setReview] = useState<{ view: Review; input: Save } | null>(null), [submitted, setSubmitted] = useState(false);
  const [discard, setDiscard] = useState<RelayNetworkState | null>(null);
  const lifetime = useRef<object | null>(null), reading = useRef<AbortController | null>(null), mutating = useRef(false);
  const previousProvider = useRef<RelayProvider | null>(null);
  const currentScope = () => {
    const epoch = lifetime.current, sessionCurrent = captureWebSessionScope();
    return () => epoch !== null && epoch === lifetime.current && sessionCurrent();
  };
  function retire() { lifetime.current = null; reading.current?.abort(); setReview(null); setTermsAccepted(false); }
  function close() { retire(); onClose(); }
  async function refresh() {
    if (reading.current || !lifetime.current) return;
    const current = currentScope(), read = new AbortController(); reading.current = read;
    const timeout = setTimeout(() => read.abort(), 10_000);
    try {
      const value = await jsonRequest<RelayNetworkState>("/api/local-node/relay", { signal: read.signal }, token);
      if (!current()) return;
      if (!sameProvider(previousProvider.current, value.provider)) setTermsAccepted(false);
      previousProvider.current = value.provider;
      setState(value); setReadError("");
    } catch (reason) {
      if (current() && !isStaleWebSessionError(reason)) {
        setState(null); setReadError(text("无法读取便捷接入状态，请刷新或重新打开本地空间。", "Refresh or reopen the local workspace to read access status."));
      }
    } finally { clearTimeout(timeout); if (reading.current === read) reading.current = null; }
  }
  useEffect(() => {
    const epoch = {}; lifetime.current = epoch;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await refresh();
      if (lifetime.current === epoch) timer = setTimeout(() => void poll(), 2500);
    };
    void poll();
    window.addEventListener(webSessionExpiredEvent, close);
    return () => {
      lifetime.current = null; reading.current?.abort(); reading.current = null; clearTimeout(timer); window.removeEventListener(webSessionExpiredEvent, close);
    };
  }, [token]);
  const provider = state?.provider ?? null;
  const providerValid = Boolean(provider && httpsURL(provider.relayOrigin, true) && httpsURL(provider.acmeDirectoryUrl) && httpsURL(provider.termsUrl));
  const freshReview = Boolean(review && state && review.input.revisionDigest === state.revisionDigest && sameProvider(review.view.provider, provider));
  async function prepare(enabled: boolean) {
    if (!state || mutating.current || (enabled && (!providerValid || !termsAccepted))) return;
    const current = currentScope(), selectedProvider = state.provider;
    const input: Selection = { revisionDigest: state.revisionDigest, enabled, termsAccepted: enabled && termsAccepted };
    mutating.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const view = await jsonRequest<Review>("/api/local-node/relay/review", { method: "POST", body: JSON.stringify(input) }, token);
      if (!current()) return;
      if (view.revisionDigest !== input.revisionDigest || view.enabled !== enabled || !sameProvider(view.provider, selectedProvider) ||
        !httpsURL(view.origin, true) || (state.saved.origin && state.saved.origin !== view.origin) || !view.reviewDigest) {
        throw new Error(text("返回的服务或地址与本次选择不一致，请刷新后重新审阅。", "The returned provider or address differs from your selection. Refresh and review again."));
      }
      setReview({ view, input: { ...input, reviewDigest: view.reviewDigest } }); setSubmitted(false);
    } catch (reason) {
      if (current() && !isStaleWebSessionError(reason)) setError(reason instanceof Error ? reason.message : String(reason));
    } finally { if (current()) { mutating.current = false; setBusy(false); } }
  }
  async function save() {
    if (!review || mutating.current || (!submitted && !freshReview)) return;
    const current = currentScope(), input = review.input;
    mutating.current = true; setBusy(true); setSubmitted(true); setError("");
    try {
      const result = await jsonRequest<{ status: string; reviewDigest: string }>("/api/local-node/relay/save", { method: "POST", body: JSON.stringify(input) }, token);
      if (!current()) return;
      if (result.status !== "pending" || result.reviewDigest !== input.reviewDigest) throw new Error("Unconfirmed relay save");
      setReview(null); setSubmitted(false); setTermsAccepted(false);
      setNotice(text("已保存。退出并重新打开 ConveneWire 后生效；当前连接继续使用原配置。", "Saved. Quit and reopen ConveneWire to apply; current connections keep their configuration."));
    } catch (reason) {
      if (current() && !isStaleWebSessionError(reason)) setError(reason instanceof HttpRequestError && [400, 403, 409].includes(reason.status)
        ? reason.message : text("保存结果尚未确认。可重试原操作，或查看待生效配置；不会自动重启。", "Save is unconfirmed. Retry the original operation or inspect pending settings; the Node will not restart automatically."));
    } finally { if (current()) { mutating.current = false; setBusy(false); await refresh(); } }
  }
  async function discardPending() {
    if (!discard?.pending || !state || state.revisionDigest !== discard.revisionDigest || mutating.current) return;
    const current = currentScope(); mutating.current = true; setBusy(true); setError("");
    try {
      const result = await jsonRequest<{ status: string }>("/api/local-node/relay/discard", { method: "POST", body: JSON.stringify({ revisionDigest: discard.revisionDigest }) }, token);
      if (result.status !== "discarded") throw new Error("Unconfirmed relay discard");
      if (current()) { setDiscard(null); setNotice(text("已取消便捷接入的待生效配置。", "Pending convenient access settings discarded.")); }
    } catch (reason) {
      if (current() && !isStaleWebSessionError(reason)) setError(text("取消结果尚未确认，请刷新查看当前配置。", "Discard is unconfirmed; refresh to inspect current settings."));
    } finally { if (current()) { mutating.current = false; setBusy(false); await refresh(); } }
  }
  const ready = state?.running.state === "ready" && state.running.origin && httpsURL(state.running.origin, true) &&
    Boolean(state.running.certificateExpiresAt && Date.parse(state.running.certificateExpiresAt) > Date.now());
  const statuses = {
    disabled: text("便捷接入已停用", "Convenient access is disabled"), connecting: text("正在连接接入服务…", "Connecting to the access service…"),
    issuing_certificate: text("正在申请 HTTPS 证书…", "Obtaining an HTTPS certificate…"),
    ready: ready ? text("已连接，可以邀请其他节点", "Connected and ready for Node invitations") : text("证书暂不可用，等待恢复连接", "Certificate unavailable; waiting for access to recover"),
    retrying: text("连接中断，正在重试…", "Connection interrupted; retrying…"), unavailable: text("便捷接入暂不可用", "Convenient access is unavailable")
  };
  const providerDetails = (value: RelayProvider) => <dl className="local-network-details">
    <dt>{text("服务提供方", "Service provider")}</dt><dd>{value.displayName}</dd>
    <dt>{text("证书服务", "Certificate service")}</dt><dd>{value.acmeDirectoryUrl}</dd>
  </dl>;
  return <PanelDialog title={text("本机网络设置", "Local network settings")} locale={locale} onClose={close} error={error || readError}
    focusKey={review ? "review" : discard ? "discard" : "settings"}>
    <div className="local-network-panel relay-network-panel">
      <section><h3>{text("便捷接入", "Convenient access")}</h3>
        <p>{text("让受邀成员从其他网络访问你的空间。自动连接并管理 HTTPS 证书，无需设置路由器、域名或证书。", "Let invited members reach your spaces from other networks. Connection and HTTPS certificates are managed automatically; no router, domain or certificate setup is needed.")}</p>
        <p>{text("本机需保持运行。成员与 Agent 的访问范围仍由你选择。", "Keep this computer running. You still choose access for members and Agents.")}</p>
      </section>
      <section aria-live="polite"><h3>{text("当前状态", "Current status")}</h3>
        {!state ? <p>{text("正在读取或暂不可用。", "Loading or unavailable.")}</p> : <>
          <p className={`relay-network-state${ready ? " relay-network-ready" : ""}`}>{statuses[state.running.state]}</p>
          {(state.running.origin ?? state.saved.origin) && <p className="relay-network-origin">{state.running.origin ?? state.saved.origin}</p>}
          {ready && <p>{text("证书有效至", "Certificate expires")} {new Date(state.running.certificateExpiresAt!).toLocaleString(locale)}</p>}
          {["retrying", "unavailable"].includes(state.running.state) && <p>{text("远端成员暂时无法连接；本地空间可继续使用。恢复后继续使用同一地址。", "Remote members cannot connect right now. Your local workspace remains usable; the same address is retained on recovery.")}</p>}
        </>}
      </section>
      {state?.pending && <section><h3>{text("等待重启生效", "Pending next startup")}</h3>
        <p>{state.pending.enabled ? text("启用便捷接入", "Enable convenient access") : text("停用便捷接入", "Disable convenient access")} · {state.pending.origin}</p>
        {!review && !discard && <button className="secondary-action" type="button" disabled={busy} onClick={() => { setDiscard(state); setError(""); }}>{text("取消待生效配置…", "Discard pending settings…")}</button>}
      </section>}
      {notice && <p role="status">{notice}</p>}
      {review ? <section><h3>{review.view.enabled ? text("确认启用便捷接入", "Review convenient access") : text("确认停用便捷接入", "Review disabling access")}</h3>
        {providerDetails(review.view.provider)}<p className="relay-network-origin">{review.view.origin}</p>
        <p>{review.view.enabled ? text("重启后将连接此服务，并自动申请及续期此地址的 HTTPS 证书。连接和证书就绪后才可邀请其他节点。", "After restart, connect to this service and automatically obtain and renew the HTTPS certificate for this address. Node invitations become available once the connection and certificate are ready.")
          : text("重启后关闭此接入通道。地址和成员关系保留；远端成员将暂时无法通过此地址连接。", "After restart, close this access channel. The address and memberships are retained; remote members cannot connect through it while disabled.")}</p>
        {!submitted && !freshReview && <p role="alert">{text("服务或配置已变化，请返回刷新后重新审阅。", "The provider or settings changed. Go back, refresh and review again.")}</p>}
        <div className="local-network-actions"><button className="secondary-action" type="button" disabled={busy} onClick={() => { setReview(null); setSubmitted(false); setError(""); }}>{text("返回", "Back")}</button>
          <button className="primary-action" type="button" disabled={busy || (!submitted && !freshReview)} onClick={() => void save()}>{submitted ? text("重试原保存操作", "Retry original save") : text("保存，重启后生效", "Save for next startup")}</button></div>
      </section> : discard ? <section><h3>{text("取消以上待生效配置", "Discard the pending settings above")}</h3>
        <p>{text("当前正在使用的配置继续保留。", "The currently running configuration remains in place.")}</p>
        {discard.revisionDigest !== state?.revisionDigest && <p role="alert">{text("配置已变化，请返回查看最新状态。", "Settings changed; return to inspect the current state.")}</p>}
        <div className="local-network-actions"><button className="secondary-action" type="button" disabled={busy} onClick={() => setDiscard(null)}>{text("返回", "Back")}</button>
          <button className="primary-action" type="button" disabled={busy || discard.revisionDigest !== state?.revisionDigest} onClick={() => void discardPending()}>{text("确认取消待生效配置", "Confirm discard")}</button></div>
      </section> : <section>
        {provider ? <>{providerDetails(provider)}
          <p>{text("连接经过此服务提供方。其可观察连接地址、时间和流量，并管理此地址的域名与证书验证入口；请使用你信任的提供方。", "Connections use this provider, which can observe addresses, timing and volume and controls the domain and certificate validation route. Use a provider you trust.")}</p>
          {providerValid ? <a href={provider.termsUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{text("查看服务与证书申请条款", "Service and certificate terms")}</a>
            : <p role="alert">{text("服务配置无效，请联系提供方更新。", "The service profile is invalid. Contact its provider.")}</p>}
          {(!state?.saved.enabled || state?.termsAcceptanceRequired) && <label className="local-network-toggle relay-network-consent"><input type="checkbox" checked={termsAccepted} disabled={busy || !providerValid}
            onChange={event => setTermsAccepted(event.target.checked)} />{text("我同意此服务及自动申请、续期 HTTPS 证书的条款", "I agree to this service and automatic HTTPS certificate issuance and renewal terms")}</label>}
          {state?.saved.enabled && state.termsAcceptanceRequired && <button className="primary-action" type="button"
            disabled={busy || !providerValid || !termsAccepted} onClick={() => void prepare(true)}>
            {text("审阅更新后的证书条款…", "Review updated certificate terms…")}</button>}
          <button className={state?.saved.enabled ? "secondary-action" : "primary-action"} type="button"
            disabled={busy || !state || (!state.saved.enabled && (!providerValid || !termsAccepted))} onClick={() => void prepare(!state?.saved.enabled)}>
            {state?.saved.enabled ? text("停用便捷接入…", "Disable convenient access…") : text("启用便捷接入…", "Enable convenient access…")}</button>
        </> : state && <p role="status">{text("此版本尚未配置接入服务。请向应用提供方获取带服务配置的版本，或使用高级手动 HTTPS 接入。", "This installation has no access service configured. Ask the app provider for a service-enabled distribution, or use advanced manual HTTPS access.")}</p>}
      </section>}
      <div className="local-network-actions"><button className="secondary-action" type="button" disabled={busy} onClick={() => void refresh()}>{text("刷新当前状态", "Refresh current state")}</button>
        {!review && !discard && <button className="secondary-action" type="button" disabled={busy} onClick={() => { retire(); onAdvanced(); }}>{text("高级：手动 HTTPS 接入", "Advanced: manual HTTPS access")}</button>}</div>
    </div>
  </PanelDialog>;
}
