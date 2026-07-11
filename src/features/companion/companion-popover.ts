"use client";

/* companion-popover.ts — desktop-only floating companion window.
 *
 * Mirrors the standalone Ami widget's shell: a small transparent,
 * borderless, always-on-top webview showing just the hologram. The window is
 * created/destroyed by the `set_companion_popover` Tauri command
 * (src-tauri/src/desktop_navigation.rs); in a plain browser this is a no-op.
 */

import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export const COMPANION_POPOVER_ROUTE = "/companion-popover";

export async function setCompanionPopoverOpen(open: boolean): Promise<boolean> {
  if (!isTauriDesktopRuntime()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_companion_popover", { open });
    return true;
  } catch (error) {
    console.error("[companion] popover toggle failed", error);
    return false;
  }
}
