import type { AgentProfile, AgentRuntime, RuntimeCapabilities, SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { AgentNotification, AgentNotificationSummary } from "@/lib/types/agent-notifications";
import type { KanbanBoard, KanbanLinkedDirectory, KanbanMachineTarget, KanbanTask, KanbanTaskAttachment } from "@/lib/types/kanban";
import type { GBrainStatus } from "@/lib/services/brain/gbrain";
import type { SyntoStatus } from "@/lib/services/brain/synto";
import type { TradingBrainStatus } from "@/lib/services/brain/trading-brain";

export type GatewayStatus = {
  ok?: boolean;
  runtime?: AgentRuntime;
  status?: number;
  payload?: unknown;
  error?: string;
};

export type RuntimeIntegrationKey =
  | "sessionSearch"
  | "backgroundTasks"
  | "xSearch"
  | "socialPosting"
  | "videoGeneration"
  | "codexRuntime"
  | "kanbanDecompose";

export type RuntimeIntegrationStatus = {
  runtime: AgentRuntime;
  targetKey?: string;
  capabilities: RuntimeCapabilities;
  integrations: Record<RuntimeIntegrationKey, {
    supported: boolean;
    enabled: boolean;
    detail: string;
  }>;
  diagnostics: string[];
  modelSelection?: {
    provider: string;
    model: string;
    providers: Array<{
      slug: string;
      name: string;
      models: Array<{ id: string; name?: string }>;
      totalModels: number;
      isCurrent?: boolean;
      isUserDefined?: boolean;
      source?: string;
    }>;
  };
  providerStatus?: {
    usePod?: {
      tokenEnvName?: string;
      depositAddress?: string;
      depositCode?: string;
      dashboardUrl?: string;
      tokenPresent?: boolean;
      tokenSource?: string;
      balanceRemaining?: string;
      route?: string;
      checkedAt?: string;
      status?: string;
      message?: string;
      httpStatus?: number;
      modelCount?: number;
    };
  };
};

export type RuntimeSessionSearchResult = {
  id: string;
  runtime: AgentRuntime;
  title: string;
  source?: string;
  model?: string | null;
  startedAt?: string;
  updatedAt?: string;
  excerpt: string;
  path?: string;
};

export type RuntimeUsageAnalytics = {
  ok?: boolean;
  error?: string;
  rows?: Array<{
    runtime: "hermes" | "openclaw";
    agentId: string;
    sessionId: string;
    source: string;
    model: string;
    updatedAt: string;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    reasoningTokens: number;
    totalTokens: number;
  }>;
  totals?: {
    sessions: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    reasoningTokens: number;
    estimatedCostUsd: number;
  };
  models?: Array<{ model: string; sessions: number; tokens: number; estimatedCostUsd: number }>;
  runtimes?: Array<{ runtime: string; sessions: number; tokens: number }>;
  sources?: Array<{ source: string; sessions: number; tokens: number }>;
};

export type MaintenanceReport = {
  ok?: boolean;
  error?: string;
  checkedAt?: string;
  checks?: Array<{ id: string; label: string; ok: boolean; detail: string; repairAction?: string }>;
};

export type RuntimeFileRoot = { key: string; label: string; path: string; writable: boolean };

export type RuntimeFileEntry = { name: string; path: string; relativePath: string; type: "file" | "dir"; size?: number; updatedAt?: number };

export type RuntimeFilePayload = {
  ok?: boolean;
  error?: string;
  roots?: RuntimeFileRoot[];
  files?: RuntimeFileEntry[];
  file?: RuntimeFileEntry & { content?: string };
};

export type HiveEnvSource = {
  id: string;
  label: string;
  scope: string;
  runtime: string;
  values: Record<string, string>;
  error?: string;
};

export type HiveEnvBackupStatus = {
  envFile?: string;
  backupPath?: string;
  backupExists?: boolean;
  gpgAvailable?: boolean;
  backupApplies?: boolean;
  error?: string;
};

export type HiveEnvPayload = {
  ok?: boolean;
  error?: string;
  total?: number;
  source?: HiveEnvSource;
  sharedSource?: HiveEnvSource;
  runtimeSources?: HiveEnvSource[];
  backupStatus?: HiveEnvBackupStatus;
};

export type HiveEnvImportEntry = {
  key: string;
  value: string;
  status: "new" | "changed" | "same";
};

export type WalletVaultBackupStatus = {
  vaultPath: string;
  keyPath: string;
  vaultExists: boolean;
  keyExists: boolean;
  envKeyConfigured: boolean;
  backupPath: string;
  backupExists: boolean;
  referencePath: string;
  referenceExists: boolean;
  gpgAvailable: boolean;
  recipientConfigured: boolean;
  recordCount: number;
  updatedAt?: string;
  error?: string;
};

export type RuntimeModelSelection = NonNullable<RuntimeIntegrationStatus["modelSelection"]>;

export type RuntimeSetupAction = {
  id: string;
  label: string;
  action: string;
  input?: Record<string, unknown>;
};

export type RuntimeSetupDefinition = {
  title: string;
  description: string;
  steps: string[];
  actions: RuntimeSetupAction[];
};

export type VaultSyncStatus = {
  ok?: boolean;
  error?: string;
  method?: "syncthing" | "rsync";
  message?: string;
  folderId?: string;
  dryRun?: boolean;
  direction?: "bidirectional" | "push" | "pull";
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  conflicts?: string[];
  changedFiles?: string[];
};

export type StoredSharedVaultConfig = Partial<SharedVaultConfig> & {
  tailnetSyncEnabled?: boolean;
};

export type DashboardGBrainStatus = GBrainStatus;
export type DashboardSyntoStatus = SyntoStatus;
export type DashboardTradingBrainStatus = TradingBrainStatus;

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: number;
  kanbanTaskId?: string;
  surface?: "chat" | "kanban" | "scheduler";
  sourceSessionId?: string;
  sourceIndex?: number;
  attachments?: ChatAttachment[];
  agentPrompt?: {
    id: string;
    type: "clarify" | "approval" | "sudo" | "secret" | "prompt";
    question: string;
    choices?: string[];
    allowFreeText?: boolean;
  };
};

