import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkPolicyOffer } from "@convene-wire/contracts/execution-plan";
import { captureWebSessionScope, HttpRequestError, isStaleWebSessionError, jsonRequest } from "../../api-client.js";
import type { Locale } from "../../i18n.js";
import { PanelDialog } from "../navigation/PanelDialog.js";

type Policy = {
  policyId: string; digest: string; alias: string; repositoryId: string; sourceRef: string; baseCommit: string;
  scope: WorkPolicyOffer["spec"]["scopePolicy"]; verificationProfiles: WorkPolicyOffer["spec"]["verificationProfiles"];
  maxRunAttempts: number; maxTaskDurationSeconds: number; expiresAt: string;
};
interface Option {
  agentId: string; agentName: string; deviceId: string | null; state: "available" | "unavailable";
  blocker: "device_offline" | "ambiguous_policy" | "policy_unavailable" | null; policy: Policy | null;
}
interface Work {
  title: string;
  operationId: string; rootTaskId: string; taskId: string; planId: string; agentId: string; deviceId: string;
  state: "pending" | "authorized" | "denied" | "expired" | "canceled"; reason: string;
}
interface Command {
  operationId: string; agentId: string; policyId: string; policyDigest: string; baseCommit: string;
  title: string; goal: string; criteria: string[];
}
interface Props {
  roomId: string; memberId: string; token: string | undefined; locale: Locale;
  onOpenTask: (roomId: string, taskId: string) => void;
  onCreated: () => void;
}
const newOperation = () => `op_${crypto.randomUUID().replaceAll("-", "_")}`;
function readPending(key: string): Command | null {
  const raw = sessionStorage.getItem(key); if (!raw) return null;
  if (raw.length > 64_000) throw new Error("Stored development request is too large");
  const value = JSON.parse(raw) as Command;
  if (!value || !/^op_[A-Za-z0-9_-]{8,128}$/u.test(value.operationId) ||
    [value.agentId, value.policyId, value.policyDigest, value.baseCommit, value.title, value.goal].some((item) => typeof item !== "string") ||
    Object.keys(value).sort().join(",") !== "agentId,baseCommit,criteria,goal,operationId,policyDigest,policyId,title" ||
    !Array.isArray(value.criteria) || value.criteria.length < 1 || value.criteria.length > 8 ||
    value.criteria.some((item) => typeof item !== "string" || item.length > 2000)) throw new Error("Stored development request is invalid");
  return value;
}

export function DevelopmentWorkEntry(props: Props) {
  const [open, setOpen] = useState(false);
  const zh = props.locale === "zh-CN";
  return <>
    <button className="development-entry secondary-action" type="button" onClick={() => setOpen(true)}>{zh ? "发起开发" : "Develop"}</button>
    {open && <DevelopmentDialog {...props} onClose={() => setOpen(false)} />}
  </>;
}

