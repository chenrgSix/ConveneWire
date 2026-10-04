import { useEffect, useState } from "react";

import { captureWebSessionScope, jsonRequest } from "../../api-client.js";
import type { Agent, LocalSession, RoomSettings } from "../../models.js";

/** Keep creation candidates scoped to the explicit destination, independent of the open conversation. */
export function useTaskCreationAgents(roomId: string | null, session: LocalSession | null, agents: Agent[]) {
  const scope = JSON.stringify([roomId, session?.userId, session?.token]);
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{ scope: string; agentIds: string[]; error: boolean } | null>(null);
  useEffect(() => {
    if (!roomId || !session) return;
    const controller = new AbortController();
    const currentSession = captureWebSessionScope();
    const current = () => !controller.signal.aborted && currentSession();
    setRead(null);
    void jsonRequest<RoomSettings>(`/api/rooms/${roomId}/settings`, { signal: controller.signal }, session.token)
      .then((settings) => {
        if (current()) setRead({ scope, agentIds: settings.participants.agentIds, error: false });
      })
      .catch(() => {
        if (current()) setRead({ scope, agentIds: [], error: true });
      });
    return () => controller.abort();
  }, [roomId, session, scope, attempt]);
  const current = read?.scope === scope ? read : null;
  return {
    agents: agents.filter((agent) => current?.agentIds.includes(agent.agentId) && agent.enabled !== false),
    loading: Boolean(roomId && session && !current),
    error: current?.error ?? false,
    retry: () => { setRead(null); setAttempt((value) => value + 1); }
  };
}
