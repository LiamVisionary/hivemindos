"use client";

import { useState, type Dispatch, type ElementType, type ReactNode, type SetStateAction } from "react";
import type { AgentNotificationSummary } from "@/lib/types/agent-notifications";
import type { KanbanBoard } from "@/lib/types/kanban";
import type { FleetActiveApp } from "@/components/fleet/fleet-data";
import type { DashboardView } from "@/features/dashboard/dashboard-types";

export type DashboardAppCompletionNotification = {
  id: string;
  app?: FleetActiveApp;
  initials?: string;
  message: string;
  title?: string;
};

type DashboardHeaderProps = {
  Image: ElementType;
  Tooltip: ElementType;
  TooltipContent: ElementType;
  TooltipProvider: ElementType;
  TooltipTrigger: ElementType;
  activeHeader: { eyebrow: string; title: string };
  activeView: DashboardView;
  isWorkView: (view: DashboardView) => boolean;
  kanbanBoard?: KanbanBoard | null;
  navItems: Array<{ id: DashboardView; label: string; detail: string }>;
  appCompletionNotification?: DashboardAppCompletionNotification | null;
  notificationClass: (...names: string[]) => string;
  notificationSummary?: AgentNotificationSummary | null;
  setActiveView: Dispatch<SetStateAction<DashboardView>>;
  setKanbanLoading: Dispatch<SetStateAction<boolean>>;
  viewIcon: (view: DashboardView) => ReactNode;
};

