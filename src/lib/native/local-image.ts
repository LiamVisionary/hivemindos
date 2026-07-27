import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

/**
 * Read a local image file by absolute path and return a full-resolution data
 * URL — desktop only. On the Tauri desktop, a drag-dropped file reaches the
 * webview as a path with no bytes, so this native command is the only way to
 * build a thumbnail preview for it. Returns null off-desktop or on any error
 * (caller falls back to the reference pill).
 */
export async function readLocalImagePreview(path: string): Promise<string | null> {
  if (!path?.trim() || !isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const dataUrl = await invoke<string>("read_local_image_preview", { path });
    return typeof dataUrl === "string" && dataUrl.startsWith("data:image/") ? dataUrl : null;
  } catch {
    return null;
  }
}
