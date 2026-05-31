import type { AeonDeliverable } from "@/app/api/runtimes/aeon/deliverables/route";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { KanbanMachineTarget } from "@/lib/types/kanban";

type NativeDeliverablesPayload = {
  ok?: boolean;
  deliverables?: AeonDeliverable[];
  path?: string;
  downloaded?: boolean;
  transfer?: unknown;
  error?: string;
};

async function invokeNativeDeliverable<T extends NativeDeliverablesPayload>(
  command: string,
  input: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (/HTTP deliverables require the Next fallback/i.test(message)) return null;
    return { ok: false, error: message } as T;
  }
}

export async function listNativeAeonDeliverables(input: {
  agent: AgentProfile;
  vaultPath?: string;
}) {
  return invokeNativeDeliverable<{ ok?: boolean; deliverables?: AeonDeliverable[]; error?: string }>(
    "list_aeon_deliverables",
    { agent: input.agent, vaultPath: input.vaultPath },
  );
}

export async function downloadNativeAeonDeliverable(input: {
  path?: string;
  url?: string;
}) {
  return invokeNativeDeliverable<{ ok?: boolean; path?: string; downloaded?: boolean; error?: string }>(
    "download_aeon_deliverable",
    { path: input.path, url: input.url },
  );
}

export async function sendNativeAeonDeliverable(input: {
  path?: string;
  url?: string;
  vaultPath?: string;
  targetMachine: KanbanMachineTarget;
}) {
  return invokeNativeDeliverable<{ ok?: boolean; transfer?: unknown; error?: string }>(
    "send_aeon_deliverable",
    {
      path: input.path,
      url: input.url,
      vaultPath: input.vaultPath,
      targetMachine: input.targetMachine,
    },
  );
}
