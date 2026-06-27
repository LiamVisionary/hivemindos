import { nativePrivateFilesystemAccessGranted, readNativeDashboardBootstrap } from "@/lib/native/dashboard-bootstrap";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export type NativePhonePromptsPayload = {
  ok?: boolean;
  source?: string;
  prompts?: Array<Record<string, unknown>>;
  vaultPath?: string;
  error?: string;
};

export async function readNativePhonePrompts(input: {
  vaultPath?: string;
  force?: boolean;
} = {}): Promise<NativePhonePromptsPayload | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    if (!input.force) {
      const bootstrap = await readNativeDashboardBootstrap({
        allowPrivateFilesystem: true,
        vaultPath: input.vaultPath,
      });
      if (bootstrap?.phonePrompts?.ok) return bootstrap.phonePrompts;
    }
    if (!nativePrivateFilesystemAccessGranted()) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativePhonePromptsPayload>("phone_prompts", {
      vaultPath: input.vaultPath,
    });
  } catch {
    return null;
  }
}
