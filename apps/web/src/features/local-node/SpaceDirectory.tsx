import { useEffect, useState } from "react";
import type { AuthoritySpace, AuthoritySpaceDirectory } from "@convene-wire/contracts/authority";
import { captureWebSessionScope, isStaleWebSessionError, jsonRequest } from "../../api-client.js";
import type { Locale } from "../../i18n.js";
import type { LocalSession } from "../../models.js";

// Construct a credential-free top-level navigation, never a cross-origin API
// request. The remote origin owns login, drafts and all subsequent requests.
export function remoteSpaceURL(space: AuthoritySpace, localOrigin: string): string | null {
  try {
    const url = new URL(space.browserOrigin);
    if (space.kind !== "remote" || url.origin !== space.browserOrigin || url.origin === localOrigin ||
      !/^team_[A-Za-z0-9_-]{8,128}$/u.test(space.teamId) || !/^node_[A-Za-z0-9_-]{8,128}$/u.test(space.authorityNodeId) ||
      !(url.protocol === "https:" || (url.protocol === "http:" &&
        (url.hostname === "localhost" || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/u.test(url.hostname) || url.hostname === "[::1]")))) return null;
    url.searchParams.set("team", space.teamId);
    return url.href;
  } catch { return null; }
}

export function SpaceDirectory({ session, locale }: { session: LocalSession; locale: Locale }) {
  const [loaded, setLoaded] = useState<{ token: string; value: AuthoritySpaceDirectory } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const zh = locale === "zh-CN";
  const token = session.token ?? "";
  useEffect(() => {
    let stopped = false;
    const current = captureWebSessionScope();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError(null);
    const refresh = () => { void jsonRequest<AuthoritySpaceDirectory>("/api/local-node/spaces", {}, token).then(value => {
      if (!stopped && current()) { setLoaded({ token, value }); setError(null); }
    }).catch(reason => {
      if (!stopped && current() && !isStaleWebSessionError(reason)) setError(token);
    }).finally(() => { if (!stopped && current()) timer = setTimeout(refresh, 5000); }); };
    refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [token]);
  const spaces = loaded !== null && loaded.token === token && Array.isArray(loaded.value.spaces) ? loaded.value.spaces : [];
  const remote = spaces.flatMap(space => {
    const href = remoteSpaceURL(space, window.location.origin);
    return href ? [{ ...space, href }] : [];
  });
  if (error === token) return <p className="space-directory" role="status">{zh ? "暂时无法读取其他空间。" : "Other spaces are temporarily unavailable."}</p>;
  if (remote.length === 0) return null;
  return <nav className="space-directory" aria-label={zh ? "空间" : "Spaces"}>
    <strong>{zh ? "本地空间" : "Local workspace"}</strong>
    {remote.map(space => <a key={`${space.authorityNodeId}:${space.teamId}`} href={space.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
      <span>{space.label} ↗</span><small>{new URL(space.browserOrigin).host}</small>
    </a>)}
    <span>{zh ? "其他空间在新窗口打开，需独立登录。" : "Other spaces open separately with their own sign-in."}</span>
  </nav>;
}
