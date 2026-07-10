import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentNotification } from "@/lib/types/agent-notifications";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import {
  DASHBOARD_TARGET_APPLIED_EVENT,
  dashboardTargetFromSearch,
  dashboardUrlForTarget,
  isDashboardView,
  type DashboardRouteTarget,
} from "@/features/dashboard/dashboard-navigation";
import { dashboardStateValue, loadDashboardStateSnapshot, saveDashboardStateValue, type DashboardStateSnapshot } from "@/lib/services/dashboard-state-client";
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
  /** Bee-piloted deep-link landing: scroll the Work Board to the task and open
   * its conversation. Invoked for targets that set `openTask` (notification
   * "Open task" buttons, notification card clicks) — never for restored routes. */
  revealKanbanTask?: (taskId: string) => void;
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
  }

  return dashboardViewFromLocation() ?? "agents";
}

export function useDashboardNavigationController({
  activeView,
  hydrated,
  revealKanbanTask,
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
  const [navigationRecents, setNavigationRecents] = useState<DashboardRouteTarget[]>([]);
  const initialRouteAppliedRef = useRef(false);
  const navigationUrlRef = useRef("");

  const navigateDashboardTarget = useCallback((target: DashboardRouteTarget) => {
    if (!target?.view || !isDashboardView(target.view)) return;
    if (target.vaultPanel) setVaultPanelMode(target.vaultPanel);
    if (target.agentId) setSelectedAgentId(target.agentId);
    if (target.taskId) setSelectedKanbanTaskId(target.taskId);
    if (target.chatLeaf) setSelectedChatLeafKey(target.chatLeaf);
    setActiveView(target.view);
    if (target.openTask && target.taskId && (target.view === "kanban" || target.view === "history")) {
      revealKanbanTask?.(target.taskId);
    }
    if (typeof window !== "undefined") {
      const nextUrl = dashboardUrlForTarget(target, window.location.pathname);
      if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
        window.history.pushState({ dashboardTarget: target }, "", nextUrl);
      }
      navigationUrlRef.current = nextUrl;
      window.dispatchEvent(new CustomEvent<DashboardRouteTarget>(DASHBOARD_TARGET_APPLIED_EVENT, { detail: target }));
    }
  }, [revealKanbanTask, setActiveView, setSelectedAgentId, setSelectedChatLeafKey, setSelectedKanbanTaskId, setVaultPanelMode]);

  const popoutDashboardTarget = useCallback((target: DashboardRouteTarget) => {
    void openNativeRouteWindow(target);
  }, []);

  const openDashboardNotification = useCallback((notification: AgentNotification) => {
    const text = `${notification.title}\n${notification.body}`.toLowerCase();
    const matchedTask = tasks.find((task) => task.title && text.includes(task.title.toLowerCase()));

    if (matchedTask) {
      navigateDashboardTarget({ view: "kanban", taskId: matchedTask.id, agentId: matchedTask.agentId, openTask: true });
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
    let cancelled = false;
    void (async () => {
      const snapshot = await loadDashboardStateSnapshot();
      if (cancelled) return;
      setNavigationRecents(initialNavigationRecents(snapshot));
      const target = dashboardTargetFromSearch(window.location.search) ?? restoredDashboardTargetFromStorage(snapshot);
      if (target) navigateDashboardTarget(target);
    })();
    return () => {
      cancelled = true;
    };
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
    void saveDashboardStateValue(RESTORED_ROUTE_STORAGE_KEY, JSON.stringify(target));
    // Route changes intentionally update the displayed recents list and its persistent mirror together.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNavigationRecents((current) => {
      const key = JSON.stringify(target);
      const next = [target, ...current.filter((item) => JSON.stringify(item) !== key)].slice(0, 8);
      void saveDashboardStateValue(NAV_RECENTS_STORAGE_KEY, JSON.stringify(next));
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

function restoredDashboardTargetFromStorage(snapshot: DashboardStateSnapshot): DashboardRouteTarget | null {
  try {
    const stored = dashboardStateValue(snapshot, RESTORED_ROUTE_STORAGE_KEY);
    return normalizeStoredDashboardTarget(stored ? JSON.parse(stored) : null);
  } catch {
    return null;
  }
}

function normalizeStoredDashboardTarget(value: unknown): DashboardRouteTarget | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const view = normalizeStoredDashboardView(record.view);
  if (!view) return null;

  return {
    view,
    agentId: typeof record.agentId === "string" ? record.agentId : undefined,
    chatLeaf: typeof record.chatLeaf === "string" ? record.chatLeaf : undefined,
    taskId: typeof record.taskId === "string" ? record.taskId : undefined,
    vaultPanel: typeof record.vaultPanel === "string" ? record.vaultPanel : undefined,
    integration: typeof record.integration === "string" ? record.integration : undefined,
    integrationTab: record.integrationTab === "connect" || record.integrationTab === "actions"
      ? record.integrationTab
      : undefined,
    integrationAction: typeof record.integrationAction === "string" ? record.integrationAction : undefined,
  };
}

function initialNavigationRecents(snapshot: DashboardStateSnapshot): DashboardRouteTarget[] {
  try {
    const value = dashboardStateValue(snapshot, NAV_RECENTS_STORAGE_KEY);
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