export type KanbanPickupPreview = {
  icon: string;
  label: string;
  assignee: string;
};

export type WorkspaceGitSnapshot = {
  signature: string;
  head: string;
  dirty: boolean;
  statusLines: string[];
};

export type KanbanTaskPatch = Omit<Partial<KanbanTask>, "reviewedAt" | "undoRequestedAt"> & {
  reviewedAt?: number | null;
  undoRequestedAt?: number | null;
};

export type ChatAttachment = KanbanTaskAttachment;

export type LinkedDirectory = KanbanLinkedDirectory;

export type AgentTask = {
  id: string;
  agentId: string;
  title: string;
  lastMessage: string;
  status: "active" | "completed" | "failed" | "unknown";
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  source?: string;
  sourceDetail?: string;
  messages?: ChatMessage[];
  workingDirectory?: string;
};

export type SchedulerStep = {
  id: string;
  text: string;
  skills: string[];
  paths: string[];
  model: string;
};

export type AgentSchedule = {
  id: string;
  name: string;
  agentId: string;
  enabled: boolean;
  every: string;
  mode: "prompt" | "steps";
  prompt: string;
  model?: string;
  skills: string[];
  paths: string[];
  steps: SchedulerStep[];
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  externalSource?: AgentRuntime | "dashboard";
  externalJobId?: string;
  lastStatus?: string;
  lastSummary?: string;
  usePastRuns?: boolean;
  pastRunLimit?: number;
  sharedSchedulePath?: string;
  sharedRunFolder?: string;
};

export type ScheduleDraft = {
  name: string;
  agentId: string;
  every: string;
  mode: "prompt" | "steps";
  prompt: string;
  model: string;
  skills: string[];
  paths: string[];
  steps: SchedulerStep[];
  usePastRuns: boolean;
  pastRunLimit: number;
};

export type SkillBrowserSkill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  source: string;
  category?: string;
  skillMdUrl?: string;
  githubUrl?: string;
  sourceRef?: string;
  capabilities?: string[];
  envKeys?: string[];
  auditStatus?: "trusted" | "review" | "restricted" | "blocked";
  providerId?: BrainSkillProviderId | "shared";
  imported?: boolean;
  requiresHermesUpdate?: boolean;
  includedSkills?: Array<{ slug: string; name: string; description: string }>;
  safety?: string;
  audience?: string;
};

export type SkillBrowserView = "catalog" | "installed" | "packs" | "audit" | "write";

export type HermesUpdateSkillLike = {
  slug: string;
  name: string;
  description?: string;
  provider?: BrainSkillProviderId | "shared";
  providerId?: BrainSkillProviderId | "shared";
  providerLabel?: string;
  source?: string;
};

export type WorkerClassDraft = {
  label: string;
  imageSrc: string;
  skillProfilePrompt: string;
  preferredSkillSlugs: string[];
};

