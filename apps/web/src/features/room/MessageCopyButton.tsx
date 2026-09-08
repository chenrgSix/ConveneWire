import { useEffect, useState } from "react";
import type { Locale } from "../../i18n.js";

export function MessageCopyButton({ content, locale }: { content: string; locale: Locale }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const zh = locale === "zh-CN";
  const label = status === "copied" ? (zh ? "已复制" : "Copied") : (zh ? "复制回复" : "Copy reply");
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);
  return <div className="message-actions" data-copy-status={status}>
    <button type="button" className="message-copy" aria-label={label} title={label} onClick={async () => {
      try {
        await navigator.clipboard.writeText(content);
        setStatus("copied");
      } catch {
        setStatus("failed");
      }
    }}>
      <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {status === "copied" ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="13" rx="3" /><path d="M16 8V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h2" /></>}
      </svg>
    </button>
    <span role="status">{status === "copied" ? label : status === "failed"
      ? (zh ? "复制失败，请选择文字复制" : "Could not copy. Select the text to copy it.") : ""}</span>
  </div>;
}
