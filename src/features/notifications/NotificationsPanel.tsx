import Image from "next/image";
import { useCallback, useState } from "react";
import { ArrowUpRight, Bell, Check, CheckCheck, KanbanSquare, MessageSquare, RefreshCcw } from "lucide-react";

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
import type { AgentNotification, AgentNotificationSettings, AgentNotificationSummary } from "@/lib/types/agent-notifications";

const notificationClass = createStyleClass(notificationStyles);

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

  return (
    <section className={notificationClass("notificationsPanel", "tabPanel")}>
      <div className={notificationClass("notificationsHeader")}>
        <div>
          <p className="eyebrow">Agent notifications</p>
          <h2>Inbox from the swarm</h2>
          <p>Agents can write markdown notes into the shared Obsidian notification folder when they need your attention.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => void onRefresh()} disabled={notificationsLoading}>
            <RefreshCcw aria-hidden="true" />
            {notificationsLoading ? "Refreshing" : "Refresh"}
          </Button>
          <Button type="button" size="sm" onClick={onMarkAllRead} disabled={!notificationSummary?.unread}>
            <CheckCheck aria-hidden="true" />
            Mark read
          </Button>
        </div>
      </div>

      <div className={notificationClass("notificationsControls")}>
        <div className={notificationClass("notificationStats")}>
          <span><strong>{notificationSummary?.total ?? 0}</strong> total</span>
          <span><strong>{notificationSummary?.unread ?? 0}</strong> unread</span>
          <span><strong>{(notificationSummary?.highUnread ?? 0) + (notificationSummary?.urgentUnread ?? 0)}</strong> high priority</span>
          <span title={notificationSummary?.folder}>/{notificationSummary?.folder ?? fallbackFolder}</span>
        </div>
        <label className={notificationClass("notificationSetting")}>
          <span>
            <strong>Escalate high priority</strong>
            <span>Off by default. If enabled, your agent will send you a message via your preferred messaging channel (e.g. telegram, discord, etc.)</span>
          </span>
          <input
            type="checkbox"
            checked={Boolean(notificationSummary?.settings.highPriorityMessagingEnabled)}
            onChange={(event) => onUpdateSettings({ highPriorityMessagingEnabled: event.target.checked })}
          />
        </label>
      </div>

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
              {group.items.map((notification) => {
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
                              {action.type === "discuss" ? <MessageSquare aria-hidden="true" />
                                : action.type === "work-board" ? <KanbanSquare aria-hidden="true" />
                                : <ArrowUpRight aria-hidden="true" />}
                              {busy ? "Sending…" : action.label}
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
              })}
            </section>
          ))}
          {notificationCursor !== null ? (
            <Button type="button" variant="secondary" onClick={() => void onRefresh({ append: true })} disabled={notificationsLoading}>
              {notificationsLoading ? "Loading..." : "Load more"}
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