export function DashboardHeader(props: DashboardHeaderProps) {
  const {
    Image,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
    activeHeader,
    activeView,
    isWorkView,
    kanbanBoard,
    navItems,
    appCompletionNotification,
    notificationClass,
    notificationSummary,
    setActiveView,
    setKanbanLoading,
    viewIcon,
  } = props;
  const [mobileRoutesOpen, setMobileRoutesOpen] = useState(false);
  const showFleetHeader = activeView === "agents";
  const topbarClassName = [
    "commandTopbar",
    showFleetHeader ? "fleetCommandTopbar" : "",
    activeView === "chat" ? "chatCommandTopbar" : "",
  ].filter(Boolean).join(" ");
  const primaryNavItems = (["agents", "kanban", "vault", "chat", "wallet", "more"] as DashboardView[])
    .map((id) => navItems.find((item) => item.id === id))
    .filter((item): item is (typeof navItems)[number] => Boolean(item));
  const isActiveRoute = (id: DashboardView) => id === activeView
    || (id === "kanban" && isWorkView(activeView))
    || (id === "more" && (activeView === "maintenance" || activeView === "memory" || activeView === "files" || activeView === "notifications" || activeView === "env" || activeView === "integrations" || activeView === "my-apps" || activeView === "phone"));
  const activeNavLabel = navItems.find((item) => item.id === activeView)?.label
    ?? primaryNavItems.find((item) => isActiveRoute(item.id))?.label
    ?? activeHeader.title;
  const closeMobileRoutes = () => {
    setMobileRoutesOpen(false);
  };
  const selectRoute = (id: DashboardView) => {
    if (id === "kanban" && !kanbanBoard) setKanbanLoading(true);
    setActiveView(id);
    closeMobileRoutes();
  };

  return (
    <TooltipProvider delayDuration={120}>
      <header className={topbarClassName} aria-label="Control room navigation">
        <div id="mobile-route-drawer-shell" className={`mobileRouteShell ${mobileRoutesOpen ? "open" : ""}`}>
          <button
            type="button"
            className="mobileRouteToggle"
            aria-expanded={mobileRoutesOpen}
            aria-controls="mobile-route-drawer"
            aria-label="Open route drawer"
            onClick={() => setMobileRoutesOpen(true)}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mobileRouteBackdrop"
            aria-label="Close route drawer"
            hidden={!mobileRoutesOpen}
            onClick={closeMobileRoutes}
          />
          <div id="mobile-route-drawer" className="mobileRouteDrawer" hidden={!mobileRoutesOpen}>
            <div className="mobileRouteDrawerHeader">
              <div>
                <span>{activeHeader.eyebrow}</span>
                <strong>{activeNavLabel}</strong>
              </div>
              <button type="button" className="mobileRouteClose" aria-label="Close route drawer" onClick={closeMobileRoutes}>
                Close
              </button>
            </div>
            <nav aria-label="Mobile dashboard routes">
              {navItems.map((item) => {
                const active = isActiveRoute(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={active ? "active" : ""}
                    aria-pressed={active}
                    onClick={() => selectRoute(item.id)}
                  >
                    {viewIcon(item.id)}
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </span>
                    {item.id === "notifications" && notificationSummary?.unread ? (
                      <i className={notificationClass("navBadge")} aria-label={`${notificationSummary.unread} unread notifications`}>
                        {notificationSummary.unread > 99 ? "99+" : notificationSummary.unread}
                      </i>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="topbarMasthead">
          <div className="brandIntro">
            <button
              type="button"
              className="brandHex"
              aria-label="Return to Fleet"
              title="Return to Fleet"
              onClick={() => setActiveView("agents")}
            >
              <Image className="brandLogo" src="/hivemindos-logo.png" alt="" width={190} height={194} priority />
            </button>
            <div className="brandCopy">
              <p className="eyebrow">{activeHeader.eyebrow}</p>
              {showFleetHeader ? (
                <strong className="topbarHeadline fleetInlineHeadline">
                  The hive is <span>humming.</span>
                </strong>
              ) : (
                <strong className="topbarHeadline">{renderHeaderPhrase(activeHeader.title, activeView)}</strong>
              )}
            </div>
          </div>

          <nav className="viewTabs" aria-label="Dashboard views">
            {primaryNavItems.map((item) => {
                const active = isActiveRoute(item.id);
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={`viewTab ${active ? "active" : ""}`}
                        aria-pressed={active}
                        title={`${item.label}: ${item.detail}`}
                        onClick={() => selectRoute(item.id)}
                      >
                        {viewIcon(item.id)}
                        <span>
                          {item.label}
                          {item.id === "notifications" && notificationSummary?.unread ? (
                            <i className={notificationClass("navBadge")} aria-label={`${notificationSummary.unread} unread notifications`}>
                              {notificationSummary.unread > 99 ? "99+" : notificationSummary.unread}
                            </i>
                          ) : null}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <strong className="block">{item.label}</strong>
                      <span className="block text-[var(--muted)]">{item.detail}</span>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
          </nav>
        </div>
        {appCompletionNotification ? (
          <DashboardAppCompletionToast key={appCompletionNotification.id} notification={appCompletionNotification} />
        ) : null}
      </header>
    </TooltipProvider>
  );
}

function DashboardAppCompletionToast({ notification }: { notification: DashboardAppCompletionNotification }) {
  const [brokenIcon, setBrokenIcon] = useState(false);
  const iconUrl = notification.app?.iconUrl;
  const initials = notification.app?.initials ?? notification.initials ?? "HM";
  const title = notification.app?.name ?? notification.title ?? "HivemindOS";

  return (
    <div className="dashboardAppNotification" role="status" aria-live="polite">
      <span className="dashboardAppNotificationIcon" aria-hidden="true">
        {iconUrl && !brokenIcon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={iconUrl} alt="" onError={() => setBrokenIcon(true)} />
        ) : (
          <span>{initials}</span>
        )}
      </span>
      <span className="dashboardAppNotificationText">
        <strong>{title}</strong>
        <span>{notification.message}</span>
      </span>
    </div>
  );
}

function renderHeaderPhrase(title: string, activeView: DashboardView) {
  if (activeView === "chat" && title.startsWith("Talking with ")) {
    const name = title.slice("Talking with ".length);
    return <>Talking with <span>{name}</span></>;
  }

  const lastSpace = title.trimEnd().lastIndexOf(" ");
  if (lastSpace < 0) return <span>{title}</span>;

  return (
    <>
      {title.slice(0, lastSpace)} <span>{title.slice(lastSpace + 1)}</span>
    </>
  );
}
