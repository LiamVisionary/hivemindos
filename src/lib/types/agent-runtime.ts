export type KnownAgentRuntime = "openclaw" | "hermes" | "aeon" | "openai-compatible";
export type AgentRuntime = KnownAgentRuntime | (string & {});
export type AgentRuntimeKind = "interactive" | "background" | "gateway" | "collector";

export interface RuntimeCapabilities {
  status?: boolean;
  chat?: boolean;
  skills?: boolean;
  schedules?: boolean;
  runs?: boolean;
  outputs?: boolean;
  memory?: boolean;
  sessionSearch?: boolean;
  backgroundTasks?: boolean;
  xSearch?: boolean;
  socialPosting?: boolean;
  videoGeneration?: boolean;
  codexRuntime?: boolean;
  kanbanDecompose?: boolean;
  notifications?: boolean;
  setup?: boolean;
  walletTools?: boolean;
  modelSelection?: boolean;
}

export type BeeAgentRole = "queen" | "worker" | "observer" | "human";
export type BeeWorkerClass = "general" | "planner" | "code" | "vision" | "writer" | "research" | "artist" | "ops" | "qa";
export type AdaptiveOpenRouterUseCase = "auto" | "coding" | "writing" | "vision" | "image" | "research" | "tool-use";

export interface AdaptiveOpenRouterConfig {
  useCase?: AdaptiveOpenRouterUseCase;
  fallbackModel?: string;
}

export interface UsePodAgentConfig {
  tokenEnvName?: string;
  depositAddress?: string;
  maxPriceInputMicrounits?: string;
  maxPriceOutputMicrounits?: string;
  lastBalanceRemaining?: string;
  lastRoute?: string;
}

export type AgentVoiceRuntime = "openai-realtime" | "grok-voice" | "gemini-live" | (string & {});
export type AgentCallMissedFallback = "none" | "in_app" | "obsidian_note" | "telegram";

export interface AgentCallPreferences {
  voiceRuntime: AgentVoiceRuntime;
  voiceProviderId?: string;
  voiceId?: string;
  enabled: boolean;
  dailyEnabled: boolean;
  dailyCallTime: string;
  timezone: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  maxCallsPerDay: number;
  sources: {
    obsidianBriefing: boolean;
    codingJobCompletion: boolean;
    blockedAgentDecision: boolean;
  };
  missedCallFallback: AgentCallMissedFallback;
}

function detectAgentCallTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function buildAgentCallPreferences(input?: Partial<AgentCallPreferences> | null): AgentCallPreferences {
  return {
    voiceRuntime: input?.voiceRuntime || "openai-realtime",
    voiceProviderId: input?.voiceProviderId,
    voiceId: input?.voiceId,
    enabled: input?.enabled ?? false,
    dailyEnabled: input?.dailyEnabled ?? false,
    dailyCallTime: input?.dailyCallTime || "09:00",
    timezone: input?.timezone || detectAgentCallTimezone(),
    quietHoursEnabled: input?.quietHoursEnabled ?? true,
    quietHoursStart: input?.quietHoursStart || "22:00",
    quietHoursEnd: input?.quietHoursEnd || "08:00",
    maxCallsPerDay: input?.maxCallsPerDay ?? 1,
    sources: {
      obsidianBriefing: input?.sources?.obsidianBriefing ?? true,
      codingJobCompletion: input?.sources?.codingJobCompletion ?? false,
      blockedAgentDecision: input?.sources?.blockedAgentDecision ?? false,
    },
    missedCallFallback: input?.missedCallFallback || "obsidian_note",
  };
}

export interface CustomWorkerClassProfile {
  id: string;
  label: string;
  imageSrc?: string;
  skillProfilePrompt: string;
  preferredSkillSlugs: string[];
}

export interface AgentProfile {
  id: string;
  name: string;
  runtime: AgentRuntime;
  gatewayUrl: string;
  token?: string;
  provider?: string;
  model?: string;
  adaptiveOpenRouter?: AdaptiveOpenRouterConfig;
  usePod?: UsePodAgentConfig;
  calls?: AgentCallPreferences;
  agentId?: string;
  sessionKey?: string;
  chatPath?: string;
  statusPath?: string;
  useSharedVault?: boolean;
  localDataDir?: string;
  machineName?: string;
  telemetryUrl?: string;
  collectorCapabilities?: {
    chat?: boolean;
    directoryBrowsing?: boolean;
    envHttpSync?: boolean;
    runtimeAgentCreation?: boolean;
    skillInventory?: boolean;
    skillAutoSync?: boolean;
    runtimes?: string[];
    syncthing?: boolean;
    defaultSyncPath?: string;
  };
  runtimeKind?: AgentRuntimeKind;
  runtimeCapabilities?: RuntimeCapabilities;
  aeonRepo?: string;
  aeonRepoName?: string;
  aeonLogoUrl?: string;
  aeonBranch?: string;
  aeonLocalPath?: string;
  a2aUrl?: string;
  aeonMode?: "github" | "a2a" | "local";
  beeRole?: BeeAgentRole;
  workerClass?: BeeWorkerClass;
  customWorkerClass?: CustomWorkerClassProfile;
  customWorkerClasses?: CustomWorkerClassProfile[];
  selectedCustomWorkerClassId?: string;
  skillProfilePrompt?: string;
  preferredSkillSlugs?: string[];
  agentEnv?: Record<string, string>;
  memoryForkedFromAgentId?: string;
}

