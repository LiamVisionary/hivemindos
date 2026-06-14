import type { Update } from "@tauri-apps/plugin-updater";
import { isPackagedDesktopRuntime } from "./desktop-status";

export type UpdateProgress =
  | { phase: "downloading"; percent: number | null }
  | { phase: "installing" }
  | { phase: "relaunching" };

/**
 * Ask the signed updater whether a newer release is published. Returns null in
 * dev/source-checkout builds (the updater plugin only works in packaged builds)
 * and when already up to date.
 */
export async function checkForNativeUpdate(signal?: AbortSignal): Promise<Update | null> {
  if (!(await isPackagedDesktopRuntime(signal))) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  return check();
}

/**
 * Download + install a pending update, then relaunch. On Windows the installer
 * exits the app itself; elsewhere relaunch() restarts into the new version.
 * Never returns on success (the process is replaced).
 */
export async function installNativeUpdate(
  update: Update,
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  let totalBytes = 0;
  let downloadedBytes = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      totalBytes = event.data.contentLength ?? 0;
      onProgress?.({ phase: "downloading", percent: totalBytes > 0 ? 0 : null });
    } else if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
      onProgress?.({
        phase: "downloading",
        percent: totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null,
      });
    } else if (event.event === "Finished") {
      onProgress?.({ phase: "installing" });
    }
  });
  onProgress?.({ phase: "relaunching" });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Tauri plugin calls reject with plain strings, not Error instances. */
export function updaterErrorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}
