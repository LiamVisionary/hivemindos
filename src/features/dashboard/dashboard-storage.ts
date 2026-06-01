import { DEFAULT_SHARED_VAULT, RUNTIME_CAPABILITIES, RUNTIME_KINDS, buildAgentCallPreferences, type AgentProfile, type AgentRuntime, type AgentRuntimeKind, type CustomWorkerClassProfile, type RuntimeCapabilities, type SharedVaultConfig } from "@/lib/types/agent-runtime";
import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import { beeWorkerPreset } from "@/lib/config/bee-worker-presets";
import { createDefaultAgentWallet, createDefaultHoneyTreasuryConfig, stripUnfundedWalletBalance } from "@/lib/utils/agent-wallet";
import type { AgentWalletConfig, HoneyTreasuryConfig } from "@/lib/types/agent-wallet";
import type { AgentSchedule, AgentSnapshot, AgentTask, ChatCustomFolder, ChatMessage, DiscoveredMachine, HermesUpdateSkillLike, RuntimeIntegrationKey, RuntimeIntegrationStatus, RuntimeSetupDefinition, ScheduleDraft, StoredSharedVaultConfig, WorkerClassDraft } from "@/features/dashboard/dashboard-types";

const STORAGE_KEY = "hivemindos.agentProfiles.v1";
const VAULT_STORAGE_KEY = "hivemindos.sharedVault.v1";
const TASK_STORAGE_KEY = "hivemindos.agentTasks.v1";
const SCHEDULE_STORAGE_KEY = "hivemindos.agentSchedules.v1";
const WALLET_STORAGE_KEY = "hivemindos.agentWallets.v1";
const HONEY_LEDGER_ENABLED_STORAGE_KEY = "hivemindos.honeyLedger.enabled.v1";
const CHAT_MESSAGES_STORAGE_KEY = "hivemindos.chatMessages.v1";
const CHAT_FOLDER_STORAGE_KEY = "hivemindos.chatFolders.v1";
const MACHINE_NAME_ALIAS_STORAGE_KEY = "hivemindos.machineNameAliases.v1";
const DISCOVERED_MACHINES_STORAGE_KEY = "hivemindos.discoveredMachines.v1";
const FLEET_SNAPSHOTS_STORAGE_KEY = "hivemindos.fleetSnapshots.v1";
const STORAGE_SUFFIXES = {
  agents: ".agentProfiles.v1",
  vault: ".sharedVault.v1",
  tasks: ".agentTasks.v1",
  schedules: ".agentSchedules.v1",
  wallets: ".agentWallets.v1",
  honeyLedgerEnabled: ".honeyLedger.enabled.v1",
  chatMessages: ".chatMessages.v1",
  chatFolders: ".chatFolders.v1",
  machineNameAliases: ".machineNameAliases.v1",
  fleetSnapshots: ".fleetSnapshots.v1",
};
const runtimeCapabilitiesByRuntime = RUNTIME_CAPABILITIES as Record<string, RuntimeCapabilities>;
const runtimeKindsByRuntime = RUNTIME_KINDS as Record<string, AgentRuntimeKind | undefined>;

function normalizeVaultRelativePath(path?: string) {
  return path?.trim().replace(/[\\/]+$/g, "");
}

