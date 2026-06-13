export const HIVEMIND_OS_RUNTIME = "hivemind-os";
export const LEGACY_OPENAI_COMPATIBLE_RUNTIME = "openai-compatible";

export type KnownAgentRuntime =
  | "openclaw"
  | "hermes"
  | "opencode"
  | "codex"
  | "claude-code"
  | "aeon"
  | "evo"
  | typeof HIVEMIND_OS_RUNTIME;
export type AgentRuntime = KnownAgentRuntime | (string & {});
export type AgentRuntimeKind =
  | "interactive"
  | "background"
  | "gateway"
  | "collector";

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
  imageGeneration?: boolean;
  ttsGeneration?: boolean;
  musicGeneration?: boolean;
  sfxGeneration?: boolean;
  model3dGeneration?: boolean;
  videoGeneration?: boolean;
  codexRuntime?: boolean;
  kanbanDecompose?: boolean;
  notifications?: boolean;
  setup?: boolean;
  walletTools?: boolean;
  modelSelection?: boolean;
  skillActions?: boolean;
  skillActionRuntimes?: Array<
    "osascript" | "http" | "shell" | "node" | "python" | "mcp" | "tauri-native"
  >;
  skillCapabilities?: Array<
    | "chat"
    | "background"
    | "scheduler"
    | "shell"
    | "browser"
    | "mcp"
    | "http"
    | "filesystem"
    | "wallet"
    | "publishing"
    | "deployment"
    | "analytics"
    | "image-generation"
    | "tts-generation"
    | "music-generation"
    | "sfx-generation"
    | "3d-generation"
    | "media-generation"
    | "aeon-workflow"
  >;
}

export type RuntimeEnvFeature =
  | {
      kind: "agent-overlay";
      label: string;
      description: string;
      storage: "profile.agentEnv";
    }
  | {
      kind: "github-secrets";
      label: string;
      description: string;
      localSources: Array<{ label: string; path: string }>;
      syncAction: "runtime.syncEnv";
      statusAction: "runtime.getSecretStatus";
      manageAction?: { label: string; view: string };
    }
  | {
      kind: "local-dotenv";
      label: string;
      description: string;
      localSources: Array<{ label: string; path: string }>;
    }
  | {
      kind: "none";
      label: string;
      description: string;
    };

export type RuntimeDefinition = {
  runtime: KnownAgentRuntime;
  label: string;
  kind: AgentRuntimeKind;
  defaults: Pick<AgentProfile, "gatewayUrl" | "chatPath" | "statusPath">;
  capabilities: RuntimeCapabilities;
  env: RuntimeEnvFeature;
  settings: RuntimeSettingsFeature;
  chat: RuntimeChatFeature;
  scheduler: RuntimeSchedulerFeature;
  profile: RuntimeProfileFeature;
  integration: RuntimeIntegrationFeature;
};

export type RuntimeSettingsPanelId =
  | "role"
  | "connection"
  | "memory"
  | "tools"
  | "calls"
  | "security";

export type RuntimeSettingsFeature = {
  kind: "standard" | "autopilot";
  createPanels: RuntimeSettingsPanelId[];
  editPanels: RuntimeSettingsPanelId[];
  hidesRuntimeSelectorWhenEditing?: boolean;
  modelSource: "runtime" | "skill";
  canAddModels?: boolean;
  runtimeSegmentSubcopy?: string;
  unavailableSubcopy?: string;
  createActionLabel?: string;
  defaultProvider?: string;
  defaultModel?: string;
  defaultAgentId?: string;
};

export type RuntimeChatFeature = {
  kind: "interactive" | "gateway" | "background";
  label: string;
  slashCommandPolicy?: "leading-slash-bypasses-system-context" | "none";
  urlStrategy?: "append-path" | "base-only";
};

export type RuntimeSchedulerFeature =
  | {
      kind: "dashboard";
    }
  | {
      kind: "external-runtime";
      externalSource: KnownAgentRuntime;
      configAction: "runtime.updateSkillConfig";
      primarySkillRequired?: boolean;
    };

export type RuntimeProfileFeature = {
  firstAgentLocalDataDir?: string;
  runtimeFolderMirrors?: Array<"aeonLocalPath">;
  defaultBeeRole?: BeeAgentRole;
  firstAgentBeeRole?: BeeAgentRole;
  defaultWorkerClass?: BeeWorkerClass;
  firstAgentWorkerClass?: BeeWorkerClass;
  postCreateAction?: {
    view: string;
    dashboardStateAgentIdKey?: string;
  };
  aeonDefaults?: {
    repoEnvVar: string;
    localPathEnvVar: string;
    localPathFallback: string;
    branch: string;
    mode: NonNullable<AgentProfile["aeonMode"]>;
    a2aUrl: "gatewayUrl";
    a2aUrlFallback: string;
  };
};

