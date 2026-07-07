// Native bridges for Obsidian shared-brain vault reads. The packaged static
// desktop app has no Next /api server, so vault-backed data is read through
// Tauri commands (src-tauri/src/obsidian.rs) instead of /api/obsidian/*. Returns
// null off the desktop runtime (web/phone) so callers fall back to HTTP.

import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { nativeOrFetch } from "@/lib/native/bridge";
import type { AgentProfile } from "@/lib/types/agent-runtime";

export type CapturedObsidianNote = {
  vaultPath: string;
  notePath: string;
  title: string;
  createdAt: string;
};

export type CaptureObsidianNoteResponse = {
  ok?: boolean;
  note?: CapturedObsidianNote;
  error?: string;
};

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

export async function captureObsidianNoteFromDashboard(input: {
  vaultPath?: string;
  inboxFolder?: string;
  content: string;
}): Promise<CaptureObsidianNoteResponse> {
  const args = {
    vaultPath: input.vaultPath?.trim() || undefined,
    inboxFolder: input.inboxFolder?.trim() || undefined,
    content: input.content,
  };
  return nativeOrFetch<CaptureObsidianNoteResponse>({
    command: "obsidian_capture_note",
    args,
    fallback: async () => {
      const response = await fetch("/api/obsidian/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "capture", ...args }),
      });
      const data = await response.json().catch(() => null) as CaptureObsidianNoteResponse | null;
      if (data) return data;
      return { ok: false, error: `Note save failed with HTTP ${response.status}` };
    },
  });
}
