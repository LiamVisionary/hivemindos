import { DEFAULT_SHARED_VAULT, RUNTIME_CAPABILITIES, RUNTIME_KINDS, buildAgentCallPreferences, normalizeAgentRuntime, type AgentProfile, type AgentRuntime, type AgentRuntimeKind, type CustomWorkerClassProfile, type RuntimeCapabilities, type SharedVaultConfig } from "@/lib/types/agent-runtime";
import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import { beeWorkerPreset, renderBeeSoulTemplate } from "@/lib/config/bee-worker-presets";
import { ONBOARDING_BRAIN_LOOPS } from "@/lib/config/brain-loops";
import { RESEARCH_STORM_SKILL_SLUG, normalizeResearchMethod } from "@/lib/config/research-methods";
import { createDefaultAgentWallet, createDefaultHoneyTreasuryConfig, stripUnfundedWalletBalance } from "@/lib/utils/agent-wallet";
import { normalizeAgentLocalDataDir } from "@/lib/utils/agent-local-data-dir";
import { normalizeAgentTelemetryUrl } from "@/lib/utils/agent-telemetry-url";
import { isAutomationTranscriptText } from "@/lib/utils/automation-transcript";
import type { AgentWalletConfig, HoneyTreasuryConfig } from "@/lib/types/agent-wallet";
import type { AgentSchedule, AgentSnapshot, AgentTask, ChatCustomFolder, ChatMessage, DiscoveredMachine, HermesUpdateSkillLike, RuntimeIntegrationKey, RuntimeIntegrationStatus, RuntimeSetupDefinition, StoredSharedVaultConfig, WorkerClassDraft } from "@/features/dashboard/dashboard-types";
import { imageGenerationToApplicationGeneration, normalizeApplicationGenerationUrl, type ChatApplicationGenerationArtifact, type ChatApplicationGenerationCard } from "@/features/dashboard/chat-application-generation";
import { dashboardStateValue, type DashboardStateSnapshot } from "@/lib/services/dashboard-state-client";
import { normalizeChatResponseBilling } from "@/lib/types/chat-billing";
import type { ChatPermissionMode } from "@/lib/types/chat-permissions";
import type { CapabilityApprovalPlan, CapabilityCandidate, CapabilityDecision } from "@/lib/types/capability-approval";
import { normalizeEvaluationHumanFeedback } from "@/lib/types/evaluation";
import { queenBeeNameOrDefault } from "@/lib/config/queen-bee-personality";
import { normalizeChatAppArtifact } from "@/lib/services/chat/chat-app-artifact";
import { mergeChatProcessEvents } from "@/lib/services/chat/chat-process-events";

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
  discoveredMachines: ".discoveredMachines.v1",
  fleetSnapshots: ".fleetSnapshots.v1",
};
const runtimeCapabilitiesByRuntime = RUNTIME_CAPABILITIES as Record<string, RuntimeCapabilities>;
type StoredAgentPromptChoice = NonNullable<NonNullable<ChatMessage["agentPrompt"]>["choices"]>[number];
const runtimeKindsByRuntime = RUNTIME_KINDS as Record<string, AgentRuntimeKind | undefined>;

