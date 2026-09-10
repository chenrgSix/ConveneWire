import { useEffect, useRef, useState } from "react";
import type { PeerBrowserEntryRequest, PeerHumanEntryIdentity } from "@convene-wire/contracts/peer";
import { jsonRequest } from "../../api-client.js";
import type { AuthenticatedUser, AuthMode } from "../../models.js";

export interface PeerEntrySession {
  user: AuthenticatedUser;
  mode: AuthMode;
  session: { expiresAt: string; token?: string };
  identity: PeerHumanEntryIdentity;
}

/** null means ordinary navigation; an empty value keeps invalid proofs at the gate. */
export function peerEntryFromFragment(hash: string): string | null {
  const params = new URLSearchParams(hash.slice(1));
  if (!params.has("peerEntry")) return null;
  if (hash.length > 240 || [...params.keys()].length !== 1) return "";
  const value = params.get("peerEntry") ?? "";
  return /^peerhuman_[A-Za-z0-9_-]{8,128}\.[A-Za-z0-9_-]{43}$/u.test(value) ? value : "";
}

export function PeerEntryGate({ entry, onEntered, onCancel }: {
  entry: string; onEntered: (session: PeerEntrySession) => void; onCancel: () => void;
}) {
  const [identity, setIdentity] = useState<PeerHumanEntryIdentity | null>(null);
  const [error, setError] = useState(false), [busy, setBusy] = useState(false), [attempted, setAttempted] = useState(false);
  const [zh, setZh] = useState(() => { try { return localStorage.getItem("agent-room.locale") !== "en"; } catch { return true; } });
  const lifetime = useRef<object | null>(null), submitting = useRef(false);
  const input = (): PeerBrowserEntryRequest => ({ schemaVersion: 1, credentialId: entry.split(".")[0]!, token: entry.split(".")[1]! });
  useEffect(() => {
    const current = {}; lifetime.current = current;
    setIdentity(null); setError(false); setBusy(false); setAttempted(false); submitting.current = false;
    const controller = new AbortController();
    if (!entry || window.location.protocol !== "https:") setError(true);
    else void jsonRequest<PeerHumanEntryIdentity>("/api/peer/browser-entry/preview", {
      method: "POST", body: JSON.stringify(input()), signal: controller.signal
    }).then(value => {
      if (lifetime.current === current) setIdentity(value);
    }).catch(() => { if (lifetime.current === current) setError(true); });
    return () => { lifetime.current = null; controller.abort(); };
  }, [entry]);

  async function enter() {
    if (!identity || error || submitting.current || !lifetime.current) return;
    const current = lifetime.current;
    submitting.current = true; setBusy(true); setAttempted(true);
    try {
      const result = await jsonRequest<PeerEntrySession>("/api/peer/browser-entry/claim", { method: "POST", body: JSON.stringify(input()) });
      if (lifetime.current !== current) return;
      const access = result.user.peerAccess;
      if (result.identity.membershipId !== identity.membershipId || result.identity.userId !== identity.userId ||
        result.identity.memberId !== identity.memberId || result.identity.scope.kind !== identity.scope.kind ||
        result.identity.scope.teamId !== identity.scope.teamId || result.identity.scope.roomId !== identity.scope.roomId ||
        result.user.userId !== identity.userId || result.user.clientTeamId || result.user.canManageOwnerRecovery ||
        !access || access.credentialId !== input().credentialId || access.membershipId !== identity.membershipId ||
        access.memberId !== identity.memberId || access.teamId !== identity.scope.teamId ||
        access.kind !== identity.scope.kind || access.roomId !== identity.scope.roomId ||
        result.mode !== "trusted-team" || result.session.token) throw new Error("Peer entry scope changed");
      onEntered(result);
    } catch {
      // Consumption may have committed. Only a fresh explicit Console entry may retry.
      if (lifetime.current === current) setError(true);
    } finally {
      if (lifetime.current === current) { submitting.current = false; setBusy(false); }
    }
  }
  return <main className="access-shell client-entry-shell">
    <div className="access-toolbar"><button type="button" onClick={() => setZh(!zh)}>{zh ? "EN" : "中"}</button></div>
    <section className="access-card" aria-live="polite">
      <div className="brand-mark">CW</div><p className="eyebrow">{zh ? "进入远端空间" : "ENTER A REMOTE SPACE"}</p>
      <h1>{zh ? "确认你的成员身份" : "Confirm your member identity"}</h1>
      <p>{window.location.origin}</p>
      {identity && <><p className="client-entry-identity"><strong>{identity.displayName}</strong> · {identity.teamLabel}</p>
        <p>{identity.scope.kind === "room" ? `# ${identity.roomLabel}` : (zh ? "Team 内已授权房间" : "Authorized Rooms in this Team")}</p>
        <p>{zh ? "继续后，此浏览器使用以上成员身份和范围。本机 Agent 的分享与执行许可仍由本机设置 管理。" : "Continue with this member identity and scope. Agent sharing and execution permission remain in your local settings."}</p></>}
      {!identity && !error && <p>{zh ? "正在核对远端授权…" : "Checking remote access…"}</p>}
      {error && <p role="alert">{zh ? "入口已过期、已使用或授权已变化。请回本机设置 重新进入；不会自动重复登录。" : "Entry expired, was used, or access changed. Open a fresh entry from your local settings; sign-in is never automatically replayed."}</p>}
      <button className="access-primary" type="button" disabled={!identity || busy || error} onClick={() => void enter()}>{busy ? (zh ? "正在进入…" : "Entering…") : (zh ? "确认并进入" : "Confirm and enter")}</button>
      <button className="secondary-action" type="button" disabled={busy} onClick={() => { lifetime.current = null; onCancel(); }}>{attempted ? (zh ? "关闭入口，检查当前登录" : "Close entry and check current sign-in") : (zh ? "取消，保留原登录" : "Cancel; keep current sign-in")}</button>
    </section>
  </main>;
}
