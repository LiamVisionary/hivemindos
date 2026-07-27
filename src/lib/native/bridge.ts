import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

/**
 * Canonical native/HTTP duality helper. On the Tauri desktop the native
 * command runs; in a browser — or when the native call fails — the HTTP
 * fallback runs instead, so callers never receive a null "you figure it out".
 *
 * New dual-surface reads/writes should route through this instead of
 * hand-rolling isTauriDesktopRuntime branches (36 modules did, each subtly
 * differently; dashboard-state-client keeps its bespoke retry path).
 */
export async function nativeOrFetch<T>(options: {
  command: string;
  args?: Record<string, unknown>;
  fallback: () => Promise<T>;
}): Promise<T> {
  if (isTauriDesktopRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<T>(options.command, options.args);
    } catch {
      // Fall through to the HTTP path — a native failure must not strand the UI.
    }
  }
  return options.fallback();
}