export function parseStoredChatMessageFeedback(value: unknown) {
  return normalizeEvaluationHumanFeedback(value);
}

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
  const runtime = normalizeAgentRuntime(agent.runtime);
  const beeRole = agent.beeRole ?? "worker";
  const name = beeRole === "queen"
    ? queenBeeNameOrDefault(agent.name, agent.queenNameCustomized)
    : agent.name;
  const workerClass = agent.workerClass ?? "general";
  const workerPreset = beeWorkerPreset(workerClass);
  const customWorkerClasses = agent.customWorkerClasses?.length
    ? agent.customWorkerClasses
    : agent.customWorkerClass
      ? [agent.customWorkerClass]
      : undefined;
  const selectedCustomWorkerClassId = agent.selectedCustomWorkerClassId ?? agent.customWorkerClass?.id;
  const preferredSkillSlugs = agent.preferredSkillSlugs ?? workerPreset.skillSlugs;
  const migrateResearchSkills = workerClass === "research"
    && !selectedCustomWorkerClassId
    && agent.researchMethod === undefined
    && !preferredSkillSlugs.includes(RESEARCH_STORM_SKILL_SLUG);
  const localDataDir = normalizeAgentLocalDataDir(agent.localDataDir);
  return {
    ...agent,
    name,
    runtime,
    statusPath: runtime === "hermes" && agent.statusPath?.trim() === "/status"
      ? "/health"
      : agent.statusPath,
    localDataDir: runtime === "hermes" && agent.id === "hermes-orchestrator" && !localDataDir
      ? "~/.hermes"
      : localDataDir,
    runtimeKind: agent.runtimeKind ?? runtimeKindsByRuntime[runtime],
    runtimeCapabilities: mergeRuntimeCapabilities(runtime, agent.runtimeCapabilities),
    a2aUrl: runtime === "aeon" ? agent.a2aUrl ?? agent.gatewayUrl : agent.a2aUrl,
    telemetryUrl: normalizeAgentTelemetryUrl(agent.telemetryUrl),
    aeonBranch: runtime === "aeon" ? agent.aeonBranch ?? "main" : agent.aeonBranch,
    aeonMode: runtime === "aeon" ? agent.aeonMode ?? "github" : agent.aeonMode,
    // Queen is an explicit, list-level choice (auto-crowned by model strength
    // in useQueenCrown when absent) — never inferred per-agent from the name.
    beeRole,
    workerClass,
    customWorkerClasses,
    selectedCustomWorkerClassId,
    customWorkerClass: customWorkerClasses?.find((workerClass: CustomWorkerClassProfile) => workerClass.id === selectedCustomWorkerClassId) ?? agent.customWorkerClass,
    soulPrompt: agent.soulPrompt ?? renderBeeSoulTemplate(workerPreset.soulTemplate, name),
    skillProfilePrompt: agent.skillProfilePrompt ?? workerPreset.taskProfile,
    preferredSkillSlugs: migrateResearchSkills ? [RESEARCH_STORM_SKILL_SLUG, ...preferredSkillSlugs] : preferredSkillSlugs,
    researchMethod: workerClass === "research" ? normalizeResearchMethod(agent.researchMethod) : agent.researchMethod,
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

export const HERMES_UPDATE_SKILL_PATTERN = /\b(background|codex|grok|kanban|session search|xai|x search|x-search|twitter|image|image-gen|imagine|tts|speech|music|sfx|sound effects|3d|video|decompose)\b/i;
export const HERMES_UPDATE_INTEGRATION_KEYS = new Set<RuntimeIntegrationKey>([
  "sessionSearch",
  "backgroundTasks",
  "xSearch",
  "imageGeneration",
  "ttsGeneration",
  "musicGeneration",
  "sfxGeneration",
  "model3dGeneration",
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
    if (key === "imageGeneration") {
      return {
        title: "Set up AI images",
        description: "Enable the Hermes image tool after image-generation provider credentials are available.",
        steps: ["Configure the image-generation provider credentials.", "Enable the Hermes image_gen tool.", "Refresh runtime integrations."],
        actions: [
          { id: "enable-image", label: "Enable images", action: "enable-tool", input: { tool: "image_gen" } },
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

export function readStoredValue(snapshot: DashboardStateSnapshot, key: string, suffix: string): string | null {
  return dashboardStateValue(snapshot, key, suffix);
}

export function parseStoredAgents(snapshot: DashboardStateSnapshot = {}): AgentProfile[] {
  const raw = readStoredValue(snapshot, STORAGE_KEY, STORAGE_SUFFIXES.agents);
  if (!raw) return seedAgents();
  try {
    const parsed = JSON.parse(raw) as AgentProfile[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seedAgents();
    return parsed.map(normalizeAgentProfile);
  } catch {
    return seedAgents();
  }
}

export function parseStoredVault(snapshot: DashboardStateSnapshot = {}): SharedVaultConfig {
  const raw = readStoredValue(snapshot, VAULT_STORAGE_KEY, STORAGE_SUFFIXES.vault);
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
      qmd: { ...DEFAULT_SHARED_VAULT.qmd, ...(storedVault.qmd ?? {}) },
      neo4j: { ...DEFAULT_SHARED_VAULT.neo4j, ...(storedVault.neo4j ?? {}) },
      synto: { ...DEFAULT_SHARED_VAULT.synto, ...(storedVault.synto ?? {}) },
    };
  } catch {
    return DEFAULT_SHARED_VAULT;
  }
}

export function parseStoredTasks(snapshot: DashboardStateSnapshot = {}): AgentTask[] {
  const raw = readStoredValue(snapshot, TASK_STORAGE_KEY, STORAGE_SUFFIXES.tasks);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AgentTask[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseStoredSchedules(snapshot: DashboardStateSnapshot = {}): AgentSchedule[] {
  const raw = readStoredValue(snapshot, SCHEDULE_STORAGE_KEY, STORAGE_SUFFIXES.schedules);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AgentSchedule[];
    return Array.isArray(parsed) ? parsed.filter((schedule) => (
      typeof schedule?.id === "string"
      && typeof schedule?.agentId === "string"
      && typeof schedule?.name === "string"
    )).map((schedule) => ({
      ...schedule,
      skills: Array.isArray(schedule.skills) ? [...new Set(schedule.skills)] : [],
      paths: Array.isArray(schedule.paths) ? [...new Set(schedule.paths)] : [],
      steps: Array.isArray(schedule.steps)
        ? schedule.steps.map((step, index) => ({
          ...step,
          id: typeof step.id === "string" ? step.id : `step-${schedule.id}-${index}`,
          text: typeof step.text === "string" ? step.text : "",
          skills: Array.isArray(step.skills) ? [...new Set(step.skills)] : [],
          paths: Array.isArray(step.paths) ? [...new Set(step.paths)] : [],
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

// Bounds the persisted schedule snapshot so the dashboard-state blob stays
// small, but must comfortably exceed a real fleet's automation count — 120 was
// clipping users with hundreds of (mostly inactive, Aeon-seeded) schedules to
// 120 rows in the list. A schedule row is ~1KB, so 1000 caps the snapshot near
// ~1MB while showing every automation a normal fleet has.
const MAX_PERSISTED_SCHEDULES = 1000;
const PINNED_SCHEDULE_IDS = new Set(ONBOARDING_BRAIN_LOOPS.map((loop) => loop.scheduleId));

export function compactSchedulesForPersist(schedules: AgentSchedule[]): AgentSchedule[] {
  if (schedules.length <= MAX_PERSISTED_SCHEDULES) return schedules;
  const selected = schedules.slice(0, MAX_PERSISTED_SCHEDULES);
  const selectedIds = new Set(selected.map((schedule) => schedule.id));
  const scheduleOrder = new Map(schedules.map((schedule, index) => [schedule.id, index]));

  for (const schedule of schedules.slice(MAX_PERSISTED_SCHEDULES)) {
    if (!PINNED_SCHEDULE_IDS.has(schedule.id) || selectedIds.has(schedule.id)) continue;
    let replaceIndex = -1;
    for (let index = selected.length - 1; index >= 0; index -= 1) {
      if (!PINNED_SCHEDULE_IDS.has(selected[index].id)) {
        replaceIndex = index;
        break;
      }
    }
    if (replaceIndex < 0) break;
    selectedIds.delete(selected[replaceIndex].id);
    selected[replaceIndex] = schedule;
    selectedIds.add(schedule.id);
  }

  return selected.sort((left, right) => (scheduleOrder.get(left.id) ?? 0) - (scheduleOrder.get(right.id) ?? 0));
}

export function parseStoredChatFolders(snapshot: DashboardStateSnapshot = {}): ChatCustomFolder[] {
  const raw = readStoredValue(snapshot, CHAT_FOLDER_STORAGE_KEY, STORAGE_SUFFIXES.chatFolders);
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
  return isAutomationTranscriptText(transcript);
}

function normalizedChatMessageContent(message: Pick<ChatMessage, "content">) {
  return message.content.replace(/\s+/g, " ").trim().toLowerCase();
}

function sameVisibleChatMessage(left: ChatMessage | undefined, right: ChatMessage | undefined) {
  if (!left || !right) return false;
  if (left.capabilityApproval || right.capabilityApproval) {
    return Boolean(left.capabilityApproval?.id && left.capabilityApproval.id === right.capabilityApproval?.id);
  }
  return left.role === right.role && normalizedChatMessageContent(left) === normalizedChatMessageContent(right);
}

function findLastChatMessageIndex(messages: ChatMessage[], predicate: (message: ChatMessage) => boolean) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index])) return index;
  }
  return -1;
}

function dedupeChatTranscript(messages: ChatMessage[]) {
  const output: ChatMessage[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (sameVisibleChatMessage(output.at(-1), message)) {
      const previous = output.at(-1);
      const processEvents = mergeChatProcessEvents(previous?.processEvents ?? [], message.processEvents ?? []);
      if (previous && (processEvents.length || (message.billing && !previous.billing) || message.feedback || message.appArtifact)) {
        output[output.length - 1] = {
          ...previous,
          processEvents: processEvents.length ? processEvents : previous.processEvents,
          billing: message.billing ?? previous.billing,
          feedback: message.feedback ?? previous.feedback,
          appArtifact: message.appArtifact ?? previous.appArtifact,
        } as ChatMessage;
      }
      continue;
    }
    if (message.role === "user" && message.content.trim()) {
      const previousUserIndex = findLastChatMessageIndex(output, (item) => sameVisibleChatMessage(item, message));
      const between = previousUserIndex >= 0 ? output.slice(previousUserIndex + 1) : [];
      const nextAssistant = messages[index + 1];
      const previousAssistant = [...between].reverse().find((item) => item.role === "assistant" && item.content.trim());
      if (
        nextAssistant?.role === "assistant"
        && previousAssistant
        && sameVisibleChatMessage(previousAssistant, nextAssistant)
      ) {
        index += 1;
        continue;
      }
    }
    if (message.role === "assistant" && message.content.trim()) {
      const previousAssistantIndex = findLastChatMessageIndex(output, (item) => sameVisibleChatMessage(item, message));
      const previousUser = [...output.slice(0, previousAssistantIndex)].reverse().find((item) => item.role === "user");
      const currentUser = [...output].reverse().find((item) => item.role === "user");
      if (previousAssistantIndex >= 0 && sameVisibleChatMessage(previousUser, currentUser)) {
        const processEvents = mergeChatProcessEvents(output[previousAssistantIndex]?.processEvents ?? [], message.processEvents ?? []);
        if (processEvents.length || (message.billing && !output[previousAssistantIndex]?.billing) || message.feedback || message.appArtifact) {
          output[previousAssistantIndex] = {
            ...output[previousAssistantIndex],
            processEvents: processEvents.length ? processEvents : output[previousAssistantIndex]?.processEvents,
            billing: message.billing ?? output[previousAssistantIndex]?.billing,
            feedback: message.feedback ?? output[previousAssistantIndex]?.feedback,
            appArtifact: message.appArtifact ?? output[previousAssistantIndex]?.appArtifact,
          };
        }
        continue;
      }
    }
    output.push(message);
  }
  return output;
}

function chatMessageHasPersistableContent(message: ChatMessage) {
  return Boolean(
    message.content.trim()
    || message.attachments?.length
    || message.capabilityApproval
    || message.appArtifact
    || message.agentPrompt
    || message.applicationGeneration
    || message.imageGeneration
    || (message.processEvents?.length ?? 0) > 0
  );
}

export function compactChatMessagesForStorage(messagesByAgent: Record<string, ChatMessage[]>) {
  return Object.fromEntries(Object.entries(messagesByAgent)
    .map(([agentId, messages]) => [
      agentId,
      dedupeChatTranscript(messages)
        .filter((message) => message.role !== "system" && chatMessageHasPersistableContent(message))
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

function parseStoredImageGeneration(message: ChatMessage) {
  const card = message.imageGeneration;
  if (!card || typeof card !== "object" || typeof card.id !== "string" || typeof card.prompt !== "string") return undefined;
  const status = card.status === "ready" || card.status === "error" || card.status === "running" ? card.status : "ready";
  return {
    id: card.id,
    prompt: card.prompt,
    status,
    appId: typeof card.appId === "string" ? card.appId : undefined,
    appName: typeof card.appName === "string" ? card.appName : undefined,
    serviceKind: typeof card.serviceKind === "string" ? card.serviceKind : undefined,
    modelName: typeof card.modelName === "string" ? card.modelName : undefined,
    machineName: typeof card.machineName === "string" ? card.machineName : undefined,
    machineSpecs: typeof card.machineSpecs === "string" ? card.machineSpecs : undefined,
    images: Array.isArray(card.images)
      ? card.images
        .map((image) => ({ image, url: normalizeApplicationGenerationUrl(image?.url) }))
        .filter((item): item is { image: NonNullable<typeof item.image>; url: string } => Boolean(item.image) && Boolean(item.url))
        .map(({ image, url }) => ({
          url,
          width: typeof image.width === "number" ? image.width : undefined,
          height: typeof image.height === "number" ? image.height : undefined,
          seed: typeof image.seed === "string" || typeof image.seed === "number" ? image.seed : undefined,
        }))
      : undefined,
    error: typeof card.error === "string" ? card.error : undefined,
    createdAt: typeof card.createdAt === "number" ? card.createdAt : undefined,
    completedAt: typeof card.completedAt === "number" ? card.completedAt : undefined,
  };
}

function parseStoredApplicationGenerationArtifact(artifact: unknown): ChatApplicationGenerationArtifact | null {
  if (!artifact || typeof artifact !== "object") return null;
  const item = artifact as Partial<ChatApplicationGenerationArtifact>;
  const url = normalizeApplicationGenerationUrl(item.url);
  if (!url) return null;
  const kind = item.kind === "image" || item.kind === "audio" || item.kind === "video" || item.kind === "model3d" || item.kind === "file"
    ? item.kind
    : "file";
  return {
    kind,
    url,
    label: typeof item.label === "string" ? item.label : undefined,
    mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
    width: typeof item.width === "number" ? item.width : undefined,
    height: typeof item.height === "number" ? item.height : undefined,
    durationMs: typeof item.durationMs === "number" ? item.durationMs : undefined,
    seed: typeof item.seed === "string" || typeof item.seed === "number" ? item.seed : undefined,
  };
}

function parseStoredApplicationGeneration(message: ChatMessage): ChatApplicationGenerationCard | undefined {
  const card = message.applicationGeneration;
  if (!card || typeof card !== "object" || typeof card.id !== "string" || typeof card.prompt !== "string") {
    const legacyImageCard = parseStoredImageGeneration(message);
    return legacyImageCard ? imageGenerationToApplicationGeneration(legacyImageCard) : undefined;
  }
  const kind = card.kind === "image" || card.kind === "music" || card.kind === "tts" || card.kind === "model3d" || card.kind === "video"
    ? card.kind
    : "image";
  const status = card.status === "ready" || card.status === "error" || card.status === "running" ? card.status : "ready";
  return {
    id: card.id,
    kind,
    prompt: card.prompt,
    status,
    title: typeof card.title === "string" ? card.title : undefined,
    appId: typeof card.appId === "string" ? card.appId : undefined,
    appName: typeof card.appName === "string" ? card.appName : undefined,
    serviceKind: typeof card.serviceKind === "string" ? card.serviceKind : undefined,
    modelName: typeof card.modelName === "string" ? card.modelName : undefined,
    machineName: typeof card.machineName === "string" ? card.machineName : undefined,
    machineSpecs: typeof card.machineSpecs === "string" ? card.machineSpecs : undefined,
    sourceArtifacts: Array.isArray(card.sourceArtifacts)
      ? card.sourceArtifacts.map(parseStoredApplicationGenerationArtifact).filter((artifact): artifact is ChatApplicationGenerationArtifact => Boolean(artifact))
      : undefined,
    artifacts: Array.isArray(card.artifacts)
      ? card.artifacts.map(parseStoredApplicationGenerationArtifact).filter((artifact): artifact is ChatApplicationGenerationArtifact => Boolean(artifact))
      : undefined,
    error: typeof card.error === "string" ? card.error : undefined,
    createdAt: typeof card.createdAt === "number" ? card.createdAt : undefined,
    completedAt: typeof card.completedAt === "number" ? card.completedAt : undefined,
  };
}

function parseStoredAgentPromptChoice(choice: unknown): StoredAgentPromptChoice | null {
  if (typeof choice === "string") return choice;
  if (!choice || typeof choice !== "object") return null;
  const record = choice as { label?: unknown; value?: unknown; permissionMode?: unknown; suppressUserMessage?: unknown };
  const label = typeof record.label === "string" ? record.label.trim() : "";
  const value = typeof record.value === "string" ? record.value.trim() : "";
  if (!label && !value) return null;
  const permissionMode = ["manual", "accept-edits", "plan", "auto", "bypass"].includes(String(record.permissionMode))
    ? record.permissionMode as ChatPermissionMode
    : undefined;
  return {
    label: label || value,
    value: value || label,
    permissionMode,
    ...(record.suppressUserMessage === true ? { suppressUserMessage: true } : {}),
  };
}

function parseStoredAgentPrompt(message: ChatMessage, agentId: string): ChatMessage["agentPrompt"] {
  if (!message.agentPrompt || typeof message.agentPrompt !== "object" || typeof message.agentPrompt.question !== "string") return undefined;
  const response = message.agentPrompt.response && typeof message.agentPrompt.response === "object" && typeof message.agentPrompt.response.label === "string"
    ? {
      label: message.agentPrompt.response.label.trim(),
      value: typeof message.agentPrompt.response.value === "string" ? message.agentPrompt.response.value.trim() : undefined,
      respondedAt: typeof message.agentPrompt.response.respondedAt === "number" ? message.agentPrompt.response.respondedAt : undefined,
    }
    : undefined;
  return {
    id: typeof message.agentPrompt.id === "string" ? message.agentPrompt.id : `${agentId}-${message.createdAt ?? Date.now()}`,
    type: ["clarify", "approval", "sudo", "secret", "prompt"].includes(message.agentPrompt.type) ? message.agentPrompt.type : "prompt",
    question: message.agentPrompt.question,
    choices: Array.isArray(message.agentPrompt.choices) ? message.agentPrompt.choices.map(parseStoredAgentPromptChoice).filter((choice): choice is StoredAgentPromptChoice => Boolean(choice)) : undefined,
    allowFreeText: message.agentPrompt.allowFreeText !== false,
    response: response?.label ? response : undefined,
  };
}

function parseStoredCapabilityApproval(message: ChatMessage): CapabilityApprovalPlan | undefined {
  const raw = message.capabilityApproval;
  if (!raw || typeof raw !== "object" || raw.version !== 1 || typeof raw.id !== "string" || typeof raw.task !== "string" || !Array.isArray(raw.items)) return undefined;
  const items = raw.items.flatMap((item, itemIndex) => {
    if (!item || typeof item !== "object" || !Array.isArray(item.candidates)) return [];
    const candidates = item.candidates.flatMap((candidate): CapabilityCandidate[] => {
      if (!candidate || typeof candidate.id !== "string" || typeof candidate.name !== "string") return [];
      if (candidate.availability !== "ready" && candidate.availability !== "setup-required") return [];
      return [{
        id: candidate.id,
        name: candidate.name,
        summary: typeof candidate.summary === "string" ? candidate.summary : "",
        kind: typeof candidate.kind === "string" ? candidate.kind : "capability",
        availability: candidate.availability,
        locator: typeof candidate.locator === "string" ? candidate.locator : undefined,
        machineName: typeof candidate.machineName === "string" ? candidate.machineName : undefined,
      }];
    }).slice(0, 8);
    if (!candidates.length) return [];
    const selectedCapabilityId = candidates.some((candidate) => candidate.id === item.selectedCapabilityId)
      ? item.selectedCapabilityId
      : candidates[0].id;
    const decision: CapabilityDecision = item.decision === "remove" || item.decision === "reject" || item.decision === "approve-setup" || item.decision === "use"
      ? item.decision
      : candidates.find((candidate) => candidate.id === selectedCapabilityId)?.availability === "setup-required" ? "approve-setup" : "use";
    return [{
      id: typeof item.id === "string" ? item.id : `${raw.id}-${itemIndex}`,
      intent: typeof item.intent === "string" ? item.intent : "capability",
      label: typeof item.label === "string" ? item.label : "Capability",
      reason: typeof item.reason === "string" ? item.reason : "",
      candidates,
      selectedCapabilityId,
      decision,
      githubUrl: typeof item.githubUrl === "string" ? item.githubUrl : undefined,
      instructions: typeof item.instructions === "string" ? item.instructions : undefined,
    }];
  });
  if (!items.length || typeof raw.agentId !== "string" || typeof raw.chatStorageKey !== "string") return undefined;
  return {
    version: 1,
    reviewMode: raw.status === "approved" && raw.reviewMode === "automatic" ? "automatic" : "ask",
    id: raw.id,
    task: raw.task,
    agentId: raw.agentId,
    agentName: typeof raw.agentName === "string" ? raw.agentName : raw.agentId,
    chatStorageKey: raw.chatStorageKey,
    chatLeaf: typeof raw.chatLeaf === "string" ? raw.chatLeaf : `agent-${raw.agentId}`,
    status: raw.status === "approved" || raw.status === "cancelled" ? raw.status : "pending",
    items,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    resolvedAt: typeof raw.resolvedAt === "number" ? raw.resolvedAt : undefined,
  };
}

export function parseStoredChatMessages(snapshot: DashboardStateSnapshot = {}): Record<string, ChatMessage[]> {
  return parseChatMessagesValue(readStoredValue(snapshot, CHAT_MESSAGES_STORAGE_KEY, STORAGE_SUFFIXES.chatMessages));
}

function parseChatMessagesValue(raw: string | null): Record<string, ChatMessage[]> {
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
          feedback: parseStoredChatMessageFeedback(message.feedback),
          billing: normalizeChatResponseBilling(message.billing),
          processEvents: Array.isArray(message.processEvents)
            ? message.processEvents
              .filter((event) => event && typeof event.label === "string" && event.label.trim())
              .map((event) => ({
                at: typeof event.at === "number" ? event.at : undefined,
                label: event.label.trim(),
                detail: typeof event.detail === "string" ? event.detail : undefined,
                status: typeof event.status === "string" ? event.status : undefined,
                runId: typeof event.runId === "string" ? event.runId : undefined,
              }))
            : undefined,
          attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
          applicationGeneration: parseStoredApplicationGeneration(message),
          imageGeneration: parseStoredImageGeneration(message),
          capabilityApproval: parseStoredCapabilityApproval(message),
          appArtifact: normalizeChatAppArtifact(message.appArtifact),
          agentPrompt: parseStoredAgentPrompt(message, agentId),
        })).slice(-120),
      ])
      .filter(([, messages]) => !isAutomationChatTranscript(messages)));
  } catch {
    return {};
  }
}

// Chats the server never acknowledged saving are stashed in localStorage so a
// reload during a dev-server restart cannot lose them. Only the unsaved delta
// is stashed: the full chat blob can exceed localStorage quotas.
const PENDING_CHAT_SAVES_STORAGE_KEY = "hivemindos.chatMessages.pendingSave.v1";

function chatTranscriptLastActivityAt(messages: ChatMessage[] = []) {
  return messages.reduce((latest, message) => Math.max(latest, message.createdAt ?? 0), 0);
}

export function readPendingChatSaves(): Record<string, ChatMessage[]> {
  if (typeof window === "undefined") return {};
  try {
    return parseChatMessagesValue(window.localStorage.getItem(PENDING_CHAT_SAVES_STORAGE_KEY));
  } catch {
    return {};
  }
}

export function writePendingChatSaves(pending: Record<string, ChatMessage[]>) {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(pending).length === 0) {
      window.localStorage.removeItem(PENDING_CHAT_SAVES_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PENDING_CHAT_SAVES_STORAGE_KEY, JSON.stringify(pending));
    }
  } catch {
    // Quota errors leave the previous stash in place; saving stays best-effort.
  }
}

export function clearPendingChatSaves() {
  writePendingChatSaves({});
}

export function diffChatMessagesForPendingSave(
  confirmed: Record<string, ChatMessage[]>,
  next: Record<string, ChatMessage[]>,
): Record<string, ChatMessage[]> {
  return Object.fromEntries(Object.entries(next)
    .filter(([storageKey, transcript]) => {
      const confirmedTranscript = confirmed[storageKey];
      return !confirmedTranscript || JSON.stringify(confirmedTranscript) !== JSON.stringify(transcript);
    }));
}

export function mergePendingChatMessages(
  stored: Record<string, ChatMessage[]>,
  pending: Record<string, ChatMessage[]>,
): Record<string, ChatMessage[]> {
  const merged = { ...stored };
  for (const [storageKey, transcript] of Object.entries(pending)) {
    if (!transcript.length) continue;
    if (chatTranscriptLastActivityAt(transcript) >= chatTranscriptLastActivityAt(merged[storageKey])) {
      merged[storageKey] = transcript;
    }
  }
  return merged;
}

export function parseStoredWallets(snapshot: DashboardStateSnapshot = {}): Record<string, AgentWalletConfig> {
  const raw = readStoredValue(snapshot, WALLET_STORAGE_KEY, STORAGE_SUFFIXES.wallets);
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
  return fallback;
}

export function parseStoredHoneyLedgerEnabled(snapshot: DashboardStateSnapshot = {}): boolean {
  const raw = readStoredValue(snapshot, HONEY_LEDGER_ENABLED_STORAGE_KEY, STORAGE_SUFFIXES.honeyLedgerEnabled);
  return raw === "true";
}

export function formatHiveAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 0.000001) return "<0.000001";
  return value.toLocaleString(undefined, { maximumFractionDigits: value < 1 ? 6 : 2 });
}

/**
 * Collectors have no authority to declare a Queen Bee — the queen is a
 * dashboard-level choice, and old collectors in the field still self-declare
 * their detected OpenClaw runtime as one. Demote any discovered "queen" to a
 * worker before the fleet renders or persists it.
 */
export function sanitizeDiscoveredAgentRoles(machines: DiscoveredMachine[]): DiscoveredMachine[] {
  return machines.map((machine) => (
    machine.agents?.some((agent) => agent.beeRole === "queen")
      ? {
        ...machine,
        agents: machine.agents.map((agent) => (agent.beeRole === "queen" ? { ...agent, beeRole: "worker" as const } : agent)),
      }
      : machine
  ));
}

export function parseStoredDiscoveredMachines(snapshot: DashboardStateSnapshot = {}): DiscoveredMachine[] {
  const raw = readStoredValue(snapshot, DISCOVERED_MACHINES_STORAGE_KEY, STORAGE_SUFFIXES.discoveredMachines);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as DiscoveredMachine[];
    if (!Array.isArray(parsed)) return [];
    return sanitizeDiscoveredAgentRoles(parsed.filter((machine) => (
      machine?.device
      && typeof machine.device.name === "string"
      && typeof machine.collector === "string"
    )));
  } catch {
    return [];
  }
}

export function parseStoredFleetSnapshots(snapshot: DashboardStateSnapshot = {}): Record<string, AgentSnapshot> {
  const raw = readStoredValue(snapshot, FLEET_SNAPSHOTS_STORAGE_KEY, STORAGE_SUFFIXES.fleetSnapshots);
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

// Persisted seed only — the in-session map stays complete. The fleet merge
// never evicts, so ephemeral per-PID agents accumulate forever; this key once
// reached 30MB (2,822 agents), and every dashboard-state save rewrites the
// whole store, which froze the desktop app (native invokes serialize on the
// UI-process main thread). Keep only the most recently checked snapshots.
const FLEET_SNAPSHOTS_PERSIST_LIMIT = 128;

export function compactFleetSnapshotsForPersist(snapshots: Record<string, AgentSnapshot>): Record<string, AgentSnapshot> {
  return Object.fromEntries(Object.entries(snapshots)
    .filter(([, snapshot]) => snapshot?.tasks?.length > 0)
    .sort(([, a], [, b]) => (b?.checkedAt ?? 0) - (a?.checkedAt ?? 0))
    .slice(0, FLEET_SNAPSHOTS_PERSIST_LIMIT)
    .map(([agentId, snapshot]) => [agentId, {
      ...snapshot,
      tasks: snapshot.tasks.slice(0, 12),
    }]));
}

export function parseStoredMachineNameAliases(snapshot: DashboardStateSnapshot = {}): Record<string, string> {
  const raw = readStoredValue(snapshot, MACHINE_NAME_ALIAS_STORAGE_KEY, STORAGE_SUFFIXES.machineNameAliases);
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
