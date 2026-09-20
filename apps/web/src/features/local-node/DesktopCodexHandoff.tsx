import { useEffect, useState } from "react";
import type { DesktopHandoffScope } from "@convene-wire/contracts/local-node";
import { jsonRequest } from "../../api-client.js";
import type { Locale } from "../../i18n.js";

export function DesktopCodexHandoff({ taskId, token, locale }: { taskId: string; token: string; locale: Locale }) {
  const [scope, setScope] = useState<DesktopHandoffScope | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let stopped = false;
    setScope(null); setMessage(""); setBusy(false);
    const load = async () => {
      try {
        const next = await jsonRequest<DesktopHandoffScope>(`/api/local-node/tasks/${taskId}/codex`, {}, token);
        if (!stopped) setScope(next);
      } catch { if (!stopped) setScope(null); }
    };
    void load();
    const refresh = () => { void load(); };
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 5000);
    return () => { stopped = true; window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [taskId, token]);
  if (!scope || scope.taskId !== taskId) return null;
  const zh = locale === "zh-CN";
  async function open() {
    setBusy(true); setMessage("");
    try {
      await jsonRequest(`/api/local-node/tasks/${taskId}/codex/open`, { method: "POST" }, token);
      setMessage(zh ? "已在本机窗口打开，请在那里选择会话并确认共享范围。" : "Opened locally. Select the conversation and review its audience there.");
    } catch { setMessage(zh ? "暂时无法打开，请检查本机 Node。" : "Cannot open local review. Check your Local Node."); }
    finally { setBusy(false); }
  }
  const labels = zh ? {available: "连接已有 Codex 会话", attached: "原 Codex 会话已连接", paused: "Codex 接管需要重新核对", released: "已交回 Codex"} :
    {available: "Connect an existing Codex conversation", attached: "Original Codex conversation connected", paused: "Codex handoff needs review", released: "Returned to Codex"};
  return <aside className="work-panel-card desktop-codex-handoff" aria-label={zh ? "Codex 会话" : "Codex conversation"}>
    <div><strong>{labels[scope.state]}</strong><p>{scope.state === "available"
      ? zh ? "让这个任务接着原来的会话做。保持原 ID，先在本机确认历史、工作区和共享范围。" : "Continue the original conversation in this task. Review its context, workspace and audience locally."
      : scope.state === "released" ? zh ? "继续使用原 Codex 会话；这个任务不会另起会话。" : "Continue in Codex. This task will not start a replacement."
      : zh ? "在房间继续本任务，或在本机管理接管、核对状态与交回控制。" : "Continue this task in its Room, or manage and return control locally."}</p></div>
    {scope.state !== "released" && <button className="work-inline-link" type="button" disabled={busy} onClick={() => void open()}>{busy ? zh ? "正在打开…" : "Opening…" : zh ? "在本机确认" : "Review locally"}</button>}
    {message && <p role="status">{message}</p>}
  </aside>;
}
