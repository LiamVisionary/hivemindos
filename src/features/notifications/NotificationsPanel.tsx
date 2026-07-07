import Image from "next/image";
import { useCallback, useState } from "react";
import { ArrowUpRight, Bell, Bot, Check, CheckCheck, ChevronLeft, ChevronRight, KanbanSquare, LoaderCircle, MessageSquare, RefreshCcw, ShieldCheck, SlidersHorizontal } from "lucide-react";

import notificationStyles from "@/app/notifications.module.css";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "@/features/dashboard/ChatMarkdown";
import { createStyleClass } from "@/features/dashboard/style-classes";
import type { DashboardRouteTarget } from "@/features/dashboard/dashboard-navigation";
import {
  findWorkBoardTasks,
  flattenKanbanColumns,
  formatWorkBoardTaskForPrompt,
} from "@/features/dashboard/work-board-lookup";
import {
  deriveNotificationActions,
  notificationTaskId,
  type NotificationActionDescriptor,
} from "@/features/notifications/notification-actions";
import { clusterNotifications } from "@/features/notifications/notification-clustering";
import {
  notificationActorMeta,
  notificationDisplayBody,
  notificationDisplayTitle,
  notificationIcon,
  notificationKindLabel,
  notificationPriorityLabel,
  notificationSourceLabel,
  notificationTagLabel,
} from "@/features/notifications/notification-display";
import { useQueenChat } from "@/features/queen-voice/queen-chat-store";
import type { AgentAutonomyReviewMode, AgentNotification, AgentNotificationSettings, AgentNotificationSummary } from "@/lib/types/agent-notifications";

const notificationClass = createStyleClass(notificationStyles);

const AUTONOMY_REVIEW_OPTIONS: Array<{
  mode: AgentAutonomyReviewMode;
  label: string;
  detail: string;
}> = [
  {
    mode: "autonomous",
    label: "Autonomous",
    detail: "Agents keep moving unless they choose to escalate.",
  },
  {
    mode: "review-high-risk",
    label: "Review high risk",
    detail: "Decisions, urgent items, spend, and external actions come here first.",
  },
  {
    mode: "review-all",
    label: "Review everything",
    detail: "Every approval-style action waits for human review.",
  },
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
  onRefresh: (options?: { append?: boolean }) => void | Promise<void>;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onOpenNotification?: (notification: AgentNotification) => void;
  /** Deep-link navigation for per-notification action buttons (route + section). */
  onNavigateTarget?: (target: DashboardRouteTarget) => void;
  onUpdateSettings: (settings: Partial<AgentNotificationSettings>) => void;
};

function formatNotificationDate(value?: string) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function needsApprovalReview(notification: AgentNotification) {
  if (notification.resolution?.status === "resolved") return false;
  return !notification.read && (
    notification.kind === "decision"
    || notification.priority === "urgent"
    || notification.priority === "high"
  );
}

function reviewPrompt(notification: AgentNotification) {
  return [
    "Help me review this agent inbox item and recommend what I should do next.",
    `Title: ${notificationDisplayTitle(notification)}`,
    `Agent: ${notification.agentName}`,
    `Priority: ${notification.priority}`,
    `Kind: ${notification.kind}`,
    notification.source ? `Source: ${notification.source}` : "",
    "",
    notificationDisplayBody(notification),
  ].filter(Boolean).join("\n");
}

