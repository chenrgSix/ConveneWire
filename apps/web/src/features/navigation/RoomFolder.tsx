import { useEffect, useId, useState } from "react";
import { captureWebSessionScope, jsonRequest } from "../../api-client.js";
import type { Locale } from "../../i18n.js";
import type { AgentTask, LocalSession, Room } from "../../models.js";

interface Props {
  locale: Locale;
  room: Room;
  session: LocalSession | null;
  selected: boolean;
  selectedTaskId: string | null;
  currentTasks?: AgentTask[] | undefined;
  onRoom: (roomId: string) => void;
  onTask: (roomId: string, taskId: string) => void;
}

/** Mounted within one Team/session scope; only expanded, inactive Rooms read tasks. */
export function RoomFolder({ locale, room, session, selected, selectedTaskId, currentTasks, onRoom, onTask }: Props) {
  const zh = locale === "zh-CN";
  const [expanded, setExpanded] = useState(selected);
  const [showAll, setShowAll] = useState(false);
  const [retry, setRetry] = useState(0);
  const [read, setRead] = useState<{ items: AgentTask[]; status: "loading" | "ready" | "failed" }>({ items: [], status: "loading" });
  const listId = useId();
  useEffect(() => { if (selectedTaskId) setExpanded(true); }, [selectedTaskId]);
  useEffect(() => {
    if (!expanded || currentTasks !== undefined || !session) return;
    const controller = new AbortController();
    const sessionValid = captureWebSessionScope();
    const valid = () => !controller.signal.aborted && sessionValid();
    setRead({ items: [], status: "loading" });
    void jsonRequest<AgentTask[]>(`/api/rooms/${room.roomId}/tasks`, { signal: controller.signal }, session.token)
      .then((items) => { if (valid()) setRead({ items: items.filter((task) => task.roomId === room.roomId), status: "ready" }); })
      .catch(() => { if (valid()) setRead({ items: [], status: "failed" }); });
    return () => controller.abort();
  }, [expanded, currentTasks, room.roomId, session, retry]);

  const tasks = (currentTasks ?? read.items).filter((task) => task.roomId === room.roomId);
  const visibleTasks = showAll ? tasks : tasks.slice(0, 5);
  const selectedTask = tasks.find((task) => task.taskId === selectedTaskId);
  if (!showAll && selectedTask && !visibleTasks.includes(selectedTask)) visibleTasks.splice(4, 1, selectedTask);
  const status = currentTasks !== undefined ? "ready" : read.status;
  return <div className="product-room-folder">
    <button className="product-folder-toggle" type="button" aria-expanded={expanded} aria-controls={listId}
      title={room.name} onClick={() => setExpanded((value) => !value)}>
      <svg className="product-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {expanded ? <><path d="M3 10V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v1" /><path d="M3 10h18a1 1 0 0 1 .96 1.3l-2.5 8A1 1 0 0 1 18.5 20h-14a1 1 0 0 1-1-.9L2 11.1A1 1 0 0 1 3 10Z" /></>
          : <path d="M3 9h18M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />}
      </svg>
      <span className="product-folder-name">{room.name}</span>
      <svg className="product-folder-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={expanded ? "m4 6 4 4 4-4" : "m6 4 4 4-4 4"} /></svg>
    </button>
    {expanded && <div className="product-folder-tasks" id={listId} role="group" aria-label={zh ? `${room.name}的任务` : `Tasks in ${room.name}`}>
      {status === "loading" && <p role="status">{zh ? "正在加载任务…" : "Loading tasks…"}</p>}
      {status === "failed" && <button className="product-folder-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>{zh ? "加载失败，重试" : "Could not load tasks. Retry"}</button>}
      {status === "ready" && visibleTasks.map((task) => <button className="product-folder-task" key={task.taskId} type="button"
        aria-current={selectedTaskId === task.taskId ? "page" : undefined} title={task.title}
        onClick={() => onTask(room.roomId, task.taskId)}>
        {task.isDefault && task.title === "Room work" ? (zh ? "默认对话" : "General conversation") : task.title}
      </button>)}
      {status === "ready" && tasks.length === 0 && <button className="product-folder-secondary" type="button" onClick={() => onRoom(room.roomId)}>{zh ? "打开房间" : "Open Room"}</button>}
      {status === "ready" && tasks.length > 5 && <button className="product-folder-secondary" type="button" onClick={() => setShowAll((value) => !value)}>
        {showAll ? (zh ? "收起任务" : "Show fewer") : (zh ? `显示其余 ${tasks.length - visibleTasks.length} 项` : `Show ${tasks.length - visibleTasks.length} more`)}
      </button>}
    </div>}
  </div>;
}