export type ImportedRuntimeSchedule = {
  id: string;
  runtime: AgentRuntime;
  name?: string;
  schedule?: string;
  every?: string;
  everyMs?: number;
  message?: string;
  enabled?: boolean;
  agentId?: string;
  nextRunMs?: number;
  lastRunMs?: number;
  lastStatus?: string;
  lastSummary?: string;
};

export type ChatCustomFolder = {
  id: string;
  machineKey: string;
  label: string;
  path: string;
  agentId?: string;
  createdAt: number;
};

export type DuplicateAgentDraft = {
  agentId: string;
  copyMemories: boolean;
  copyEnv: boolean;
  copyChats: boolean;
};

export type WalletActionState = {
  busy?: boolean;
  message?: string;
  error?: string;
  sendTo?: string;
  sendAmount?: string;
  sendAsset?: "USDC" | "ETH";
  confirmation?: string;
  x402Url?: string;
  x402Method?: string;
  x402Confirmation?: string;
};

export type WalletMoneyClawStatus = {
  configured: boolean;
  apiKeyEnvName: string;
  baseUrl?: string;
  account?: unknown;
  balance?: unknown;
  depositAddress?: unknown;
  paymentIntents?: unknown;
  errors?: Record<string, string>;
};

export type AgentSnapshot = {
  agentId: string;
  ok: boolean;
  runtimeReachable: boolean;
  processRunning: boolean;
  summary: string;
  sources: string[];
  tasks: AgentTask[];
  checkedAt: number;
  warning?: string;
  error?: string;
};

export type TailscaleDevice = {
  self: boolean;
  name: string;
  dnsName: string;
  os: string;
  online: boolean;
  ip: string;
  collectorUrl: string;
  lastHandshake?: string;
  curAddr?: string;
  rxBytes?: number;
  txBytes?: number;
  active?: boolean;
  relay?: string;
};

export type TailnetHealth = {
  state?: "ok" | "peer-traffic-stalled" | "status-unavailable" | "not-running";
  detail?: string;
};

export type HivemindLinkClientStatus = {
  ok?: boolean;
  backendState?: string;
  authUrl?: string;
  source?: string;
};

export type MachineGroup = {
  key: string;
  name: string;
  address: string;
  collectorUrl: string;
  dnsName?: string;
  ip?: string;
  os?: string;
  relay?: string;
  lastHandshake?: string;
  curAddr?: string;
  rxBytes?: number;
  txBytes?: number;
  active?: boolean;
  online: boolean;
  self: boolean;
  collector: "ready" | "not-installed" | "offline" | "missing" | "unknown";
  agents: AgentProfile[];
  version?: AppVersion;
  machineId?: string;
  capabilities?: AgentProfile["collectorCapabilities"];
  envSync?: {
    ready?: boolean;
    user?: string;
    command?: string;
    error?: string;
  };
  lastSeenAt?: number;
};

export type MachineDirectoryEntry = {
  name: string;
  path: string;
  kind: "directory";
};

export type MachineDirectoryBrowser = {
  open: boolean;
  machine: KanbanMachineTarget;
  path: string;
  parentPath?: string;
  directories: MachineDirectoryEntry[];
  selectedDirectory?: MachineDirectoryEntry | null;
  loading: boolean;
  error: string;
  onChoose?: (directory: LinkedDirectory) => void;
};

export type ChatTreeItem = {
  key: string;
  title: string;
  subtitle: string;
  updatedAt?: number;
  rank: number;
  active: boolean;
  onOpen: () => void;
};

export type ChatTreeFolder = {
  key: string;
  label: string;
  path?: string;
  active?: boolean;
  chats: ChatTreeItem[];
  onStartChat?: () => void;
};

export type ChatTreeMachine = {
  key: string;
  name: string;
  detail: string;
  folders: ChatTreeFolder[];
  onStartChat?: () => void;
  onCreateFolder?: () => void;
};

export type DiscoveredMachine = {
  device: TailscaleDevice;
  collector: MachineGroup["collector"];
  collectorHost?: string;
  machineId?: string;
  agents: AgentProfile[];
  snapshots: AgentSnapshot[];
  version?: AppVersion;
  capabilities?: AgentProfile["collectorCapabilities"];
  envSync?: MachineGroup["envSync"];
  lastSeenAt?: number;
};

export type AppVersion = {
  appDir?: string;
  version?: string;
  latestVersion?: string;
  commit?: string;
  shortCommit?: string;
  branch?: string;
  dirty?: boolean;
  latestCommit?: string;
  latestShortCommit?: string;
  updateCommand?: string;
};