export function workerCapabilityBadges(summary: string) {
  return summary
    .replace(/\.$/, "")
    .split(/,\s+|\s+and\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function customWorkerProfileFromDraft(draft: WorkerClassDraft): CustomWorkerClassProfile {
  return {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: draft.label.trim() || "Custom worker",
    imageSrc: draft.imageSrc,
    skillProfilePrompt: draft.skillProfilePrompt.trim(),
    preferredSkillSlugs: draft.preferredSkillSlugs,
  };
}

export function defaultWorkerClassDraft(): WorkerClassDraft {
  return {
    label: "",
    imageSrc: beeRoleIconPath("worker", "general"),
    skillProfilePrompt: "",
    preferredSkillSlugs: [],
  };
}

export function seedAgents(): AgentProfile[] {
  return [];
}

export function normalizeAgentProfile(agent: AgentProfile): AgentProfile {
  const inferredQueen = agent.beeRole === "queen" || /queen|orchestrat|lead|main/i.test(agent.name) || agent.runtime === "openclaw";
  const customWorkerClasses = agent.customWorkerClasses?.length
    ? agent.customWorkerClasses
    : agent.customWorkerClass
      ? [agent.customWorkerClass]
      : undefined;
  const selectedCustomWorkerClassId = agent.selectedCustomWorkerClassId ?? agent.customWorkerClass?.id;
  return {
    ...agent,
    localDataDir: agent.runtime === "hermes" && agent.id === "hermes-orchestrator" && !agent.localDataDir
      ? "~/.hermes"
      : agent.localDataDir,
    runtimeKind: agent.runtimeKind ?? runtimeKindsByRuntime[agent.runtime],
    runtimeCapabilities: mergeRuntimeCapabilities(agent.runtime, agent.runtimeCapabilities),
    a2aUrl: agent.runtime === "aeon" ? agent.a2aUrl ?? agent.gatewayUrl : agent.a2aUrl,
    aeonBranch: agent.runtime === "aeon" ? agent.aeonBranch ?? "main" : agent.aeonBranch,
    aeonMode: agent.runtime === "aeon" ? agent.aeonMode ?? "github" : agent.aeonMode,
    beeRole: agent.beeRole ?? (inferredQueen ? "queen" : "worker"),
    workerClass: agent.workerClass ?? "general",
    customWorkerClasses,
    selectedCustomWorkerClassId,
    customWorkerClass: customWorkerClasses?.find((workerClass: CustomWorkerClassProfile) => workerClass.id === selectedCustomWorkerClassId) ?? agent.customWorkerClass,
    skillProfilePrompt: agent.skillProfilePrompt ?? beeWorkerPreset(agent.workerClass ?? "general").taskProfile,
    preferredSkillSlugs: agent.preferredSkillSlugs ?? beeWorkerPreset(agent.workerClass ?? "general").skillSlugs,
    calls: buildAgentCallPreferences(agent.calls),
    agentEnv: agent.agentEnv && typeof agent.agentEnv === "object" && !Array.isArray(agent.agentEnv)
      ? Object.fromEntries(Object.entries(agent.agentEnv).filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === "string"))
      : undefined,
  };
}

export function runtimeCapabilities(agent?: AgentProfile | null): RuntimeCapabilities {
  if (!agent) return {};
  return mergeRuntimeCapabilities(agent.runtime, agent.runtimeCapabilities);
}

function mergeRuntimeCapabilities(runtime: AgentRuntime, patch?: RuntimeCapabilities): RuntimeCapabilities {
  const base = runtimeCapabilitiesByRuntime[runtime] ?? {};
  const merged = { ...(patch ?? {}), ...base };
  for (const key of Object.keys(base) as Array<keyof RuntimeCapabilities>) {
    if (typeof base[key] === "boolean" && base[key]) (merged as Record<string, unknown>)[key] = true;
  }
  return merged;
}

export function runtimeCan(agent: AgentProfile | null | undefined, capability: keyof RuntimeCapabilities) {
  return Boolean(runtimeCapabilities(agent)[capability]);
}

export const HERMES_UPDATE_SKILL_PATTERN = /\b(background|codex|grok|kanban|session search|xai|x search|x-search|twitter|video|imagine|decompose)\b/i;
export const HERMES_UPDATE_INTEGRATION_KEYS = new Set<RuntimeIntegrationKey>([
  "sessionSearch",
  "backgroundTasks",
  "xSearch",
  "videoGeneration",
  "codexRuntime",
  "kanbanDecompose",
]);

export function skillRequiresHermesUpdate(skill: HermesUpdateSkillLike, hermesUpdateRequired: boolean) {
  if (!hermesUpdateRequired) return false;
  const providerHints = [
    skill.provider,
    skill.providerId,
    skill.providerLabel,
    skill.source,
  ].filter(Boolean).join(" ").toLowerCase();
  const featureText = `${skill.slug} ${skill.name} ${skill.description ?? ""} ${providerHints}`.replace(/[_-]+/g, " ");
  return HERMES_UPDATE_SKILL_PATTERN.test(featureText);
}

export function hermesUpdateDetail(status: RuntimeIntegrationStatus | null | undefined) {
  if (status?.runtime !== "hermes") return "";
  const details = [
    ...Object.values(status.integrations).map((integration) => integration.detail),
    ...status.diagnostics,
  ].join("\n");
  const match = details.match(/Update available[^\n]*/i);
  return match?.[0] ?? "";
}

export function runtimeSetupDefinition(runtime: AgentRuntime, key: RuntimeIntegrationKey): RuntimeSetupDefinition {
  if (runtime === "hermes") {
    if (key === "xSearch") {
      return {
        title: "Set up X search",
        description: "Connect xAI/Grok credentials, then enable the Hermes X search tool for this runtime.",
        steps: ["Start xAI login or make sure XAI_API_KEY is configured.", "Enable the Hermes x_search tool.", "Refresh runtime integrations."],
        actions: [
          { id: "xai-login", label: "Start xAI login", action: "xai-login" },
          { id: "enable-x-search", label: "Enable X search", action: "enable-tool", input: { tool: "x_search" } },
        ],
      };
    }
    if (key === "videoGeneration") {
      return {
        title: "Set up AI video",
        description: "Enable the Hermes video tool after Grok/xAI credentials are available.",
        steps: ["Start xAI login or configure the provider credentials.", "Enable the Hermes video_gen tool.", "Refresh runtime integrations."],
        actions: [
          { id: "xai-login", label: "Start xAI login", action: "xai-login" },
          { id: "enable-video", label: "Enable video", action: "enable-tool", input: { tool: "video_gen" } },
        ],
      };
    }
    if (key === "codexRuntime") {
      return {
        title: "Set up Codex runtime",
        description: "Point Hermes at a Codex/OpenAI runtime path before routing coding work through it.",
        steps: ["Open Hermes configuration.", "Add the Codex/OpenAI runtime provider path.", "Refresh runtime integrations."],
        actions: [],
      };
    }
  }
  return {
    title: "Set up runtime capability",
    description: "This runtime reports the capability, but it needs provider credentials, a local tool toggle, or a readable data path before it can be used.",
    steps: ["Complete the runtime-specific setup outside this panel.", "Return here and refresh runtime integrations."],
    actions: [],
  };
}

export function readStoredValue(key: string, suffix: string): string | null {
  if (typeof window === "undefined") return null;
  const current = window.localStorage.getItem(key);
  if (current !== null) return current;
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const candidateKey = window.localStorage.key(index);
    if (!candidateKey || candidateKey === key || !candidateKey.endsWith(suffix)) continue;
    const candidate = window.localStorage.getItem(candidateKey);
    if (candidate === null) continue;
    window.localStorage.setItem(key, candidate);
    return candidate;
  }
  return null;
}