export type RuntimeIntegrationFeature = {
  updateRequirementDetail?: "hermes";
};

export type RuntimeScheduleFilterOption = {
  value: AgentRuntime;
  label: string;
};

export type BeeAgentRole = "queen" | "worker" | "observer" | "human";
export type BeeWorkerClass =
  | "general"
  | "planner"
  | "code"
  | "vision"
  | "writer"
  | "research"
  | "artist"
  | "ops"
  | "qa"
  | "security";
export type AdaptiveOpenRouterUseCase =
  | "auto"
  | "coding"
  | "writing"
  | "vision"
  | "image"
  | "research"
  | "tool-use";

export interface AdaptiveOpenRouterConfig {
  useCase?: AdaptiveOpenRouterUseCase;
  fallbackModel?: string;
}

export type AdaptiveRoutingMode = "best-free" | "free-then-fallback";

export interface AdaptiveRoutingConfig {
  mode?: AdaptiveRoutingMode;
  useCase?: AdaptiveOpenRouterUseCase;
  enabledRuntimes?: AgentRuntime[];
  disabledProviders?: string[];
  fallbackModel?: string;
}

export interface UsePodAgentConfig {
  tokenEnvName?: string;
  depositAddress?: string;
  depositCode?: string;
  dashboardUrl?: string;
  apiCompatibility?: "openai" | "anthropic";
  routingMode?: "auto" | "marketplace-only";
  maxPriceInputMicrounits?: string;
  maxPriceOutputMicrounits?: string;
  spendPreset?: "cheapest" | "balanced" | "fast" | "none" | "custom";
  lastBalanceRemaining?: string;
  lastRoute?: string;
  lastCheckedAt?: string;
  lastTestStatus?: string;
  lastStatusMessage?: string;
  lastHttpStatus?: number;
  lastModelCount?: number;
  lastTokenPresent?: boolean;
  lastTokenSource?: string;
}

export interface VeniceAgentConfig {
  authMode?: "x402" | "api-key";
  apiKeyEnvName?: string;
  walletVaultId?: string;
  walletAddress?: string;
  walletNetwork?: string;
  lastBalanceUsd?: string;
  lastDiemBalanceUsd?: string;
  lastMinimumTopUpUsd?: string;
  lastSuggestedTopUpUsd?: string;
  lastCheckedAt?: string;
  lastTestStatus?: string;
  lastStatusMessage?: string;
  lastHttpStatus?: number;
  lastModelCount?: number;
  lastKeyPresent?: boolean;
}

export type AgentVoiceRuntime =
  | "openai-realtime"
  | "grok-voice"
  | "gemini-live"
  | (string & {});
export type AgentCallMissedFallback =
  | "none"
  | "in_app"
  | "obsidian_note"
  | "telegram";

