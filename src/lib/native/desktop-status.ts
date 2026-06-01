import type { AppVersion } from "@/features/dashboard/dashboard-types";

type NativeDesktopStatus = AppVersion & {
  ok?: boolean;
  runtime?: string;
  phase?: string;
  devUrl?: string | null;
  nativeHost?: string;
  nativePort?: number | null;
};

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

export async function getNativeAppVersion(signal?: AbortSignal): Promise<AppVersion | null> {
  if (!isTauriDesktopRuntime() || signal?.aborted) return null;

  try {
    const { readNativeDashboardBootstrap } = await import("@/lib/native/dashboard-bootstrap");
    const bootstrap = await readNativeDashboardBootstrap();
    const bootStatus = bootstrap?.appVersion ?? bootstrap?.desktopStatus;
    if (!signal?.aborted && bootStatus?.commit) {
      return {
        appDir: bootStatus.appDir,
        commit: bootStatus.commit,
        shortCommit: bootStatus.shortCommit ?? bootStatus.commit.slice(0, 7),
        branch: bootStatus.branch,
        dirty: bootStatus.dirty,
        latestCommit: bootStatus.latestCommit ?? bootStatus.commit,
        latestShortCommit: bootStatus.latestShortCommit ?? bootStatus.commit.slice(0, 7),
        updateCommand: bootStatus.updateCommand,
      };
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const status = await invoke<NativeDesktopStatus>("desktop_status");
    if (signal?.aborted || !status?.commit) return null;

    return {
      appDir: status.appDir,
      commit: status.commit,
      shortCommit: status.shortCommit ?? status.commit.slice(0, 7),
      branch: status.branch,
      dirty: status.dirty,
      latestCommit: status.latestCommit ?? status.commit,
      latestShortCommit: status.latestShortCommit ?? status.commit.slice(0, 7),
      updateCommand: status.updateCommand,
    };
  } catch {
    return null;
  }
}
