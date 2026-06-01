import type { FleetHostedApp } from "@/components/fleet/active-apps";
import type { AppVersion, HiveEnvPayload, KanbanResponse, TailnetHealth, TailscaleDevice } from "@/features/dashboard/dashboard-types";
import type { MemoryTelemetryPayload } from "@/lib/types/memory-telemetry";
import type { RuntimeUsageAnalytics } from "@/lib/services/runtime-usage-analytics";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

type NativeDesktopStatus = AppVersion & {
  ok?: boolean;
  runtime?: string;
  phase?: string;
  devUrl?: string | null;
  nativeHost?: string;
  nativePort?: number | null;
};

type NativeFleetAppsPayload = {
  ok?: boolean;
  checkedAt?: string;
  source?: string;
  cacheAgeMs?: number;
  stale?: boolean;
  apps?: FleetHostedApp[];
  machines?: Array<{ name: string; collector: string; appCount: number; error?: string }>;
  error?: string;
};

type NativeTailscaleDevicesPayload = {
  ok?: boolean;
  backendState?: string;
  authUrl?: string;
  source?: string;
  tailnetHealth?: TailnetHealth;
  devices?: TailscaleDevice[];
  error?: string;
};

export type NativeDashboardBootstrap = {
  ok?: boolean;
  checkedAt?: string;
  desktopStatus?: NativeDesktopStatus;
  appVersion?: NativeDesktopStatus;
  hiveEnv?: HiveEnvPayload;
  fleetApps?: NativeFleetAppsPayload;
  tailscaleDevices?: NativeTailscaleDevicesPayload;
  kanban?: KanbanResponse;
  brainSummary?: {
    ok?: boolean;
    source?: string;
    checkedAt?: string;
    vaultPath?: string;
    skillsFolder?: string;
    totals?: {
      sharedSkills?: number;
      notes?: number;
      folders?: number;
      recentAccesses?: number;
    };
    recentAccesses?: unknown[];
    truncated?: boolean;
    error?: string;
  };
  memoryTelemetry?: MemoryTelemetryPayload;
  phonePrompts?: {
    ok?: boolean;
    source?: string;
    prompts?: Array<Record<string, unknown>>;
    vaultPath?: string;
    error?: string;
  };
  runtimeUsage?: RuntimeUsageAnalytics;
  schedulerShared?: {
    ok?: boolean;
    source?: string;
    schedules?: Array<Record<string, unknown>>;
    root?: string;
    error?: string;
  };
  error?: string;
};

let cachedBootstrap: { loadedAt: number; payload: NativeDashboardBootstrap } | null = null;
let inFlightBootstrap: Promise<NativeDashboardBootstrap | null> | null = null;

export async function readNativeDashboardBootstrap(input: {
  maxAgeMs?: number;
  cacheTtlMs?: number;
  force?: boolean;
  vaultPath?: string;
  kanbanFolder?: string;
  kanbanBoard?: string;
  scheduledFolder?: string;
} = {}): Promise<NativeDashboardBootstrap | null> {
  if (!isTauriDesktopRuntime()) return null;
  const now = Date.now();
  const cacheTtlMs = input.cacheTtlMs ?? 5_000;
  if (!input.force && cachedBootstrap && now - cachedBootstrap.loadedAt <= cacheTtlMs) {
    return cachedBootstrap.payload;
  }
  if (!input.force && inFlightBootstrap) return inFlightBootstrap;

  inFlightBootstrap = (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const payload = await invoke<NativeDashboardBootstrap>("dashboard_bootstrap", {
        maxAgeMs: input.maxAgeMs,
        vaultPath: input.vaultPath,
        kanbanFolder: input.kanbanFolder,
        kanbanBoard: input.kanbanBoard,
        scheduledFolder: input.scheduledFolder,
      });
      cachedBootstrap = { loadedAt: Date.now(), payload };
      return payload;
    } catch {
      return null;
    } finally {
      inFlightBootstrap = null;
    }
  })();

  return inFlightBootstrap;
}
