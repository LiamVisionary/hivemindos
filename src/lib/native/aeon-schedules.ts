import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { RuntimeSchedule } from "@/lib/services/runtime-adapters/types";

type NativeSchedulesPayload = {
  ok?: boolean;
  runtime?: string;
  schedules?: RuntimeSchedule[];
  error?: string;
};

export async function listNativeAeonSchedules(input: {
  agent: AgentProfile;
}): Promise<NativeSchedulesPayload | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeSchedulesPayload>("list_aeon_schedules", { agent: input.agent });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return { ok: false, error: message };
  }
}
