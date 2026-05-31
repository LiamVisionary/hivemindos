import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import type { AgentProfile } from "@/lib/types/agent-runtime";

type AeonOutput = {
  filename?: string;
  skill?: string;
  source?: string;
  updatedAt?: string;
  excerpt?: string;
};

type NativeOutputsPayload = {
  ok?: boolean;
  runtime?: string;
  outputs?: AeonOutput[];
  error?: string;
};

export async function listNativeAeonOutputs(input: {
  agent: AgentProfile;
}): Promise<NativeOutputsPayload | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativeOutputsPayload>("list_aeon_outputs", { agent: input.agent });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return { ok: false, error: message };
  }
}
