import type { AgentRuntime, KnownAgentRuntime } from "@/lib/types/agent-runtime";
import type { RuntimeAdapter } from "./types";
import { aeonAdapter } from "./aeon";
import { claudeCodeAdapter, codexAdapter, opencodeAdapter } from "./cli-runtimes";
import { hermesAdapter } from "./hermes";
import { openAICompatibleAdapter } from "./openai-compatible";
import { openClawAdapter } from "./openclaw";

export const RUNTIME_ADAPTERS: Record<KnownAgentRuntime, RuntimeAdapter> = {
  openclaw: openClawAdapter,
  hermes: hermesAdapter,
  opencode: opencodeAdapter,
  codex: codexAdapter,
  "claude-code": claudeCodeAdapter,
  aeon: aeonAdapter,
  "openai-compatible": openAICompatibleAdapter,
};

export function getRuntimeAdapter(runtime: AgentRuntime): RuntimeAdapter | undefined {
  return RUNTIME_ADAPTERS[runtime as KnownAgentRuntime];
}

export function runtimeSupports(runtime: AgentRuntime, capability: keyof RuntimeAdapter["capabilities"]) {
  return Boolean(getRuntimeAdapter(runtime)?.capabilities?.[capability]);
}

export function runtimeHasAdapter(runtime: string): runtime is AgentRuntime {
  return Boolean(getRuntimeAdapter(runtime as AgentRuntime));
}

export type {
  RuntimeAdapter,
  RuntimeAdapterContext,
  RuntimeAnalytics,
  RuntimeEnvSyncResult,
  RuntimeMemorySnapshot,
  RuntimeRepoSyncStatus,
  RuntimeRun,
  RuntimeRunLog,
  RuntimeSchedule,
  RuntimeScheduleAction,
  RuntimeSecretStatus,
  RuntimeSkillConfigAction,
  RuntimeSkill,
} from "./types";