export interface SharedVaultConfig {
  enabled: boolean;
  vaultPath: string;
  syncProvider: "external" | "syncthing" | "manual";
  tailnetSyncHost: string;
  tailnetSyncPath: string;
  tailnetSyncDirection: "bidirectional" | "push" | "pull";
  syncthingAutoPairEnabled: boolean;
  tailnetSyncIntervalSeconds: number;
  inboxFolder: string;
  sharedNotePath: string;
  kanbanFolder: string;
  notificationsFolder: string;
  scheduledFolder: string;
  synthesisFolder: string;
  brainServicesFolder: string;
  noteTaskImportFolders: string;
  noteTaskImportEnabled: boolean;
  skillAutoSyncAll: boolean;
  skillAutoSync: Record<string, {
    autoImport: boolean;
    autoUpdate: boolean;
    trackRemovals: boolean;
    allowDelete: boolean;
  }>;
  gbrain: GBrainConfig;
  controlRoomPath: string;
  instructions: string;
}

export type GBrainInstallMode = "optional" | "local" | "remote";
export type GBrainMcpMode = "stdio" | "http" | "disabled";
export type GBrainProviderPolicy = "balanced-cloud" | "local-first" | "max-quality";
export type GBrainSearchMode = "conservative" | "balanced" | "tokenmax";

export interface GBrainConfig {
  enabled: boolean;
  installMode: GBrainInstallMode;
  cliPath: string;
  installPath: string;
  brainPath: string;
  dataDir: string;
  mcpMode: GBrainMcpMode;
  httpUrl: string;
  searchMode: GBrainSearchMode;
  providerPolicy: GBrainProviderPolicy;
  skillpackLocation: string;
}

const DEFAULT_SYNCTHING_AUTO_PAIR_ENABLED = process.env.NEXT_PUBLIC_TAILNET_SYNC_ENABLED === "true";

export const DEFAULT_SHARED_VAULT: SharedVaultConfig = {
  enabled: true,
  vaultPath: process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH ?? "~/Documents/Obsidian/hivemindos-vault",
  syncProvider: DEFAULT_SYNCTHING_AUTO_PAIR_ENABLED ? "syncthing" : "external",
  tailnetSyncHost: "",
  tailnetSyncPath: "",
  tailnetSyncDirection: "bidirectional",
  syncthingAutoPairEnabled: DEFAULT_SYNCTHING_AUTO_PAIR_ENABLED,
  tailnetSyncIntervalSeconds: 20,
  inboxFolder: process.env.NEXT_PUBLIC_OBSIDIAN_INBOX_FOLDER ?? "Intake",
  sharedNotePath: process.env.NEXT_PUBLIC_OBSIDIAN_SHARED_NOTE_PATH ?? "Shared Context.md",
  kanbanFolder: process.env.NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER ?? "Operations/Work Board",
  notificationsFolder: process.env.NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER ?? "Operations/Agent Notifications",
  scheduledFolder: process.env.NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER ?? "Operations/Automations",
  synthesisFolder: process.env.NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER ?? "Synthesis",
  brainServicesFolder: process.env.NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER ?? "Operations/Brain Services",
  noteTaskImportFolders: "Projects\nIntake\nMemory",
  noteTaskImportEnabled: false,
  skillAutoSyncAll: false,
  skillAutoSync: {},
  gbrain: {
    enabled: false,
    installMode: "optional",
    cliPath: process.env.NEXT_PUBLIC_GBRAIN_CLI_PATH ?? "gbrain",
    installPath: process.env.NEXT_PUBLIC_GBRAIN_INSTALL_PATH ?? "~/gbrain",
    brainPath: process.env.NEXT_PUBLIC_GBRAIN_BRAIN_PATH ?? "",
    dataDir: process.env.NEXT_PUBLIC_GBRAIN_DATA_DIR ?? "~/.gbrain",
    mcpMode: "stdio",
    httpUrl: process.env.NEXT_PUBLIC_GBRAIN_HTTP_URL ?? "http://127.0.0.1:3131",
    searchMode: "balanced",
    providerPolicy: "balanced-cloud",
    skillpackLocation: process.env.NEXT_PUBLIC_GBRAIN_SKILLPACK_LOCATION ?? "Skills/GBrain",
  },
  controlRoomPath: process.env.NEXT_PUBLIC_HERMES_CONTROL_ROOM_PATH ?? "~/agent-control-room",
  instructions: "Use this vault as the shared memory and handoff space for all local agents. Read AGENTS.md before durable edits. Treat GBrain as the optional retrieval/graph brain service, Synthesis as the reviewed synthesis layer, and Operations as machine-readable HivemindOS state.",
};

