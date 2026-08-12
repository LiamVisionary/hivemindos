import type { AppVersion } from "@/features/dashboard/dashboard-types";
export { isPackagedReleaseAppVersion, selectDashboardAppVersion } from "./app-version-selection";

type NativeDesktopStatus = AppVersion & {
  ok?: boolean;
  runtime?: string;
  phase?: string;
  packaged?: boolean;
  sourceBuild?: boolean;
  releaseChannel?: string;
  devUrl?: string | null;
  nativeHost?: string;
  nativePort?: number | null;
};

function appVersionFromNativeStatus(status: NativeDesktopStatus): AppVersion {
  return {
    appDir: status.appDir,
    version: status.version,
    latestVersion: status.latestVersion,
    commit: status.commit,
    shortCommit: status.shortCommit ?? status.commit?.slice(0, 7),
    branch: status.branch,
    dirty: status.dirty,
    latestCommit: status.latestCommit ?? status.commit,
    latestShortCommit: status.latestShortCommit ?? status.commit?.slice(0, 7),
    updateCommand: status.updateCommand,
    packaged: status.packaged,
    sourceBuild: status.sourceBuild,
    releaseChannel: status.releaseChannel,
  };
}

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriDesktopRuntime() {
  return typeof window !== "undefined" && (
    typeof window.__TAURI_INTERNALS__ !== "undefined"
    || typeof window.__TAURI__ !== "undefined"
  );
}

/**
 * True only in release desktop builds (debug_assertions off), where the
 * signed tauri-plugin-updater flow is the correct update path. Dev builds
 * and the plain web app keep the git-checkout update flow.
 */
export async function isPackagedDesktopRuntime(signal?: AbortSignal): Promise<boolean> {
  if (!isTauriDesktopRuntime() || signal?.aborted) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const status = await invoke<NativeDesktopStatus>("desktop_status");
    return status?.packaged === true;
  } catch {
    return false;
  }
}

export async function isReleaseUpdaterDesktopRuntime(signal?: AbortSignal): Promise<boolean> {
  if (!isTauriDesktopRuntime() || signal?.aborted) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const status = await invoke<NativeDesktopStatus>("desktop_status");
    return status?.packaged === true && status.sourceBuild !== true && status.releaseChannel !== "source";
  } catch {
    return false;
  }
}

export async function getNativeAppVersion(signal?: AbortSignal): Promise<AppVersion | null> {
  if (!isTauriDesktopRuntime() || signal?.aborted) return null;

  try {
    const { readNativeDashboardBootstrap } = await import("@/lib/native/dashboard-bootstrap");
    const bootstrap = await readNativeDashboardBootstrap();
    const bootStatus = bootstrap?.appVersion ?? bootstrap?.desktopStatus;
    if (!signal?.aborted && bootStatus?.commit) {
      return appVersionFromNativeStatus(bootStatus);
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const status = await invoke<NativeDesktopStatus>("desktop_status");
    if (signal?.aborted || !status?.commit) return null;

    return appVersionFromNativeStatus(status);
  } catch {
    return null;
  }
}
