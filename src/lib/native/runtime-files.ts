import type { SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export type NativeRuntimeFilesPayload = {
  ok?: boolean;
  source?: string;
  roots?: unknown[];
  files?: unknown[];
  file?: unknown;
  error?: string;
};

export async function nativeRuntimeFileRequest(body: {
  action?: "roots" | "list" | "read" | "write";
  agents?: AgentProfile[];
  sharedVault?: SharedVaultConfig;
  rootKey?: string;
  path?: string;
  content?: string;
}): Promise<NativeRuntimeFilesPayload | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeRuntimeFilesPayload>("runtime_files", {
      action: body.action,
      agents: body.agents,
      sharedVault: body.sharedVault,
      rootKey: body.rootKey,
      path: body.path,
      content: body.content,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Native runtime file action failed." };
  }
}
