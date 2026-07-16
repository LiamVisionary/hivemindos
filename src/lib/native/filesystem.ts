import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export type NativeDirectoryEntry = {
  name: string;
  path: string;
  kind: "directory";
};

export type NativeDirectoryListing = {
  ok?: boolean;
  path: string;
  parentPath?: string;
  directories: NativeDirectoryEntry[];
};

export type NativeFolderResult = {
  ok?: boolean;
  path?: string;
  label?: string;
  cancelled?: boolean;
  error?: string;
};

export type NativeActionResult = {
  ok?: boolean;
  error?: string;
};

function normalizeCollectorUrl(url?: string | null) {
  const trimmed = url?.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const peerPrefix = "/peer/";
    if (parsed.pathname.startsWith(peerPrefix)) {
      const peer = decodeURIComponent(parsed.pathname.slice(peerPrefix.length)).replace(/\/+$/, "");
      if (peer) return `http://${peer}`;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

export function isLocalCollectorUrl(url?: string | null) {
  const normalized = normalizeCollectorUrl(url);
  if (!normalized) return true;
  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return true;
  }
}

export async function listNativeLocalDirectories(input: {
  path?: string;
  collectorUrl?: string | null;
}): Promise<NativeDirectoryListing | null> {
  if (!isTauriDesktopRuntime() || !isLocalCollectorUrl(input.collectorUrl)) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeDirectoryListing>("list_local_directories", { path: input.path ?? "~" });
  } catch {
    return null;
  }
}

export async function createNativeLocalFolder(input: {
  parentPath: string;
  name: string;
}): Promise<NativeFolderResult | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeFolderResult>("create_local_folder", input);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not create folder." };
  }
}

export async function displayNativeLocalPath(path: string) {
  if (!isTauriDesktopRuntime()) return path;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("display_local_path", { path });
  } catch {
    return path;
  }
}

export async function openNativeDirectory(input: {
  currentPath?: string;
  prompt?: string;
} = {}): Promise<NativeFolderResult | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title: input.prompt ?? "Choose a folder",
      defaultPath: input.currentPath && input.currentPath.startsWith("/") ? input.currentPath : undefined,
    });
    if (!selected || Array.isArray(selected)) return { cancelled: true };
    return { ok: true, path: await displayNativeLocalPath(selected) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not choose a folder." };
  }
}

export async function openNativeDeliverable(input: {
  action: "folder" | "open" | "reveal";
  path?: string;
  url?: string;
}): Promise<NativeActionResult | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeActionResult>("open_deliverable", input);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not open deliverable." };
  }
}

export type NativeOpenInAppId = "vscode" | "xcode" | "terminal" | "finder" | "default";

/**
 * Whether the native "Open in <app>" command is available. False outside the
 * Tauri desktop app (there is no browser equivalent), so the chat header's
 * Open-in menu can hide these entries in the browser.
 */
export function nativeOpenInAppSupported(): boolean {
  return isTauriDesktopRuntime();
}

export async function openNativeInApp(input: {
  app: NativeOpenInAppId;
  path: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isTauriDesktopRuntime()) {
    return { ok: false, error: "Opening in an app requires the HivemindOS desktop app." };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<NativeActionResult>("open_in_app", input);
    return { ok: result?.ok ?? true, error: result?.error };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not open in the selected app." };
  }
}
