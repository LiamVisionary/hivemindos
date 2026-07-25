import type { DashboardRouteTarget } from "@/features/dashboard/dashboard-navigation";
import { DESKTOP_NAVIGATE_EVENT, DESKTOP_OPEN_PALETTE_EVENT, DESKTOP_OPEN_POPOUT_EVENT, dashboardTargetFromSearch, dashboardUrlForTarget } from "@/features/dashboard/dashboard-navigation";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { createSafeTauriUnlistenAll } from "@/lib/native/tauri-event-listeners";

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
      // Menu/tray popouts get the same chrome-free satellite treatment as
      // drag-outs and palette popouts.
      if (target?.view) void openNativeRouteWindow({ ...target, popout: true });
    });
    return createSafeTauriUnlistenAll([unlistenNavigate, unlistenPalette, unlistenPopout]);
  } catch {
    return () => {};
  }
}

export async function openNativeRouteWindow(
  target: DashboardRouteTarget,
  opts?: {
    /** Requests spawn-under-pointer (drag flows). The native side positions
     * from the real OS cursor; these webview-reported coordinates are only
     * its fallback, since webview screenX/screenY are unreliable. */
    screenX?: number;
    screenY?: number;
    /** The pointer is still held mid-drag: the window spawns unfocused (so
     * the origin window's gesture stays alive) and the native side keeps it
     * under the cursor until the physical button releases. */
    live?: boolean;
  },
): Promise<string | false> {
  if (!isTauriDesktopRuntime()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const label = await invoke<string>("open_route_window", {
      target: {
        url: dashboardUrlForTarget(target),
        view: target.view,
        screenX: opts?.screenX,
        screenY: opts?.screenY,
        live: opts?.live,
      },
    });
    return typeof label === "string" && label ? label : false;
  } catch {
    return false;
  }
}

/** Live drag-out follow: nudge a popped-out native route window to the OS
 * cursor. Fire-and-forget; the native side reads the cursor itself. */
export async function moveNativeRouteWindowToCursor(label: string) {
  if (!isTauriDesktopRuntime()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("move_route_window", { label });
  } catch {
    /* window may already be closed */
  }
}
