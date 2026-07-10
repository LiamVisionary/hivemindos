import type { AgentProfile, AgentRuntime, AgentRuntimeKind, RuntimeCapabilities } from "@/lib/types/agent-runtime";

export type RuntimeAdapterContext = {
  requestUrl?: string;
  agents?: AgentProfile[];
  vaultPath?: string;
  fastSecretStatus?: boolean;
};

export type RuntimeScheduleAction = "run-now" | "enable" | "disable";
export type RuntimeSkillConfigAction = "enable" | "disable" | "schedule" | "var" | "model" | "harness" | "automate";

export type RuntimeSchedule = {
  id: string;
  runtime: AgentRuntime;
  agentId?: string;
  name: string;
  schedule?: string;
  every?: string;
  everyMs?: number;
  message?: string;
  enabled?: boolean;
  nextRunMs?: number;
  lastRunMs?: number;
  lastStatus?: string;
  lastSummary?: string;
  source?: string;
  metadata?: Record<string, unknown>;
};

export type RuntimeRun = {
  id: string;
  runtime: AgentRuntime;
  name: string;
  status: "queued" | "active" | "completed" | "failed" | "unknown";
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  conclusion?: string | null;
};

export type RuntimeRunLog = {
  id: string;
  summary: string;
  logs: string;
  url?: string;
};

export type RuntimeSkillMetrics = {
  slug: string;
  name: string;
  total: number;
  success: number;
  failure: number;
  active: number;
  successRate: number;
  lastRun?: string;
  lastConclusion?: string | null;
};

export type RuntimeAnalytics = {
  summary: {
    totalRuns: number;
    success: number;
    failure: number;
    active: number;
    successRate: number;
    uniqueSkills: number;
  };
  skills: RuntimeSkillMetrics[];
  insights: Array<{ type: "warning" | "info" | "success"; message: string }>;
};

export type RuntimeSkill = {
  slug: string;
  name: string;
  description: string;
  category?: string;
  enabled?: boolean;
  schedule?: string;
  var?: string;
  model?: string;
  harness?: string;
  tags?: string[];
  requires?: Array<{ key: string; optional?: boolean }>;
  mcp?: Array<{ slug: string; optional?: boolean }>;
  pack?: string;
  packName?: string;
  source?: string;
  path?: string;
  checksum?: string;
  providerLabel?: string;
  automationYaml?: string;
};

export type RuntimeEnvSyncResult = {
  repo: string;
  githubSecretCount?: number;
  synced: Array<{ key: string }>;
  skipped: Array<{ key: string; reason: string }>;
  sources: string[];
};

export type RuntimeSecretStatus = {
  repo: string;
  githubSecretCount?: number;
  keys: Array<{
    key: string;
    label: string;
    isSet: boolean;
    availableInSharedEnv: boolean;
    availableLocally: boolean;
    usedIn: string[];
    guidance?: string;
  }>;
};

export type RuntimeMemorySnapshot = {
  root: string;
  index?: string;
  topics: Array<{ slug: string; title: string; excerpt: string; path: string; updatedAt?: string }>;
  logs: Array<{ slug: string; title: string; excerpt: string; path: string; updatedAt?: string }>;
  issues: Array<{ slug: string; title: string; excerpt: string; path: string; updatedAt?: string }>;
};

export type RuntimeRepoSyncStatus = {
  root: string;
  repo: string;
  branch: string;
  hasChanges: boolean;
  changedFiles: string[];
  behind: number;
  ahead: number;
  lastMessage?: string;
};

export type RuntimeModelOption = {
  id: string;
  name?: string;
  subtitle?: string;
  group?: string;
  badge?: string;
  disabled?: boolean;
  disabledReason?: string;
};

export type RuntimeModelProvider = {
  slug: string;
  name: string;
  models: RuntimeModelOption[];
  totalModels: number;
  isCurrent?: boolean;
  isUserDefined?: boolean;
  source?: string;
};

export type RuntimeModelSelection = {
  provider: string;
  model: string;
  providers: RuntimeModelProvider[];
};

export type RuntimeAdapter = {
  runtime: AgentRuntime;
  label: string;
  kind: AgentRuntimeKind;
  capabilities: RuntimeCapabilities;
  defaultProfile: Partial<AgentProfile>;
  getStatus?: (profile: AgentProfile, context: RuntimeAdapterContext) => Promise<unknown>;
  listSkills?: (profile: AgentProfile, context: RuntimeAdapterContext) => Promise<RuntimeSkill[]>;
  syncSkills?: (profile: AgentProfile, context: RuntimeAdapterContext) => Promise<unknown>;
  syncEnv?: (
    profile: AgentProfile,
    context: RuntimeAdapterContext & { keys?: string[]; allSharedEnv?: boolean },
  ) => Promise<RuntimeEnvSyncResult>;
  listSchedules?: (profile: AgentProfile, context: RuntimeAdapterContext) => Promise<RuntimeSchedule[]>;
  runScheduleAction?: (
    profile: AgentProfile | undefined,
    action: RuntimeScheduleAction,
    jobId: string,
    context: RuntimeAdapterContext,
  ) => Promise<{ ok: boolean; error?: string; result?: unknown }>;
  runIntegrationAction?: (
    profile: AgentProfile | undefined,
    action: string,
    input: Record<string, unknown>,
    context: RuntimeAdapterContext,
  ) => Promise<{ ok: boolean; error?: string; message?: string; result?: unknown }>;
  listRuns?: (profile: AgentProfile, context: RuntimeAdapterContext) => Promise<RuntimeRun[]>;
  listOutputs?: (profile: AgentProfile, context: RuntimeAdapterContext) => Promise<unknown[]>;
  getRunLog?: (profile: AgentProfile, runId: string, context: RuntimeAdapterContext) => Promise<RuntimeRunLog>;
  getAnalytics?: (profile: AgentProfile, context: RuntimeAdapterContext) => Promise<RuntimeAnalytics>;
  getMemory?: (profile: AgentProfile, context: RuntimeAdapterContext) => Promise<RuntimeMemorySnapshot>;
  getSecretStatus?: (profile: AgentProfile, context: RuntimeAdapterContext) => Promise<RuntimeSecretStatus>;
  updateSkillConfig?: (
    profile: AgentProfile,
    skill: string,
    action: RuntimeSkillConfigAction,
    value: string | boolean,
    context: RuntimeAdapterContext,
  ) => Promise<{ ok: boolean; error?: string; result?: unknown }>;
  getRepoSyncStatus?: (profile: AgentProfile, context: RuntimeAdapterContext) => Promise<RuntimeRepoSyncStatus>;
  runRepoSyncAction?: (
    profile: AgentProfile,
    action: "pull" | "push",
    context: RuntimeAdapterContext,
  ) => Promise<{ ok: boolean; error?: string; status?: RuntimeRepoSyncStatus; message?: string }>;
};
