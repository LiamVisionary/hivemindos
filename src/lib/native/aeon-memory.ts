import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { RuntimeMemorySnapshot } from "@/lib/services/runtime-adapters/types";

type NativeMemoryPayload = {
  ok?: boolean;
  runtime?: string;
  memory?: RuntimeMemorySnapshot;
  error?: string;
};

export async function getNativeAeonMemory(input: {
  agent: AgentProfile;
}): Promise<NativeMemoryPayload | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeMemoryPayload>("get_aeon_memory", { agent: input.agent });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return { ok: false, error: message };
  }
}
