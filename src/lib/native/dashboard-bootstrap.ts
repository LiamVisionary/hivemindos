import type { FleetHostedApp } from "@/components/fleet/active-apps";
import type { AppVersion, HiveEnvPayload, KanbanResponse, TailnetHealth, TailscaleDevice } from "@/features/dashboard/dashboard-types";
import type { MemoryTelemetryPayload } from "@/lib/types/memory-telemetry";
import type { RuntimeUsageAnalytics } from "@/lib/services/runtime-usage-analytics";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

const NATIVE_PRIVATE_FILESYSTEM_CONSENT_KEY = "hivemindos.nativePrivateFilesystemConsent.v1";
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 2_500;

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

let cachedBootstrap: {
  allowPrivateFilesystem: boolean;
  loadedAt: number;
  payload: NativeDashboardBootstrap;
} | null = null;
let inFlightBootstrap: {
  allowPrivateFilesystem: boolean;
  promise: Promise<NativeDashboardBootstrap | null>;
} | null = null;

export function grantNativePrivateFilesystemAccess() {
  try {
    window.localStorage.setItem(NATIVE_PRIVATE_FILESYSTEM_CONSENT_KEY, "1");
  } catch {
    // The native backend remains consent-gated when browser storage is unavailable.
  }
}

export function nativePrivateFilesystemAccessGranted() {
  try {
    return window.localStorage.getItem(NATIVE_PRIVATE_FILESYSTEM_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export async function readNativeDashboardBootstrap(input: {
  maxAgeMs?: number;
  cacheTtlMs?: number;
  force?: boolean;
  timeoutMs?: number;
  allowPrivateFilesystem?: boolean;
  vaultPath?: string;
  kanbanFolder?: string;
  kanbanBoard?: string;
  scheduledFolder?: string;
} = {}): Promise<NativeDashboardBootstrap | null> {
  if (!isTauriDesktopRuntime()) return null;
  const now = Date.now();
  const cacheTtlMs = input.cacheTtlMs ?? 5_000;
  const allowPrivateFilesystem = input.allowPrivateFilesystem === true && nativePrivateFilesystemAccessGranted();
  if (
    !input.force
    && cachedBootstrap
    && cachedBootstrap.allowPrivateFilesystem === allowPrivateFilesystem
    && now - cachedBootstrap.loadedAt <= cacheTtlMs
  ) {
    return cachedBootstrap.payload;
  }
  if (!input.force && inFlightBootstrap?.allowPrivateFilesystem === allowPrivateFilesystem) {
    return inFlightBootstrap.promise;
  }

  let promise: Promise<NativeDashboardBootstrap | null> | null = null;
  promise = (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const payload = await withTimeout(invoke<NativeDashboardBootstrap>("dashboard_bootstrap", {
        maxAgeMs: input.maxAgeMs,
        allowPrivateFilesystem,
        vaultPath: input.vaultPath,
        kanbanFolder: input.kanbanFolder,
        kanbanBoard: input.kanbanBoard,
        scheduledFolder: input.scheduledFolder,
      }), input.timeoutMs ?? DEFAULT_BOOTSTRAP_TIMEOUT_MS);
      if (!payload) return null;
      cachedBootstrap = { allowPrivateFilesystem, loadedAt: Date.now(), payload };
      return payload;
    } catch {
      return null;
    } finally {
      if (inFlightBootstrap?.promise === promise) inFlightBootstrap = null;
    }
  })();
  inFlightBootstrap = { allowPrivateFilesystem, promise };

  return promise;
}
