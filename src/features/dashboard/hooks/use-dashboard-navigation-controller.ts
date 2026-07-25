import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentNotification } from "@/lib/types/agent-notifications";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import {
  DASHBOARD_TARGET_APPLIED_EVENT,
  POPOUT_GRAB_OFFSET_X,
  POPOUT_GRAB_OFFSET_Y,
  dashboardTargetFromSearch,
  dashboardUrlForTarget,
  isDashboardView,
  type DashboardRouteTarget,
  type PopoutFollowHandle,
} from "@/features/dashboard/dashboard-navigation";
import { dashboardStateValue, loadDashboardStateSnapshot, saveDashboardStateValue, type DashboardStateSnapshot } from "@/lib/services/dashboard-state-client";
import { listenForDesktopNavigation, moveNativeRouteWindowToCursor, openNativeRouteWindow } from "@/lib/native/desktop-navigation";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { listenForResearchSyncCodes } from "@/lib/services/research-sync-code";

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
  /** True when this dashboard runs inside a popped-out satellite window.
   * Keeps `popout=1` on its URLs across navigation (so refresh stays
   * chrome-free) and stops it from persisting its route into the shared
   * last-route/recents state the main window restores from. */
  isPopoutWindow?: boolean;
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
  isPopoutWindow = false,
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
      const urlTarget = isPopoutWindow ? { ...target, popout: true } : target;
      const nextUrl = dashboardUrlForTarget(urlTarget, window.location.pathname);
      if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
        window.history.pushState({ dashboardTarget: urlTarget }, "", nextUrl);
      }
      navigationUrlRef.current = nextUrl;
      window.dispatchEvent(new CustomEvent<DashboardRouteTarget>(DASHBOARD_TARGET_APPLIED_EVENT, { detail: target }));
    }
  }, [isPopoutWindow, revealKanbanTask, setActiveView, setSelectedAgentId, setSelectedChatLeafKey, setSelectedKanbanTaskId, setVaultPanelMode]);

  // Pops the target route out into its own chrome-free window (popout=1 URLs
  // render without the nav rail): a native webview window on the Tauri
  // desktop, or a browser popup window otherwise. `screenPosition` (screen
  // coordinates, e.g. from a drag release) requests spawn-under-pointer; the
  // native side positions from the real OS cursor since webview screen
  // coordinates are unreliable. `live: true` means the pointer is still held
  // mid-drag — the returned follow handle keeps the new window under the
  // cursor: the browser popup via Window.moveTo, the native window via
  // cursor-reading move_route_window pings. Stays synchronous in the browser
  // path so window.open() runs inside the user gesture and isn't
  // popup-blocked.
  const popoutDashboardTarget = useCallback((
    target: DashboardRouteTarget,
    screenPosition?: { x: number; y: number },
    opts?: { live?: boolean },
  ): PopoutFollowHandle | null => {
    const popoutTarget = { ...target, popout: true };
    if (isTauriDesktopRuntime()) {
      const labelPromise = openNativeRouteWindow(popoutTarget, {
        screenX: screenPosition?.x,
        screenY: screenPosition?.y,
        live: opts?.live,
      });
      if (!opts?.live) return null;
      return {
        closed: false,
        // Coordinates are ignored on native: the Rust side reads the OS
        // cursor itself, which sidesteps webview screen-coordinate bugs.
        moveTo: () => {
          void labelPromise.then((label) => {
            if (label) void moveNativeRouteWindowToCursor(label);
          });
        },
      };
    }
    if (typeof window === "undefined") return null;
    const features = ["popup=yes", "width=1100", "height=760"];
    if (screenPosition) {
      features.push(`left=${Math.max(0, Math.round(screenPosition.x - POPOUT_GRAB_OFFSET_X))}`);
      features.push(`top=${Math.max(0, Math.round(screenPosition.y - POPOUT_GRAB_OFFSET_Y))}`);
    }
    return window.open(
      dashboardUrlForTarget(popoutTarget, window.location.pathname),
      `hivemindos-popout-${Date.now().toString(36)}`,
      features.join(","),
    );
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
      popout: isPopoutWindow || undefined,
    };
    const nextUrl = dashboardUrlForTarget(target, window.location.pathname);

    if (navigationUrlRef.current !== nextUrl && `${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.pushState({ dashboardTarget: target }, "", nextUrl);
    }

    navigationUrlRef.current = nextUrl;
    // Satellite popout windows never persist their route: the shared
    // last-route/recents state belongs to the main window's next boot.
    if (isPopoutWindow) return;
    void saveDashboardStateValue(RESTORED_ROUTE_STORAGE_KEY, JSON.stringify(target));
    // Route changes intentionally update the displayed recents list and its persistent mirror together.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNavigationRecents((current) => {
      const key = JSON.stringify(target);
      const next = [target, ...current.filter((item) => JSON.stringify(item) !== key)].slice(0, 8);
      void saveDashboardStateValue(NAV_RECENTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [activeView, hydrated, isPopoutWindow, selectedAgentId, selectedChatLeafKey, selectedKanbanTaskId, vaultPanelMode]);

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

  // Deep-linked hivemindos://research/sync pairing codes. This listener lives
  // at the dashboard root because the Integrations view unmounts when
  // inactive — a single-use code emitted mid-navigation would otherwise be
  // dropped. It parks the code for the Hive Research card and surfaces the
  // Integrations view (covers cold start, where the native navigate event
  // fired before this webview existed).
  useEffect(() => {
    if (!hydrated) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void listenForResearchSyncCodes(() => navigateDashboardTarget({ view: "integrations" })).then((unlisten) => {
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
