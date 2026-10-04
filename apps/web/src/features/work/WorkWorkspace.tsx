import type { WorkbenchPage } from "@convene-wire/contracts/task-result";
import React, { useId, useState } from "react";

import type { Locale } from "../../i18n.js";
import type { TaskWorkDetailTab } from "./TaskWorkDetail.js";
import { attentionFilters, type WorkFilters } from "./work-filters.js";
import { WorkSearchInput } from "./WorkSearchInput.js";

export type WorkbenchItem = WorkbenchPage["items"][number];

interface WorkWorkspaceProps extends WorkFilters {
  searchContext?: string;
  onFiltersChange?: (filters: WorkFilters) => void;
  onClearFilters?: () => void;
  agentNames: ReadonlyMap<string, string>;
  error: string | null;
  items: WorkbenchItem[];
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  lifecycleState?: string;
  locale: Locale;
  memberNames: ReadonlyMap<string, string>;
  onCreateTask?: () => void;
  createTaskDisabled?: boolean;
  onCopyLink?: () => void | Promise<void>;
  onOpenAction?: (item: WorkbenchItem) => void;
  onOpenTask: (taskId: string, roomId: string) => void;
  onLoadMore?: () => void;
  onLifecycleStateChange?: (value: string) => void;
  onOwnerMemberIdChange?: (value: string) => void;
  onSearchChange?: (value: string) => void;
  onRefresh: () => void;
  onScopeChange: (scope: "mine" | "team") => void;
  roomNames: ReadonlyMap<string, string>;
  ownerMemberId?: string;
  search?: string;
  scope: "mine" | "team";
}

export interface WorkActionTarget {
  view: "room" | "work";
  roomId: string;
  taskId: string;
  tab?: TaskWorkDetailTab;
  runId?: string;
}

/** Navigation intent only. Neither the projection nor this mapping grants command authority. */
export function workActionTarget(item: WorkbenchItem): WorkActionTarget | null {
  const location = { roomId: item.roomId, taskId: item.taskId };
  const { reason, sourceId } = item.nextAction;
  if (reason === "none") return null;
  if (reason === "provide_input" || reason === "start_work") return { ...location, view: "room" };
  if (reason === "review_result" || reason === "submit_result") return { ...location, view: "work", tab: "results" };
  if (reason === "acknowledge_outcome") {
    const runId = sourceId && /^run_[A-Za-z0-9_-]{8,128}$/u.test(sourceId)
      ? sourceId
      : item.latestRun?.runId;
    return { ...location, view: "work", tab: "runs", ...(runId ? { runId } : {}) };
  }
  return { ...location, view: "work", tab: "overview" };
}

type GroupKey = "human" | "executing" | "review" | "blocked" | "completed" | "other";

const activeRunStates = new Set([
  "queued", "delivered", "working", "input_required"
]);
const blockedReasons = new Set([
  "outcome_unknown", "blocked", "overdue", "paused", "budget_exhausted",
  "runtime_unavailable", "result_rejected"
]);

function groupFor(item: WorkbenchItem): GroupKey {
  if (item.lifecycleState === "completed") return "completed";
  if (item.lifecycleState === "review" || item.attentionReasons.some(({ reason }) =>
    reason === "needs_approval" || reason === "result_stale"
  )) return "review";
  if (item.attentionReasons.some(({ reason }) => blockedReasons.has(reason))) {
    return "blocked";
  }
  if (item.nextAction.actorKind === "member" && item.nextAction.reason !== "none") {
    return "human";
  }
  if ((item.latestRun && activeRunStates.has(item.latestRun.state)) ||
    item.lifecycleState === "active") return "executing";
  return "other";
}

