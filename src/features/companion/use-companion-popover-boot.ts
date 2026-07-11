"use client";

import { useEffect } from "react";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { readCompanionSettings } from "./companion-install";
import { setCompanionPopoverOpen } from "./companion-popover";

/**
 * Re-opens the floating companion popover on app launch when the user left
 * the mode enabled. Runs once from the dashboard root (main window only —
 * the popover window itself never mounts DashboardApp).
 */
export function useCompanionPopoverBoot() {
  useEffect(() => {
    if (!isTauriDesktopRuntime()) return;
    let cancelled = false;
    void readCompanionSettings().then((settings) => {
      if (cancelled) return;
      if (settings.installed && settings.popoverEnabled) {
        void setCompanionPopoverOpen(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
}
