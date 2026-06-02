import type { DashboardRouteTarget } from "@/features/dashboard/dashboard-navigation";
import { DESKTOP_NAVIGATE_EVENT, DESKTOP_OPEN_PALETTE_EVENT, DESKTOP_OPEN_POPOUT_EVENT, dashboardTargetFromSearch, dashboardUrlForTarget } from "@/features/dashboard/dashboard-navigation";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export type DesktopNavigationEvent = DashboardRouteTarget & {
  action?: "navigate" | "palette" | "popout";
};

export async function listenForDesktopNavigation(
  onNavigate: (target: DashboardRouteTarget) => void,
  onOpenPalette: () => void,
) {
  if (!isTauriDesktopRuntime()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlistenNavigate = await listen<DesktopNavigationEvent>(DESKTOP_NAVIGATE_EVENT, (event) => {
      if (event.payload?.view) onNavigate(event.payload);
    });
    const unlistenPalette = await listen(DESKTOP_OPEN_PALETTE_EVENT, () => {
      onOpenPalette();
    });
    const unlistenPopout = await listen<DesktopNavigationEvent>(DESKTOP_OPEN_POPOUT_EVENT, (event) => {
      const target = event.payload?.view
        ? event.payload
        : dashboardTargetFromSearch(window.location.search);
      if (target?.view) void openNativeRouteWindow(target);
    });
    return () => {
      unlistenNavigate();
      unlistenPalette();
      unlistenPopout();
    };
  } catch {
    return () => {};
  }
}

export async function openNativeRouteWindow(target: DashboardRouteTarget) {
  if (!isTauriDesktopRuntime()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_route_window", {
      target: {
        url: dashboardUrlForTarget(target),
        view: target.view,
      },
    });
    return true;
  } catch {
    return false;
  }
}
