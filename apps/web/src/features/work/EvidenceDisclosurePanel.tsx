import React, { useEffect, useState } from "react";
import type { EvidenceDisclosureGrant, EvidenceDisclosureIntent } from "@convene-wire/contracts/task-result";
import { captureWebSessionScope, jsonRequest } from "../../api-client.js";
import type { Locale } from "../../i18n.js";

// The parent keys this panel by Task/member/session, so a different authority
// never inherits an approval draft or an in-flight response.
export function EvidenceDisclosurePanel({ taskId, roomId, token, locale }: {
  taskId: string; roomId: string; token: string | undefined; locale: Locale;
}) {
  const t = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [intent, setIntent] = useState<EvidenceDisclosureIntent | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [grants, setGrants] = useState<EvidenceDisclosureGrant[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController(), current = captureWebSessionScope();
    void jsonRequest<EvidenceDisclosureGrant[]>(`/api/tasks/${taskId}/evidence-disclosures`,
      { signal: controller.signal, cache: "no-store" }, token).then(value => {
        if (!controller.signal.aborted && current()) setGrants(value);
      }).catch(() => { if (!controller.signal.aborted && current()) setError(true); });
    return () => controller.abort();
  }, [expanded, taskId, token, reload]);
  const inspect = () => {
    setIntent(null); setReviewed(false); setError(false);
    try {
      // Reject bodies before any request. Only the metadata request file belongs here.
      const value = JSON.parse(draft) as EvidenceDisclosureIntent;
      const keys = ["version", "operationId", "deviceId", "agentId", "runId", "taskId", "roomId", "definitionRevision", "criteriaRevision", "source", "contentSha256", "contentBytes", "audience", "expiresAt"];
      if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value)) ||
        value.taskId !== taskId || value.roomId !== roomId || value.audience !== "room_members" ||
        !/^[a-f0-9]{64}$/u.test(value.contentSha256) || !value.source ||
        value.version !== 1 || !Number.isSafeInteger(value.contentBytes) || value.contentBytes < 1 || value.contentBytes > 16384 ||
        ![value.definitionRevision, value.criteriaRevision].every(n => Number.isSafeInteger(n) && n > 0) ||
        !/^op_[A-Za-z0-9_-]{8,128}$/u.test(value.operationId) ||
        !/^device_[A-Za-z0-9_-]{8,128}$/u.test(value.deviceId) ||
        !/^agent_[A-Za-z0-9_-]{8,128}$/u.test(value.agentId) ||
        !/^run_[A-Za-z0-9_-]{8,128}$/u.test(value.runId) ||
        !/^evidence_[A-Za-z0-9_-]{8,64}$/u.test(value.source.evidenceRef) ||
        !/^[a-f0-9]{40}([a-f0-9]{24})?$/u.test(value.source.revision) ||
        !/^[a-f0-9]{64}$/u.test(value.source.contentSha256) ||
        Object.keys(value.source).sort().join() !== "contentSha256,end,evidenceRef,revision,start" ||
        !Number.isSafeInteger(value.source.start) || !Number.isSafeInteger(value.source.end) ||
        value.source.start < 0 || value.source.end <= value.source.start || value.source.end > 4194304 ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/u.test(value.expiresAt) ||
        !Number.isFinite(Date.parse(value.expiresAt))) throw new Error();
      setIntent(value);
    } catch { setError(true); }
  };
  const mutate = async (url: string, body: unknown) => {
    const current = captureWebSessionScope();
    setBusy(true); setError(false);
    try {
      await jsonRequest(url, { method: "POST", body: JSON.stringify(body) }, token);
      if (!current()) return;
      setIntent(null); setDraft(""); setReviewed(false); setReload(value => value + 1);
    } catch { if (current()) setError(true); }
    finally { if (current()) setBusy(false); }
  };
  return <section className="result-acceptance">
    <button type="button" className="acceptance-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {t("私有证据披露", "Private evidence disclosure")}
    </button>
    {expanded && <div className="acceptance-content">
      <p>{t("先在所属设备检查要共享的原文。这里只粘贴 Bridge 生成的 .request.json，不要粘贴原文或本地 bundle。批准后，选定内容将向此 Room 的成员开放；这不代表内容已验证或 Result 已验收。", "Review the selected text on its owner device first. Paste only the Bridge .request.json, never private text or the local bundle. Approval shares the selected content with this Room's members; it does not verify truth or accept a Result.")}</p>
      <label>{t("披露请求", "Disclosure request")}<textarea value={draft} disabled={busy} maxLength={8192} onChange={event => { setDraft(event.target.value); setIntent(null); setReviewed(false); }} /></label>
      <button type="button" disabled={busy || !draft} onClick={inspect}>{t("检查请求", "Inspect request")}</button>
      {intent && <div>
        <p>Room: {intent.roomId} · Task: {intent.taskId}</p>
        <p>Device: {intent.deviceId} · Agent: {intent.agentId} · Run: {intent.runId}</p>
        <p>{t("内容摘要 / 字节数", "Content SHA-256 / bytes")}: <code>{intent.contentSha256}</code> / {intent.contentBytes}</p>
        <p>{t("来源 / 版本 / 范围", "Source / revision / range")}: {intent.source.evidenceRef} / {intent.source.revision} / [{intent.source.start}, {intent.source.end})</p>
        <p>{t("来源摘要", "Source SHA-256")}: <code>{intent.source.contentSha256}</code></p>
        <p>{t("到期时间", "Expires")}: {intent.expiresAt}</p>
        <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} />{t("我已在本机核对选定原文、摘要和接收 Room，并同意披露这些固定内容。", "I reviewed the selected local text, digest and destination Room and consent to disclose these exact bytes.")}</label>
        <button type="button" disabled={busy || !reviewed} onClick={() => void mutate("/api/evidence-disclosures", intent)}>{t("批准披露", "Approve disclosure")}</button>
      </div>}
      {error && <p role="alert">{t("操作未完成。请检查请求格式、当前任务和资料所属成员的登录权限，然后刷新授权状态。", "Operation did not complete. Check the request, Task and source owner's full session, then refresh grant state.")}</p>}
      <button type="button" disabled={busy} onClick={() => { setError(false); setReload(value => value + 1); }}>{t("刷新授权状态", "Refresh grant state")}</button>
      {grants.map(grant => <article className="work-result-card" key={grant.grantId}>
        <p><code>{grant.grantId}</code> · {grant.state} · {grant.intent.source.evidenceRef}</p>
        <p>{t("到期时间", "Expires")}: {grant.intent.expiresAt} · Result: {grant.resultId ?? "—"}</p>
        {grant.state === "active" && <button type="button" disabled={busy} onClick={() => void mutate(`/api/evidence-disclosures/${grant.grantId}/revoke`, { expectedRevision: grant.revision })}>{t("撤销后续披露", "Revoke future disclosure")}</button>}
      </article>)}
      <p>{t("撤权以服务器确认时间为准。已提交的内容不会因此收回。", "Revocation takes effect when acknowledged by the server. Previously committed content is not recalled.")}</p>
    </div>}
  </section>;
}
