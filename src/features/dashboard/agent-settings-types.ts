import type { AdaptiveOpenRouterConfig, AdaptiveRoutingConfig, AgentCallPreferences, AgentRuntime, BeeWorkerClass, CustomWorkerClassProfile, UsePodAgentConfig, VeniceAgentConfig, WorkerTaskPreference } from "@/lib/types/agent-runtime";

export type AgentCreateDraft = {
  name: string;
  runtime: AgentRuntime;
  provider?: string;
  model?: string;
  adaptiveOpenRouter?: AdaptiveOpenRouterConfig;
  adaptiveRouting?: AdaptiveRoutingConfig;
  usePod?: UsePodAgentConfig;
  venice?: VeniceAgentConfig;
  calls?: AgentCallPreferences;
  workerClass: BeeWorkerClass;
  customWorkerClass?: CustomWorkerClassProfile;
  customWorkerClasses: CustomWorkerClassProfile[];
  selectedCustomWorkerClassId?: string;
  soulPrompt?: string;
  skillProfilePrompt: string;
  preferredSkillSlugs: string[];
  taskPreferences?: WorkerTaskPreference[];
  useSharedVault: boolean;
  aeonLocalPath?: string;
  aeonRepo?: string;
  aeonBranch?: string;
  aeonMode?: "github" | "a2a" | "local";
  a2aUrl?: string;
};

export type RuntimeModelDraft = {
  provider: string;
  model: string;
  contextLength: string;
};

export type AgentSettingsPanel = "role" | "connection" | "memory" | "tools" | "calls" | "security";

export type AgentWorkerClassView = "presets" | "create";

export type RuntimeModelSetupMode = "provider" | "model" | null;