export function NotificationsPanel({
  notifications,
  notificationGroups,
  notificationSummary,
  notificationCursor,
  notificationsLoading,
  notificationsStatus,
  fallbackFolder,
  onRefresh,
  onMarkAllRead,
  onMarkRead,
  onOpenNotification,
  onNavigateTarget,
  onUpdateSettings,
}: NotificationsPanelProps) {
  const queenChat = useQueenChat();
  // notification id → created board task id (flips "Send to board" into "Open task").
  const [boardTasks, setBoardTasks] = useState<Record<string, string>>({});
  const [boardBusyId, setBoardBusyId] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  // Consolidated look-alike notifications page through one card at a time.
  // Keyed by `${dayLabel}::${clusterKey}` so same-titled stacks in different
  // day groups keep independent positions.
  const [clusterCursor, setClusterCursor] = useState<Record<string, number>>({});
  const autonomyReviewMode = notificationSummary?.settings.autonomyReviewMode ?? "autonomous";
  const approvalItems = notifications.filter(needsApprovalReview).slice(0, 4);
  const decisionCount = notifications.filter((notification) => !notification.read && notification.kind === "decision").length;
  const highPriorityCount = (notificationSummary?.highUnread ?? 0) + (notificationSummary?.urgentUnread ?? 0);

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
    // instead of hunting for the task (her first real Discuss click went
    // looking for a nonexistent "task directory"). Best-effort with a short
    // timeout — the base prompt still works without it.
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
    void queenChat.sendText(enriched);
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
    void discussWithQueen(notification, action.prompt);
  }, [discussWithQueen, onNavigateTarget, sendToBoard]);

  const renderNotificationCard = (notification: AgentNotification) => {
    const actor = notificationActorMeta(notification);
    const sourceLabel = notificationSourceLabel(notification);
    return (
      <article
        key={notification.id}
        className={notificationClass("notificationCard", notification.priority, !notification.read && "unread")}
        role={onOpenNotification ? "button" : undefined}
        tabIndex={onOpenNotification ? 0 : undefined}
        onClick={() => onOpenNotification?.(notification)}
        onKeyDown={(event) => {
          if (!onOpenNotification) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenNotification(notification);
          }
        }}
      >
        <div className={notificationClass("notificationGlyph")}>
          {notificationIcon(notification.kind, notification.priority)}
        </div>
        <div className={notificationClass("notificationBody")}>
          <div className={notificationClass("notificationMetaRow")}>
            <div>
              <h3>{notificationDisplayTitle(notification)}</h3>
              <div className={notificationClass("notificationActorRow")}>
                <span className={notificationClass("notificationActorBadge", actor.icon && "withIcon")}>
                  {actor.icon ? <Image src={actor.icon} alt="" width={20} height={20} aria-hidden="true" unoptimized /> : null}
                  <span>
                    <b>{actor.label}</b>
                    <small>{actor.role}</small>
                  </span>
                </span>
                {sourceLabel ? (
                  <span className={notificationClass("notificationSourcePill")}>
                    {sourceLabel.startsWith("Task: ") ? (
                      <>
                        <small>Task</small>
                        <b>{sourceLabel.slice("Task: ".length)}</b>
                      </>
                    ) : sourceLabel}
                  </span>
                ) : null}
              </div>
            </div>
            <time>{formatNotificationDate(notification.createdAt)}</time>
          </div>
          {notification.body ? (
            <ChatMarkdown
              text={notificationDisplayBody(notification)}
              className={notificationClass("notificationMarkdown")}
              headingClassName={notificationClass("notificationMarkdownHeading")}
            />
          ) : null}
          {notification.resolution ? (
            <p className={notificationClass("resolutionNote", notification.resolution.status)}>
              {notification.resolution.status === "resolved" ? "Resolved" : "Resolution in progress"}
              {notification.resolution.note ? ` — ${notification.resolution.note}` : ""}
              <time> ({formatNotificationDate(notification.resolution.updatedAt)})</time>
            </p>
          ) : null}
          <div className={notificationClass("notificationFooter")}>
            <div className={notificationClass("notificationTags")}>
              {notification.resolution ? (
                <span className={notificationClass("resolutionPill", notification.resolution.status)}>
                  {notification.resolution.status === "resolved" ? "✓ resolved" : "resolution in progress…"}
                </span>
              ) : null}
              <span className={notificationClass("priorityPill", notification.priority)}>{notificationPriorityLabel(notification.priority)}</span>
              <span className={notificationClass("kindPill")}>{notificationKindLabel(notification.kind)}</span>
              {notification.read ? <span className={notificationClass("readPill")}>read</span> : null}
              {/* task:<id> tags are structured routing data for the action buttons, not labels */}
              {notification.tags.filter((tag) => !tag.toLowerCase().startsWith("task:")).slice(0, 4).map((tag) => <span className={notificationClass("kindPill")} key={`${notification.id}-${tag}`}>{notificationTagLabel(tag)}</span>)}
            </div>
            {!notification.read ? (
              <Button type="button" size="sm" variant="secondary" onClick={(event) => {
                event.stopPropagation();
                onMarkRead(notification.id);
              }}>
                <Check aria-hidden="true" />
                Read
              </Button>
            ) : null}
          </div>
          <div className={notificationClass("notificationActions")}>
            {boardTasks[notification.id] ? (
              <Button type="button" size="sm" onClick={(event) => {
                event.stopPropagation();
                onNavigateTarget?.({ view: "kanban", taskId: boardTasks[notification.id] });
              }}>
                <KanbanSquare aria-hidden="true" />
                On the board — open task
              </Button>
            ) : null}
            {deriveNotificationActions(notification).map((action) => {
              if (action.type === "work-board" && boardTasks[notification.id]) return null;
              if (action.type === "navigate" && !onNavigateTarget) return null;
              const busy = action.type === "work-board" && boardBusyId === notification.id;
              return (
                <Button
                  key={`${notification.id}-action-${action.label}`}
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    runAction(notification, action);
                  }}
                >
                  {busy ? <LoaderCircle aria-hidden="true" className={notificationClass("spinIcon")} />
                    : action.type === "discuss" ? <MessageSquare aria-hidden="true" />
                    : action.type === "work-board" ? <KanbanSquare aria-hidden="true" />
                    : <ArrowUpRight aria-hidden="true" />}
                  {busy ? "Sending" : action.label}
                </Button>
              );
            })}
            {actionErrors[notification.id] ? (
              <span className={notificationClass("notificationActionError")}>{actionErrors[notification.id]}</span>
            ) : null}
          </div>
        </div>
      </article>
    );
  };

  return (
    <section className={notificationClass("notificationsPanel", "tabPanel")}>
      <div className={notificationClass("notificationsHeader")}>
        <div>
          <p className="eyebrow">Hive Alerts</p>
          <h2>Alerts, decisions, and approvals</h2>
          <p>Agents can keep operating autonomously, escalate high-priority items, or route approval-style decisions here based on your review mode.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => void onRefresh()} disabled={notificationsLoading}>
            <RefreshCcw aria-hidden="true" className={notificationsLoading ? notificationClass("spinIcon") : undefined} />
            {notificationsLoading ? "Refreshing" : "Refresh"}
          </Button>
          <Button type="button" size="sm" onClick={onMarkAllRead} disabled={!notificationSummary?.unread}>
            <CheckCheck aria-hidden="true" />
            Mark read
          </Button>
        </div>
      </div>

      <div className={notificationClass("inboxSummaryGrid")}>
        <article>
          <Bell aria-hidden="true" />
          <span>Unread</span>
          <strong>{notificationSummary?.unread ?? 0}</strong>
        </article>
        <article>
          <SlidersHorizontal aria-hidden="true" />
          <span>Decisions</span>
          <strong>{decisionCount}</strong>
        </article>
        <article>
          <ShieldCheck aria-hidden="true" />
          <span>Priority</span>
          <strong>{highPriorityCount}</strong>
        </article>
        <article>
          <Bot aria-hidden="true" />
          <span>Mode</span>
          <strong>{AUTONOMY_REVIEW_OPTIONS.find((option) => option.mode === autonomyReviewMode)?.label ?? "Autonomous"}</strong>
        </article>
      </div>

      <div className={notificationClass("notificationsControls")}>
        <div className={notificationClass("notificationStats")}>
          <span><strong>{notificationSummary?.total ?? 0}</strong> total</span>
          <span><strong>{notificationSummary?.unread ?? 0}</strong> unread</span>
          <span><strong>{(notificationSummary?.highUnread ?? 0) + (notificationSummary?.urgentUnread ?? 0)}</strong> high priority</span>
          <span title={notificationSummary?.folder}>/{notificationSummary?.folder ?? fallbackFolder}</span>
        </div>
        <div className={notificationClass("inboxSettings")}>
          <div className={notificationClass("autonomyReview")}>
            <div>
              <strong>Autonomy review mode</strong>
              <span>Configurable, never mandatory. Fully autonomous remains the default.</span>
            </div>
            <div className={notificationClass("autonomySegments")} role="radiogroup" aria-label="Autonomy review mode">
              {AUTONOMY_REVIEW_OPTIONS.map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  role="radio"
                  aria-checked={autonomyReviewMode === option.mode}
                  className={notificationClass(autonomyReviewMode === option.mode && "active")}
                  onClick={() => onUpdateSettings({ autonomyReviewMode: option.mode })}
                >
                  <strong>{option.label}</strong>
                  <span>{option.detail}</span>
                </button>
              ))}
            </div>
          </div>
          <label className={notificationClass("notificationSetting")}>
            <span>
              <strong>Escalate high priority</strong>
              <span>Off by default. If enabled, your agent can message you via the configured channel.</span>
            </span>
            <input
              type="checkbox"
              checked={Boolean(notificationSummary?.settings.highPriorityMessagingEnabled)}
              onChange={(event) => onUpdateSettings({ highPriorityMessagingEnabled: event.target.checked })}
            />
          </label>
        </div>
      </div>

      {approvalItems.length ? (
        <section className={notificationClass("approvalLane")} aria-label="Approval review queue">
          <div className={notificationClass("approvalLaneHeader")}>
            <div>
              <p className="eyebrow">Review queue</p>
              <h3>Needs your eyes</h3>
            </div>
            <span>{approvalItems.length} visible</span>
          </div>
          <div className={notificationClass("approvalCards")}>
            {approvalItems.map((notification) => (
              <article key={`approval-${notification.id}`} className={notificationClass("approvalCard", notification.priority)}>
                <div>
                  <span>{notificationKindLabel(notification.kind)} · {notificationPriorityLabel(notification.priority)}</span>
                  <strong>{notificationDisplayTitle(notification)}</strong>
                  <small>{notification.agentName} · {formatNotificationDate(notification.createdAt)}</small>
                </div>
                <div className={notificationClass("approvalActions")}>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void discussWithQueen(notification, reviewPrompt(notification))}>
                    <MessageSquare aria-hidden="true" />
                    Ask Queen
                  </Button>
                  {!notification.read ? (
                    <Button type="button" size="sm" onClick={() => onMarkRead(notification.id)}>
                      <Check aria-hidden="true" />
                      Clear
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {notifications.length ? (
        <div
          className={notificationClass("notificationList")}
          onScroll={(event) => {
            const target = event.currentTarget;
            if (notificationsLoading || notificationCursor === null) return;
            if (target.scrollHeight - target.scrollTop - target.clientHeight < 220) void onRefresh({ append: true });
          }}
        >
          {notificationGroups.map((group) => (
            <section key={group.label} className={notificationClass("notificationDayGroup")}>
              <h3>{group.label}</h3>
              {clusterNotifications(group.items).map((cluster) => {
                const total = cluster.items.length;
                if (total === 1) return renderNotificationCard(cluster.items[0]);
                const stateKey = `${group.label}::${cluster.key}`;
                const activeIndex = Math.min(clusterCursor[stateKey] ?? 0, total - 1);
                const unreadCount = cluster.items.filter((item) => !item.read).length;
                const goTo = (index: number) =>
                  setClusterCursor((prev) => ({ ...prev, [stateKey]: Math.max(0, Math.min(total - 1, index)) }));
                return (
                  <div key={cluster.key} className={notificationClass("notificationCluster")}>
                    <div className={notificationClass("notificationPager")}>
                      <div className={notificationClass("notificationPagerNav")}>
                        <button
                          type="button"
                          className={notificationClass("notificationPagerArrow")}
                          aria-label="Previous alert in this group"
                          disabled={activeIndex === 0}
                          onClick={() => goTo(activeIndex - 1)}
                        >
                          <ChevronLeft aria-hidden="true" />
                        </button>
                        <span className={notificationClass("notificationPagerCount")}>{activeIndex + 1}/{total}</span>
                        <button
                          type="button"
                          className={notificationClass("notificationPagerArrow")}
                          aria-label="Next alert in this group"
                          disabled={activeIndex === total - 1}
                          onClick={() => goTo(activeIndex + 1)}
                        >
                          <ChevronRight aria-hidden="true" />
                        </button>
                      </div>
                      <span
                        className={notificationClass("notificationPagerBadge", unreadCount > 0 && "unread")}
                        title={`${total} similar notifications collapsed${unreadCount ? ` — ${unreadCount} unread` : ""}`}
                      >
                        +{total - 1} similar{unreadCount ? ` · ${unreadCount} unread` : ""}
                      </span>
                    </div>
                    {renderNotificationCard(cluster.items[activeIndex])}
                  </div>
                );
              })}
            </section>
          ))}
          {notificationCursor !== null ? (
            <Button type="button" variant="secondary" onClick={() => void onRefresh({ append: true })} disabled={notificationsLoading}>
              {notificationsLoading ? (
                <>
                  <LoaderCircle aria-hidden="true" className={notificationClass("spinIcon")} />
                  Loading more
                </>
              ) : "Load more"}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className={notificationClass("notificationsEmpty")}>
          <div>
            <Bell aria-hidden="true" />
            <strong>No notifications yet</strong>
            <p>When an agent writes to the vault folder, this tab will pick it up and the nav badge will light up.</p>
          </div>
        </div>
      )}
      <p className={notificationClass("notificationStatus")}>{notificationsStatus || "Notifications sync from Obsidian markdown."}</p>
    </section>
  );
}