export const KNOWN_AGENT_RUNTIMES: KnownAgentRuntime[] = ["openclaw", "hermes", "aeon", "openai-compatible"];

export const RUNTIME_LABELS: Record<string, string> = {
  openclaw: "OpenClaw",
  hermes: "Hermes",
  aeon: "Aeon",
  "openai-compatible": "Local OpenAI",
};

export const RUNTIME_DEFAULTS: Record<string, Pick<AgentProfile, "gatewayUrl" | "chatPath" | "statusPath">> = {
  openclaw: {
    gatewayUrl: "ws://127.0.0.1:18789",
    chatPath: "",
    statusPath: "",
  },
  hermes: {
    gatewayUrl: process.env.NEXT_PUBLIC_HERMES_BASE_URL ?? "http://127.0.0.1:8642",
    chatPath: "/chat",
    statusPath: "/health",
  },
  aeon: {
    gatewayUrl: process.env.NEXT_PUBLIC_AEON_A2A_URL ?? process.env.NEXT_PUBLIC_AEON_BASE_URL ?? "http://127.0.0.1:41241",
    chatPath: "",
    statusPath: "/health",
  },
  "openai-compatible": {
    gatewayUrl: process.env.NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL ?? "http://127.0.0.1:1234",
    chatPath: "/v1/chat/completions",
    statusPath: "/v1/models",
  },
};

export const RUNTIME_CAPABILITIES: Record<string, RuntimeCapabilities> = {
  openclaw: {
    status: true,
    chat: true,
    modelSelection: true,
  },
  hermes: {
    status: true,
    chat: true,
    runs: true,
    memory: true,
    sessionSearch: true,
    backgroundTasks: true,
    xSearch: true,
    socialPosting: false,
    videoGeneration: true,
    codexRuntime: true,
    kanbanDecompose: true,
    setup: true,
    walletTools: true,
    modelSelection: true,
  },
  aeon: {
    status: true,
    skills: true,
    schedules: true,
    runs: true,
    outputs: true,
    memory: true,
    backgroundTasks: true,
    notifications: true,
    setup: true,
  },
  "openai-compatible": {
    status: true,
    chat: true,
    modelSelection: true,
  },
};

export const RUNTIME_KINDS: Record<string, AgentRuntimeKind> = {
  openclaw: "gateway",
  hermes: "interactive",
  aeon: "background",
  "openai-compatible": "interactive",
};

export function createAgentProfile(runtime: AgentRuntime, index = 1): AgentProfile {
  const defaults = RUNTIME_DEFAULTS[runtime] ?? RUNTIME_DEFAULTS["openai-compatible"];
  const label = RUNTIME_LABELS[runtime] ?? runtime;
  return {
    id: `${runtime}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${label} Agent ${index}`,
    runtime,
    gatewayUrl: defaults.gatewayUrl,
    chatPath: defaults.chatPath,
    statusPath: defaults.statusPath,
    agentId: runtime === "openclaw" ? "main" : "",
    provider: runtime === "hermes" ? "openai-codex" : runtime === "openai-compatible" ? "lm-studio" : "",
    model: runtime === "openai-compatible" ? process.env.NEXT_PUBLIC_LOCAL_OPENAI_MODEL ?? "" : "",
    localDataDir: runtime === "hermes" && index === 1 ? "~/.hermes" : "",
    machineName: "local",
    telemetryUrl: "",
    useSharedVault: true,
    runtimeKind: RUNTIME_KINDS[runtime] ?? "interactive",
    runtimeCapabilities: RUNTIME_CAPABILITIES[runtime] ?? { chat: true },
    aeonRepo: runtime === "aeon" ? process.env.NEXT_PUBLIC_AEON_REPO ?? "" : undefined,
    aeonBranch: runtime === "aeon" ? "main" : undefined,
    aeonLocalPath: runtime === "aeon" ? process.env.NEXT_PUBLIC_AEON_LOCAL_PATH ?? "" : undefined,
    a2aUrl: runtime === "aeon" ? defaults.gatewayUrl : undefined,
    aeonMode: runtime === "aeon" ? "github" : undefined,
    beeRole: runtime === "openclaw" && index === 1 ? "queen" : "worker",
    workerClass: runtime === "openclaw" && index === 1 ? "general" : "general",
    calls: buildAgentCallPreferences(),
  };
}

export function getRuntimeUrl(profile: AgentProfile, path?: string): string {
  if (profile.runtime === "openclaw") return profile.gatewayUrl;
  if (path && /^https?:\/\//i.test(path)) return path;
  const defaults = RUNTIME_DEFAULTS[profile.runtime] ?? RUNTIME_DEFAULTS.hermes;
  const base = (profile.gatewayUrl?.trim() || defaults.gatewayUrl || "").replace(/\/+$/, "");
  const suffix = path || profile.chatPath || defaults.chatPath || "/chat";
  return `${base}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}
