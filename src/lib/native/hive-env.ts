import type { HiveEnvPayload } from "@/features/dashboard/dashboard-types";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export async function readNativeHiveEnv(): Promise<HiveEnvPayload | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<HiveEnvPayload>("hive_env_read");
  } catch {
    return null;
  }
}
