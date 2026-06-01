import { readNativeDashboardBootstrap } from "@/lib/native/dashboard-bootstrap";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export type NativeSharedSchedulesPayload = {
  ok?: boolean;
  source?: string;
  schedules?: Array<Record<string, unknown>>;
  root?: string;
  error?: string;
};

export async function readNativeSharedSchedules(input: {
  vaultPath?: string;
  scheduledFolder?: string;
  force?: boolean;
} = {}): Promise<NativeSharedSchedulesPayload | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    if (!input.force) {
      const bootstrap = await readNativeDashboardBootstrap({
        vaultPath: input.vaultPath,
        scheduledFolder: input.scheduledFolder,
      });
      if (bootstrap?.schedulerShared?.ok) return bootstrap.schedulerShared;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeSharedSchedulesPayload>("scheduler_shared_schedules", {
      vaultPath: input.vaultPath,
      scheduledFolder: input.scheduledFolder,
    });
  } catch {
    return null;
  }
}