function label(value: string, locale: Locale): string {
  if (locale !== "zh-CN") return value.replaceAll("_", " ");
  const labels: Record<string, string> = {
    needs_input: "等待输入",
    outcome_unknown: "结果未知",
    needs_approval: "等待审核",
    result_stale: "结果已过期",
    blocked: "已阻塞",
    overdue: "已逾期",
    paused: "已暂停",
    budget_exhausted: "预算已用尽",
    runtime_unavailable: "运行时不可用",
    result_rejected: "结果被拒绝",
    draft: "草稿",
    ready: "就绪",
    active: "进行中",
    review: "审核中",
    completed: "已完成",
    canceled: "已取消",
    low: "低",
    normal: "普通",
    high: "高",
    urgent: "紧急",
    provide_input: "提供输入",
    acknowledge_outcome: "确认未知结果",
    review_result: "审核结果",
    resolve_block: "解决阻塞",
    resume_scheduling: "恢复调度",
    increase_budget: "增加预算",
    restore_runtime: "恢复运行时",
    submit_result: "提交结果",
    start_work: "开始工作",
    none: "无需操作",
    queued: "排队中",
    delivered: "已送达",
    working: "执行中",
    input_required: "等待输入",
    failed: "失败",
    expired: "已过期"
  };
  return labels[value] ?? value;
}

function WorkCard({
  agentNames,
  item,
  locale,
  memberNames,
  onOpenAction,
  onOpenTask,
  roomNames
}: {
  agentNames: ReadonlyMap<string, string>;
  item: WorkbenchItem;
  locale: Locale;
  memberNames: ReadonlyMap<string, string>;
  onOpenAction: WorkWorkspaceProps["onOpenAction"];
  onOpenTask: WorkWorkspaceProps["onOpenTask"];
  roomNames: ReadonlyMap<string, string>;
}) {
  const unknown = locale === "zh-CN" ? "未知" : "Unknown";
  const nextActor = item.nextAction.actorKind === "member"
    ? memberNames.get(item.nextAction.expectedMemberId ?? "") ?? (locale === "zh-CN" ? "待确认的成员" : "Member to confirm")
    : item.nextAction.actorKind === "agent"
      ? agentNames.get(item.nextAction.expectedAgentId ?? "") ?? (locale === "zh-CN" ? "待确认的智能体" : "Agent to confirm")
      : (locale === "zh-CN" ? "系统" : "System");
  return (
    <article className="work-card">
      <button
        aria-label={locale === "zh-CN"
          ? `打开 TASK-${item.taskDisplayNumber}：${item.title}`
          : `Open TASK-${item.taskDisplayNumber}: ${item.title}`}
        className="work-card-open"
        onClick={() => onOpenTask(item.taskId, item.roomId)}
        type="button"
      >
        <span className="work-task-number">TASK-{item.taskDisplayNumber}</span>
        <span className={`work-priority ${item.priority}`}>{label(item.priority, locale)}</span>
        <strong>{item.title}</strong>
        <small>
          #{roomNames.get(item.roomId) ?? unknown} · {locale === "zh-CN" ? "负责人" : "Owner"} {memberNames.get(item.ownerMemberId) ?? unknown}
        </small>
      </button>
      <div className="work-state-row">
        <span>{label(item.lifecycleState, locale)}</span>
        {item.schedulingState === "paused" && <span>{label("paused", locale)}</span>}
        {item.latestRun && (
          <span>
            {agentNames.get(item.latestRun.agentId) ?? unknown} · {label(item.latestRun.state, locale)}
          </span>
        )}
      </div>
      {item.attentionReasons.length > 0 && (
        <ul aria-label={locale === "zh-CN" ? "全部关注原因" : "All attention reasons"} className="work-attention-list">
          {item.attentionReasons.map((attention) => (
            <li
              className={attention.reason === item.primaryAttention ? "primary" : ""}
              key={`${attention.reason}:${attention.sourceId}`}
            >{label(attention.reason, locale)}</li>
          ))}
        </ul>
      )}
      {item.requiredCriteriaTotal > 0 && <p className="work-criteria-summary">
        {locale === "zh-CN" ? "验收标准" : "Acceptance criteria"} · {item.requiredCriteriaSatisfied}/{item.requiredCriteriaTotal}
      </p>}
      <footer>
        {item.nextAction.reason !== "none" && <span className="work-next-actor">
          {locale === "zh-CN" ? "下一步由" : "Next up"} {nextActor}
        </span>}
        {onOpenAction && workActionTarget(item) ? <button
          aria-label={locale === "zh-CN"
            ? `查看 TASK-${item.taskDisplayNumber} 的下一步：${label(item.nextAction.reason, locale)}`
            : `Open next step for TASK-${item.taskDisplayNumber}: ${label(item.nextAction.reason, locale)}`}
          className="work-inline-link work-next-action"
          onClick={() => onOpenAction(item)}
          type="button"
        >{label(item.nextAction.reason, locale)} <span aria-hidden="true">→</span></button>
          : <span>{locale === "zh-CN" ? "下一步" : "Next"}: {label(item.nextAction.reason, locale)}</span>}
        {item.latestResultId && (
          <span>{locale === "zh-CN" ? "最新结果" : "Latest Result"}: {item.latestResultCurrent
            ? (locale === "zh-CN" ? "当前版本" : "Current")
            : (locale === "zh-CN" ? "旧版本" : "Stale")}</span>
        )}
      </footer>
    </article>
  );
}

