import Image from "next/image";
import { Bell, Check, CheckCheck, RefreshCcw } from "lucide-react";

import notificationStyles from "@/app/notifications.module.css";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "@/features/dashboard/ChatMarkdown";
import { createStyleClass } from "@/features/dashboard/style-classes";
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
  onUpdateSettings,
}: NotificationsPanelProps) {
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
                              {actor.icon ? <Image src={actor.icon} alt="" width={20} height={20} aria-hidden="true" /> : null}
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
                      <div className={notificationClass("notificationFooter")}>
                        <div className={notificationClass("notificationTags")}>
                          <span className={notificationClass("priorityPill", notification.priority)}>{notificationPriorityLabel(notification.priority)}</span>
                          <span className={notificationClass("kindPill")}>{notificationKindLabel(notification.kind)}</span>
                          {notification.read ? <span className={notificationClass("readPill")}>read</span> : null}
                          {notification.tags.slice(0, 4).map((tag) => <span className={notificationClass("kindPill")} key={`${notification.id}-${tag}`}>{notificationTagLabel(tag)}</span>)}
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
