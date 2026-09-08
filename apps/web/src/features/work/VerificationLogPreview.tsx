import { useRef, useState, useEffect } from "react";
import { captureWebSessionScope, isStaleWebSessionError, jsonRequest } from "../../api-client.js";
import type { Locale } from "../../i18n.js";
import type { ArtifactPreview } from "../../models.js";
import { BrowserVerificationView } from "../task/BrowserVerificationView.js";

export function VerificationLogPreview({taskId, artifactId, digest, revision, token, locale}: {
  taskId: string; artifactId: string; digest: string; revision: number; token: string | undefined; locale: Locale;
}) {
  const [preview,setPreview] = useState<ArtifactPreview | null>(null);
  const [error,setError] = useState<string | null>(null);
  const [busy,setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const zh = locale === "zh-CN";
  async function read() {
    if (busy) return;
    const current = captureWebSessionScope(); setBusy(true); setError(null);
    try {
      const value = await jsonRequest<ArtifactPreview>(`/api/tasks/${taskId}/artifacts/${artifactId}/preview`, {}, token);
      if (!mounted.current || !current()) return;
      if (value.artifactId !== artifactId || value.artifactRevision !== revision || value.sha256 !== digest || value.taskId !== taskId || value.integrity !== "verified") throw new Error(zh ? "报告与验证回执不匹配" : "Report does not match its verification receipt");
      setPreview(value);
    } catch (reason) {if (mounted.current && current() && !isStaleWebSessionError(reason)) setError(String(reason));}
    finally {if (mounted.current && current()) setBusy(false);}
  }
  return <div className="verification-log-preview">
    <button className="secondary-action" type="button" disabled={busy} onClick={() => preview ? setPreview(null) : void read()}>{preview ? (zh ? "收起报告" : "Hide report") : busy ? (zh ? "核对报告…" : "Checking report…") : (zh ? "查看验证报告" : "View verification report")}</button>
    {error && <p role="alert">{error}</p>}
    {preview?.browser ? <BrowserVerificationView browser={preview.browser} locale={locale} /> : preview && <pre>{preview.text}</pre>}
    {preview?.truncated && !preview.browser && <p>{zh ? "报告仅显示部分内容。" : "Only part of this report is shown."}</p>}
  </div>;
}
