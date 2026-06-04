import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentNotification } from "@/lib/types/agent-notifications";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import {
  dashboardTargetFromSearch,
  dashboardUrlForTarget,
  isDashboardView,
  type DashboardRouteTarget,
} from "@/features/dashboard/dashboard-navigation";
import { listenForDesktopNavigation, openNativeRouteWindow } from "@/lib/native/desktop-navigation";

const NAV_RECENTS_STORAGE_KEY = "hivemindos.dashboardNavigation.recents.v1";
const RESTORED_ROUTE_STORAGE_KEY = "hivemindos.dashboardNavigation.lastRoute.v1";

type NavigationTask = {
  agentId?: string;
  id: string;
  title?: string;
};

type UseDashboardNavigationControllerOptions = {
  activeView: DashboardView;
  hydrated: boolean;
  selectedAgentId: string;
  selectedChatLeafKey: string;
  selectedKanbanTaskId: string;
  setActiveView: (view: DashboardView) => void;
  setSelectedAgentId: (agentId: string) => void;
  setSelectedChatLeafKey: (leafKey: string) => void;
  setSelectedKanbanTaskId: (taskId: string) => void;
  setVaultPanelMode: (mode: string) => void;
  tasks: NavigationTask[];
  vaultPanelMode?: string;
};

export function initialDashboardView(): DashboardView {
  if (typeof window !== "undefined") {
    const restored = dashboardTargetFromSearch(window.location.search);
    if (restored?.view) return restored.view;

    try {
      const stored = window.localStorage.getItem(RESTORED_ROUTE_STORAGE_KEY);
      const target = stored ? JSON.parse(stored) : null;
      const restoredView = normalizeStoredDashboardView(target?.view);
      if (restoredView) return restoredView;
    } catch {}
  }

  return dashboardViewFromLocation() ?? "agents";
}

export function useDashboardNavigationController({
  activeView,
  hydrated,
  selectedAgentId,
  selectedChatLeafKey,
  selectedKanbanTaskId,
  setActiveView,
  setSelectedAgentId,
  setSelectedChatLeafKey,
  setSelectedKanbanTaskId,
  setVaultPanelMode,
  tasks,
  vaultPanelMode,
}: UseDashboardNavigationControllerOptions) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [navigationRecents, setNavigationRecents] = useState<DashboardRouteTarget[]>(initialNavigationRecents);
  const initialRouteAppliedRef = useRef(false);
  const navigationUrlRef = useRef("");

  const navigateDashboardTarget = useCallback((target: DashboardRouteTarget) => {
    if (!target?.view || !isDashboardView(target.view)) return;
    if (target.vaultPanel) setVaultPanelMode(target.vaultPanel);
    if (target.agentId) setSelectedAgentId(target.agentId);
    if (target.taskId) setSelectedKanbanTaskId(target.taskId);
    if (target.chatLeaf) setSelectedChatLeafKey(target.chatLeaf);
    setActiveView(target.view);
  }, [setActiveView, setSelectedAgentId, setSelectedChatLeafKey, setSelectedKanbanTaskId, setVaultPanelMode]);

  const popoutDashboardTarget = useCallback((target: DashboardRouteTarget) => {
    void openNativeRouteWindow(target);
  }, []);

  const openDashboardNotification = useCallback((notification: AgentNotification) => {
    const text = `${notification.title}\n${notification.body}`.toLowerCase();
    const matchedTask = tasks.find((task) => task.title && text.includes(task.title.toLowerCase()));

    if (matchedTask) {
      navigateDashboardTarget({ view: "kanban", taskId: matchedTask.id, agentId: matchedTask.agentId });
      return;
    }

    if (notification.agentId) {
      navigateDashboardTarget({ view: "chat", agentId: notification.agentId });
      return;
    }

    navigateDashboardTarget({ view: "notifications" });
  }, [navigateDashboardTarget, tasks]);

  useEffect(() => {
    if (!hydrated || initialRouteAppliedRef.current) return;
    initialRouteAppliedRef.current = true;
    const target = dashboardTargetFromSearch(window.location.search);
    if (target) navigateDashboardTarget(target);
  }, [hydrated, navigateDashboardTarget]);

  useEffect(() => {
    if (!hydrated) return;

    const target: DashboardRouteTarget = {
      view: activeView,
      vaultPanel: activeView === "vault" ? vaultPanelMode : undefined,
      agentId: activeView === "chat" ? selectedAgentId : undefined,
      taskId: activeView === "kanban" || activeView === "history" ? selectedKanbanTaskId || undefined : undefined,
      chatLeaf: activeView === "chat" ? selectedChatLeafKey || undefined : undefined,
    };
    const nextUrl = dashboardUrlForTarget(target, window.location.pathname);

    if (navigationUrlRef.current !== nextUrl && `${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.pushState({ dashboardTarget: target }, "", nextUrl);
    }

    navigationUrlRef.current = nextUrl;
    window.localStorage.setItem(RESTORED_ROUTE_STORAGE_KEY, JSON.stringify(target));
    // Route changes intentionally update the displayed recents list and its persistent mirror together.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNavigationRecents((current) => {
      const key = JSON.stringify(target);
      const next = [target, ...current.filter((item) => JSON.stringify(item) !== key)].slice(0, 8);
      window.localStorage.setItem(NAV_RECENTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [activeView, hydrated, selectedAgentId, selectedChatLeafKey, selectedKanbanTaskId, vaultPanelMode]);

  useEffect(() => {
    if (!hydrated) return;

    const applyLocation = () => {
      const target = dashboardTargetFromSearch(window.location.search);
      if (!target) return;
      navigationUrlRef.current = dashboardUrlForTarget(target, window.location.pathname);
      navigateDashboardTarget(target);
    };

    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, [hydrated, navigateDashboardTarget]);

  useEffect(() => {
    if (!hydrated) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void listenForDesktopNavigation(navigateDashboardTarget, () => setCommandPaletteOpen(true)).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      cleanup = unlisten;
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [hydrated, navigateDashboardTarget]);

  return {
    commandPaletteOpen,
    navigateDashboardTarget,
    navigationRecents,
    openDashboardNotification,
    popoutDashboardTarget,
    setCommandPaletteOpen,
  };
}

function dashboardViewFromLocation(): DashboardView | null {
  if (typeof window === "undefined") return null;

  const view = new URLSearchParams(window.location.search).get("view");
  return normalizeStoredDashboardView(view);
}

function initialNavigationRecents(): DashboardRouteTarget[] {
  if (typeof window === "undefined") return [];

  try {
    const value = window.localStorage.getItem(NAV_RECENTS_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed
        .map((item) => {
          const view = normalizeStoredDashboardView(item?.view);
          return view ? { ...item, view } : null;
        })
        .filter((item): item is DashboardRouteTarget => Boolean(item))
        .slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function normalizeStoredDashboardView(value: unknown): DashboardView | null {
  return typeof value === "string" && isDashboardView(value) ? value : null;
}