export function WorkWorkspace({
  agentNames,
  error,
  items,
  loading,
  loadingMore = false,
  hasMore = false,
  lifecycleState = "",
  locale,
  memberNames,
  onCreateTask,
  createTaskDisabled = false,
  onCopyLink,
  onOpenAction,
  onOpenTask,
  onLoadMore,
  onLifecycleStateChange,
  onOwnerMemberIdChange,
  onSearchChange,
  onRefresh,
  onScopeChange,
  roomNames,
  ownerMemberId = "",
  search = "",
  scope, attention = "", filterRoomId = "", filterAgentId = "", priority = "",
  searchContext = "", onFiltersChange, onClearFilters
}: WorkWorkspaceProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  const zh = locale === "zh-CN";
  const activeFilters = [
    attention && `${zh ? "关注" : "Attention"}: ${label(attention, locale)}`,
    filterRoomId && `${zh ? "房间" : "Room"}: ${roomNames.get(filterRoomId) ?? (zh ? "房间不可用" : "Room unavailable")}`,
    filterAgentId && `${zh ? "智能体" : "Agent"}: ${agentNames.get(filterAgentId) ?? (zh ? "智能体不可用" : "Agent unavailable")}`,
    priority && `${zh ? "优先级" : "Priority"}: ${label(priority, locale)}`,
    lifecycleState && `${zh ? "状态" : "State"}: ${label(lifecycleState, locale)}`,
    ownerMemberId && `${zh ? "负责人" : "Owner"}: ${memberNames.get(ownerMemberId) ?? (zh ? "成员不可用" : "Member unavailable")}`
  ].filter(Boolean);
  const hasFilters = Boolean(search || activeFilters.length);
  const hasAdvancedFilters = Boolean(onFiltersChange || onLifecycleStateChange || onOwnerMemberIdChange);
  const clearFilters = () => {
    if (onClearFilters) { onClearFilters(); return; }
    onLifecycleStateChange?.(""); onOwnerMemberIdChange?.(""); onSearchChange?.("");
    onFiltersChange?.({ attention: "", filterRoomId: "", filterAgentId: "", priority: "" });
  };
  const groups: Array<{ key: GroupKey; title: string }> = [
    { key: "human", title: locale === "zh-CN" ? "待处理" : "Needs attention" },
    { key: "executing", title: locale === "zh-CN" ? "正在执行" : "Executing" },
    { key: "review", title: locale === "zh-CN" ? "等待审核" : "Waiting for review" },
    { key: "blocked", title: locale === "zh-CN" ? "阻塞与风险" : "Blocked and at risk" },
    { key: "completed", title: locale === "zh-CN" ? "最近完成" : "Recently completed" },
    { key: "other", title: locale === "zh-CN" ? "其他工作" : "Other work" }
  ];
  const grouped = new Map(groups.map(({ key }) => [
    key,
    items.filter((item) => groupFor(item) === key)
  ]));
  return (
    <section className="work-workspace" aria-label={locale === "zh-CN" ? "工作台" : "Work"}>
      <header className="work-intro">
        <h3>{locale === "zh-CN" ? "任务" : "Tasks"}</h3>
        <div className="work-toolbar">
          {onCreateTask && <button className="work-inline-link work-create-task" disabled={createTaskDisabled} onClick={onCreateTask} type="button">{locale === "zh-CN" ? "新建任务" : "New Task"}</button>}
          <div aria-label={locale === "zh-CN" ? "工作范围" : "Work scope"} className="work-scope" role="group">
            <button aria-pressed={scope === "mine"} onClick={() => onScopeChange("mine")} type="button">{locale === "zh-CN" ? "我的" : "Mine"}</button>
            <button aria-pressed={scope === "team"} onClick={() => onScopeChange("team")} type="button">{locale === "zh-CN" ? "团队" : "Team"}</button>
          </div>
          <button className="work-refresh" disabled={loading} onClick={onRefresh} type="button">
            {loading ? (locale === "zh-CN" ? "刷新中…" : "Refreshing…") : (locale === "zh-CN" ? "刷新" : "Refresh")}
          </button>
          {onCopyLink && <button className="work-inline-link" onClick={() => void onCopyLink()} type="button">{locale === "zh-CN" ? "复制当前链接" : "Copy current link"}</button>}
        </div>
      </header>
      {(hasAdvancedFilters || onSearchChange) && <section className="work-filter-bar" aria-label={locale === "zh-CN" ? "筛选工作" : "Filter work"}>
        <div className="work-filters work-filter-primary">
        {onSearchChange && <WorkSearchInput key={searchContext} value={search} locale={locale} onChange={onSearchChange} />}
        {onFiltersChange && <div className="work-quick-filters" role="group" aria-label={locale === "zh-CN" ? "快捷筛选" : "Quick filters"}>
          {attentionFilters.slice(0, 3).map((filter) => <button className="work-inline-link" type="button" aria-pressed={attention === filter.value} key={filter.value} onClick={() => onFiltersChange({ attention: attention === filter.value ? "" : filter.value })}>{locale === "zh-CN" ? filter.zh : filter.en}</button>)}
        </div>}
        {hasAdvancedFilters && <button aria-expanded={filtersOpen} aria-controls={filtersId} className="work-inline-link work-filter-toggle" type="button" onClick={() => setFiltersOpen((open) => !open)}>
          {locale === "zh-CN" ? "筛选" : "Filters"}{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}
        </button>}
        {hasFilters && <button className="work-inline-link" onClick={clearFilters} type="button">{locale === "zh-CN" ? "清除筛选" : "Clear filters"}</button>}
        </div>
        {activeFilters.length > 0 && <ul className="work-active-filters" aria-label={zh ? "已选筛选" : "Active filters"}>
          {activeFilters.map((filter) => <li key={String(filter)}>{filter}</li>)}
        </ul>}
        {hasAdvancedFilters && <div className="work-filters work-filter-advanced" id={filtersId} hidden={!filtersOpen}>
          {onFiltersChange && <>
          <label>{locale === "zh-CN" ? "关注原因" : "Attention"}<select value={attention} onChange={(event) => onFiltersChange({ attention: event.target.value as WorkFilters["attention"] })}>
            <option value="">{locale === "zh-CN" ? "全部原因" : "All reasons"}</option>
            {attentionFilters.map((filter) => <option value={filter.value} key={filter.value}>{locale === "zh-CN" ? filter.zh : filter.en}</option>)}
          </select></label>
          <label>{locale === "zh-CN" ? "筛选房间" : "Filter Room"}<select value={filterRoomId} onChange={(event) => onFiltersChange({ filterRoomId: event.target.value })}>
            <option value="">{locale === "zh-CN" ? "全部房间" : "All Rooms"}</option>
            {filterRoomId && !roomNames.has(filterRoomId) && <option value={filterRoomId}>{locale === "zh-CN" ? "房间不可用" : "Room unavailable"}</option>}
            {[...roomNames].map(([id, name]) => <option value={id} key={id}>{name}</option>)}
          </select></label>
          <label>{locale === "zh-CN" ? "筛选智能体" : "Filter Agent"}<select value={filterAgentId} onChange={(event) => onFiltersChange({ filterAgentId: event.target.value })}>
            <option value="">{locale === "zh-CN" ? "全部智能体" : "All Agents"}</option>
            {filterAgentId && !agentNames.has(filterAgentId) && <option value={filterAgentId}>{locale === "zh-CN" ? "智能体不可用" : "Agent unavailable"}</option>}
            {[...agentNames].map(([id, name]) => <option value={id} key={id}>{name}</option>)}
          </select></label>
          <label>{locale === "zh-CN" ? "优先级" : "Priority"}<select value={priority} onChange={(event) => onFiltersChange({ priority: event.target.value as WorkFilters["priority"] })}>
            <option value="">{locale === "zh-CN" ? "全部优先级" : "All priorities"}</option>
            {["low", "normal", "high", "urgent"].map((value) => <option value={value} key={value}>{label(value, locale)}</option>)}
          </select></label>
        </>}
        {onLifecycleStateChange && <label>{locale === "zh-CN" ? "任务状态" : "Task state"}<select onChange={(event) => onLifecycleStateChange(event.target.value)} value={lifecycleState}>
          <option value="">{locale === "zh-CN" ? "全部状态" : "All states"}</option>
          {["draft", "ready", "active", "review", "completed", "canceled"].map((state) => <option key={state} value={state}>{label(state, locale)}</option>)}
        </select></label>}
        {onOwnerMemberIdChange && <label>{locale === "zh-CN" ? "负责人" : "Owner"}<select onChange={(event) => onOwnerMemberIdChange(event.target.value)} value={ownerMemberId}>
          <option value="">{locale === "zh-CN" ? "全部负责人" : "All owners"}</option>
          {[...memberNames].map(([memberId, name]) => <option key={memberId} value={memberId}>{name}</option>)}
        </select></label>}
        </div>}
      </section>}
      {error && <p className="work-error" role="alert">{error}</p>}
      {!loading && !error && items.length === 0 ? (
        <div className="work-empty">
          <strong>{hasFilters ? (zh ? "没有匹配的任务" : "No matching tasks") : (zh ? "还没有任务" : "No tasks yet")}</strong>
          <p>{locale === "zh-CN"
            ? (hasFilters ? "调整搜索词或清除筛选后再试。" : onCreateTask ? "新建任务，写下目标并安排下一步。" : "切换范围，或进入房间创建任务。")
            : (hasFilters ? "Adjust your search or clear the filters." : onCreateTask ? "Create a task, describe the goal and plan the next step." : "Change scope or open a room to create a task.")}</p>
        </div>
      ) : (
        <div className="work-groups">
          {groups.map(({ key, title }) => {
            const groupItems = grouped.get(key) ?? [];
            if (groupItems.length === 0) return null;
            return (
              <section className={`work-group ${key}`} key={key}>
                <header><h4>{title}</h4><span>{groupItems.length}</span></header>
                <div className="work-card-grid">
                  {groupItems.map((item) => (
                    <WorkCard
                      agentNames={agentNames}
                      item={item}
                      key={item.taskId}
                      locale={locale}
                      memberNames={memberNames}
                      onOpenAction={onOpenAction}
                      onOpenTask={onOpenTask}
                      roomNames={roomNames}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {items.length > 0 && <footer className="work-pagination">
        <p role="status">{locale === "zh-CN" ? `已加载 ${items.length} 项工作` : `${items.length} work items loaded`}</p>
        {hasMore && onLoadMore && <button className="work-inline-link" disabled={loading || loadingMore} onClick={onLoadMore} type="button">{loadingMore ? (locale === "zh-CN" ? "加载中…" : "Loading…") : (locale === "zh-CN" ? "加载更多工作" : "Load more work")}</button>}
        {!hasMore && !loading && <small>{locale === "zh-CN" ? "已显示当前筛选下的全部工作" : "All work matching the current filters is shown"}</small>}
      </footer>}
    </section>
  );
}