export type MachineInitResult = {
  projectName: string;
  projectDir: string;
  envPath: string;
  sshAlias: string;
  serverName: string;
  commands: {
    editEnv: string;
    listServerTypes: string;
    listLocations: string;
    provision: string;
    verify: string;
    bootstrap?: string;
    destroy: string;
  };
};

export type MachineInitStatus = {
  busy?: boolean;
  error?: string;
  result?: MachineInitResult;
};

export type MachineInitTokenStatus = {
  busyAction?: "save" | "open";
  ok?: boolean;
  validated?: boolean;
  message?: string;
  error?: string;
};

export type MachineUpdateStatus = {
  label: string;
  detail?: string;
  tone: "working" | "success" | "error";
};

export type KanbanBoardSummary = {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
};

export type KanbanResponse = {
  ok?: boolean;
  boards?: KanbanBoardSummary[];
  board?: KanbanBoard;
  task?: KanbanTask;
  created?: boolean;
  tenants?: string[];
  assignees?: string[];
  storage?: {
    source: "obsidian" | "local";
    root: string;
    boardsRoot: string;
    file: string;
    fallbackReason?: string;
  };
  error?: string;
};

export type AgentSessionResponse = {
  ok: boolean;
  error?: string;
  session?: {
    sessionId: string;
    runtime?: string;
    source?: string;
    updatedAt?: number;
    messageCount?: number;
    messages?: Array<{
      index: number;
      role: "user" | "assistant" | "tool";
      content: string;
      createdAt?: number;
    }>;
  };
};

export type NoteTaskCandidate = {
  idempotencyKey: string;
  title: string;
  body: string;
  sourcePath: string;
  line: number;
  project?: string;
  section?: string;
  kind: "checkbox" | "next-action";
};

export type NoteIntakeResponse = {
  ok?: boolean;
  candidates?: NoteTaskCandidate[];
  imported?: NoteTaskCandidate[];
  skipped?: number;
  board?: KanbanBoard;
  error?: string;
};

export type NotificationsResponse = Partial<AgentNotificationSummary> & {
  ok?: boolean;
  notifications?: AgentNotification[];
  nextCursor?: number | null;
  limit?: number;
  error?: string;
};

export type BrainAccessEvent = {
  id: string;
  notePath: string;
  agentName: string;
  agentId?: string;
  runtime?: string;
  machineName: string;
  dashboardMachine: string;
  accessedAt: string;
  action: "view" | "read" | "write" | "inspect";
};

export type BrainGraphNode = {
  id: string;
  label: string;
  folder: string;
  tags: string[];
  byteSize: number;
  lineCount?: number;
  modifiedAt?: string;
  preview?: string;
  incoming: number;
  outgoing: number;
  accessCount: number;
  lastAccessedAt?: string;
  recentAccesses: BrainAccessEvent[];
};

export type BrainGraphLink = {
  source: string;
  target: string;
  unresolved?: boolean;
};

export type BrainGraph = {
  vaultPath: string;
  accessLogPath: string;
  generatedAt: string;
  nodes: BrainGraphNode[];
  links: BrainGraphLink[];
  recentAccesses: BrainAccessEvent[];
  truncated: boolean;
};

export type BrainGraphResponse = {
  ok?: boolean;
  graph?: BrainGraph;
  error?: string;
};

export type BrainSkillProviderId = "claude" | "codex" | "hermes" | "gemini" | "openclaw" | "aeon";

export type BrainSkillSummary = {
  id: string;
  slug: string;
  name: string;
  description: string;
  provider: BrainSkillProviderId | "shared";
  providerLabel: string;
  path: string;
  relativePath: string;
  checksum: string;
  imported: boolean;
  importedAs?: string;
};

export type BrainSkillProviderInventory = {
  id: BrainSkillProviderId;
  label: string;
  home: string;
  skills: BrainSkillSummary[];
  installed: boolean;
};

export type BrainSkillInventory = {
  ok?: boolean;
  vaultPath: string;
  skillsFolder: string;
  readmePath: string;
  shared: BrainSkillSummary[];
  providers: BrainSkillProviderInventory[];
  totals: {
    shared: number;
    providerSkills: number;
    importable: number;
  };
  imported?: BrainSkillSummary[];
  skipped?: BrainSkillSummary[];
  provider?: BrainSkillProviderId | "all";
  error?: string;
};

