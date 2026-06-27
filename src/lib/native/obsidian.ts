// Native bridges for Obsidian shared-brain vault reads. The packaged static
// desktop app has no Next /api server, so vault-backed data is read through
// Tauri commands (src-tauri/src/obsidian.rs) instead of /api/obsidian/*. Returns
// null off the desktop runtime (web/phone) so callers fall back to HTTP.

import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import type { AgentProfile } from "@/lib/types/agent-runtime";

export async function getNativeObsidianAgents(
  vaultPath: string,
): Promise<{ ok: boolean; agents: AgentProfile[] } | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<{ ok: boolean; agents: AgentProfile[] }>("obsidian_agents", { vaultPath });
  } catch {
    return null;
  }
}
