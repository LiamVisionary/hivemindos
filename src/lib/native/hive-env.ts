import type { HiveEnvPayload } from "@/features/dashboard/dashboard-types";
import { nativePrivateFilesystemAccessGranted, readNativeDashboardBootstrap } from "@/lib/native/dashboard-bootstrap";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export async function readNativeHiveEnv(input: { force?: boolean } = {}): Promise<HiveEnvPayload | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const allowPrivateFilesystem = nativePrivateFilesystemAccessGranted();
    const bootstrap = input.force ? null : await readNativeDashboardBootstrap({ allowPrivateFilesystem });
    if (bootstrap?.hiveEnv) return bootstrap.hiveEnv;
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<HiveEnvPayload>("hive_env_read", { allowPrivateFilesystem });
  } catch {
    return null;
  }
}
