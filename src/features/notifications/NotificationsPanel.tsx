import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, Bell, CalendarClock, Check, CheckCheck, ChevronRight, KanbanSquare, LoaderCircle, MessageSquare, RefreshCcw, X } from "lucide-react";

import { ApprovalReviewCard } from "@/features/approvals/ApprovalReviewCard";
import { useSpendApprovals } from "@/features/approvals/use-spend-approvals";
import { MARKETPLACE_NOTE_MODE, marketplaceDecisionToView } from "@/features/dashboard/views/marketplace/marketplace-approval-model";
import { useMarketplaceDecisions } from "@/features/dashboard/views/marketplace/use-marketplace-decisions";
import type { SpendApprovalView } from "@/features/approvals/spend-approval-model";
import notificationStyles from "@/app/notifications.module.css";
import { ChatMarkdown } from "@/features/dashboard/ChatMarkdown";
import { createStyleClass } from "@/features/dashboard/style-classes";
import type { DashboardRouteTarget } from "@/features/dashboard/dashboard-navigation";
import {
  findWorkBoardTasks,
  flattenKanbanColumns,
  formatWorkBoardTaskForPrompt,
} from "@/features/dashboard/work-board-lookup";
import {
  chatDiscussContextForNotification,
  deriveNotificationActions,
  notificationTaskId,
  type NotificationActionDescriptor,
} from "@/features/notifications/notification-actions";
import { discussDraftForContext, type ChatDiscussContext } from "@/features/dashboard/chat-discuss-context";
import { clusterNotifications } from "@/features/notifications/notification-clustering";
import {
  groupNotifications,
  notificationActorMeta,
  notificationDisplayBody,
  notificationDisplayTitle,
  notificationIcon,
  notificationPriorityLabel,
} from "@/features/notifications/notification-display";
import { useQueenChat } from "@/features/queen-voice/queen-chat-store";
import type { AgentAutonomyReviewMode, AgentNotification, AgentNotificationSettings, AgentNotificationSummary } from "@/lib/types/agent-notifications";
import { formatReasoningTrailForPlainText } from "@/lib/types/reasoning-trail";
import { computeScheduleHealthWarnings, scheduleHealthWarningKey, visibleScheduleHealthWarnings } from "@/features/dashboard/schedule-health";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";
import type { AgentSchedule } from "@/features/dashboard/dashboard-types";

const notificationClass = createStyleClass(notificationStyles);

// Durable set of automation-health warnings the user has dismissed, keyed by
// kind+scheduleIds so an acknowledged warning stays hidden but a genuinely new
// one still surfaces. Shares the exact key the scheduler banner used, so
// dismissals persist across the move to the Alerts route.
const SCHEDULE_HEALTH_DISMISSED_KEY = "hivemindos.scheduleHealthDismissed.v1";

const AUTONOMY_REVIEW_OPTIONS: Array<{
  mode: AgentAutonomyReviewMode;
  label: string;
  detail: string;
}> = [
  { mode: "autonomous", label: "Autonomous", detail: "Agents keep going." },
  { mode: "review-high-risk", label: "Review high-risk", detail: "Spend, decisions & urgent first." },
  { mode: "review-all", label: "Review all", detail: "Everything waits for you." },
];

type NotificationFilter = "all" | "unread" | "attention" | "resolved";

const FILTERS: Array<{ id: NotificationFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "attention", label: "Need attention" },
  { id: "resolved", label: "Resolved" },
];

export type NotificationGroup = {
  label: string;
  items: AgentNotification[];
};

