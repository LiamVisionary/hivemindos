import type { MemoryTelemetryPayload } from "@/lib/types/memory-telemetry";
import { readNativeDashboardBootstrap } from "@/lib/native/dashboard-bootstrap";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export async function readNativeMemoryTelemetry(input: { force?: boolean } = {}): Promise<MemoryTelemetryPayload | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const bootstrap = input.force ? null : await readNativeDashboardBootstrap();
    if (bootstrap?.memoryTelemetry?.ok) return bootstrap.memoryTelemetry;
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<MemoryTelemetryPayload>("memory_telemetry");
  } catch {
    return null;
  }
}