export function parseStoredAgents(): AgentProfile[] {
  if (typeof window === "undefined") return seedAgents();
  const raw = readStoredValue(STORAGE_KEY, STORAGE_SUFFIXES.agents);
  if (!raw) return seedAgents();
  try {
    const parsed = JSON.parse(raw) as AgentProfile[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seedAgents();
    return parsed.map(normalizeAgentProfile);
  } catch {
    return seedAgents();
  }
}

export function parseStoredVault(): SharedVaultConfig {
  if (typeof window === "undefined") return DEFAULT_SHARED_VAULT;
  const raw = readStoredValue(VAULT_STORAGE_KEY, STORAGE_SUFFIXES.vault);
  if (!raw) return DEFAULT_SHARED_VAULT;
  try {
    const parsed = JSON.parse(raw) as StoredSharedVaultConfig;
    const { tailnetSyncEnabled: legacyTailnetSyncEnabled, ...storedVault } = parsed;
    const storedVaultPath = storedVault.vaultPath?.trim();
    const migratedVaultPath = storedVaultPath
      && /\/[^/]*(hivemind|vault)[^/]*$/i.test(storedVaultPath)
      && !storedVaultPath.endsWith("/hivemindos-vault")
      ? DEFAULT_SHARED_VAULT.vaultPath
      : storedVaultPath;
    const storedKanbanFolder = normalizeVaultRelativePath(storedVault.kanbanFolder);
    const migratedKanbanFolder = storedKanbanFolder && /^kanban$/i.test(storedKanbanFolder)
      ? DEFAULT_SHARED_VAULT.kanbanFolder
      : storedKanbanFolder === "Projects/HivemindOS/Kanban"
        ? DEFAULT_SHARED_VAULT.kanbanFolder
      : storedKanbanFolder;
    const storedNotificationsFolder = normalizeVaultRelativePath(storedVault.notificationsFolder);
    const migratedNotificationsFolder = storedNotificationsFolder === "agent-notifications"
      ? DEFAULT_SHARED_VAULT.notificationsFolder
      : storedNotificationsFolder;
    const storedScheduledFolder = normalizeVaultRelativePath(storedVault.scheduledFolder);
    const migratedScheduledFolder = storedScheduledFolder === "Scheduled"
      ? DEFAULT_SHARED_VAULT.scheduledFolder
      : storedScheduledFolder;
    const storedSharedNotePath = storedVault.sharedNotePath?.trim();
    const migratedSharedNotePath = storedSharedNotePath === "Team/Shared Context.md" || storedSharedNotePath === "HivemindOS/Shared Context.md"
      ? DEFAULT_SHARED_VAULT.sharedNotePath
      : storedSharedNotePath;
    const storedInboxFolder = normalizeVaultRelativePath(storedVault.inboxFolder);
    const migratedInboxFolder = storedInboxFolder === "Agent Inbox" || storedInboxFolder === "Inbox"
      ? DEFAULT_SHARED_VAULT.inboxFolder
      : storedInboxFolder;
    const storedSynthesisFolder = normalizeVaultRelativePath(storedVault.synthesisFolder);
    const storedBrainServicesFolder = normalizeVaultRelativePath(storedVault.brainServicesFolder);
    const migratedBrainServicesFolder = storedBrainServicesFolder === "Projects/HivemindOS/Brain Access"
      ? DEFAULT_SHARED_VAULT.brainServicesFolder
      : storedBrainServicesFolder;
    const syncProvider = storedVault.syncProvider === "syncthing" || storedVault.syncProvider === "manual" || storedVault.syncProvider === "external"
      ? storedVault.syncProvider
      : legacyTailnetSyncEnabled === true
        ? "syncthing"
        : DEFAULT_SHARED_VAULT.syncProvider;
    return {
      ...DEFAULT_SHARED_VAULT,
      ...storedVault,
      syncProvider,
      syncthingAutoPairEnabled: storedVault.syncthingAutoPairEnabled ?? legacyTailnetSyncEnabled ?? DEFAULT_SHARED_VAULT.syncthingAutoPairEnabled,
      vaultPath: migratedVaultPath || DEFAULT_SHARED_VAULT.vaultPath,
      inboxFolder: migratedInboxFolder || DEFAULT_SHARED_VAULT.inboxFolder,
      sharedNotePath: migratedSharedNotePath || DEFAULT_SHARED_VAULT.sharedNotePath,
      kanbanFolder: migratedKanbanFolder || DEFAULT_SHARED_VAULT.kanbanFolder,
      notificationsFolder: migratedNotificationsFolder || DEFAULT_SHARED_VAULT.notificationsFolder,
      scheduledFolder: migratedScheduledFolder || DEFAULT_SHARED_VAULT.scheduledFolder,
      synthesisFolder: storedSynthesisFolder || DEFAULT_SHARED_VAULT.synthesisFolder,
      brainServicesFolder: migratedBrainServicesFolder || DEFAULT_SHARED_VAULT.brainServicesFolder,
      gbrain: { ...DEFAULT_SHARED_VAULT.gbrain, ...(storedVault.gbrain ?? {}) },
      synto: { ...DEFAULT_SHARED_VAULT.synto, ...(storedVault.synto ?? {}) },
    };
  } catch {
    return DEFAULT_SHARED_VAULT;
  }
}

export function parseStoredTasks(): AgentTask[] {
  if (typeof window === "undefined") return [];
  const raw = readStoredValue(TASK_STORAGE_KEY, STORAGE_SUFFIXES.tasks);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AgentTask[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseStoredSchedules(): AgentSchedule[] {
  if (typeof window === "undefined") return [];
  const raw = readStoredValue(SCHEDULE_STORAGE_KEY, STORAGE_SUFFIXES.schedules);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AgentSchedule[];
    return Array.isArray(parsed) ? parsed.filter((schedule) => (
      typeof schedule?.id === "string"
      && typeof schedule?.agentId === "string"
      && typeof schedule?.name === "string"
    )).map((schedule) => ({
      ...schedule,
      skills: Array.isArray(schedule.skills) ? schedule.skills : [],
      paths: Array.isArray(schedule.paths) ? schedule.paths : [],
      steps: Array.isArray(schedule.steps)
        ? schedule.steps.map((step, index) => ({
          ...step,
          id: typeof step.id === "string" ? step.id : `step-${schedule.id}-${index}`,
          text: typeof step.text === "string" ? step.text : "",
          skills: Array.isArray(step.skills) ? step.skills : [],
          paths: Array.isArray(step.paths) ? step.paths : [],
          model: typeof step.model === "string" ? step.model : "",
        }))
        : [],
      usePastRuns: schedule.usePastRuns === true,
      pastRunLimit: Math.max(1, Math.min(12, Number(schedule.pastRunLimit) || 3)),
    })) : [];
  } catch {
    return [];
  }
}

export function parseStoredChatFolders(): ChatCustomFolder[] {
  if (typeof window === "undefined") return [];
  const raw = readStoredValue(CHAT_FOLDER_STORAGE_KEY, STORAGE_SUFFIXES.chatFolders);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ChatCustomFolder[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((folder) => (
      typeof folder?.machineKey === "string"
      && typeof folder?.path === "string"
      && typeof folder?.label === "string"
    ));
  } catch {
    return [];
  }
}

export function isAutomationChatTranscript(messages: ChatMessage[] = []) {
  const transcript = messages.slice(0, 8).map((message) => message.content).join("\n");
  if (/\[IMPORTANT:\s*The user has invoked the "[^"]+" skill/i.test(transcript)) return true;
  if (/running as a scheduled cron job/i.test(transcript)) return true;
  if (/user has invoked the "[^"]+" skill/i.test(transcript)) return true;
  return false;
}

export function compactChatMessagesForStorage(messagesByAgent: Record<string, ChatMessage[]>) {
  return Object.fromEntries(Object.entries(messagesByAgent)
    .map(([agentId, messages]) => [
      agentId,
      messages
        .filter((message) => message.role !== "system" && (message.content.trim() || message.attachments?.length))
        .slice(-120),
    ])
    .filter(([, messages]) => Array.isArray(messages) && messages.length > 0 && !isAutomationChatTranscript(messages)));
}

export function chatMessagesStorageStats(messagesByAgent: Record<string, ChatMessage[]>) {
  return {
    agentCount: Object.keys(messagesByAgent).length,
    messageCount: Object.values(messagesByAgent).reduce((count, messages) => count + messages.length, 0),
  };
}

export function parseStoredChatMessages(): Record<string, ChatMessage[]> {
  if (typeof window === "undefined") return {};
  const raw = readStoredValue(CHAT_MESSAGES_STORAGE_KEY, STORAGE_SUFFIXES.chatMessages);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, ChatMessage[]>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([agentId, messages]) => typeof agentId === "string" && Array.isArray(messages))
      .map(([agentId, messages]): [string, ChatMessage[]] => [
        agentId,
        messages.filter((message): message is ChatMessage => (
          (message?.role === "user" || message?.role === "assistant" || message?.role === "system")
          && typeof message.content === "string"
        )).map((message) => ({
          role: message.role,
          content: message.content,
          createdAt: typeof message.createdAt === "number" ? message.createdAt : undefined,
          kanbanTaskId: typeof message.kanbanTaskId === "string" ? message.kanbanTaskId : undefined,
          surface: message.surface === "chat" || message.surface === "kanban" || message.surface === "scheduler" ? message.surface : undefined,
          sourceSessionId: typeof message.sourceSessionId === "string" ? message.sourceSessionId : undefined,
          sourceIndex: typeof message.sourceIndex === "number" ? message.sourceIndex : undefined,
          attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
          agentPrompt: message.agentPrompt && typeof message.agentPrompt === "object" && typeof message.agentPrompt.question === "string"
            ? {
              id: typeof message.agentPrompt.id === "string" ? message.agentPrompt.id : `${agentId}-${message.createdAt ?? Date.now()}`,
              type: ["clarify", "approval", "sudo", "secret", "prompt"].includes(message.agentPrompt.type) ? message.agentPrompt.type : "prompt",
              question: message.agentPrompt.question,
              choices: Array.isArray(message.agentPrompt.choices) ? message.agentPrompt.choices.filter((choice) => typeof choice === "string") : undefined,
              allowFreeText: message.agentPrompt.allowFreeText === true,
            }
            : undefined,
        })).slice(-120),
      ])
      .filter(([, messages]) => !isAutomationChatTranscript(messages)));
  } catch {
    return {};
  }
}

