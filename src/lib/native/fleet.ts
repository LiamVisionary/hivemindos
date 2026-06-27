import type { FleetHostedApp } from "@/components/fleet/active-apps";
import type { DiscoveredMachine, TailnetHealth, TailscaleDevice } from "@/features/dashboard/dashboard-types";
import { readNativeDashboardBootstrap } from "@/lib/native/dashboard-bootstrap";
import { isPackagedDesktopRuntime, isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export type NativeFleetAppsPayload = {
  ok?: boolean;
  checkedAt?: string;
  source?: string;
  cacheAgeMs?: number;
  stale?: boolean;
  apps?: FleetHostedApp[];
  machines?: Array<{ name: string; collector: string; appCount: number; error?: string }>;
  error?: string;
};

export type NativeTailscaleDevicesPayload = {
  ok?: boolean;
  backendState?: string;
  authUrl?: string;
  source?: string;
  tailnetHealth?: TailnetHealth;
  devices?: TailscaleDevice[];
  error?: string;
};

export type NativeFleetDiscoveryPayload = {
  ok?: boolean;
  source?: string;
  machines?: DiscoveredMachine[];
  error?: string;
};

export async function getNativeFleetAppsCache<TPayload = NativeFleetAppsPayload>(input: { maxAgeMs?: number } = {}): Promise<TPayload | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const bootstrap = await readNativeDashboardBootstrap({ maxAgeMs: input.maxAgeMs });
    if (bootstrap?.fleetApps) return bootstrap.fleetApps as TPayload;
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<TPayload>("fleet_apps_cache", { maxAgeMs: input.maxAgeMs });
  } catch {
    return null;
  }
}

export async function getNativeTailscaleDevices(): Promise<NativeTailscaleDevicesPayload | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const bootstrap = await readNativeDashboardBootstrap();
    if (bootstrap?.tailscaleDevices) return bootstrap.tailscaleDevices;
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeTailscaleDevicesPayload>("tailscale_devices");
  } catch {
    return null;
  }
}

export async function getNativeFleetDiscovery(): Promise<NativeFleetDiscoveryPayload | null> {
  if (!isTauriDesktopRuntime()) return null;
  if (typeof window !== "undefined" && /^https?:$/.test(window.location.protocol)) return null;
  if (!(await isPackagedDesktopRuntime())) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeFleetDiscoveryPayload>("fleet_discover");
  } catch {
    return null;
  }
}