export type NotificationsPanelProps = {
  notifications: AgentNotification[];
  notificationGroups: NotificationGroup[];
  notificationSummary: AgentNotificationSummary | null;
  notificationCursor: string | number | null;
  notificationsLoading: boolean;
  notificationsStatus: string;
  fallbackFolder: string;
  vaultPath?: string;
  onRefresh: (options?: { append?: boolean }) => void | Promise<void>;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onOpenNotification?: (notification: AgentNotification) => void;
  /** Deep-link navigation for per-notification action buttons (route + section). */
  onNavigateTarget?: (target: DashboardRouteTarget) => void;
  onUpdateSettings: (settings: Partial<AgentNotificationSettings>) => void;
  /** All known schedules — powers the automation-health warnings surfaced here
   *  (moved out of the scheduler route's top banner). Optional so other callers
   *  that don't have schedules simply show no health warnings. */
  schedules?: AgentSchedule[];
  /** Open the /chat route on the Queen Bee agent with `context` pinned as a
   *  first-message badge and `draft` pre-filled in the composer. When omitted,
   *  Discuss falls back to the floating Queen chat bubble. */
  onDiscussInChat?: (context: ChatDiscussContext, draft: string) => void;
};

function isResolved(notification: AgentNotification) {
  return notification.resolution?.status === "resolved";
}

function needsApprovalReview(notification: AgentNotification) {
  if (isResolved(notification)) return false;
  return !notification.read && (
    notification.kind === "decision"
    || notification.priority === "urgent"
    || notification.priority === "high"
  );
}

function isNotificationForSpendApproval(notification: AgentNotification, approval: SpendApprovalView) {
  const id = approval.id.trim().toLowerCase();
  if (!id) return false;
  const tags = notification.tags.map((tag) => tag.toLowerCase());
  return tags.includes("wallet")
    && tags.includes("approval")
    && notification.id.toLowerCase().includes(id);
}