export type BrainSkillAeonSyncResponse = {
  ok?: boolean;
  result?: {
    synced?: BrainSkillSummary[];
    skipped?: Array<BrainSkillSummary & { reason?: string }>;
    aeonRoot?: string;
    manifestPath?: string;
  };
  error?: string;
};

export type RuntimeEnvSyncResponse = {
  ok?: boolean;
  result?: {
    repo?: string;
    githubSecretCount?: number;
    synced?: Array<{ key: string }>;
    skipped?: Array<{ key: string; reason: string }>;
    sources?: string[];
  };
  error?: string;
};

export type MiroSharkStatus = {
  configured: boolean;
  ok: boolean;
  phase: "connected" | "starting" | "installing" | "installed-stopped" | "not-installed" | "needs-config" | "unreachable";
  baseUrl: string;
  service?: string;
  status?: string;
  installPath?: string;
  installSource?: string;
  apiDocsUrl?: string;
  templatesUrl?: string;
  simulationsUrl?: string;
  checkedAt: number;
  latencyMs?: number;
  error?: string;
  requirements: { name: string; ok: boolean; detail: string }[];
  install: {
    running: boolean;
    phase?: string;
    startedAt?: number;
    finishedAt?: number;
    exitCode?: number | null;
    logPath: string;
    message?: string;
  };
  adminAuth: {
    configured: boolean;
    source?: "environment" | "miroshark-env";
    hint: string;
  };
  actions: { id: "install" | "start" | "open" | "configure-admin"; label: string; disabled?: boolean }[];
  startCommand?: string;
  installCommand?: string;
  configHint?: string;
  endpoints: {
    health: string;
    openapi: string;
    templates: string;
    simulations: string;
    createSimulation: string;
  };
};

export type MiroSharkRunResult = {
  ok?: boolean;
  archived?: boolean;
  archivedAt?: string;
  archivedSummary?: MiroSharkArchivedRun;
  jobId?: string;
  status?: "queued" | "running" | "started" | "failed";
  step?: string;
  message?: string;
  error?: string;
  projectId?: string;
  graphId?: string;
  simulationId?: string;
  rounds?: number;
  platform?: string;
  templateId?: string;
  links?: Record<string, string>;
  runStatus?: unknown;
  actions?: unknown;
  posts?: unknown;
  timeline?: unknown;
  profiles?: unknown;
  realtimeProfiles?: unknown;
  beliefDrift?: unknown;
  counterfactual?: unknown;
  agentStats?: unknown;
  influence?: unknown;
  interactionNetwork?: unknown;
  demographics?: unknown;
  quality?: unknown;
  markets?: unknown;
  marketPrices?: unknown;
  surfaceStats?: unknown;
  lineage?: unknown;
  threadJson?: unknown;
  transcriptJson?: unknown;
  embedSummary?: unknown;
  webhookLog?: unknown;
  report?: unknown;
  interviewHistory?: unknown;
  graphData?: unknown;
  entities?: unknown;
  project?: unknown;
  runStatusDetail?: unknown;
  observabilityStats?: unknown;
  observabilityEvents?: unknown;
  llmCalls?: unknown;
};

export type MiroSharkArchivedRun = {
  simulationId: string;
  projectId?: string;
  graphId?: string;
  platform?: string;
  status?: string;
  scenario?: string;
  rounds?: number;
  postCount: number;
  savedAt: string;
  folder: string;
};

export type MiroSharkMetadata = {
  ok?: boolean;
  baseUrl?: string;
  templates?: unknown;
  templateCapabilities?: unknown;
  templateDetails?: unknown;
  history?: unknown;
  publicRuns?: unknown;
  simulationList?: unknown;
  trending?: unknown;
  observabilityStats?: unknown;
  observabilityEvents?: unknown;
  llmCalls?: unknown;
  settings?: unknown;
  mcpStatus?: unknown;
  pushVapidKey?: unknown;
  error?: string;
};

export type MiroSharkWorkbenchTab = "surface" | "analysis" | "agents" | "experiments" | "observability" | "exports";

export type MiroSharkSurfaceView = "x" | "reddit" | "polymarket" | "timeline";

export type MiroSharkWorkspaceMode = "new" | "run";

export type DashboardView = "agents" | "kanban" | "scheduler" | "swarm" | "history" | "wallet" | "vault" | "integrations" | "maintenance" | "sessions" | "tools" | "memory" | "files" | "notifications" | "chat" | "more" | "env" | "my-apps" | "phone" | "aeon" | "fusion";

export type WorkView = Extract<DashboardView, "kanban" | "scheduler" | "swarm" | "history">;

export type DashboardTheme = "dark" | "hive-light";
