import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { RuntimeRepoSyncStatus, RuntimeRun, RuntimeRunLog } from "@/lib/services/runtime-adapters/types";

type NativeRepoSyncPayload = {
  ok?: boolean;
  status?: RuntimeRepoSyncStatus;
  message?: string;
  error?: string;
};

type NativeRunsPayload = {
  ok?: boolean;
  runtime?: string;
  runs?: RuntimeRun[];
  log?: RuntimeRunLog;
  error?: string;
};

async function invokeNativeAeon<T extends { error?: string }>(
  command: string,
  input: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return { error: message } as T;
  }
}

export async function nativeAeonRepoSync(input: {
  agent: AgentProfile;
  action: "status" | "pull" | "push";
}) {
  return invokeNativeAeon<NativeRepoSyncPayload>("aeon_repo_sync", {
    agent: input.agent,
    action: input.action,
  });
}

export async function listNativeAeonRuns(input: {
  agent: AgentProfile;
}) {
  return invokeNativeAeon<NativeRunsPayload>("list_aeon_runs", { agent: input.agent });
}

export async function getNativeAeonRunLog(input: {
  agent: AgentProfile;
  runId: string;
}) {
  return invokeNativeAeon<NativeRunsPayload>("get_aeon_run_log", {
    agent: input.agent,
    runId: input.runId,
  });
}