/** Compact relative timestamp for the meta column ("2 min ago", "Yst 22:10"). */
function formatRelativeStamp(value?: string) {
  if (!value) return "";
  const then = new Date(value);
  const time = then.getTime();
  if (Number.isNaN(time)) return value;
  const diffMs = Date.now() - time;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 12) return `${diffHr} hr ago`;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = new Date(then);
  day.setHours(0, 0, 0, 0);
  const diffDays = Math.round((startOfToday.getTime() - day.getTime()) / 86_400_000);
  const hhmm = then.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return hhmm;
  if (diffDays === 1) return `Yst ${hhmm}`;
  if (diffDays < 7) return then.toLocaleDateString([], { weekday: "short" });
  return then.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function NotificationsPanel({
  notifications,
  notificationSummary,
  notificationCursor,
  notificationsLoading,
  notificationsStatus,
  fallbackFolder,
  vaultPath,
  onRefresh,
  onMarkAllRead,
  onMarkRead,
  onNavigateTarget,
  onUpdateSettings,
  schedules,
  onDiscussInChat,
}: NotificationsPanelProps) {
  const queenChat = useQueenChat();
  // notification id → created board task id (flips "Send to board" into "Open task").
  const [boardTasks, setBoardTasks] = useState<Record<string, string>>({});
  const [boardBusyId, setBoardBusyId] = useState<string | null>(null);
  const [dismissBusyId, setDismissBusyId] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  // Consolidated look-alike notifications page through one card at a time.
  // Which look-alike clusters are expanded (open to show every member).
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(() => new Set());
  const [expandedNotificationId, setExpandedNotificationId] = useState<string | null>(null);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  // The real human-in-the-loop spend-approval queue (shared with the Zero Human
  // Companies approvals section). Powers the "Review first" rail + its modal.
  const spendApprovals = useSpendApprovals();
  // Marketplace decisions ride the same rail through their own endpoint.
  const marketplaceDecisions = useMarketplaceDecisions();

  // Automation-health warnings (duplicate loops, enabled-but-dead schedules) —
  // moved here from the scheduler route's top banner. Mount-time clock keeps
  // render pure; staleness thresholds are days-scale so hours of drift is fine.
  const [healthCheckedAt] = useState(() => Date.now());
  const scheduleHealthWarnings = useMemo(
    () => computeScheduleHealthWarnings(schedules ?? [], healthCheckedAt),
    [schedules, healthCheckedAt],
  );
  const [dismissedHealthRaw, rememberDismissedHealth] = useRememberedDashboardValue(SCHEDULE_HEALTH_DISMISSED_KEY);
  const dismissedHealthKeys = useMemo(() => {
    try {
      const parsed = JSON.parse(dismissedHealthRaw || "[]");
      return new Set<string>(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [dismissedHealthRaw]);
  const visibleHealthWarnings = useMemo(
    () => visibleScheduleHealthWarnings(scheduleHealthWarnings, dismissedHealthKeys),
    [scheduleHealthWarnings, dismissedHealthKeys],
  );
  const dismissHealthWarning = useCallback((warning: (typeof scheduleHealthWarnings)[number]) => {
    const liveKeys = new Set(scheduleHealthWarnings.map(scheduleHealthWarningKey));
    const next = [...dismissedHealthKeys, scheduleHealthWarningKey(warning)].filter((key) => liveKeys.has(key));
    rememberDismissedHealth(JSON.stringify([...new Set(next)]));
  }, [dismissedHealthKeys, rememberDismissedHealth, scheduleHealthWarnings]);

  // Auto-fill: the first page can collapse to a handful of rows (e.g. 38
  // look-alike escalations cluster into one +N row), leaving the tall list
  // underfilled — with nothing to scroll, the scroll-triggered load never
  // fires. Pull the next page whenever the loaded rows don't fill the viewport
  // (and there's more to load), so the list fills instead of stopping at the
  // first cluster. Terminates when the list fills or the cursor runs out.
  useEffect(() => {
    if (notificationsLoading || notificationCursor === null) return;
    const el = listScrollRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 40) void onRefresh({ append: true });
  }, [notifications, notificationsLoading, notificationCursor, filter, onRefresh]);

  const settings = notificationSummary?.settings;
  const autonomyReviewMode = settings?.autonomyReviewMode ?? "autonomous";
  const activeNotifications = useMemo(
    () => notifications.filter((notification) => !isResolved(notification)),
    [notifications],
  );

  const filterCounts = useMemo(() => ({
    all: activeNotifications.length,
    unread: activeNotifications.filter((notification) => !notification.read).length,
    attention: activeNotifications.filter(needsApprovalReview).length,
    resolved: notifications.filter(isResolved).length,
  }), [activeNotifications, notifications]);

  const decisionsCount = useMemo(
    () => activeNotifications.filter((notification) => !notification.read && notification.kind === "decision").length,
    [activeNotifications],
  );

  const visibleGroups = useMemo(() => {
    if (filter === "resolved") return groupNotifications(notifications.filter(isResolved));
    const active = filter === "unread"
      ? activeNotifications.filter((notification) => !notification.read)
      : filter === "attention"
        ? activeNotifications.filter(needsApprovalReview)
        : activeNotifications;
    return groupNotifications(active);
  }, [activeNotifications, filter, notifications]);

  const total = notificationSummary?.total ?? notifications.length;
  // Health warnings show above the vault notifications, but never in the
  // "Resolved" filter (they aren't resolvable vault items — they clear when the
  // schedule is fixed or the warning is dismissed).
  const healthShown = filter !== "resolved" && visibleHealthWarnings.length > 0;

  const sendToBoard = useCallback(async (notification: AgentNotification) => {
    setBoardBusyId(notification.id);
    setActionErrors((prev) => ({ ...prev, [notification.id]: "" }));
    try {
      const res = await fetch("/api/kanban", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: notification.title,
          body: `${notification.body}\n\n—\nCreated from dashboard notification ${notification.id}${notification.source ? ` (${notification.source})` : ""}.`,
          priority: notification.priority === "urgent" || notification.priority === "high" ? "high" : "normal",
          // Double-clicks and re-renders must not mint duplicate tasks.
          idempotencyKey: `notification:${notification.id}`,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; task?: { id?: string }; error?: string };
      if (!res.ok || !json.ok || !json.task?.id) throw new Error(json.error || `Work Board returned HTTP ${res.status}`);
      setBoardTasks((prev) => ({ ...prev, [notification.id]: json.task!.id! }));
      onMarkRead(notification.id);
    } catch (error) {
      setActionErrors((prev) => ({ ...prev, [notification.id]: error instanceof Error ? error.message : "Could not create the board task." }));
    } finally {
      setBoardBusyId(null);
    }
  }, [onMarkRead]);

  const discussWithQueen = useCallback(async (notification: AgentNotification, prompt: string) => {
    // Inline the referenced Work Board record so the Queen answers from facts
    // instead of hunting for the task. Best-effort with a short timeout.
    let enriched = prompt;
    const taskId = notificationTaskId(notification);
    if (taskId) {
      try {
        const res = await fetch("/api/kanban", { cache: "no-store", signal: AbortSignal.timeout(4_000) });
        const data = (await res.json().catch(() => null)) as { columns?: unknown } | null;
        const hit = data ? findWorkBoardTasks(flattenKanbanColumns(data.columns), { taskId })[0] : undefined;
        if (hit) enriched = `${prompt}\n\nCurrent Work Board record (fetched just now — answer from this):\n${formatWorkBoardTaskForPrompt(hit)}`;
      } catch {
        // board unreachable — send the base prompt
      }
    }
    // Expand the persistent chat bubble, send the context turn, and put the
    // cursor in the input so the follow-up question is one keystroke away.
    queenChat.setHistoryMinimized(false);
    void queenChat.sendText(enriched, { suppressWalletIntents: true });
    onMarkRead(notification.id);
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>("body > .fr-root .fr-chat-input")
        ?? document.querySelector<HTMLInputElement>(".fr-chat-input");
      input?.focus();
    }, 250);
  }, [onMarkRead, queenChat]);

  const runAction = useCallback((notification: AgentNotification, action: NotificationActionDescriptor) => {
    if (action.type === "navigate") {
      onNavigateTarget?.(action.target);
      return;
    }
    if (action.type === "work-board") {
      void sendToBoard(notification);
      return;
    }
    // Discuss: open the /chat route on the Queen with this alert pinned as a
    // context badge; fall back to the floating bubble when the host didn't wire
    // the chat route in.
    if (onDiscussInChat) {
      const context = chatDiscussContextForNotification(notification);
      onDiscussInChat(context, discussDraftForContext(context));
      onMarkRead(notification.id);
      return;
    }
    void discussWithQueen(notification, action.prompt);
  }, [discussWithQueen, onDiscussInChat, onMarkRead, onNavigateTarget, sendToBoard]);

  const dismissNotification = useCallback(async (notification: AgentNotification) => {
    setDismissBusyId(notification.id);
    setActionErrors((prev) => ({ ...prev, [notification.id]: "" }));
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "dismiss",
          id: notification.id,
          vaultPath: vaultPath || undefined,
          notificationsFolder: fallbackFolder || undefined,
        }),
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not dismiss this alert.");
      await onRefresh();
    } catch (error) {
      setActionErrors((prev) => ({
        ...prev,
        [notification.id]: error instanceof Error ? error.message : "Could not dismiss this alert.",
      }));
    } finally {
      setDismissBusyId(null);
    }
  }, [fallbackFolder, onRefresh, vaultPath]);

  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  const toggleCluster = (key: string) => {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleNotificationExpansion = useCallback((notificationId: string) => {
    setExpandedNotificationId((current) => current === notificationId ? null : notificationId);
  }, []);

  const discussApproval = useCallback((approval: SpendApprovalView) => {
    // Prefer the /chat route: pin the approval as a context badge and pre-fill a
    // draft, so the user talks it over with the Queen with the real request in
    // scope. Falls back to the floating bubble when the chat route isn't wired.
    if (onDiscussInChat) {
      const context: ChatDiscussContext = {
        id: `approval:${approval.id}`,
        kind: "approval",
        label: approval.title,
        body: [
          approval.title,
          `Requested by ${approval.agent} · ${approval.kind}${approval.amountUsd != null ? ` · $${approval.amountUsd.toFixed(2)} ${approval.asset ?? "USDC"}` : ""}`,
          approval.reason ? `Reason: ${approval.reason}` : "",
          approval.explanation ? `Reasoning trail:\n${formatReasoningTrailForPlainText(approval.explanation)}` : "",
        ].filter(Boolean).join("\n"),
      };
      onDiscussInChat(context, discussDraftForContext(context));
      return;
    }
    queenChat.setHistoryMinimized(false);
    void queenChat.sendText([
      "I'm reviewing a spend-approval request and want your take before I decide:",
      "",
      approval.title,
      `Requested by ${approval.agent} · ${approval.kind}${approval.amountUsd != null ? ` · $${approval.amountUsd.toFixed(2)} ${approval.asset ?? "USDC"}` : ""}`,
      approval.reason ? `Reason: ${approval.reason}` : "",
      approval.explanation ? `Reasoning trail:\n${formatReasoningTrailForPlainText(approval.explanation)}` : "",
      "",
      "Should I approve or reject this? If reject, what change should I ask the agent for?",
    ].filter(Boolean).join("\n"), { suppressWalletIntents: true });
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>("body > .fr-root .fr-chat-input")
        ?? document.querySelector<HTMLInputElement>(".fr-chat-input");
      input?.focus();
    }, 250);
  }, [onDiscussInChat, queenChat]);

  const renderActions = (notification: AgentNotification) => {
    const derived = deriveNotificationActions(notification);
    const createdTaskId = boardTasks[notification.id];
    return (
      <div className={notificationClass("rowActions")} onClick={stop} role="group" aria-label="Alert actions">
        {createdTaskId ? (
          <button
            type="button"
            className={notificationClass("actionBtn", "primary")}
            onClick={() => onNavigateTarget?.({ view: "kanban", taskId: createdTaskId, openTask: true })}
          >
            <KanbanSquare aria-hidden="true" />
            On the board — open task
          </button>
        ) : null}
        {derived.map((action) => {
          if (action.type === "work-board" && createdTaskId) return null;
          if (action.type === "navigate" && !onNavigateTarget) return null;
          const busy = action.type === "work-board" && boardBusyId === notification.id;
          return (
            <button
              key={`${notification.id}-action-${action.label}`}
              type="button"
              className={notificationClass("actionBtn")}
              disabled={busy}
              onClick={() => runAction(notification, action)}
            >
              {busy ? <LoaderCircle aria-hidden="true" className={notificationClass("spinIcon")} />
                : action.type === "discuss" ? <MessageSquare aria-hidden="true" />
                : action.type === "work-board" ? <KanbanSquare aria-hidden="true" />
                : <ArrowUpRight aria-hidden="true" />}
              {busy ? "Sending" : action.label}
            </button>
          );
        })}
        {!notification.read ? (
          <button
            type="button"
            className={notificationClass("actionBtn", "readBtn")}
            onClick={() => onMarkRead(notification.id)}
          >
            <Check aria-hidden="true" />
            Read
          </button>
        ) : null}
        {!isResolved(notification) ? (
          <button
            type="button"
            className={notificationClass("actionBtn", "dismissBtn")}
            disabled={dismissBusyId === notification.id}
            onClick={() => void dismissNotification(notification)}
          >
            {dismissBusyId === notification.id ? (
              <LoaderCircle aria-hidden="true" className={notificationClass("spinIcon")} />
            ) : (
              <X aria-hidden="true" />
            )}
            {dismissBusyId === notification.id ? "Dismissing" : "Dismiss"}
          </button>
        ) : null}
        {actionErrors[notification.id] ? (
          <span className={notificationClass("actionError")}>{actionErrors[notification.id]}</span>
        ) : null}
      </div>
    );
  };

  const renderRow = (
    notification: AgentNotification,
    key: string,
    cluster: { total: number; unread: number; expanded: boolean; onToggle: () => void } | null,
  ) => {
    const actor = notificationActorMeta(notification);
    const resolved = isResolved(notification);
    const expanded = expandedNotificationId === notification.id;
    const bodyText = notification.body
      ? `**${actor.label}** · ${notificationDisplayBody(notification)}`
      : `**${actor.label}**`;
    return (
      <div
        key={key}
        className={notificationClass("row", notification.priority, resolved && "resolved", expanded && "open")}
        tabIndex={0}
        role="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} alert: ${notificationDisplayTitle(notification)}`}
        onClick={() => toggleNotificationExpansion(notification.id)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleNotificationExpansion(notification.id);
          }
        }}
      >
        <span className={notificationClass("rowGlyph")}>
          {notificationIcon(notification.kind, notification.priority)}
        </span>
        <div className={notificationClass("rowMain")}>
          <div className={notificationClass("rowTitleLine")}>
            <b className={notificationClass("rowTitle")}>{notificationDisplayTitle(notification)}</b>
            {!notification.read ? <span className={notificationClass("unreadDot")} aria-label="Unread" /> : null}
            {cluster ? (
              <button
                type="button"
                className={notificationClass("clusterBadge", cluster.expanded && "expanded")}
                aria-expanded={cluster.expanded}
                title={`${cluster.total} similar${cluster.unread ? ` · ${cluster.unread} unread` : ""} — ${cluster.expanded ? "collapse" : "expand"}`}
                onClick={(event) => { event.stopPropagation(); cluster.onToggle(); }}
              >
                <ChevronRight aria-hidden="true" className={notificationClass("clusterChevron")} />
                {cluster.expanded ? `${cluster.total} similar` : `+${cluster.total - 1}`}
              </button>
            ) : null}
          </div>
          <div className={notificationClass("expandWrap")}>
            <ChatMarkdown
              text={bodyText}
              className={notificationClass("rowBody")}
            />
            {notification.resolution ? (
              <p className={notificationClass("resolutionNote")}>
                {resolved ? "Resolved" : "Resolution in progress"}
                {notification.resolution.note ? ` — ${notification.resolution.note}` : ""}
              </p>
            ) : null}
            {renderActions(notification)}
          </div>
        </div>
        <div className={notificationClass("rowMeta")}>
          {resolved ? (
            <span className={notificationClass("resolvedPill")}>✓ resolved</span>
          ) : (
            <span className={notificationClass("priorityPill")}>{notificationPriorityLabel(notification.priority)}</span>
          )}
          <time className={notificationClass("rowTime")} dateTime={notification.createdAt}>
            {formatRelativeStamp(notification.createdAt)}
          </time>
        </div>
      </div>
    );
  };

  return (
    <section className={notificationClass("notificationsPanel", "tabPanel")} aria-label="Alerts">
      <header className={notificationClass("alertsHeader")}>
        <div>
          <p className={notificationClass("alertsEyebrow")}>What needs attention</p>
          <h1 className={notificationClass("alertsTitle")}>Alerts</h1>
        </div>
        <div className={notificationClass("headerActions")}>
          <button
            type="button"
            className={notificationClass("headerBtn")}
            onClick={() => void onRefresh()}
            disabled={notificationsLoading}
          >
            <RefreshCcw aria-hidden="true" className={notificationsLoading ? notificationClass("spinIcon") : undefined} />
            {notificationsLoading ? "Refreshing" : "Refresh"}
          </button>
          <button
            type="button"
            className={notificationClass("headerBtn", "headerBtnPrimary")}
            onClick={onMarkAllRead}
            disabled={!notificationSummary?.unread}
          >
            <CheckCheck aria-hidden="true" />
            Mark all read
          </button>
        </div>
      </header>

      <div className={notificationClass("twoCol")}>
        <main className={notificationClass("mainCol")}>
          <div className={notificationClass("notificationsCard")}>
            <div className={notificationClass("filterTabs")} role="tablist" aria-label="Filter alerts">
              {FILTERS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === entry.id}
                  className={notificationClass("filterTab", filter === entry.id && "active")}
                  onClick={() => setFilter(entry.id)}
                >
                  {entry.label}
                  {filterCounts[entry.id] ? <span className={notificationClass("filterTabCount")}>{filterCounts[entry.id]}</span> : null}
                </button>
              ))}
              <span className={notificationClass("tabsTotal")}>{total} total</span>
            </div>

            <div
              className={notificationClass("listScroll")}
              ref={listScrollRef}
              onScroll={(event) => {
                const el = event.currentTarget;
                // Infinite scroll — pull the next page as the reader nears the bottom.
                if (notificationsLoading || notificationCursor === null) return;
                if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) void onRefresh({ append: true });
              }}
            >
              {healthShown ? (
                <section className={notificationClass("dayGroup")} aria-label="Automation health">
                  <p className={notificationClass("dayLabel")}>Automation health</p>
                  {visibleHealthWarnings.map((warning) => (
                    <div key={scheduleHealthWarningKey(warning)} className={notificationClass("row", "high", "open")}>
                      <span className={notificationClass("rowGlyph")}><AlertTriangle aria-hidden="true" /></span>
                      <div className={notificationClass("rowMain")}>
                        <div className={notificationClass("rowTitleLine")}>
                          <b className={notificationClass("rowTitle")}>{warning.title}</b>
                        </div>
                        <div className={notificationClass("expandWrap")}>
                          <ChatMarkdown text={warning.detail} className={notificationClass("rowBody")} />
                          <div className={notificationClass("rowActions")} role="group" aria-label="Automation health actions">
                            <button
                              type="button"
                              className={notificationClass("actionBtn", "primary")}
                              onClick={() => onNavigateTarget?.({ view: "scheduler" })}
                            >
                              <CalendarClock aria-hidden="true" />
                              Open scheduler
                            </button>
                            {onDiscussInChat ? (
                              <button
                                type="button"
                                className={notificationClass("actionBtn")}
                                onClick={() => {
                                  const context: ChatDiscussContext = {
                                    id: `automation-health:${scheduleHealthWarningKey(warning)}`,
                                    kind: "automation-health",
                                    label: warning.title,
                                    body: `${warning.title}\n${warning.detail}`,
                                  };
                                  onDiscussInChat(context, discussDraftForContext(context));
                                }}
                              >
                                <MessageSquare aria-hidden="true" />
                                Discuss
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={notificationClass("actionBtn", "dismissBtn")}
                              onClick={() => dismissHealthWarning(warning)}
                            >
                              <X aria-hidden="true" />
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className={notificationClass("rowMeta")}>
                        <span className={notificationClass("priorityPill")}>Schedules</span>
                      </div>
                    </div>
                  ))}
                </section>
              ) : null}

              {visibleGroups.length ? (
                <div className={notificationClass("dayGroups")}>
                  {visibleGroups.map((group) => (
                    <section key={group.label} className={notificationClass("dayGroup")}>
                      <p className={notificationClass("dayLabel")}>{group.label}</p>
                      {clusterNotifications(group.items).map((cluster) => {
                        const count = cluster.items.length;
                        if (count === 1) return renderRow(cluster.items[0], cluster.items[0].id, null);
                        // Key expansion on the stable anchor id so the open/closed
                        // state survives a refresh.
                        const anchorId = cluster.items[0].id;
                        const stateKey = `${group.label}::${anchorId}`;
                        const expanded = expandedClusters.has(stateKey);
                        const unread = cluster.items.filter((item) => !item.read).length;
                        const clusterMeta = { total: count, unread, expanded, onToggle: () => toggleCluster(stateKey) };
                        // Collapsed: one representative row with the expand toggle.
                        if (!expanded) return renderRow(cluster.items[0], anchorId, clusterMeta);
                        // Expanded: the representative + every other member, grouped.
                        return (
                          <div key={stateKey} className={notificationClass("clusterGroup")}>
                            {renderRow(cluster.items[0], anchorId, clusterMeta)}
                            <div className={notificationClass("clusterMembers")}>
                              {cluster.items.slice(1).map((item) => renderRow(item, item.id, null))}
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  ))}
                  {notificationCursor !== null ? (
                    <button
                      type="button"
                      className={notificationClass("actionBtn", "loadMore")}
                      onClick={() => void onRefresh({ append: true })}
                      disabled={notificationsLoading}
                    >
                      {notificationsLoading ? <LoaderCircle aria-hidden="true" className={notificationClass("spinIcon")} /> : null}
                      {notificationsLoading ? "Loading more" : "Load more"}
                    </button>
                  ) : null}
                </div>
              ) : healthShown ? null : (
                <div className={notificationClass("emptyState")} role="status">
                  <Bell aria-hidden="true" />
                  <strong>{filter === "all" ? "No alerts yet" : "Nothing here"}</strong>
                  <p>
                    {filter === "all"
                      ? "When an agent writes to the vault folder, this tab picks it up and the nav badge lights up."
                      : "No alerts match this filter right now."}
                  </p>
                </div>
              )}
            </div>

            {notificationsStatus ? <p className={notificationClass("statusLine")}>{notificationsStatus}</p> : null}
          </div>
        </main>

        <aside className={notificationClass("sideCol")} aria-label="Review and settings">
          <div className={notificationClass("sidePanel")}>
            <p className={notificationClass("sidePanelLabel")}>Overview</p>
            <div className={notificationClass("overviewGrid")}>
              <div className={notificationClass("overviewRow")}><span>Unread</span><b>{filterCounts.unread}</b></div>
              <div className={notificationClass("overviewDivider")} />
              <div className={notificationClass("overviewRow")}><span>Need attention</span><b>{filterCounts.attention}</b></div>
              <div className={notificationClass("overviewDivider")} />
              <div className={notificationClass("overviewRow")}><span>Decisions</span><b>{decisionsCount}</b></div>
            </div>
          </div>

          {spendApprovals.approvals.length || marketplaceDecisions.decisions.length ? (
            <div className={notificationClass("sidePanel")}>
              <div className={notificationClass("sidePanelHead")}>
                <p className={notificationClass("sidePanelLabel")}>Review first</p>
                <span className={notificationClass("reviewCount")}>{spendApprovals.approvals.length + marketplaceDecisions.decisions.length}</span>
              </div>
              <div className={notificationClass("reviewList")}>
                {marketplaceDecisions.decisions.map((decision) => (
                  <ApprovalReviewCard
                    key={decision.id}
                    approval={marketplaceDecisionToView(decision)}
                    noteMode={MARKETPLACE_NOTE_MODE}
                    busy={marketplaceDecisions.busyId === decision.id}
                    error={marketplaceDecisions.error || undefined}
                    onDecide={(verdict, note, makeStanding) => marketplaceDecisions.decide(decision.id, verdict, note, Boolean(makeStanding))}
                  />
                ))}
                {spendApprovals.approvals.map((approval) => (
                  <ApprovalReviewCard
                    key={approval.id}
                    approval={approval}
                    busy={spendApprovals.busyId === approval.id}
                    error={spendApprovals.error || undefined}
                    onDecide={async (decision, note) => {
                      const ok = await spendApprovals.decide(approval.id, decision, note);
                      if (ok) {
                        const matchingIds = notifications
                          .filter((notification) => isNotificationForSpendApproval(notification, approval))
                          .map((notification) => notification.id);
                        await Promise.all(matchingIds.map((id) => onMarkRead(id)));
                        void onRefresh();
                      }
                      return ok;
                    }}
                    onDiscuss={() => discussApproval(approval)}
                  />
                ))}
              </div>
              {spendApprovals.error ? <p className={notificationClass("reviewError")}>{spendApprovals.error}</p> : null}
            </div>
          ) : null}

          <div className={notificationClass("sidePanel")}>
            <div>
              <p className={notificationClass("sidePanelLabel")}>Autonomy</p>
              <p className={notificationClass("autonomyIntro")}>Fully autonomous by default. Choose how much routes to you.</p>
            </div>
            <div className={notificationClass("modeStack")} role="radiogroup" aria-label="Autonomy review mode">
              {AUTONOMY_REVIEW_OPTIONS.map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  role="radio"
                  aria-checked={autonomyReviewMode === option.mode}
                  className={notificationClass("modeBtn", autonomyReviewMode === option.mode && "active")}
                  onClick={() => onUpdateSettings({ autonomyReviewMode: option.mode })}
                >
                  <b className={notificationClass("modeBtnLabel")}>{option.label}</b>
                  <span className={notificationClass("modeBtnDetail")}>{option.detail}</span>
                </button>
              ))}
            </div>
            <div className={notificationClass("escalateRow")}>
              <span className={notificationClass("escalateText")}>
                <b>Message me for urgent items</b>
                <span>Off by default. Sends to your linked channel.</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(settings?.highPriorityMessagingEnabled)}
                aria-label="Message me for urgent items"
                className={notificationClass("escalateTrack", settings?.highPriorityMessagingEnabled && "on")}
                onClick={() => onUpdateSettings({ highPriorityMessagingEnabled: !settings?.highPriorityMessagingEnabled })}
              >
                <span className={notificationClass("escalateKnob")} />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
