import { useEffect, useRef, useState } from "react";
import type { RuntimeApprovalRequestedPayload, RuntimeApprovalDecisionPayload } from "@convene-wire/contracts/bridge-messages";
import { jsonRequest } from "../../api-client.js";
import type { Locale } from "../../i18n.js";
import { PanelDialog } from "../navigation/PanelDialog.js";

interface Approval extends RuntimeApprovalDecisionPayload {
  request: RuntimeApprovalRequestedPayload;
  agentName: string;
  deviceName: string;
  roomName: string;
  roomId: string;
  taskId: string;
}

export function RuntimeApprovals({ teamId, token, locale, onPendingChange }: { teamId: string; token?: string | undefined; locale: Locale; onPendingChange?: (count: number) => void }) {
  const zh = locale === "zh-CN";
  const [items, setItems] = useState<Approval[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reachable, setReachable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  const resolved = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    alive.current = true;
    const refresh = async () => {
      try {
        const response = await jsonRequest<{ items: Approval[] }>(`/api/teams/${teamId}/runtime-approvals`, {}, token);
        if (stopped) return;
        const pending = response.items.filter(item => !resolved.current.has(item.requestId));
        setItems(pending); setReachable(true);
        if (pending.some(item => !seen.current.has(item.requestId))) setOpen(true);
        pending.forEach(item => seen.current.add(item.requestId));
      } catch {
        if (!stopped) setReachable(false);
      } finally { if (!stopped) timer = setTimeout(refresh, 1500); }
    };
    void refresh();
    return () => { stopped = true; alive.current = false; clearTimeout(timer); };
  }, [teamId, token]);

  useEffect(() => { onPendingChange?.(items.length); }, [items.length, onPendingChange]);
  useEffect(() => () => onPendingChange?.(0), [onPendingChange]);
  const item = items[0];
  if (!item) return null;
  const decide = async (decision: "allow" | "deny") => {
    if (busy || !reachable) return;
    setBusy(true); setError(null);
    try {
      const result = await jsonRequest<RuntimeApprovalDecisionPayload>(`/api/runtime-approvals/${item.requestId}/decision`, {
        method: "POST", body: JSON.stringify({ digest: item.digest, decision })
      }, token);
      if (!alive.current) return;
      if (result.requestId !== item.requestId || result.digest !== item.digest || result.decision !== decision) throw new Error("Stale decision");
      resolved.current.add(item.requestId);
      setItems(current => current.filter(value => value.requestId !== item.requestId));
    } catch {
      if (alive.current) setError(zh ? "审批未确认，请刷新后核对；原任务仍受权限限制。" : "Decision was not confirmed. Refresh and check the request.");
    } finally { if (alive.current) setBusy(false); }
  };
  return <>
    <button type="button" className="runtime-approval-notice" onClick={() => setOpen(true)}>
      {zh ? `待审批权限 · ${items.length}` : `Permission requests · ${items.length}`}
    </button>
    {open && <PanelDialog locale={locale} title={zh ? "权限审批" : "Permission request"}
      onClose={() => setOpen(false)} focusKey={item.requestId}
      error={!reachable ? (zh ? "连接已断开，恢复连接后才能审批。" : "Reconnect before reviewing this request.") : error}>
      <section className="runtime-approval-review">
      <p><strong>{item.agentName}</strong> · {item.deviceName} · #{item.roomName}</p>
      <p>{item.request.operationKind === "command" ? (zh ? "执行命令" : "Execute command") : (zh ? "修改文件" : "Change files")}</p>
      <pre className="runtime-approval-details">{item.request.details}</pre>
      <p className="muted">{zh ? "仅允许本次操作，决定后继续当前任务。" : "This decision applies only to this operation in the current task."}</p>
      <p className="muted">{zh ? "有效期至 " : "Expires "}{new Date(item.request.expiresAt).toLocaleTimeString(zh ? "zh-CN" : "en")}</p>
      <div className="runtime-approval-actions">
        <button type="button" disabled={busy || !reachable} onClick={() => void decide("deny")}>{zh ? "拒绝" : "Deny"}</button>
        <button type="button" className="primary" disabled={busy || !reachable} onClick={() => void decide("allow")}>{busy ? (zh ? "提交中…" : "Submitting…") : (zh ? "允许本次" : "Allow once")}</button>
      </div>
      </section>
    </PanelDialog>}
  </>;
}
