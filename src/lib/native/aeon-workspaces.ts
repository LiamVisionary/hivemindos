import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import type { AgentProfile } from "@/lib/types/agent-runtime";

type NativeWorkspacePayload = {
  ok?: boolean;
  action?: string;
  agent?: AgentProfile;
  root?: string;
  error?: string;
};

function isLocalCollectorUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function prepareNativeAeonWorkspace(input: {
  action: string;
  path?: string;
  name?: string;
  repoUrl?: string;
  collectorUrl?: string;
  machineName?: string;
}): Promise<NativeWorkspacePayload | null> {
  if (!isTauriDesktopRuntime()) return null;
  if (!["initialize", "link"].includes(input.action)) return null;
  if (!isLocalCollectorUrl(input.collectorUrl)) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeWorkspacePayload>("prepare_aeon_workspace", {
      action: input.action,
      path: input.path,
      name: input.name,
      repoUrl: input.repoUrl,
      machineName: input.machineName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return { ok: false, error: message };
  }
}