function DevelopmentDialog({roomId, memberId, token, locale, onOpenTask, onCreated, onClose}: Props & {onClose: () => void}) {
  const zh = locale === "zh-CN";
  const storageKey = `convenewire.development.v1:${memberId}:${roomId}`;
  const mounted = useRef(true);
  const currentSession = useRef(captureWebSessionScope());
  const [options, setOptions] = useState<Option[]>([]);
  const [items, setItems] = useState<Work[]>([]);
  const [agentId, setAgentId] = useState("");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [criteria, setCriteria] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [storageInvalid, setStorageInvalid] = useState(false);
  const [pending, setPending] = useState<Command | null>(null);
  const pendingRef = useRef<Command | null>(null);
  const sequence = useRef(0);
  const available = options.find((option) => option.agentId === agentId && option.state === "available");
  const isCurrent = () => mounted.current && currentSession.current();
  const load = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const [choices, work] = await Promise.all([
        jsonRequest<{options: Option[]}>(`/api/rooms/${roomId}/development-options`, {}, token),
        jsonRequest<{items: Work[]}>(`/api/rooms/${roomId}/development-tasks`, {}, token)
      ]);
      if (!isCurrent() || id !== sequence.current) return;
      setOptions(choices.options); setItems(work.items);
      setAgentId((current) => current || choices.options.find((option) => option.state === "available")?.agentId || "");
      if (pendingRef.current && work.items.some((item) => item.operationId === pendingRef.current?.operationId)) {
        sessionStorage.removeItem(storageKey); pendingRef.current = null; setPending(null);
        setTitle(""); setGoal(""); setCriteria(""); onCreated();
      }
      setLoading(false);
    } catch (reason) {
      if (isCurrent() && id === sequence.current && !isStaleWebSessionError(reason)) {setLoading(false); setError(String(reason));}
    }
  }, [roomId, token, storageKey]);
  useEffect(() => {
    mounted.current = true;
    try { const saved = readPending(storageKey); pendingRef.current = saved; setPending(saved); }
    catch { setStorageInvalid(true); setError(zh ? "无法读取待核对请求，请先核对最近的开发请求并检查浏览器存储。" : "Cannot read the pending request; reconcile recent requests and check browser storage."); }
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {mounted.current = false; clearInterval(timer);};
  }, [load, storageKey]);
  async function submit() {
    if (busy || storageInvalid || !isCurrent()) return;
    const policy = available?.policy;
    if (!pendingRef.current && (!available || !policy)) return;
    const command: Command = pendingRef.current ?? {
      operationId: newOperation(), agentId: available!.agentId, policyId: policy!.policyId, policyDigest: policy!.digest,
      baseCommit: policy!.baseCommit, title: title.trim(), goal: goal.trim(), criteria: criteria.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
    };
    if (command.criteria.length < 1 || command.criteria.length > 8) {setError(zh ? "请填写 1 至 8 条验收标准，每行一条。" : "Provide 1–8 acceptance criteria, one per line."); return;}
    setError(null);
    try { sessionStorage.setItem(storageKey, JSON.stringify(command)); }
    catch {setError(zh ? "无法保存请求编号，请启用浏览器会话存储后重试。" : "Enable session storage to retain the request identity before submitting."); return;}
    pendingRef.current = command; setPending(command); setBusy(true);
    try {
      const work = await jsonRequest<Work>(`/api/rooms/${roomId}/development-tasks`, {method: "POST", body: JSON.stringify(command)}, token);
      if (!isCurrent()) return;
      sessionStorage.removeItem(storageKey); pendingRef.current = null; setPending(null);
      setTitle(""); setGoal(""); setCriteria("");
      setItems((current) => [work, ...current.filter((item) => item.operationId !== work.operationId)]);
      onCreated(); await load();
    } catch (reason) {
      if (!isCurrent() || isStaleWebSessionError(reason)) return;
      if (reason instanceof HttpRequestError && [400, 409].includes(reason.status)) {
        sessionStorage.removeItem(storageKey); pendingRef.current = null; setPending(null);
        setError(zh ? `未创建任务，工作范围或资源已变化。请刷新后重试：${reason.message}` : `The request was rejected. Refresh the current policy and retry: ${reason.message}`);
      } else {
        setError(zh ? "请求结果尚未确认。核对并重试会使用原请求编号，不会重复创建任务。" : "The request outcome is unconfirmed. Reconcile and retry uses the same identity without creating a duplicate Task.");
      }
    } finally { if (isCurrent()) setBusy(false); }
  }
  const stateText = (state: Work["state"]) => ({
    pending: zh ? "等待设备授权" : "Awaiting device authorization",
    authorized: zh ? "已授权，执行与交付请查看任务" : "Authorized; open the Task for execution and delivery",
    denied: zh ? "设备拒绝授权" : "Device denied authorization",
    expired: zh ? "授权等待超时" : "Authorization timed out",
    canceled: zh ? "请求已失效" : "Request invalidated"
  })[state];
  const blockerText = (option: Option) => option.blocker === "device_offline"
    ? (zh ? "请设备主人启动客户端并恢复连接。" : "Ask the device owner to start the client and reconnect.")
    : option.blocker === "ambiguous_policy" ? (zh ? "存在重叠策略，请设备主人在客户端撤销多余策略。" : "Ask the owner to revoke overlapping local policies.")
    : (zh ? "请设备主人在客户端「受控开发」配置工作策略，包含当前 Room、发起人和 Agent，并检查执行环境。" : "Ask the owner to configure a work policy for this Room, initiator and Agent in the local client and check its Runtime.");
  return <PanelDialog title={zh ? "发起开发任务" : "Start development"} locale={locale} onClose={onClose} error={error}>
    <p>{zh ? "在设备主人预先允许的范围内自动执行，交付候选提交和验证结果。" : "Execute within the device owner's standing policy and deliver a candidate commit with verification evidence."}</p>
    <button className="secondary-action" type="button" disabled={busy} onClick={() => void load()}>{zh ? "刷新可用范围" : "Refresh readiness"}</button>
    {loading ? <p role="status">{zh ? "正在检查设备工作范围…" : "Checking device policies…"}</p> : <>
      {options.length === 0 && <p>{zh ? "当前 Room 没有可选 Agent，请先添加本机 Agent。" : "Add a local Agent to this Room first."}</p>}
      {options.filter((option) => option.state !== "available").map((option) => <p className="development-blocker" key={option.agentId}>
        <strong>{option.agentName}</strong> · {blockerText(option)} <small>{option.deviceId}</small>
      </p>)}
      <form className="development-form" onSubmit={(event) => {event.preventDefault(); void submit();}}>
        <fieldset disabled={busy || pending !== null}>
          <label>{zh ? "执行 Agent" : "Agent"}<select required value={agentId} onChange={(event) => setAgentId(event.target.value)}>
            <option value="">{zh ? "选择可用 Agent" : "Choose an available Agent"}</option>
            {options.filter((option) => option.state === "available").map((option) => <option value={option.agentId} key={option.agentId}>{option.agentName} · {option.policy?.alias}</option>)}
          </select></label>
          {available?.policy && <div className="development-policy">
            <strong>{available.policy.alias}</strong><span>{available.policy.sourceRef} · {available.policy.baseCommit.slice(0, 12)}</span>
            <span>{zh ? "交付目录" : "Output paths"}: {available.policy.scope.allowedPaths.join(", ")}</span>
            <span>{zh ? "验证方式" : "Verifiers"}: {available.policy.verificationProfiles.map((profile) => profile.profileId).join(", ") || (zh ? "未配置" : "None")}</span>
            <span>{available.policy.maxRunAttempts} {zh ? "次执行以内" : "attempts"} · {available.policy.maxTaskDurationSeconds / 60} {zh ? "分钟以内" : "minutes"}</span>
          </div>}
          <label>{zh ? "任务标题" : "Title"}<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} /></label>
          <label>{zh ? "开发目标" : "Goal"}<textarea rows={4} value={goal} onChange={(event) => setGoal(event.target.value)} required maxLength={20000} /></label>
          <label>{zh ? "验收标准（每行一条）" : "Acceptance criteria (one per line)"}<textarea rows={3} value={criteria} onChange={(event) => setCriteria(event.target.value)} required maxLength={16000} /></label>
        </fieldset>
        {pending && <p role="status">{zh ? `待核对：${pending.title}` : `Pending reconciliation: ${pending.title}`}</p>}
        <button className="primary-action" type="submit" disabled={busy || storageInvalid || (!pending && !available)}>{busy ? (zh ? "提交中…" : "Submitting…") : pending ? (zh ? "核对并重试" : "Reconcile and retry") : (zh ? "开始开发" : "Start development")}</button>
      </form>
    </>}
    <section className="development-history"><h3>{zh ? "最近的开发请求" : "Recent development requests"}</h3>
      {items.map((item) => <article key={item.operationId}>
        <strong>{item.title}</strong>
        <span>{stateText(item.state)}</span>
        {item.state === "denied" && <span>{item.reason}</span>}
        <button className="secondary-action" type="button" onClick={() => {onClose(); onOpenTask(roomId, item.rootTaskId);}}>{zh ? "查看执行与交付" : "Execution and delivery"}</button>
      </article>)}
      {items.length === 0 && <p>{zh ? "尚无开发请求。" : "No development requests yet."}</p>}
    </section>
  </PanelDialog>;
}