export function parseStoredWallets(): Record<string, AgentWalletConfig> {
  if (typeof window === "undefined") return {};
  const raw = readStoredValue(WALLET_STORAGE_KEY, STORAGE_SUFFIXES.wallets);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, AgentWalletConfig>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([agentId, wallet]) => typeof agentId === "string" && wallet && typeof wallet === "object")
      .map(([agentId, wallet]) => [agentId, stripUnfundedWalletBalance({ ...createDefaultAgentWallet(agentId), ...wallet, agentId })]));
  } catch {
    return {};
  }
}

export function parseStoredHoneyTreasury(): HoneyTreasuryConfig {
  const fallback = createDefaultHoneyTreasuryConfig();
  if (typeof window === "undefined") return fallback;
  return fallback;
}

export function parseStoredHoneyLedgerEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const raw = readStoredValue(HONEY_LEDGER_ENABLED_STORAGE_KEY, STORAGE_SUFFIXES.honeyLedgerEnabled);
  return raw === "true";
}

export function formatHiveAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 0.000001) return "<0.000001";
  return value.toLocaleString(undefined, { maximumFractionDigits: value < 1 ? 6 : 2 });
}

export function parseStoredDiscoveredMachines(): DiscoveredMachine[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(DISCOVERED_MACHINES_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as DiscoveredMachine[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((machine) => (
      machine?.device
      && typeof machine.device.name === "string"
      && typeof machine.collector === "string"
    ));
  } catch {
    return [];
  }
}

export function parseStoredFleetSnapshots(): Record<string, AgentSnapshot> {
  if (typeof window === "undefined") return {};
  const raw = readStoredValue(FLEET_SNAPSHOTS_STORAGE_KEY, STORAGE_SUFFIXES.fleetSnapshots);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, AgentSnapshot>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([agentId, snapshot]) => (
        typeof agentId === "string"
        && snapshot
        && typeof snapshot === "object"
        && typeof snapshot.agentId === "string"
        && Array.isArray(snapshot.tasks)
      ))
      .map(([agentId, snapshot]) => [agentId, {
        ...snapshot,
        tasks: snapshot.tasks.slice(0, 12),
        sources: Array.isArray(snapshot.sources) ? snapshot.sources : [],
      }]));
  } catch {
    return {};
  }
}

export function parseStoredMachineNameAliases(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const raw = readStoredValue(MACHINE_NAME_ALIAS_STORAGE_KEY, STORAGE_SUFFIXES.machineNameAliases);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed)
      .filter(([key, value]) => key.trim() && typeof value === "string" && value.trim())
      .map(([key, value]) => [key, value.trim()]));
  } catch {
    return {};
  }
}

export function mergeMachineNameAliases(local: Record<string, string>, remote: Record<string, string>) {
  return { ...local, ...remote };
}

export function runtimeCount(agents: AgentProfile[], runtime: AgentRuntime) {
  return agents.filter((agent) => agent.runtime === runtime).length;
}

export function formatRelativeTime(timestamp: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
