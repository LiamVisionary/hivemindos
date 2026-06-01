import type { RuntimeUsageAnalytics } from "@/lib/services/runtime-usage-analytics";
import { readNativeDashboardBootstrap } from "@/lib/native/dashboard-bootstrap";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export async function readNativeRuntimeUsage(input: {
  force?: boolean;
  limit?: number;
} = {}): Promise<RuntimeUsageAnalytics | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    if (!input.force) {
      const bootstrap = await readNativeDashboardBootstrap();
      if (bootstrap?.runtimeUsage?.ok) return bootstrap.runtimeUsage;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<RuntimeUsageAnalytics>("runtime_usage", {
      limit: input.limit,
    });
  } catch {
    return null;
  }
}