export interface AgentCallPreferences {
  voiceRuntime: AgentVoiceRuntime;
  voiceProviderId?: string;
  voiceModelId?: string;
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

export function buildAgentCallPreferences(
  input?: Partial<AgentCallPreferences> | null,
): AgentCallPreferences {
  return {
    voiceRuntime: input?.voiceRuntime || "openai-realtime",
    voiceProviderId: input?.voiceProviderId,
    voiceModelId: input?.voiceModelId,
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

export interface WorkerTaskPreference {
  id: string;
  /** Task family the preference applies to, e.g. "image", "video", "writing", or free text. */
  taskType: string;
  appId?: string;
  appName?: string;
  model?: string;
  /** Natural-prose hint, e.g. "anime-style renders" or "long-form realism". */
  notes?: string;
}

export interface CustomWorkerClassProfile {
  id: string;
  label: string;
  imageSrc?: string;
  skillProfilePrompt: string;
  preferredSkillSlugs: string[];
  taskPreferences?: WorkerTaskPreference[];
}

export interface AgentGitLawbStatus {
  did?: string;
  source: "local" | "missing";
  publicOnly: boolean;
  lastCheckedAt?: number;
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
  adaptiveRouting?: AdaptiveRoutingConfig;
  usePod?: UsePodAgentConfig;
  venice?: VeniceAgentConfig;
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
    collectorOnly?: boolean;
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
  taskPreferences?: WorkerTaskPreference[];
  agentEnv?: Record<string, string>;
  gitlawb?: AgentGitLawbStatus;
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
  tradingBrainEnabled: boolean;
  skillAutoSyncAll: boolean;
  skillAutoSync: Record<
    string,
    {
      autoImport: boolean;
      autoUpdate: boolean;
      trackRemovals: boolean;
      allowDelete: boolean;
    }
  >;
  gbrain: GBrainConfig;
  synto: SyntoConfig;
  controlRoomPath: string;
  instructions: string;
}

export type GBrainInstallMode = "optional" | "local" | "remote";
export type GBrainMcpMode = "stdio" | "http" | "disabled";
export type GBrainProviderPolicy =
  | "balanced-cloud"
  | "local-first"
  | "max-quality";
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

export type SyntoInstallMode = "optional" | "uv-tool" | "pip-user" | "existing";
export type SyntoMcpMode = "stdio" | "disabled";
export type SyntoSourceAccessMode = "permissive_only" | "all" | "deny";

export interface SyntoConfig {
  enabled: boolean;
  installMode: SyntoInstallMode;
  cliPath: string;
  mcpMode: SyntoMcpMode;
  sourceAccessMode: SyntoSourceAccessMode;
  compareHeavyModel: string;
  autoApprove: boolean;
  minConfidence: number;
}

const DEFAULT_SYNCTHING_AUTO_PAIR_ENABLED =
  process.env.NEXT_PUBLIC_TAILNET_SYNC_ENABLED === "true";

export const DEFAULT_SHARED_VAULT: SharedVaultConfig = {
  enabled: true,
  vaultPath:
    process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH ??
    "~/Documents/Obsidian/hivemindos-vault",
  syncProvider: DEFAULT_SYNCTHING_AUTO_PAIR_ENABLED ? "syncthing" : "external",
  tailnetSyncHost: "",
  tailnetSyncPath: "",
  tailnetSyncDirection: "bidirectional",
  syncthingAutoPairEnabled: DEFAULT_SYNCTHING_AUTO_PAIR_ENABLED,
  tailnetSyncIntervalSeconds: 20,
  inboxFolder: process.env.NEXT_PUBLIC_OBSIDIAN_INBOX_FOLDER ?? "Intake",
  sharedNotePath:
    process.env.NEXT_PUBLIC_OBSIDIAN_SHARED_NOTE_PATH ?? "Shared Context.md",
  kanbanFolder:
    process.env.NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER ?? "Operations/Work Board",
  notificationsFolder:
    process.env.NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER ??
    "Operations/Agent Notifications",
  scheduledFolder:
    process.env.NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER ??
    "Operations/Automations",
  synthesisFolder:
    process.env.NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER ?? "Synthesis",
  brainServicesFolder:
    process.env.NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER ??
    "Operations/Brain Services",
  noteTaskImportFolders: "Projects\nIntake\nMemory",
  noteTaskImportEnabled: false,
  tradingBrainEnabled: false,
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
    skillpackLocation:
      process.env.NEXT_PUBLIC_GBRAIN_SKILLPACK_LOCATION ?? "Skills/GBrain",
  },
  synto: {
    enabled: false,
    installMode: "optional",
    cliPath: process.env.NEXT_PUBLIC_SYNTO_CLI_PATH ?? "synto",
    mcpMode: "stdio",
    sourceAccessMode: "deny",
    compareHeavyModel:
      process.env.NEXT_PUBLIC_SYNTO_COMPARE_HEAVY_MODEL ?? "llama3.1:8b",
    autoApprove: false,
    minConfidence: 0.8,
  },
  controlRoomPath:
    process.env.NEXT_PUBLIC_HERMES_CONTROL_ROOM_PATH ?? "~/agent-control-room",
  instructions:
    'Use this vault as the shared memory and handoff space for all local agents. Read AGENTS.md and Operations/AI-Ready Vault Contract.md before durable edits. Use /api/brain/memory for shared-brain recall and durable shared memories: default recall is tiered through typed Agent Memory first and full shared vault when needed, scope: "agent-memory" narrows to strict typed/proven memory, scope: "full-vault" forces broad vault recall, recall before relying on prior context, remember durable facts/decisions/preferences/goals/instructions with agent/runtime/machine/Tailnet provenance, and use proof: "auto" unless the user asks for explicit proof. Treat GBrain as the optional retrieval/graph brain service, Syntho as the optional compiled-wiki/MCP service for Synthesis, and Operations as machine-readable HivemindOS state.',
};

export const KNOWN_AGENT_RUNTIMES: KnownAgentRuntime[] = [
  "openclaw",
  "hermes",
  "opencode",
  "codex",
  "claude-code",
  "aeon",
  "evo",
  HIVEMIND_OS_RUNTIME,
];

export function normalizeAgentRuntime(
  runtime: AgentRuntime | string | undefined,
): AgentRuntime {
  return runtime === LEGACY_OPENAI_COMPATIBLE_RUNTIME
    ? HIVEMIND_OS_RUNTIME
    : runtime || HIVEMIND_OS_RUNTIME;
}

const DEFAULT_RUNTIME_ENV_FEATURE: RuntimeEnvFeature = {
  kind: "agent-overlay",
  label: "Agent overlay",
  description:
    "This runtime accepts per-agent environment overlays saved on the dashboard profile.",
  storage: "profile.agentEnv",
};

const DEFAULT_RUNTIME_SETTINGS_FEATURE: RuntimeSettingsFeature = {
  kind: "standard",
  createPanels: ["role", "memory", "calls", "security"],
  editPanels: ["role", "memory", "tools", "calls", "security"],
  modelSource: "runtime",
};

const DEFAULT_RUNTIME_SCHEDULER_FEATURE: RuntimeSchedulerFeature = {
  kind: "dashboard",
};

const DEFAULT_RUNTIME_PROFILE_FEATURE: RuntimeProfileFeature = {
  defaultBeeRole: "worker",
  defaultWorkerClass: "general",
};

const DEFAULT_RUNTIME_INTEGRATION_FEATURE: RuntimeIntegrationFeature = {};

const CLI_RUNTIME_SETTINGS: RuntimeSettingsFeature = {
  ...DEFAULT_RUNTIME_SETTINGS_FEATURE,
  unavailableSubcopy: "CLI missing",
};

const CLI_RUNTIME_CHAT: RuntimeChatFeature = {
  kind: "background",
  label: "CLI runtime",
};

export const RUNTIME_DEFINITIONS: Record<KnownAgentRuntime, RuntimeDefinition> =
  {
    openclaw: {
      runtime: "openclaw",
      label: "OpenClaw",
      kind: "gateway",
      defaults: {
        gatewayUrl: "ws://127.0.0.1:18789",
        chatPath: "",
        statusPath: "",
      },
      capabilities: {
        status: true,
        chat: true,
        modelSelection: true,
        skillCapabilities: ["chat", "mcp", "http"],
      },
      env: DEFAULT_RUNTIME_ENV_FEATURE,
      settings: {
        ...DEFAULT_RUNTIME_SETTINGS_FEATURE,
        defaultAgentId: "main",
      },
      chat: {
        kind: "gateway",
        label: "OpenClaw",
        urlStrategy: "base-only",
      },
      scheduler: DEFAULT_RUNTIME_SCHEDULER_FEATURE,
      profile: {
        ...DEFAULT_RUNTIME_PROFILE_FEATURE,
        firstAgentBeeRole: "queen",
      },
      integration: DEFAULT_RUNTIME_INTEGRATION_FEATURE,
    },
    hermes: {
      runtime: "hermes",
      label: "Hermes",
      kind: "interactive",
      defaults: {
        gatewayUrl:
          process.env.NEXT_PUBLIC_HERMES_BASE_URL ?? "http://127.0.0.1:8642",
        chatPath: "/chat",
        statusPath: "/health",
      },
      capabilities: {
        status: true,
        chat: true,
        runs: true,
        memory: true,
        sessionSearch: true,
        backgroundTasks: true,
        xSearch: true,
        socialPosting: false,
        imageGeneration: true,
        videoGeneration: true,
        codexRuntime: true,
        kanbanDecompose: true,
        setup: true,
        walletTools: true,
        modelSelection: true,
        skillActions: true,
        skillActionRuntimes: ["http", "shell", "node", "python", "mcp"],
        skillCapabilities: [
          "chat",
          "background",
          "scheduler",
          "shell",
          "browser",
          "mcp",
          "http",
          "filesystem",
          "wallet",
          "publishing",
          "deployment",
          "analytics",
          "image-generation",
          "media-generation",
        ],
      },
      env: DEFAULT_RUNTIME_ENV_FEATURE,
      settings: {
        ...DEFAULT_RUNTIME_SETTINGS_FEATURE,
        canAddModels: true,
        defaultProvider: "openai-codex",
      },
      chat: {
        kind: "interactive",
        label: "Hermes",
        slashCommandPolicy: "leading-slash-bypasses-system-context",
      },
      scheduler: DEFAULT_RUNTIME_SCHEDULER_FEATURE,
      profile: {
        ...DEFAULT_RUNTIME_PROFILE_FEATURE,
        firstAgentLocalDataDir: "~/.hermes",
      },
      integration: {
        updateRequirementDetail: "hermes",
      },
    },
    opencode: {
      runtime: "opencode",
      label: "OpenCode",
      kind: "interactive",
      defaults: {
        gatewayUrl: "",
        chatPath: "",
        statusPath: "",
      },
      capabilities: {
        status: true,
        chat: false,
        modelSelection: true,
        skillCapabilities: ["chat", "shell", "filesystem"],
      },
      env: DEFAULT_RUNTIME_ENV_FEATURE,
      settings: {
        ...CLI_RUNTIME_SETTINGS,
        defaultProvider: "openrouter",
      },
      chat: {
        ...CLI_RUNTIME_CHAT,
        label: "OpenCode",
      },
      scheduler: DEFAULT_RUNTIME_SCHEDULER_FEATURE,
      profile: {
        ...DEFAULT_RUNTIME_PROFILE_FEATURE,
        firstAgentLocalDataDir: "~/.opencode",
        defaultWorkerClass: "code",
      },
      integration: DEFAULT_RUNTIME_INTEGRATION_FEATURE,
    },
    codex: {
      runtime: "codex",
      label: "Codex",
      kind: "interactive",
      defaults: {
        gatewayUrl: "",
        chatPath: "",
        statusPath: "",
      },
      capabilities: {
        status: true,
        chat: false,
        codexRuntime: true,
        modelSelection: true,
        skillActionRuntimes: ["shell"],
        skillCapabilities: ["chat", "shell", "filesystem"],
      },
      env: DEFAULT_RUNTIME_ENV_FEATURE,
      settings: {
        ...CLI_RUNTIME_SETTINGS,
        defaultProvider: "openai-codex",
      },
      chat: {
        ...CLI_RUNTIME_CHAT,
        label: "Codex",
      },
      scheduler: DEFAULT_RUNTIME_SCHEDULER_FEATURE,
      profile: {
        ...DEFAULT_RUNTIME_PROFILE_FEATURE,
        firstAgentLocalDataDir: "~/.codex",
        defaultWorkerClass: "code",
      },
      integration: DEFAULT_RUNTIME_INTEGRATION_FEATURE,
    },
    "claude-code": {
      runtime: "claude-code",
      label: "Claude Code",
      kind: "interactive",
      defaults: {
        gatewayUrl: "",
        chatPath: "",
        statusPath: "",
      },
      capabilities: {
        status: true,
        chat: false,
        modelSelection: true,
        skillActionRuntimes: ["shell"],
        skillCapabilities: ["chat", "shell", "filesystem"],
      },
      env: DEFAULT_RUNTIME_ENV_FEATURE,
      settings: {
        ...CLI_RUNTIME_SETTINGS,
        defaultProvider: "anthropic",
      },
      chat: {
        ...CLI_RUNTIME_CHAT,
        label: "Claude Code",
      },
      scheduler: DEFAULT_RUNTIME_SCHEDULER_FEATURE,
      profile: {
        ...DEFAULT_RUNTIME_PROFILE_FEATURE,
        firstAgentLocalDataDir: "~/.claude",
        defaultWorkerClass: "code",
      },
      integration: DEFAULT_RUNTIME_INTEGRATION_FEATURE,
    },
    aeon: {
      runtime: "aeon",
      label: "Aeon",
      kind: "background",
      defaults: {
        gatewayUrl:
          process.env.NEXT_PUBLIC_AEON_A2A_URL ??
          process.env.NEXT_PUBLIC_AEON_BASE_URL ??
          "http://127.0.0.1:41241",
        chatPath: "",
        statusPath: "/health",
      },
      capabilities: {
        status: true,
        skills: true,
        schedules: true,
        runs: true,
        outputs: true,
        memory: true,
        backgroundTasks: true,
        notifications: true,
        setup: true,
        skillActions: true,
        skillActionRuntimes: ["http", "shell", "node", "python"],
        skillCapabilities: [
          "background",
          "scheduler",
          "shell",
          "http",
          "filesystem",
          "analytics",
          "aeon-workflow",
        ],
      },
      env: {
        kind: "github-secrets",
        label: "AEON repo secrets",
        description:
          "AEON secrets live in local AEON .env files and are synced to the agent's GitHub repo secrets for Actions runs.",
        localSources: [
          { label: "AEON home", path: "~/.aeon/.env" },
          { label: "AEON workspace", path: "<aeonLocalPath>/.env" },
        ],
        syncAction: "runtime.syncEnv",
        statusAction: "runtime.getSecretStatus",
        manageAction: { label: "Open AEON secrets", view: "aeon" },
      },
      settings: {
        kind: "autopilot",
        createPanels: ["role", "connection", "memory", "calls"],
        editPanels: ["connection", "memory", "calls"],
        hidesRuntimeSelectorWhenEditing: true,
        modelSource: "skill",
        runtimeSegmentSubcopy: "Autopilot",
        unavailableSubcopy: "Needs setup",
        createActionLabel: "Connect Autopilot",
        defaultAgentId: "local-aeon",
      },
      chat: {
        kind: "background",
        label: "AEON",
      },
      scheduler: {
        kind: "external-runtime",
        externalSource: "aeon",
        configAction: "runtime.updateSkillConfig",
        primarySkillRequired: true,
      },
      profile: {
        ...DEFAULT_RUNTIME_PROFILE_FEATURE,
        runtimeFolderMirrors: ["aeonLocalPath"],
        postCreateAction: {
          view: "aeon",
          dashboardStateAgentIdKey: "hivemindos.aeon.openDetailAgentId",
        },
        aeonDefaults: {
          repoEnvVar: "NEXT_PUBLIC_AEON_REPO",
          localPathEnvVar: "NEXT_PUBLIC_AEON_LOCAL_PATH",
          localPathFallback: "~/.aeon",
          branch: "main",
          mode: "github",
          a2aUrl: "gatewayUrl",
          a2aUrlFallback: "http://127.0.0.1:41241",
        },
      },
      integration: DEFAULT_RUNTIME_INTEGRATION_FEATURE,
    },
    evo: {
      runtime: "evo",
      label: "Evo",
      kind: "background",
      defaults: {
        gatewayUrl: "",
        chatPath: "",
        statusPath: "",
      },
      capabilities: {
        status: true,
        runs: true,
        backgroundTasks: true,
        skillCapabilities: ["background", "shell", "filesystem", "analytics"],
      },
      env: DEFAULT_RUNTIME_ENV_FEATURE,
      settings: {
        ...CLI_RUNTIME_SETTINGS,
        unavailableSubcopy: "Run `uv tool install evo-hq-cli`",
      },
      chat: {
        ...CLI_RUNTIME_CHAT,
        label: "Evo",
      },
      scheduler: DEFAULT_RUNTIME_SCHEDULER_FEATURE,
      profile: {
        ...DEFAULT_RUNTIME_PROFILE_FEATURE,
        defaultWorkerClass: "code",
      },
      integration: DEFAULT_RUNTIME_INTEGRATION_FEATURE,
    },
    [HIVEMIND_OS_RUNTIME]: {
      runtime: HIVEMIND_OS_RUNTIME,
      label: "HivemindOS",
      kind: "interactive",
      defaults: {
        gatewayUrl:
          process.env.NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL ??
          "http://127.0.0.1:1234",
        chatPath: "/v1/chat/completions",
        statusPath: "/v1/models",
      },
      capabilities: {
        status: true,
        chat: true,
        modelSelection: true,
        skillCapabilities: ["chat", "http"],
      },
      env: DEFAULT_RUNTIME_ENV_FEATURE,
      settings: {
        ...DEFAULT_RUNTIME_SETTINGS_FEATURE,
        defaultProvider: "lm-studio",
        defaultModel: process.env.NEXT_PUBLIC_LOCAL_OPENAI_MODEL ?? "",
      },
      chat: {
        kind: "interactive",
        label: "HivemindOS-managed chat",
      },
      scheduler: DEFAULT_RUNTIME_SCHEDULER_FEATURE,
      profile: DEFAULT_RUNTIME_PROFILE_FEATURE,
      integration: DEFAULT_RUNTIME_INTEGRATION_FEATURE,
    },
  };

export const RUNTIME_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(RUNTIME_DEFINITIONS).map(([runtime, definition]) => [
    runtime,
    definition.label,
  ]),
);

export const RUNTIME_DEFAULTS: Record<
  string,
  Pick<AgentProfile, "gatewayUrl" | "chatPath" | "statusPath">
> = Object.fromEntries(
  Object.entries(RUNTIME_DEFINITIONS).map(([runtime, definition]) => [
    runtime,
    definition.defaults,
  ]),
);

export const RUNTIME_CAPABILITIES: Record<string, RuntimeCapabilities> =
  Object.fromEntries(
    Object.entries(RUNTIME_DEFINITIONS).map(([runtime, definition]) => [
      runtime,
      definition.capabilities,
    ]),
  );

export const RUNTIME_ENV_FEATURES: Record<string, RuntimeEnvFeature> =
  Object.fromEntries(
    Object.entries(RUNTIME_DEFINITIONS).map(([runtime, definition]) => [
      runtime,
      definition.env,
    ]),
  );

export const RUNTIME_SETTINGS_FEATURES: Record<string, RuntimeSettingsFeature> =
  Object.fromEntries(
    Object.entries(RUNTIME_DEFINITIONS).map(([runtime, definition]) => [
      runtime,
      definition.settings,
    ]),
  );

export const RUNTIME_CHAT_FEATURES: Record<string, RuntimeChatFeature> =
  Object.fromEntries(
    Object.entries(RUNTIME_DEFINITIONS).map(([runtime, definition]) => [
      runtime,
      definition.chat,
    ]),
  );

export const RUNTIME_SCHEDULER_FEATURES: Record<
  string,
  RuntimeSchedulerFeature
> = Object.fromEntries(
  Object.entries(RUNTIME_DEFINITIONS).map(([runtime, definition]) => [
    runtime,
    definition.scheduler,
  ]),
);

export const RUNTIME_PROFILE_FEATURES: Record<string, RuntimeProfileFeature> =
  Object.fromEntries(
    Object.entries(RUNTIME_DEFINITIONS).map(([runtime, definition]) => [
      runtime,
      definition.profile,
    ]),
  );

export const RUNTIME_INTEGRATION_FEATURES: Record<
  string,
  RuntimeIntegrationFeature
> = Object.fromEntries(
  Object.entries(RUNTIME_DEFINITIONS).map(([runtime, definition]) => [
    runtime,
    definition.integration,
  ]),
);

export const RUNTIME_KINDS: Record<string, AgentRuntimeKind> =
  Object.fromEntries(
    Object.entries(RUNTIME_DEFINITIONS).map(([runtime, definition]) => [
      runtime,
      definition.kind,
    ]),
  );

export function runtimeDisplayLabel(runtime: AgentRuntime) {
  const normalizedRuntime = normalizeAgentRuntime(runtime);
  return RUNTIME_LABELS[normalizedRuntime] ?? normalizedRuntime;
}

export function runtimeEnvFeature(runtime: AgentRuntime): RuntimeEnvFeature {
  return (
    RUNTIME_ENV_FEATURES[normalizeAgentRuntime(runtime)] ??
    DEFAULT_RUNTIME_ENV_FEATURE
  );
}

export function runtimeSettingsFeature(
  runtime: AgentRuntime,
): RuntimeSettingsFeature {
  return (
    RUNTIME_SETTINGS_FEATURES[normalizeAgentRuntime(runtime)] ??
    DEFAULT_RUNTIME_SETTINGS_FEATURE
  );
}

export function runtimeChatFeature(runtime: AgentRuntime): RuntimeChatFeature {
  const normalizedRuntime = normalizeAgentRuntime(runtime);
  return (
    RUNTIME_CHAT_FEATURES[normalizedRuntime] ?? {
      kind: "interactive",
      label: runtimeDisplayLabel(normalizedRuntime),
      slashCommandPolicy: "none",
    }
  );
}

export function runtimeSchedulerFeature(
  runtime: AgentRuntime,
): RuntimeSchedulerFeature {
  return (
    RUNTIME_SCHEDULER_FEATURES[normalizeAgentRuntime(runtime)] ??
    DEFAULT_RUNTIME_SCHEDULER_FEATURE
  );
}

export function runtimeProfileFeature(
  runtime: AgentRuntime,
): RuntimeProfileFeature {
  return (
    RUNTIME_PROFILE_FEATURES[normalizeAgentRuntime(runtime)] ??
    DEFAULT_RUNTIME_PROFILE_FEATURE
  );
}

export function runtimeIntegrationFeature(
  runtime: AgentRuntime,
): RuntimeIntegrationFeature {
  return (
    RUNTIME_INTEGRATION_FEATURES[normalizeAgentRuntime(runtime)] ??
    DEFAULT_RUNTIME_INTEGRATION_FEATURE
  );
}

export function runtimeLocalDataDirPatch(
  runtime: AgentRuntime,
  path: string,
): Partial<AgentProfile> {
  const patch: Partial<Pick<AgentProfile, "localDataDir" | "aeonLocalPath">> = {
    localDataDir: path,
  };
  for (const field of runtimeProfileFeature(runtime).runtimeFolderMirrors ??
    []) {
    patch[field] = path;
  }
  return patch;
}

export function runtimePostCreateAction(runtime: AgentRuntime) {
  return runtimeProfileFeature(runtime).postCreateAction;
}

export function runtimeOwnsSchedules(runtime: AgentRuntime) {
  return runtimeSchedulerFeature(runtime).kind === "external-runtime";
}

export function runtimeScheduleFilterOptions(): RuntimeScheduleFilterOption[] {
  return Object.keys(RUNTIME_DEFINITIONS)
    .filter((runtime) => runtimeOwnsSchedules(runtime))
    .map((runtime) => ({
      value: runtime,
      label: runtimeDisplayLabel(runtime),
    }));
}

export function runtimeUsesAgentEnvOverlay(runtime: AgentRuntime) {
  return runtimeEnvFeature(runtime).kind === "agent-overlay";
}

type RuntimeAgentNameOptions = {
  provider?: string;
};

function runtimeAgentNameLabel(
  runtime: AgentRuntime,
  labels: Record<string, string>,
  options: RuntimeAgentNameOptions = {},
) {
  const provider = options.provider?.trim().toLowerCase() ?? "";
  if (provider === "adaptive") return "Adaptive";
  return labels[runtime] ?? runtime;
}

export function runtimeAgentNamePrefix(
  runtime: AgentRuntime,
  labels: Record<string, string> = RUNTIME_LABELS,
  options: RuntimeAgentNameOptions = {},
) {
  const label = runtimeAgentNameLabel(runtime, labels, options);
  const compactLabel = label
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join("");
  return `${compactLabel || "Agent"}Agent`;
}

export function defaultAgentNameForRuntime(
  agents: AgentProfile[],
  runtime: AgentRuntime,
  labels: Record<string, string> = RUNTIME_LABELS,
  options: RuntimeAgentNameOptions = {},
) {
  const prefix = runtimeAgentNamePrefix(runtime, labels, options);
  const compactPrefix = prefix.toLowerCase();
  const spacedPrefix = prefix.replace(/Agent$/i, " Agent").toLowerCase();
  const usedIndexes = new Set<number>();
  for (const agent of agents) {
    if (agent.runtime !== runtime) continue;
    const compactName = agent.name.replace(/\s+/g, "");
    const compactMatch = compactName.match(
      new RegExp(`^${compactPrefix}(\\d+)$`, "i"),
    );
    const spacedMatch = agent.name.match(
      new RegExp(`^${spacedPrefix}\\s+(\\d+)$`, "i"),
    );
    const match = compactMatch ?? spacedMatch;
    if (!match) continue;
    const value = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(value) && value > 0) usedIndexes.add(value);
  }
  for (let index = 1; index < 1000; index += 1) {
    if (!usedIndexes.has(index))
      return `${prefix}${String(index).padStart(2, "0")}`;
  }
  return `${prefix}${Date.now()}`;
}

export function createAgentProfile(
  runtime: AgentRuntime,
  index = 1,
): AgentProfile {
  const normalizedRuntime = normalizeAgentRuntime(runtime);
  const defaults =
    RUNTIME_DEFAULTS[normalizedRuntime] ??
    RUNTIME_DEFAULTS[HIVEMIND_OS_RUNTIME];
  const settings = runtimeSettingsFeature(normalizedRuntime);
  const profile = runtimeProfileFeature(normalizedRuntime);
  const aeonDefaults = profile.aeonDefaults;
  const beeRole =
    index === 1
      ? (profile.firstAgentBeeRole ?? profile.defaultBeeRole ?? "worker")
      : (profile.defaultBeeRole ?? "worker");
  const workerClass =
    index === 1
      ? (profile.firstAgentWorkerClass ??
        profile.defaultWorkerClass ??
        "general")
      : (profile.defaultWorkerClass ?? "general");
  return {
    id: `${normalizedRuntime}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${runtimeAgentNamePrefix(normalizedRuntime)}${String(index).padStart(2, "0")}`,
    runtime: normalizedRuntime,
    gatewayUrl: defaults.gatewayUrl,
    chatPath: defaults.chatPath,
    statusPath: defaults.statusPath,
    agentId: settings.defaultAgentId ?? "",
    provider: settings.defaultProvider ?? "",
    model: settings.defaultModel ?? "",
    localDataDir: index === 1 ? (profile.firstAgentLocalDataDir ?? "") : "",
    machineName: "local",
    telemetryUrl: "",
    useSharedVault: true,
    runtimeKind: RUNTIME_KINDS[runtime] ?? "interactive",
    runtimeCapabilities: RUNTIME_CAPABILITIES[runtime] ?? { chat: true },
    aeonRepo: aeonDefaults
      ? (process.env[aeonDefaults.repoEnvVar] ?? "")
      : undefined,
    aeonBranch: aeonDefaults?.branch,
    aeonLocalPath: aeonDefaults
      ? (process.env[aeonDefaults.localPathEnvVar] ??
        aeonDefaults.localPathFallback)
      : undefined,
    a2aUrl:
      aeonDefaults?.a2aUrl === "gatewayUrl"
        ? defaults.gatewayUrl || aeonDefaults.a2aUrlFallback
        : undefined,
    aeonMode: aeonDefaults?.mode,
    beeRole,
    workerClass,
    calls: buildAgentCallPreferences(),
  };
}

export function getRuntimeUrl(profile: AgentProfile, path?: string): string {
  if (runtimeChatFeature(profile.runtime).urlStrategy === "base-only")
    return profile.gatewayUrl;
  if (path && /^https?:\/\//i.test(path)) return path;
  const defaults = RUNTIME_DEFAULTS[profile.runtime] ?? RUNTIME_DEFAULTS.hermes;
  const base = (
    profile.gatewayUrl?.trim() ||
    defaults.gatewayUrl ||
    ""
  ).replace(/\/+$/, "");
  const suffix = path || profile.chatPath || defaults.chatPath || "/chat";
  return `${base}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}
