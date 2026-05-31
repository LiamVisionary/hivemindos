// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
  Activity,
  AlignLeft,
  Bell,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  CircleAlert,
  Copy,
  CopyPlus,
  Cpu,
  Download,
  Eye,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FileUp,
  GitBranch,
  Hammer,
  HandCoins,
  Hexagon,
  KanbanSquare,
  KeyRound,
  List,
  LoaderCircle,
  Link,
  MessageSquare,
  Minus,
  Monitor,
  Network,
  Plus,
  PlugZap,
  RefreshCcw,
  Repeat2,
  Puzzle,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Search,
  Paperclip,
  Pencil,
  Terminal,
  Trash2,
  Upload,
  Users,
  WalletCards,
} from "lucide-react";
import type { AdaptiveOpenRouterConfig, AgentProfile, AgentRuntime, BeeWorkerClass, CustomWorkerClassProfile, RuntimeCapabilities, SharedVaultConfig, UsePodAgentConfig } from "@/lib/types/agent-runtime";
import type { AgentNotification, AgentNotificationSettings, AgentNotificationSummary } from "@/lib/types/agent-notifications";
import { createAgentProfile, DEFAULT_SHARED_VAULT, RUNTIME_CAPABILITIES, RUNTIME_DEFAULTS, RUNTIME_KINDS, RUNTIME_LABELS } from "@/lib/types/agent-runtime";
import type { AgentPaymentProvider, AgentWalletConfig, HoneyTreasuryConfig } from "@/lib/types/agent-wallet";
import type { KanbanBoard, KanbanLinkedDirectory, KanbanMachineTarget, KanbanStatus, KanbanTask, KanbanTaskAttachment } from "@/lib/types/kanban";
import type { RecentDirectory } from "@/lib/types/recent-directories";
import type { MiroSharkAnalysisMode, MiroSharkIntelligence } from "@/lib/services/miroshark/run-intelligence";
import { KANBAN_COLUMNS } from "@/lib/types/kanban";
import { AGENT_PAYMENT_PROVIDER_COPY } from "@/lib/config/agent-payments";
import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import { providerIconPath, providerIconRenderMode, runtimeIconFallback, runtimeIconPath, runtimeIconRenderMode } from "@/lib/config/runtime-icons";
import { BEE_WORKER_PRESET_LIST, beeWorkerPreset } from "@/lib/config/bee-worker-presets";
import { logClientTelemetry } from "@/lib/utils/client-telemetry";
import {
  buildAgentPaymentPrompt,
  createDefaultAgentWallet,
  createDefaultHoneyTreasuryConfig,
  getHoneyAgentRewards,
  getSurvivalSnapshot,
  normalizeMoney,
  stripUnfundedWalletBalance,
} from "@/lib/utils/agent-wallet";
import { groupKanbanTasks } from "@/lib/utils/kanban-board";
import {
  beeRoleLabel,
  beeWorkerClassLabel,
  chooseBeeAssignment,
} from "@/lib/services/orchestration/bee-roles";
import chatStyles from "@/app/chat.module.css";
import fleetStyles from "@/app/fleet.module.css";
import kanbanStyles from "@/app/kanban-board.module.css";
import notificationStyles from "@/app/notifications.module.css";
import vaultStyles from "@/app/vault.module.css";
import walletStyles from "@/app/wallets.module.css";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AttachmentListMenuContent,
  AttachmentMenuContent,
  AgentResponseLoader,
  attachmentSizeLabel,
  attachmentSummary,
  chatDisplayContent,
  cleanActivityTitle,
  ComposerField,
  linkedDirectoryLabel,
  MessageAttachments,
  messageContentParts,
  pickLinkedDirectory,
  readComposerFiles,
  speechRecognitionConstructor,
  type SpeechRecognitionLike,
} from "@/features/chat/chat-composer";
import { Cell } from "@/components/cells/Cell";
import { CellMenu } from "@/components/cells/CellMenu";
import type { CellMenuItem } from "@/components/cells/CellMenu";
import type { AgentTaskRow } from "@/components/cells/AgentTaskList";
import type { SetupStep } from "@/components/cells/SetupCell";
import type { FleetAgentChat, FleetAlert, FleetMachine, FleetTask } from "@/components/fleet";
import type { SchedulerJob, SchedulerRunPhase, SchedulerRunState } from "@/components/scheduler";
import type { NewTaskPayload } from "@/components/task-modal";
import type { SwarmAgent, SwarmDecision, SwarmMarket, SwarmRun, SwarmSocialPost, SwarmTemplate, TemplateId } from "@/components/swarm";
import {
  AgentCell,
  AgentTaskList,
  AgentWalletCard,
  AgentWalletCardCompact,
  FleetView,
  MachineCell,
  MemoryCell,
  SchedulerView,
  SetupCell,
  SwarmView,
  TaskModal,
} from "@/features/dashboard/lazy-components";
import { AgentsPanel } from "@/features/dashboard/views/AgentsPanel";
import { ChatPanel } from "@/features/dashboard/views/ChatPanel";
import { ChatMarkdown } from "@/features/dashboard/ChatMarkdown";
import { MorePanel } from "@/features/dashboard/MorePanel";
import { AeonAutopilotPanel } from "@/features/dashboard/views/AeonAutopilotPanel";
import { PhonePanel } from "@/features/dashboard/views/PhonePanel";
import {
  chatDedupeKey,
  chatFolderLabel,
  chatPreviewDedupeKey,
  chatSetupIssue,
  dedupeAgents,
  extractKanbanVisualBrief,
  formatDurationShort,
  formatMessageTimestamp,
  inferCurrentTask,
  inferLatestAgentMessage,
  isHermesAuthFailure,
  isInternalHermesSessionPrelude,
  isKanbanAwaitingAgentUpdate,
  isKanbanTerminalMessage,
  isStarterPlaceholder,
  isTransientDelegationMessage,
  kanbanCardMessage,
  kanbanEventLabel,
  KANBAN_STEER_TARGETS,
  kanbanReadyPickupSignature,
  kanbanTaskAssigneeAgent,
  kanbanTaskAssignmentForAgent,
  kanbanTaskBee,
  kanbanTaskDispatchPrompt,
  kanbanTaskInterruptPrompt,
  parentPathFromPath,
  preferChatTreeItem,
  simpleStableHash,
  viewIcon,
  wait,
  workspaceLabelFromPath,
} from "@/features/dashboard/dashboard-light-helpers";
import {
  BrainGraphLoader,
  brainGraphEdgePath,
  brainGraphLayout,
  brainNodePoints,
  fleetAgentState,
  fleetMachineLocation,
  fleetMetric,
  fleetVersionState,
  formatBrainDate,
  friendlyEmptyTitle,
  isCollectorAutoUpdateable,
  localDashboardHasUnpublishedChanges,
  machineNeedsChatBridgeRepair,
  machineNeedsEnvHttpSyncRepair,
  machineNeedsSkillSyncRepair,
  machineNetworkIssue,
  machineVersionCopy,
  mergeDiscoveredMachines,
  mergeSnapshotRecord,
  setupCollectorCommand,
  splitBrainLabel,
} from "@/features/dashboard/dashboard-display-helpers";
import { createStyleClass } from "@/features/dashboard/style-classes";
import type { DashboardGBrainStatus, DashboardTradingBrainStatus } from "@/features/dashboard/dashboard-types";
import type { MemoryTelemetryPayload } from "@/lib/types/memory-telemetry";
import type { WorkHistoryPayload } from "@/lib/types/work-history";
import {
  compactDiagnosticPreview,
  isKanbanStaleWorkingTask,
  isManualAgentChatMessage,
  kanbanNoAssistantStalledDetail,
  kanbanStaleAge,
  kanbanToolOutputStalledDetail,
  summarizeKanbanToolOutput,
} from "@/features/kanban/kanban-diagnostics";
import {
  groupNotifications,
  notificationActorMeta,
  notificationDisplayBody,
  notificationDisplayTitle,
  notificationSourceLabel,
  summarizeHermesAuthError,
} from "@/features/notifications/notification-display";
import { NotificationsPanel } from "@/features/notifications/NotificationsPanel";
import {
  agentAliasMap,
  agentWorkspaceKey,
  collectorKey,
  displayMachineName,
  isLoopbackCollector,
  isMobileMachineOs,
  isVisibleFleetMachine,
  machineIdentityFromParts,
  renderAgentKey,
} from "@/features/fleet/fleet-identity";
import {
  AgentEnvCard,
  chatMessageStorageKey,
  chatSeedMessagesForTask,
  chatTaskMatchKey,
  createChatLeafKey,
  EnvValueRow,
  findRosterChatTask,
  formatAgentEnvText,
  runtimeSessionIdFromTask,
  isChatSidebarTask,
  isMeaningfulActive,
  parseAgentEnvText,
  parseEnvImportText,
  randomEnvSecret,
  runtimeSessionForChat,
  taskChatLeafKey,
  workPriority,
} from "@/features/env/env-components";
import {
  customWorkerProfileFromDraft,
  defaultWorkerClassDraft,
  formatHiveAmount,
  formatRelativeTime,
  HERMES_UPDATE_INTEGRATION_KEYS,
  chatMessagesStorageStats,
  compactChatMessagesForStorage,
  hermesUpdateDetail,
  isAutomationChatTranscript,
  mergeMachineNameAliases,
  normalizeAgentProfile,
  parseStoredAgents,
  parseStoredChatFolders,
  parseStoredChatMessages,
  parseStoredDiscoveredMachines,
  parseStoredFleetSnapshots,
  parseStoredHoneyLedgerEnabled,
  parseStoredHoneyTreasury,
  parseStoredMachineNameAliases,
  parseStoredSchedules,
  parseStoredTasks,
  parseStoredVault,
  parseStoredWallets,
  readStoredValue,
  runtimeCan,
  runtimeCapabilities,
  runtimeCount,
  runtimeSetupDefinition,
  seedAgents,
  skillRequiresHermesUpdate,
  workerCapabilityBadges,
} from "@/features/dashboard/dashboard-storage";
import {
  HETZNER_IMAGE_OPTIONS,
  HETZNER_LOCATION_OPTIONS,
  HETZNER_SERVER_TYPE_OPTIONS,
} from "@/features/fleet/machine-init-options";
import {
  SCHEDULE_PRESETS,
  SCHEDULER_DYNAMIC_SKILL_ACTIONS_ENABLED,
  SCHEDULER_HERMES_SKILL_CONTEXT_ENABLED,
  SCHEDULER_MODEL_OPTIONS,
} from "@/features/scheduler/scheduler-options";
import {
  composeMirosharkTemplateScenario,
  defaultMirosharkTemplateInputs,
  MIROSHARK_TEMPLATE_INPUTS,
  SWARM_LAUNCH_PRESETS,
  type MiroSharkTemplate,
  type MiroSharkTemplateInputState,
} from "@/features/swarm/miroshark-templates";
import {
  asRecord,
  compactValue,
  getMiroSharkPosts,
  getMiroSharkRunStatus,
  getMiroSharkTemplates,
  isEmptyIntegrationPayload,
  isMiroSharkRunTerminal,
  isUnpublishedSimulationPayload,
  payloadArray,
  payloadCount,
  payloadData,
  payloadPreview,
} from "@/features/swarm/miroshark-payload";
import {
  mirosharkHandle,
  mirosharkStat,
  mirosharkUserName,
  numericRecordValue,
  swarmEventItem,
  swarmMarketEventItem,
  swarmMarketFromItems,
  swarmMarketPriceEventItem,
  swarmRunState,
  swarmTemplateIdFromMirosharkTemplate,
  swarmTemplateIdFromSurface,
} from "@/features/swarm/swarm-transformers";

import { useMirosharkBrainController } from "@/features/dashboard/hooks/use-miroshark-brain-controller";
import { useDashboardPollingEffects } from "@/features/dashboard/hooks/use-dashboard-polling-effects";
import { useDashboardDerivedState } from "@/features/dashboard/hooks/use-dashboard-derived-state";
import { useVisibilityAwarePolling } from "@/features/dashboard/hooks/use-visibility-aware-polling";
import { useAgentController } from "@/features/dashboard/hooks/use-agent-controller";
import { useSchedulerController } from "@/features/dashboard/hooks/use-scheduler-controller";
import { useWalletFilesController } from "@/features/dashboard/hooks/use-wallet-files-controller";
import { useChatTreeController } from "@/features/dashboard/hooks/use-chat-tree-controller";
import { useFleetNotificationsController } from "@/features/dashboard/hooks/use-fleet-notifications-controller";
import { useKanbanTaskController } from "@/features/dashboard/hooks/use-kanban-task-controller";
import { useKanbanDispatchController } from "@/features/dashboard/hooks/use-kanban-dispatch-controller";
import { useStatusChatInputController } from "@/features/dashboard/hooks/use-status-chat-input-controller";
import { useAgentSettingsController } from "@/features/dashboard/hooks/use-agent-settings-controller";
import { DashboardHeader } from "@/features/dashboard/views/DashboardHeader";
const kanbanClass = createStyleClass(kanbanStyles);
const fleetClass = createStyleClass(fleetStyles);
const chatClass = createStyleClass(chatStyles);
const notificationClass = createStyleClass(notificationStyles);
const vaultClass = createStyleClass(vaultStyles);
const walletClass = createStyleClass(walletStyles);
const KanbanPanel = dynamic(() => import("@/features/dashboard/views/KanbanPanel").then((mod) => mod.KanbanPanel), { ssr: false });
const SchedulerPanel = dynamic(() => import("@/features/dashboard/views/SchedulerPanel").then((mod) => mod.SchedulerPanel), { ssr: false });
const SwarmPanel = dynamic(() => import("@/features/dashboard/views/SwarmPanel").then((mod) => mod.SwarmPanel), { ssr: false });
const WalletPanel = dynamic(() => import("@/features/dashboard/views/WalletPanel").then((mod) => mod.WalletPanel), { ssr: false });
const VaultPanel = dynamic(() => import("@/features/dashboard/views/VaultPanel").then((mod) => mod.VaultPanel), { ssr: false });
const UtilityPanels = dynamic(() => import("@/features/dashboard/views/UtilityPanels").then((mod) => mod.UtilityPanels), { ssr: false });
const DashboardModals = dynamic(() => import("@/features/dashboard/views/DashboardModals").then((mod) => mod.DashboardModals), { ssr: false });
const NangoIntegrationsView = dynamic(() => import("@/features/integrations/NangoIntegrationsView"), { ssr: false });
const BRAIN_SKILL_PROVIDER_FALLBACK: BrainSkillProviderInventory[] = [
  { id: "claude", label: "Claude", home: "~/.claude", skills: [], installed: false },
  { id: "codex", label: "Codex", home: "~/.codex", skills: [], installed: false },
  { id: "hermes", label: "Hermes", home: "~/.hermes", skills: [], installed: false },
  { id: "gemini", label: "Gemini", home: "~/.gemini", skills: [], installed: false },
  { id: "openclaw", label: "OpenClaw", home: "~/.openclaw", skills: [], installed: false },
  { id: "aeon", label: "Aeon", home: "~/.aeon", skills: [], installed: false },
];

function devicesToDiscoveredMachines(devices: TailscaleDevice[]): DiscoveredMachine[] {
  return devices.map((device) => ({
    device,
    collector: "unknown",
    agents: [],
    snapshots: [],
  }));
}

function isWorkView(view: DashboardView): view is WorkView {
  return view === "kanban" || view === "scheduler" || view === "swarm" || view === "history";
}

const DASHBOARD_VIEWS = new Set<DashboardView>([
  "agents",
  "kanban",
  "scheduler",
  "swarm",
  "history",
  "wallet",
  "vault",
  "integrations",
  "maintenance",
  "memory",
  "files",
  "notifications",
  "chat",
  "more",
  "env",
  "my-apps",
  "phone",
  "aeon",
]);

function dashboardViewFromLocation(): DashboardView | null {
  if (typeof window === "undefined") return null;
  const view = new URLSearchParams(window.location.search).get("view");
  return view && DASHBOARD_VIEWS.has(view as DashboardView) ? view as DashboardView : null;
}

function initialDashboardView(): DashboardView {
  return dashboardViewFromLocation() ?? "agents";
}

const STORAGE_KEY = "hivemindos.agentProfiles.v1";
const VAULT_STORAGE_KEY = "hivemindos.sharedVault.v1";
const TRADING_BRAIN_PROMPT_START = "<!-- HivemindOS:TradingBrain:start -->";
const TRADING_BRAIN_PROMPT_END = "<!-- HivemindOS:TradingBrain:end -->";

function stripTradingBrainPrompt(prompt = "") {
  return prompt.replace(new RegExp(`\\n?${TRADING_BRAIN_PROMPT_START}[\\s\\S]*?${TRADING_BRAIN_PROMPT_END}\\n?`, "g"), "").trim();
}

function hasTradingBrainPrompt(agent: AgentProfile) {
  return (agent.skillProfilePrompt ?? "").includes(TRADING_BRAIN_PROMPT_START);
}

function tradingBrainPromptBlock(runtimeLabel: string) {
  return [
    TRADING_BRAIN_PROMPT_START,
    "## HivemindOS Trading Brain",
    "",
    `This ${runtimeLabel} runtime has access to the optional Obsidian Trading Brain module.`,
    "",
    "When the user asks for trading journal capture, trade review, edge analysis, market-context review, pattern alerts, emotional performance correlation, or pre-trade historical context:",
    "- Use `TRADING-BRAIN/system/runtime-instructions.md` as the runtime-agnostic operating contract.",
    "- Use `TRADING-BRAIN/system/AGENTS.md`, `edge-definition.md`, and `rules.md` for local safety and strategy context.",
    "- Read/write only local markdown under `TRADING-BRAIN/` unless the user explicitly asks for a different path.",
    "- Never place trades, sign transactions, move funds, or present output as financial advice.",
    TRADING_BRAIN_PROMPT_END,
  ].join("\n");
}

function withTradingBrainPrompt(agent: AgentProfile) {
  const base = stripTradingBrainPrompt(agent.skillProfilePrompt ?? "");
  const label = RUNTIME_LABELS[agent.runtime] ?? agent.runtime;
  return [base, tradingBrainPromptBlock(label)].filter(Boolean).join("\n\n");
}

function runtimeCardIdForAgent(agent: AgentProfile) {
  return agent.runtime;
}

function isCodexBackedAgent(agent: AgentProfile) {
  return agent.runtimeCapabilities?.codexRuntime || /codex/i.test(`${agent.provider ?? ""} ${agent.model ?? ""} ${agent.name ?? ""}`);
}

function agentMirrorKey(agent: AgentProfile) {
  return [
    agent.runtime,
    agent.agentId || agent.id || agent.name,
    agent.runtime === "aeon" ? agent.aeonLocalPath || agent.localDataDir || agent.aeonRepo || "" : "",
  ].join("|").toLowerCase();
}

function mergeAgentProfiles(current: AgentProfile[], incoming: AgentProfile[]) {
  const merged = new Map<string, AgentProfile>();
  for (const agent of current) merged.set(agent.id || agentMirrorKey(agent), agent);
  for (const agent of incoming) {
    const directKey = agent.id && merged.has(agent.id) ? agent.id : "";
    const mirrorKey = [...merged.entries()].find(([, existing]) => agentMirrorKey(existing) === agentMirrorKey(agent))?.[0];
    const key = directKey || mirrorKey || agent.id || agentMirrorKey(agent);
    merged.set(key, normalizeAgentProfile({ ...(merged.get(key) ?? {}), ...agent }));
  }
  return [...merged.values()];
}

function readActiveChatRuns(): Record<string, ActiveChatRunRecord> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACTIVE_CHAT_RUNS_STORAGE_KEY) || "{}") as Record<string, ActiveChatRunRecord>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const now = Date.now();
    return Object.fromEntries(Object.entries(parsed)
      .filter(([storageKey, run]) => (
        typeof storageKey === "string"
        && typeof run?.agentId === "string"
        && typeof run?.leafKey === "string"
        && typeof run?.startedAt === "number"
        && now - run.updatedAt < ACTIVE_CHAT_RUN_TTL_MS
      )));
  } catch {
    return {};
  }
}

function writeActiveChatRuns(runs: Record<string, ActiveChatRunRecord>) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const compact = Object.fromEntries(Object.entries(runs)
    .filter(([, run]) => now - run.updatedAt < ACTIVE_CHAT_RUN_TTL_MS));
  if (Object.keys(compact).length) window.localStorage.setItem(ACTIVE_CHAT_RUNS_STORAGE_KEY, JSON.stringify(compact));
  else window.localStorage.removeItem(ACTIVE_CHAT_RUNS_STORAGE_KEY);
}

function chatTranscriptHasAssistantReply(messages: ChatMessage[] | undefined) {
  const lastMeaningful = [...(messages ?? [])].reverse().find((message) => (
    message.role === "user"
    || message.role === "assistant"
    || Boolean(message.content?.trim())
    || Boolean(message.agentPrompt)
  ));
  return lastMeaningful?.role === "assistant" && Boolean(lastMeaningful.content?.trim() || lastMeaningful.agentPrompt);
}

function chatProcessFromSessionMessage(message: ChatMessage | { role?: string; content?: string }) {
  const role = String(message?.role ?? "").trim().toLowerCase();
  const content = String(message?.content ?? "").trim();
  if (!content || role === "user") return null;
  const detail = content.replace(/\s+/g, " ").slice(0, 180);
  if (role === "assistant") return { label: "Assistant wrote in session", detail };
  if (role === "tool") {
    if (/\[Command interrupted\]/i.test(content)) return { label: "Command interrupted" };
    if (/Tool execution skipped/i.test(content)) return { label: "Tool execution skipped", detail };
    if (/\bexit\s+\d+\b/i.test(content)) return { label: "Command finished", detail };
    if (/Image loaded into your context/i.test(content)) return { label: "Image inspected", detail };
    if (/^\s*\d+\|/m.test(content)) return { label: "File content read", detail };
    if (/^---\s*\nname:/i.test(content)) return { label: "Skill context loaded", detail: content.match(/^name:\s*(.+)$/mi)?.[1] ?? detail };
    return { label: "Tool output", detail };
  }
  return { label: `${role || "Session"} message`, detail };
}

function runtimeSessionMessages(session: unknown): ChatMessage[] {
  const messages = Array.isArray((session as { messages?: unknown[] } | null)?.messages)
    ? (session as { messages: unknown[] }).messages
    : [];
  const sessionId = String((session as { sessionId?: string; id?: string } | null)?.sessionId ?? (session as { id?: string } | null)?.id ?? "");
  return messages
    .filter((message): message is { role?: string; content?: string; createdAt?: number; index?: number } => (
      typeof message === "object"
      && message !== null
      && typeof (message as { content?: unknown }).content === "string"
    ))
    .map((message) => ({
      role: message.role === "assistant" || message.role === "system" || message.role === "user" ? message.role : "system",
      content: message.content ?? "",
      createdAt: typeof message.createdAt === "number" ? message.createdAt : undefined,
      sourceSessionId: sessionId || undefined,
      sourceIndex: typeof message.index === "number" ? message.index : undefined,
      surface: message.role === "assistant" || message.role === "user" ? "chat" : undefined,
    }));
}
const TASK_STORAGE_KEY = "hivemindos.agentTasks.v1";
const SCHEDULE_STORAGE_KEY = "hivemindos.agentSchedules.v1";
const WALLET_STORAGE_KEY = "hivemindos.agentWallets.v1";
const HONEY_LEDGER_ENABLED_STORAGE_KEY = "hivemindos.honeyLedger.enabled.v1";
const THEME_STORAGE_KEY = "hivemindos.theme.v1";
const CHAT_MESSAGES_STORAGE_KEY = "hivemindos.chatMessages.v1";
const ACTIVE_CHAT_RUNS_STORAGE_KEY = "hivemindos.activeChatRuns.v1";
const CHAT_FOLDER_STORAGE_KEY = "hivemindos.chatFolders.v1";
const MACHINE_NAME_ALIAS_STORAGE_KEY = "hivemindos.machineNameAliases.v1";
const FLEET_SNAPSHOTS_STORAGE_KEY = "hivemindos.fleetSnapshots.v1";
const CHAT_RESPONSE_STALL_TIMEOUT_MS = 130 * 1000;
const DISCOVERED_MACHINES_STORAGE_KEY = "hivemindos.discoveredMachines.v1";
const KANBAN_TOOL_OUTPUT_STALL_MS = 5 * 60 * 1000;
const KANBAN_NO_ASSISTANT_STALL_MS = 2 * 60 * 1000;
const KANBAN_NO_ASSISTANT_QUIET_MS = 90 * 1000;
const KANBAN_DISPATCH_NO_PROGRESS_MS = 75 * 1000;
const KANBAN_SESSION_POLL_FAILURE_LIMIT = 3;
const KANBAN_STALE_AGENT_COOLDOWN_MS = 20 * 60 * 1000;
const KANBAN_PICKUP_PREVIEW_MS = 1_000;
const SCHEDULER_RUN_STALE_MS = 30_000;
const BRAIN_GRAPH_CLIENT_CACHE_MS = 30_000;
const QUIET_SNAPSHOT_HOLD_MS = 15 * 60 * 1000;
const ACTIVE_CHAT_RUN_TTL_MS = 20 * 60 * 1000;
const STORAGE_SUFFIXES = {
  agents: ".agentProfiles.v1",
  vault: ".sharedVault.v1",
  tasks: ".agentTasks.v1",
  schedules: ".agentSchedules.v1",
  wallets: ".agentWallets.v1",
  honeyLedgerEnabled: ".honeyLedger.enabled.v1",
  theme: ".theme.v1",
  chatMessages: ".chatMessages.v1",
  chatFolders: ".chatFolders.v1",
  machineNameAliases: ".machineNameAliases.v1",
  fleetSnapshots: ".fleetSnapshots.v1",
};

type ActiveChatRunRecord = {
  storageKey: string;
  agentId: string;
  leafKey: string;
  startedAt: number;
  updatedAt: number;
  requestLabel?: string;
  sessionId?: string;
  status?: "active" | "stalled";
};
type DashboardAppProps = {
  initialView?: DashboardView;
  initialVaultPanelMode?: DashboardVaultPanelMode;
  initialWorkHistory?: WorkHistoryPayload;
};

export type DashboardVaultPanelMode = "hive-vault" | "shared-skills" | "brain-services" | "config";

export default function DashboardApp({ initialView, initialVaultPanelMode, initialWorkHistory }: DashboardAppProps = {}) {
  // Initialize all persisted state with deterministic seed values so SSR and
  // first client render match. localStorage is read inside a useEffect below.
  const [hydrated, setHydrated] = useState(false);
  const [agents, setAgents] = useState<AgentProfile[]>(seedAgents);
  const agentVaultHydratedRef = useRef(false);
  const aeonProfilePruneKeyRef = useRef("");
  const [selectedAgentId, setSelectedAgentId] = useState(() => seedAgents()[0]?.id ?? "");
  const [walletExpanded, setWalletExpanded] = useState(false);
  const [text, setText] = useState("");
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [chatDirectories, setChatDirectories] = useState<LinkedDirectory[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [recentDirectories, setRecentDirectories] = useState<RecentDirectory[]>([]);
  const [recentDirectoriesExpanded, setRecentDirectoriesExpanded] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceTarget, setVoiceTarget] = useState<"chat" | "kanban-steer" | KanbanStatus>("chat");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceBands, setVoiceBands] = useState<number[]>(() => Array(18).fill(0));
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [statusAgentId, setStatusAgentId] = useState("");
  const [vaultStatus, setVaultStatus] = useState<Record<string, unknown> | null>(null);
  const [controlRoomStatus, setControlRoomStatus] = useState<Record<string, unknown> | null>(null);
  const [vaultSyncStatus, setVaultSyncStatus] = useState<VaultSyncStatus | null>(null);
  const [vaultSyncPending, setVaultSyncPending] = useState("");
  const [sharedVault, setSharedVault] = useState<SharedVaultConfig>(DEFAULT_SHARED_VAULT);
  const [brainGraph, setBrainGraph] = useState<BrainGraph | null>(null);
  const [brainGraphStatus, setBrainGraphStatus] = useState("");
  const [brainGraphLoading, setBrainGraphLoading] = useState(false);
  const brainGraphLoadedAtRef = useRef(0);
  const brainGraphVaultPathRef = useRef("");
  const [selectedBrainNodeId, setSelectedBrainNodeId] = useState("");
  const [brainPan, setBrainPan] = useState({ x: 0, y: 0 });
  const [brainSkills, setBrainSkills] = useState<BrainSkillInventory | null>(null);
  const [brainSkillsStatus, setBrainSkillsStatus] = useState("");
  const [brainSkillsLoading, setBrainSkillsLoading] = useState(false);
  const [gbrainStatus, setGbrainStatus] = useState<DashboardGBrainStatus | null>(null);
  const [gbrainActionStatus, setGbrainActionStatus] = useState("");
  const [gbrainBusy, setGbrainBusy] = useState("");
  const [gbrainQuery, setGbrainQuery] = useState("");
  const [gbrainQueryResult, setGbrainQueryResult] = useState("");
  const [tradingBrainStatus, setTradingBrainStatus] = useState<DashboardTradingBrainStatus | null>(null);
  const [tradingBrainActionStatus, setTradingBrainActionStatus] = useState("");
  const [tradingBrainBusy, setTradingBrainBusy] = useState("");
  const [hermesUpdateRequiredDetail, setHermesUpdateRequiredDetail] = useState("");
  const [brainSkillImportProvider, setBrainSkillImportProvider] = useState<BrainSkillProviderId | "all" | "">("");
  const [brainSkillImportSuccess, setBrainSkillImportSuccess] = useState<BrainSkillProviderId | "all" | "">("");
  const [brainSkillAeonSyncing, setBrainSkillAeonSyncing] = useState(false);
  const [skillBrowserOpen, setSkillBrowserOpen] = useState(false);
  const [skillBrowserSkills, setSkillBrowserSkills] = useState<SkillBrowserSkill[]>([]);
  const [skillBrowserSearch, setSkillBrowserSearch] = useState("");
  const [skillBrowserStatus, setSkillBrowserStatus] = useState("");
  const [skillBrowserLoading, setSkillBrowserLoading] = useState(false);
  const [skillBrowserImporting, setSkillBrowserImporting] = useState("");
  const [skillBrowserGithubOpen, setSkillBrowserGithubOpen] = useState(false);
  const [skillBrowserGithubUrl, setSkillBrowserGithubUrl] = useState("");
  const [skillBrowserGithubInstalling, setSkillBrowserGithubInstalling] = useState(false);
  const [skillBrowserView, setSkillBrowserView] = useState<"browse" | "write">("browse");
  const [skillBrowserWrittenContent, setSkillBrowserWrittenContent] = useState("");
  const [skillBrowserWriting, setSkillBrowserWriting] = useState(false);
  const [skillBrowserMode, setSkillBrowserMode] = useState<"brain" | "agent-class">("brain");
  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, ChatMessage[]>>({});
  const lastPersistedChatMessagesRef = useRef("");
  const lastPersistedChatStatsRef = useRef("");
  const resumedRuntimeSessionKeysRef = useRef<Set<string>>(new Set());
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>({
    name: "",
    agentId: "",
    every: "360m",
    mode: "prompt",
    prompt: "",
    model: "",
    skills: [],
    paths: [],
    steps: [{ id: "draft-step-0", text: "", skills: [], paths: [], model: "" }],
    usePastRuns: false,
    pastRunLimit: 3,
  });
  const [schedulerAttachMenu, setSchedulerAttachMenu] = useState<"menu" | "skill" | "model" | "path" | null>(null);
  const [schedulerSkillSearch, setSchedulerSkillSearch] = useState("");
  const [schedulerPathDraft, setSchedulerPathDraft] = useState("");
  const [schedulerPathKind, setSchedulerPathKind] = useState<"folder" | "file" | "path">("path");
  const [schedulerSelectedStep, setSchedulerSelectedStep] = useState(0);
  const [editingScheduleId, setEditingScheduleId] = useState("");
  const [scheduleImportStatus, setScheduleImportStatus] = useState("");
  const [scheduleImporting, setScheduleImporting] = useState(false);
  const [schedulerDraftOpen, setSchedulerDraftOpen] = useState(false);
  const [schedulerRunStates, setSchedulerRunStates] = useState<Record<string, SchedulerRunState>>({});
  // AEON automations arm a skill from the AEON runtime's own inventory (the 188 shown
  // in the AEON view), not the Obsidian shared brain. The scheduler task modal's
  // shared-brain list (`sharedSkillOptions`) is the wrong source in aeon mode, so we
  // fetch the runtime skills for the AEON agent when the aeon modal opens.
  const [aeonSkillOptions, setAeonSkillOptions] = useState<Array<{ slug: string; name: string; description: string }>>([]);
  const [walletsByAgent, setWalletsByAgent] = useState<Record<string, AgentWalletConfig>>({});
  const [honeyTreasury, setHoneyTreasury] = useState<HoneyTreasuryConfig>(createDefaultHoneyTreasuryConfig);
  const [honeyLedgerEnabled, setHoneyLedgerEnabled] = useState(false);
  const [walletActionsByAgent, setWalletActionsByAgent] = useState<Record<string, WalletActionState>>({});
  const [walletPanelMode, setWalletPanelMode] = useState<"wallets" | "usage">("wallets");
  const [vaultPanelMode, setVaultPanelMode] = useState<DashboardVaultPanelMode>(initialVaultPanelMode ?? "hive-vault");
  const [moneyClawStatusByEnvName, setMoneyClawStatusByEnvName] = useState<Record<string, WalletMoneyClawStatus>>({});
  const [moneyClawLoadingEnvName, setMoneyClawLoadingEnvName] = useState("");
  const [walletVaultBackupStatus, setWalletVaultBackupStatus] = useState<WalletVaultBackupStatus | null>(null);
  const [walletVaultBackupBusy, setWalletVaultBackupBusy] = useState("");
  const [walletVaultBackupMessage, setWalletVaultBackupMessage] = useState("");
  const [runtimeUsage, setRuntimeUsage] = useState<RuntimeUsageAnalytics | null>(null);
  const [runtimeUsageLoading, setRuntimeUsageLoading] = useState(false);
  const [maintenanceReport, setMaintenanceReport] = useState<MaintenanceReport | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState("");
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [memoryTelemetry, setMemoryTelemetry] = useState<MemoryTelemetryPayload | null>(null);
  const [memoryTelemetryLoading, setMemoryTelemetryLoading] = useState(false);
  const [runtimeFileRoots, setRuntimeFileRoots] = useState<RuntimeFileRoot[]>([]);
  const [runtimeFileRootKey, setRuntimeFileRootKey] = useState("");
  const [runtimeFilePath, setRuntimeFilePath] = useState("");
  const [runtimeFiles, setRuntimeFiles] = useState<RuntimeFileEntry[]>([]);
  const [runtimeFileOpen, setRuntimeFileOpen] = useState<RuntimeFilePayload["file"] | null>(null);
  const [runtimeFileDraft, setRuntimeFileDraft] = useState("");
  const [runtimeFileStatus, setRuntimeFileStatus] = useState("");
  const [hiveEnv, setHiveEnv] = useState<HiveEnvPayload | null>(null);
  const [hiveEnvLoading, setHiveEnvLoading] = useState(false);
  const [hiveEnvRestoring, setHiveEnvRestoring] = useState(false);
  const [hiveEnvSyncing, setHiveEnvSyncing] = useState(false);
  const [hiveEnvStatus, setHiveEnvStatus] = useState("");
  const [hiveEnvSavingKey, setHiveEnvSavingKey] = useState("");
  const [hiveEnvRuntimeSourceId, setHiveEnvRuntimeSourceId] = useState("runtime-hermes");
  const [sharedEnvDraft, setSharedEnvDraft] = useState({ key: "", value: "" });
  const [sharedEnvEditable, setSharedEnvEditable] = useState(false);
  const [sharedEnvAddMenuOpen, setSharedEnvAddMenuOpen] = useState(false);
  const [sharedEnvImportOpen, setSharedEnvImportOpen] = useState(false);
  const [sharedEnvImportText, setSharedEnvImportText] = useState("");
  const [sharedEnvImporting, setSharedEnvImporting] = useState(false);
  const [agentEnvDrafts, setAgentEnvDrafts] = useState<Record<string, { key: string; value: string }>>({});
  const [revealedEnvValues, setRevealedEnvValues] = useState<Record<string, boolean>>({});
  const [fleetSnapshots, setFleetSnapshots] = useState<Record<string, AgentSnapshot>>({});
  const [fleetCheckedAt, setFleetCheckedAt] = useState<number | null>(null);
  const [fleetDiscoveryLoading, setFleetDiscoveryLoading] = useState(true);
  const [tailscaleDevices, setTailscaleDevices] = useState<TailscaleDevice[]>([]);
  const [tailscaleStatus, setTailscaleStatus] = useState("Checking Tailnet...");
  const [hivemindLinkStatus, setHivemindLinkStatus] = useState<HivemindLinkClientStatus | null>(null);
  const [hivemindLinkBannerDismissed, setHivemindLinkBannerDismissed] = useState(false);
  const [hivemindLinkConnectedUntil, setHivemindLinkConnectedUntil] = useState(0);
  const [hivemindLinkSignInPolling, setHivemindLinkSignInPolling] = useState(false);
  const [discoveredMachines, setDiscoveredMachines] = useState<DiscoveredMachine[]>([]);
  const [machineNameAliases, setMachineNameAliases] = useState<Record<string, string>>({});
  const [appVersion, setAppVersion] = useState<AppVersion | null>(null);
  const [updateStatusByMachine, setUpdateStatusByMachine] = useState<Record<string, MachineUpdateStatus>>({});
  const [copiedUpdateDetailKey, setCopiedUpdateDetailKey] = useState("");
  const [setupMachineKey, setSetupMachineKey] = useState("");
  const [machineInitOpen, setMachineInitOpen] = useState(false);
  const [machineInitDraft, setMachineInitDraft] = useState({
    projectName: "",
    serverType: "cx23",
    serverLocation: "hel1",
    serverImage: "ubuntu-24.04",
    runtimeAgent: "hermes" as AgentRuntime,
  });
  const [machineInitStatus, setMachineInitStatus] = useState<MachineInitStatus>({});
  const [machineInitCopiedKey, setMachineInitCopiedKey] = useState("");
  const [machineInitToken, setMachineInitToken] = useState("");
  const [machineInitTokenStatus, setMachineInitTokenStatus] = useState<MachineInitTokenStatus>({});
  const [agentRoleModalId, setAgentRoleModalId] = useState("");
  const [agentCreateMachineKey, setAgentCreateMachineKey] = useState("");
  const [agentSettingsPanel, setAgentSettingsPanel] = useState<"role" | "connection" | "memory" | "tools" | "calls" | "security">("role");
  const [aeonEnvKeys, setAeonEnvKeys] = useState("ANTHROPIC_API_KEY\nCLAUDE_CODE_OAUTH_TOKEN\nBANKR_LLM_KEY\nGH_GLOBAL");
  const [aeonEnvSyncStatus, setAeonEnvSyncStatus] = useState("");
  const [aeonEnvSyncing, setAeonEnvSyncing] = useState(false);
  const [agentCreateDraft, setAgentCreateDraft] = useState<{
    name: string;
    runtime: AgentRuntime;
    provider?: string;
    model?: string;
    adaptiveOpenRouter?: AdaptiveOpenRouterConfig;
    usePod?: UsePodAgentConfig;
    workerClass: BeeWorkerClass;
    customWorkerClass?: CustomWorkerClassProfile;
    customWorkerClasses: CustomWorkerClassProfile[];
    selectedCustomWorkerClassId?: string;
    skillProfilePrompt: string;
    preferredSkillSlugs: string[];
    useSharedVault: boolean;
  }>({
    name: "",
    runtime: "hermes",
    provider: "openai-codex",
    model: "",
    usePod: undefined,
    workerClass: "general",
    customWorkerClass: undefined,
    customWorkerClasses: [],
    selectedCustomWorkerClassId: undefined,
    skillProfilePrompt: beeWorkerPreset("general").taskProfile,
    preferredSkillSlugs: beeWorkerPreset("general").skillSlugs,
    useSharedVault: true,
  });
  const [agentRenameDraft, setAgentRenameDraft] = useState("");
  const [agentRenameEditing, setAgentRenameEditing] = useState(false);
  const [agentRuntimeFolderEditing, setAgentRuntimeFolderEditing] = useState(false);
  const [agentRuntimeFolderBrowsing, setAgentRuntimeFolderBrowsing] = useState(false);
  const [agentRuntimeFolderStatus, setAgentRuntimeFolderStatus] = useState("");
  const [agentRuntimeAdvancedOpen, setAgentRuntimeAdvancedOpen] = useState(false);
  const [duplicateAgentDraft, setDuplicateAgentDraft] = useState<DuplicateAgentDraft | null>(null);
  const [runtimeIntegrationStatus, setRuntimeIntegrationStatus] = useState<RuntimeIntegrationStatus | null>(null);
  const [runtimeAvailability, setRuntimeAvailability] = useState<Record<string, { installed: boolean; detail: string }>>({});
  const [runtimeModelSelectionsByRuntime, setRuntimeModelSelectionsByRuntime] = useState<Partial<Record<AgentRuntime, NonNullable<RuntimeIntegrationStatus["modelSelection"]>>>>({});
  const [runtimeIntegrationBusy, setRuntimeIntegrationBusy] = useState("");
  const [runtimeIntegrationMessage, setRuntimeIntegrationMessage] = useState("");
  const [runtimeUpdateConfirmKey, setRuntimeUpdateConfirmKey] = useState<RuntimeIntegrationKey | "">("");
  const [runtimeSetupKey, setRuntimeSetupKey] = useState<RuntimeIntegrationKey | "">("");
  const [runtimeSessionQuery, setRuntimeSessionQuery] = useState("");
  const [runtimeSessionResults, setRuntimeSessionResults] = useState<RuntimeSessionSearchResult[]>([]);
  const [runtimeBackgroundPrompt, setRuntimeBackgroundPrompt] = useState("");
  const [runtimeModelSetupMode, setRuntimeModelSetupMode] = useState<"provider" | "model" | null>(null);
  const [runtimeModelDraft, setRuntimeModelDraft] = useState({ provider: "", model: "", contextLength: "" });
  const [agentWorkerClassView, setAgentWorkerClassView] = useState<"presets" | "create">("presets");
  const [customWorkerDraft, setCustomWorkerDraft] = useState<WorkerClassDraft>(() => defaultWorkerClassDraft());
  const [customWorkerSkillSearch, setCustomWorkerSkillSearch] = useState("");
  const [customWorkerImageError, setCustomWorkerImageError] = useState("");
  const [setupCommandCopied, setSetupCommandCopied] = useState(false);
  const [kanbanBoard, setKanbanBoard] = useState<KanbanBoard | null>(null);
  const [kanbanLoading, setKanbanLoading] = useState(false);
  const [kanbanBoards, setKanbanBoards] = useState<KanbanBoardSummary[]>([]);
  const [kanbanBoardSlug, setKanbanBoardSlug] = useState("default");
  const [kanbanError, setKanbanError] = useState("");
  const [kanbanIncludeArchived, setKanbanIncludeArchived] = useState(false);
  const [kanbanTenantFilter, setKanbanTenantFilter] = useState("");
  const [kanbanAssigneeFilter, setKanbanAssigneeFilter] = useState("");
  const [kanbanSearch, setKanbanSearch] = useState("");
  const [kanbanTenants, setKanbanTenants] = useState<string[]>([]);
  const [kanbanAssignees, setKanbanAssignees] = useState<string[]>([]);
  const [kanbanStorage, setKanbanStorage] = useState<KanbanResponse["storage"] | null>(null);
  const [noteIntakeStatus, setNoteIntakeStatus] = useState("");
  const [noteIntakePreview, setNoteIntakePreview] = useState<NoteTaskCandidate[]>([]);
  const [noteIntakePending, setNoteIntakePending] = useState("");
  const [notifications, setNotifications] = useState<AgentNotification[]>([]);
  const [notificationSummary, setNotificationSummary] = useState<AgentNotificationSummary | null>(null);
  const [notificationCursor, setNotificationCursor] = useState<number | null>(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsStatus, setNotificationsStatus] = useState("");
  const [selectedKanbanTaskId, setSelectedKanbanTaskId] = useState("");
  const [kanbanTaskModal, setKanbanTaskModal] = useState<"assign" | "chat" | "edit" | "events" | "notes" | "">("");
  const [kanbanEditDraft, setKanbanEditDraft] = useState({ title: "", body: "" });
  const [kanbanEditPendingTaskId, setKanbanEditPendingTaskId] = useState("");
  const [kanbanSteerDraft, setKanbanSteerDraft] = useState("");
  const [kanbanSteerAttachments, setKanbanSteerAttachments] = useState<ChatAttachment[]>([]);
  const [kanbanSteerDirectories, setKanbanSteerDirectories] = useState<LinkedDirectory[]>([]);
  const [kanbanSteerAttachmentError, setKanbanSteerAttachmentError] = useState("");
  const [kanbanSteerAttachmentMenuOpen, setKanbanSteerAttachmentMenuOpen] = useState(false);
  const [kanbanSteerTargetStatus, setKanbanSteerTargetStatus] = useState<KanbanStatus>("working");
  const [kanbanSteerTargetMenuOpen, setKanbanSteerTargetMenuOpen] = useState(false);
  const [kanbanSteeringTaskId, setKanbanSteeringTaskId] = useState("");
  const [expandedKanbanCards, setExpandedKanbanCards] = useState<Record<string, boolean>>({});
  const [kanbanPickupPreviewByTask, setKanbanPickupPreviewByTask] = useState<Record<string, KanbanPickupPreview>>({});
  const [quickAddStatus, setQuickAddStatus] = useState<KanbanStatus | "">("");
  const [quickAddDrafts, setQuickAddDrafts] = useState<Record<string, string>>({});
  const [quickAddAttachments, setQuickAddAttachments] = useState<Record<string, ChatAttachment[]>>({});
  const [quickAddDirectories, setQuickAddDirectories] = useState<Record<string, LinkedDirectory[]>>({});
  const [quickAddMachineTargets, setQuickAddMachineTargets] = useState<Record<string, KanbanMachineTarget | null>>({});
  const [quickAddMachineMenuOpen, setQuickAddMachineMenuOpen] = useState<Record<string, boolean>>({});
  const [kanbanCardMachineMenuOpen, setKanbanCardMachineMenuOpen] = useState<Record<string, boolean>>({});
  const [kanbanCardAttachmentMenuOpen, setKanbanCardAttachmentMenuOpen] = useState<Record<string, boolean>>({});
  const [kanbanCardAttachmentListOpen, setKanbanCardAttachmentListOpen] = useState<Record<string, boolean>>({});
  const [kanbanCardDeliverableMenuOpen, setKanbanCardDeliverableMenuOpen] = useState<Record<string, boolean>>({});
  const [kanbanCardAttachmentTargetId, setKanbanCardAttachmentTargetId] = useState("");
  const [quickAddAttachmentError, setQuickAddAttachmentError] = useState("");
  const [quickAddAttachmentMenuOpen, setQuickAddAttachmentMenuOpen] = useState(false);
  const [kanbanCardRecentsExpanded, setKanbanCardRecentsExpanded] = useState<Record<string, boolean>>({});
  const [selectedKanbanTaskIds, setSelectedKanbanTaskIds] = useState<Record<string, boolean>>({});
  const [kanbanBulkAssignee, setKanbanBulkAssignee] = useState("");
  const [kanbanBulkPending, setKanbanBulkPending] = useState(false);
  const [machineDirectoryBrowser, setMachineDirectoryBrowser] = useState<MachineDirectoryBrowser | null>(null);
  const [kanbanBoardScrollState, setKanbanBoardScrollState] = useState({ canScrollLeft: false, canScrollRight: false });
  const [newBoardDraft, setNewBoardDraft] = useState({ slug: "", name: "" });
  const [commentDraft, setCommentDraft] = useState("");
  const [mirosharkStatus, setMirosharkStatus] = useState<MiroSharkStatus | null>(null);
  const [mirosharkActionPending, setMirosharkActionPending] = useState("");
  const [mirosharkRun, setMirosharkRun] = useState<MiroSharkRunResult | null>(null);
  const [mirosharkRunPending, setMirosharkRunPending] = useState(false);
  const [mirosharkScenario, setMirosharkScenario] = useState("Nom launches a neighborhood food-sharing app. Local cooks, restaurants, parents, and city health officials debate safety, affordability, trust, and regulation.");
  const [mirosharkRounds, setMirosharkRounds] = useState(5);
  const [mirosharkPlatform, setMirosharkPlatform] = useState<"twitter" | "reddit" | "parallel" | "polymarket">("twitter");
  const [mirosharkArchiveRuns, setMirosharkArchiveRuns] = useState<MiroSharkArchivedRun[]>([]);
  const [mirosharkArchiveStatus, setMirosharkArchiveStatus] = useState("");
  const [mirosharkArchiveLoading, setMirosharkArchiveLoading] = useState(false);
  const [selectedMirosharkRunId, setSelectedMirosharkRunId] = useState("");
  const [mirosharkMetadata, setMirosharkMetadata] = useState<MiroSharkMetadata | null>(null);
  const [mirosharkWorkspaceMode, setMirosharkWorkspaceMode] = useState<MiroSharkWorkspaceMode>("new");
  const [mirosharkWorkbenchTab, setMirosharkWorkbenchTab] = useState<MiroSharkWorkbenchTab>("surface");
  const [mirosharkSurfaceView, setMirosharkSurfaceView] = useState<MiroSharkSurfaceView>("x");
  const [mirosharkSelectedTemplateId, setMirosharkSelectedTemplateId] = useState("");
  const [mirosharkTemplateInputs, setMirosharkTemplateInputs] = useState<MiroSharkTemplateInputState>({});
  const [mirosharkExperimentEvent, setMirosharkExperimentEvent] = useState("A city health official issues a public warning and demands proof of food handling compliance.");
  const [mirosharkExperimentStatus, setMirosharkExperimentStatus] = useState("");
  const [mirosharkExperimentPending, setMirosharkExperimentPending] = useState("");
  const [mirosharkAnalysisAgentId, setMirosharkAnalysisAgentId] = useState("");
  const [mirosharkAnalysisPending, setMirosharkAnalysisPending] = useState<MiroSharkAnalysisMode | "">("");
  const [mirosharkAnalysisStatus, setMirosharkAnalysisStatus] = useState("");
  const [mirosharkAnalysisResult, setMirosharkAnalysisResult] = useState<{
    message?: string;
    notePath?: string;
    intelligence?: MiroSharkIntelligence;
  } | null>(null);
  const [mirosharkHelperPending, setMirosharkHelperPending] = useState<"ask" | "suggest" | "">("");
  const [mirosharkHelperStatus, setMirosharkHelperStatus] = useState("");
  const [activeView, setActiveView] = useState<DashboardView>(initialView ?? initialDashboardView);
  const [dashboardTheme, setDashboardTheme] = useState<DashboardTheme>("dark");
  const [chatStreamingByKey, setChatStreamingByKey] = useState<Record<string, { agentId: string; leafKey: string; hasChunk: boolean }>>({});
  const [chatProcessByKey, setChatProcessByKey] = useState<Record<string, Array<{ at: number; label: string; detail?: string }>>>({});
  const [chatRuntimeSessionIdsByKey, setChatRuntimeSessionIdsByKey] = useState<Record<string, string>>({});
  const activeChatStreams = Object.values(chatStreamingByKey);
  const busyAgentId = activeChatStreams[0]?.agentId ?? "";
  const [chatMessageWindow, setChatMessageWindow] = useState<{ agentId: string; limit: number } | null>(null);
  const [selectedChatLeafKey, setSelectedChatLeafKey] = useState("");
  const [selectedChatRuntimeSessionId, setSelectedChatRuntimeSessionId] = useState("");
  const selectedChatTargetRef = useRef({ agentId: selectedAgentId, leafKey: "" });
  const [selectedChatPreview, setSelectedChatPreview] = useState<{ agentId: string; leafKey: string; messages: ChatMessage[] } | null>(null);
  const [expandedChatFolders, setExpandedChatFolders] = useState<Set<string>>(() => new Set());
  const [chatContextMenu, setChatContextMenu] = useState<"machine" | "directory" | "">("");
  const [chatCustomFolders, setChatCustomFolders] = useState<ChatCustomFolder[]>([]);
  const [selectedChatDirectoryPath, setSelectedChatDirectoryPath] = useState("");
  const [chatFolderDraft, setChatFolderDraft] = useState({
    machineKey: "",
    parentPath: "",
    name: "",
    busy: false,
    error: "",
  });
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const chatAutoScrollRef = useRef(true);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const chatImageInputRef = useRef<HTMLInputElement | null>(null);
  const quickAddFileInputRef = useRef<HTMLInputElement | null>(null);
  const quickAddImageInputRef = useRef<HTMLInputElement | null>(null);
  const kanbanCardFileInputRef = useRef<HTMLInputElement | null>(null);
  const kanbanCardImageInputRef = useRef<HTMLInputElement | null>(null);
  const kanbanSteerFileInputRef = useRef<HTMLInputElement | null>(null);
  const kanbanSteerImageInputRef = useRef<HTMLInputElement | null>(null);
  const customWorkerImageInputRef = useRef<HTMLInputElement | null>(null);
  const kanbanBoardScrollRef = useRef<HTMLDivElement | null>(null);
  const quickAddAttachmentMenuRef = useRef<HTMLDivElement | null>(null);
  const quickAddMachineMenuRef = useRef<HTMLDivElement | null>(null);
  const kanbanSteerAttachmentMenuRef = useRef<HTMLDivElement | null>(null);
  const kanbanSteerTargetMenuRef = useRef<HTMLDivElement | null>(null);
  const attachmentMenuRef = useRef<HTMLDivElement | null>(null);
  const chatContextMenuRef = useRef<HTMLDivElement | null>(null);
  const hivemindLinkStatusRef = useRef<HivemindLinkClientStatus | null>(null);
  const hivemindLinkConnectedTimeoutRef = useRef<number | null>(null);
  const hivemindLinkSignInPollingRef = useRef(false);
  const chatHistoryRefreshKeyRef = useRef("");
  const voiceRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceAnimationRef = useRef<number | null>(null);
  const voiceTranscriptRef = useRef("");
  const notificationCursorRef = useRef<number | null>(0);
  const notificationCountRef = useRef(0);
  const mirosharkArchiveSaveKeyRef = useRef("");
  const noteIntakeAutoInFlightRef = useRef(false);
  const kanbanReadyPickupAttemptRef = useRef<Map<string, string>>(new Map());
  const kanbanReadyPickupInFlightRef = useRef<Set<string>>(new Set());
  const kanbanDispatchCooldownRef = useRef<Map<string, number>>(new Map());
  const kanbanStaleRequeueAttemptRef = useRef<Set<string>>(new Set());
  const kanbanSessionPollRef = useRef<Map<string, number>>(new Map());
  const kanbanSessionPollFailureRef = useRef<Map<string, number>>(new Map());
  const kanbanRuntimeAbortRef = useRef<Map<string, AbortController>>(new Map());
  const syncthingAutoPairRef = useRef<Set<string>>(new Set());
  const brainDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    moved: boolean;
    nodeId: string;
  } | null>(null);
  const brainDragMovedRef = useRef(false);
  const applyHivemindLinkStatus = useCallback((status: HivemindLinkClientStatus | null) => {
    const previous = hivemindLinkStatusRef.current;
    const reachedRunning = status?.ok === true && previous?.ok !== true;
    const wasWaitingForSignIn = Boolean(previous?.authUrl) || hivemindLinkSignInPollingRef.current;
    hivemindLinkStatusRef.current = status;
    setHivemindLinkStatus(status);
    if (status) {
      setTailscaleStatus(status.ok
        ? "Hivemind Link connected"
        : `Hivemind Link ${status.backendState ?? "not connected"}`);
    }
    if (status?.ok === true) {
      hivemindLinkSignInPollingRef.current = false;
      setHivemindLinkSignInPolling(false);
    }
    if (reachedRunning && wasWaitingForSignIn) {
      setHivemindLinkBannerDismissed(false);
      setHivemindLinkConnectedUntil(Date.now() + 10_000);
      if (hivemindLinkConnectedTimeoutRef.current) {
        window.clearTimeout(hivemindLinkConnectedTimeoutRef.current);
      }
      hivemindLinkConnectedTimeoutRef.current = window.setTimeout(() => {
        setHivemindLinkConnectedUntil(0);
      }, 10_000);
    }
  }, []);
  const refreshTailscaleDevices = useCallback(async () => {
    const response = await fetch("/api/tailscale/devices", { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      backendState?: string;
      authUrl?: string;
      source?: string;
      tailnetHealth?: {
        state?: "ok" | "peer-traffic-stalled" | "status-unavailable" | "not-running";
        detail?: string;
      };
      devices?: TailscaleDevice[];
      error?: string;
    } | null;
    const devices = data?.devices ?? [];
    const localOnlyStatusFallback = data?.tailnetHealth?.state === "status-unavailable"
      && devices.length <= 1
      && devices.every((device) => device.self || device.ip === "127.0.0.1");
    if (!localOnlyStatusFallback) {
      setTailscaleDevices(devices);
    }
    if (devices.length > 0 && !localOnlyStatusFallback) {
      setDiscoveredMachines((current) => mergeDiscoveredMachines(current, devicesToDiscoveredMachines(devices)));
      setFleetDiscoveryLoading(false);
    }
    if (data?.source === "hivemind-link") {
      applyHivemindLinkStatus({
        ok: data.ok,
        backendState: data.backendState,
        authUrl: data.authUrl,
        source: data.source,
      });
      if (data.tailnetHealth?.state === "peer-traffic-stalled") {
        setTailscaleStatus("Hivemind Link connected; Tailscale peer traffic stalled");
      }
      return;
    }
    applyHivemindLinkStatus(null);
    if (data?.tailnetHealth?.state === "peer-traffic-stalled") {
      setTailscaleStatus("Tailscale Running; peer traffic stalled");
    } else if (data?.tailnetHealth?.state === "status-unavailable") {
      setTailscaleStatus("Tailscale status unavailable. Running locally.");
    } else if (data?.tailnetHealth?.state === "not-running") {
      setTailscaleStatus(`Tailscale ${data.backendState ?? "not running"}`);
    } else {
      setTailscaleStatus(data?.ok ? `Tailscale ${data.backendState}` : "Tailscale not configured. Running locally.");
    }
  }, [applyHivemindLinkStatus]);
  const refreshHoneyLedgerRef = useRef(null);
  const refreshMoneyClawStatusRef = useRef(null);
  const observeHoneyUsageRef = useRef(null);
  const refreshRuntimeIntegrationsRef = useRef(null);
  const refreshSharedSchedulesFromVaultRef = useRef(null);
  const schedulerVaultAutoSyncKeyRef = useRef("");
  const importExistingSchedulesRef = useRef(null);
  const schedulerRuntimeAutoImportKeyRef = useRef("");
  const updateAgentProfileRef = useRef(null);
  const dispatchKanbanTaskToAgentRef = useRef(null);
  const refreshHoneyLedger = useCallback((...args: any[]) => refreshHoneyLedgerRef.current?.(...args) ?? Promise.resolve(undefined), []);
  const refreshMoneyClawStatus = useCallback((...args: any[]) => refreshMoneyClawStatusRef.current?.(...args) ?? Promise.resolve(undefined), []);
  const observeHoneyUsage = useCallback((...args: any[]) => observeHoneyUsageRef.current?.(...args) ?? Promise.resolve(undefined), []);
  const refreshRuntimeIntegrations = useCallback((...args: any[]) => refreshRuntimeIntegrationsRef.current?.(...args) ?? Promise.resolve(undefined), []);
  const refreshSharedSchedulesFromVault = useCallback((...args: any[]) => refreshSharedSchedulesFromVaultRef.current?.(...args) ?? Promise.resolve(undefined), []);
  const updateAgentProfile = useCallback((...args: any[]) => updateAgentProfileRef.current?.(...args), []);
  const refreshHiveEnv = useCallback(async () => {
    setHiveEnvLoading(true);
    setHiveEnvStatus("");
    try {
      const response = await fetch("/api/env", { cache: "no-store" }).catch(() => null);
      const data = await response?.json().catch(() => null) as HiveEnvPayload | null;
      if (!response?.ok || !data?.ok) {
        setHiveEnvStatus(data?.error ?? "Could not read hive-env-add variables.");
        return;
      }
	      setHiveEnv(data);
	      const sharedCount = Object.keys(data.sharedSource?.values ?? {}).length;
	      const backupCopy = data.backupStatus?.backupExists ? " Encrypted backup is available." : " No encrypted backup found yet.";
	      setHiveEnvStatus(`Loaded ${sharedCount} shared env variable${sharedCount === 1 ? "" : "s"}.${backupCopy}`);
	    } finally {
	      setHiveEnvLoading(false);
	    }
	  }, []);
  const refreshMemoryTelemetry = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setMemoryTelemetryLoading(true);
    try {
      const response = await fetch("/api/memory-telemetry", { cache: "no-store" }).catch(() => null);
      const data = await response?.json().catch(() => null) as MemoryTelemetryPayload | null;
      if (response?.ok && data?.ok) setMemoryTelemetry(data);
    } finally {
      if (!options.silent) setMemoryTelemetryLoading(false);
    }
  }, []);
  useVisibilityAwarePolling({
    enabled: hydrated,
    intervalMs: activeView === "memory" ? 15_000 : 60_000,
    hiddenIntervalMs: 5 * 60_000,
    task: () => refreshMemoryTelemetry({ silent: true }),
  });
  const toggleEnvValue = useCallback((key: string) => {
    setRevealedEnvValues((current) => ({ ...current, [key]: !current[key] }));
  }, []);
  const saveSharedEnvValue = useCallback(async (source: HiveEnvSource, key: string, value: string, previousValue: string) => {
    if (value === previousValue) return;
    const savingKey = `shared:${source.id}:${key}`;
    setHiveEnvSavingKey(savingKey);
    setHiveEnvStatus(`Saving ${key}...`);
    try {
      const response = await fetch("/api/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, key, value }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as HiveEnvPayload | null;
      if (!response?.ok || !data?.ok || !data.sharedSource) {
        setHiveEnvStatus(data?.error ?? `Could not save ${key}.`);
        return;
      }
	      setHiveEnv(data);
	      setHiveEnvStatus(value === "" ? `Removed ${key} with hive-env-add.` : `Saved ${key} with hive-env-add.`);
	    } finally {
	      setHiveEnvSavingKey("");
	    }
	  }, []);
  const saveAgentEnvValue = useCallback((agent: AgentProfile, key: string, value: string, previousValue: string) => {
    if (value === previousValue) return;
    const nextEnv = { ...(agent.agentEnv ?? {}) };
    if (value === "") delete nextEnv[key];
    else nextEnv[key] = value;
    updateAgentProfile(agent.id, {
      agentEnv: nextEnv,
    });
    setHiveEnvStatus(value === "" ? `Removed ${key} for ${agent.name}.` : `Saved ${key} for ${agent.name}.`);
  }, []);
	  const addSharedEnvValue = useCallback(async () => {
	    const key = sharedEnvDraft.key.trim();
	    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      setHiveEnvStatus("Use a valid env name like ANTHROPIC_API_KEY.");
      return;
    }
    await saveSharedEnvValue(hiveEnv?.sharedSource ?? {
      id: "shared",
      label: "Shared sync store",
      scope: "agent",
      runtime: "generic",
      values: {},
    }, key, sharedEnvDraft.value, "");
	    setSharedEnvDraft({ key: "", value: "" });
	  }, [hiveEnv?.sharedSource, saveSharedEnvValue, sharedEnvDraft.key, sharedEnvDraft.value]);
	  const generateSharedEnvSecret = useCallback(() => {
	    setSharedEnvDraft((current) => ({ ...current, value: randomEnvSecret() }));
	    setSharedEnvEditable(true);
	    setSharedEnvAddMenuOpen(false);
	    setHiveEnvStatus("Generated a secret value. Add a key name, then set it.");
	  }, []);
	  const importSharedEnvEntries = useCallback(async () => {
	    const entries = parseEnvImportText(sharedEnvImportText, hiveEnv?.sharedSource?.values ?? {}).entries.filter((entry) => entry.status !== "same");
	    if (!entries.length) {
	      setHiveEnvStatus("No new or changed env variables found.");
	      return;
	    }
	    setSharedEnvImporting(true);
	    setHiveEnvStatus(`Importing ${entries.length} env variable${entries.length === 1 ? "" : "s"}...`);
	    try {
	      const response = await fetch("/api/env", {
	        method: "POST",
	        headers: { "Content-Type": "application/json" },
	        body: JSON.stringify({
	          sourceId: hiveEnv?.sharedSource?.id ?? "shared",
	          entries: Object.fromEntries(entries.map((entry) => [entry.key, entry.value])),
	        }),
	      }).catch(() => null);
	      const data = await response?.json().catch(() => null) as HiveEnvPayload | null;
	      if (!response?.ok || !data?.ok || !data.sharedSource) {
	        setHiveEnvStatus(data?.error ?? "Could not import env variables.");
	        return;
	      }
	      setHiveEnv(data);
	      setSharedEnvImportText("");
	      setSharedEnvImportOpen(false);
	      setSharedEnvEditable(false);
	      setHiveEnvStatus(`Imported ${entries.length} env variable${entries.length === 1 ? "" : "s"} with hive-env-add.`);
	    } finally {
	      setSharedEnvImporting(false);
	    }
	  }, [hiveEnv?.sharedSource?.id, hiveEnv?.sharedSource?.values, sharedEnvImportText]);
  const promoteRuntimeEnvValue = useCallback(async (source: HiveEnvSource, key: string, value: string) => {
    const savingKey = `promote:${source.id}:${key}`;
    setHiveEnvSavingKey(savingKey);
    setHiveEnvStatus(`Adding ${key} to shared env...`);
    try {
      const response = await fetch("/api/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, key, value, promoteToShared: true }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as HiveEnvPayload | null;
      if (!response?.ok || !data?.ok || !data.sharedSource) {
        setHiveEnvStatus(data?.error ?? `Could not add ${key} to shared env.`);
        return;
      }
	      setHiveEnv(data);
	      setHiveEnvStatus(`Added ${key} to shared env with hive-env-add.`);
	    } finally {
	      setHiveEnvSavingKey("");
	    }
	  }, []);
	  const restoreSharedEnvBackup = useCallback(async () => {
	    setHiveEnvRestoring(true);
	    setHiveEnvStatus("Restoring encrypted shared env backup...");
	    try {
	      const response = await fetch("/api/env", {
	        method: "POST",
	        headers: { "Content-Type": "application/json" },
	        body: JSON.stringify({ action: "restoreBackup" }),
	      }).catch(() => null);
	      const data = await response?.json().catch(() => null) as HiveEnvPayload | null;
	      if (!response?.ok || !data?.ok || !data.sharedSource) {
	        setHiveEnvStatus(data?.error ?? "Could not restore encrypted shared env backup.");
	        return;
	      }
	      setHiveEnv(data);
	      const sharedCount = Object.keys(data.sharedSource.values ?? {}).length;
	      setHiveEnvStatus(`Restored ${sharedCount} shared env variable${sharedCount === 1 ? "" : "s"} from encrypted backup with hive-env-add.`);
	    } finally {
	      setHiveEnvRestoring(false);
	    }
	  }, []);
	  const syncSharedEnvMachines = useCallback(async () => {
	    setHiveEnvSyncing(true);
	    setHiveEnvStatus("Syncing shared env with machines...");
	    try {
	      const response = await fetch("/api/env", {
	        method: "POST",
	        headers: { "Content-Type": "application/json" },
	        body: JSON.stringify({ action: "syncMachines" }),
	      }).catch(() => null);
	      const data = await response?.json().catch(() => null) as HiveEnvPayload | null;
	      if (!response?.ok || !data?.ok || !data.sharedSource) {
	        setHiveEnvStatus(data?.error ?? "Could not sync shared env with machines.");
	        return;
	      }
	      setHiveEnv(data);
	      const sharedCount = Object.keys(data.sharedSource.values ?? {}).length;
	      setHiveEnvStatus(`Synced ${sharedCount} shared env variable${sharedCount === 1 ? "" : "s"} with machines.`);
	    } finally {
	      setHiveEnvSyncing(false);
	    }
	  }, []);
  const addAgentEnvValue = useCallback((agent: AgentProfile) => {
    const draft = agentEnvDrafts[agent.id] ?? { key: "", value: "" };
    const key = draft.key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      setHiveEnvStatus("Use a valid agent env name like WRITER_STYLE.");
      return;
    }
    updateAgentProfile(agent.id, {
      agentEnv: {
        ...(agent.agentEnv ?? {}),
        [key]: draft.value,
      },
    });
    setAgentEnvDrafts((current) => ({ ...current, [agent.id]: { key: "", value: "" } }));
    setHiveEnvStatus(`Added ${key} for ${agent.name}.`);
  }, [agentEnvDrafts]);
  // Hydrate persisted state on the client after the first render. Reading
  // localStorage inside useState init would diverge from SSR and trigger
  // a hydration mismatch — this is the canonical pattern to avoid it,
  // even though the lint rule flags setState-in-effect in general.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const storedAgents = parseStoredAgents();
    setAgents(storedAgents);
    setSelectedAgentId((current: string) => (
      storedAgents.some((agent) => agent.id === current) ? current : storedAgents[0]?.id ?? current
    ));
    setSharedVault(parseStoredVault());
    setTasks(parseStoredTasks());
    setSchedules(parseStoredSchedules());
    setWalletsByAgent(parseStoredWallets());
    const storedChatMessages = parseStoredChatMessages();
    setMessagesByAgent(storedChatMessages);
    const storedChatStats = chatMessagesStorageStats(storedChatMessages);
    lastPersistedChatStatsRef.current = `${storedChatStats.agentCount}:${storedChatStats.messageCount}`;
    logClientTelemetry("chat.messages.hydrated", storedChatStats);
    const activeRuns = Object.fromEntries(Object.entries(readActiveChatRuns())
      .filter(([storageKey]) => !chatTranscriptHasAssistantReply(storedChatMessages[storageKey])));
    writeActiveChatRuns(activeRuns);
    if (Object.keys(activeRuns).length) {
      setChatStreamingByKey(Object.fromEntries(Object.entries(activeRuns).map(([storageKey, run]) => [
        storageKey,
        { agentId: run.agentId, leafKey: run.leafKey, hasChunk: false },
      ])));
      setChatProcessByKey(Object.fromEntries(Object.entries(activeRuns).map(([storageKey, run]) => [
        storageKey,
        [
          { at: run.startedAt, label: "Queued chat request", detail: run.requestLabel },
          { at: Date.now(), label: "Resumed after reload", detail: "Checking the runtime session for activity." },
        ].filter((entry) => entry.detail !== ""),
      ])));
      setChatRuntimeSessionIdsByKey(Object.fromEntries(Object.entries(activeRuns)
        .filter(([, run]) => Boolean(run.sessionId))
        .map(([storageKey, run]) => [storageKey, run.sessionId])));
    }
    setHoneyLedgerEnabled(parseStoredHoneyLedgerEnabled());
    setHoneyTreasury(parseStoredHoneyTreasury());
    setChatCustomFolders(parseStoredChatFolders());
    setDiscoveredMachines(parseStoredDiscoveredMachines());
    setFleetSnapshots(parseStoredFleetSnapshots());
    setMachineNameAliases(parseStoredMachineNameAliases());
    const storedTheme = readStoredValue(THEME_STORAGE_KEY, STORAGE_SUFFIXES.theme);
    setDashboardTheme(storedTheme === "hive-light" ? "hive-light" : "dark");
    setHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useVisibilityAwarePolling({
    enabled: hydrated && honeyLedgerEnabled,
    intervalMs: activeView === "wallet" ? 60_000 : 120_000,
    hiddenIntervalMs: 5 * 60_000,
    task: () => observeHoneyUsage(),
  });
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(HONEY_LEDGER_ENABLED_STORAGE_KEY, honeyLedgerEnabled ? "true" : "false");
  }, [honeyLedgerEnabled, hydrated]);
  useEffect(() => {
    document.documentElement.dataset.theme = dashboardTheme;
    if (!hydrated) return;
    window.localStorage.setItem(THEME_STORAGE_KEY, dashboardTheme);
  }, [dashboardTheme, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
  }, [hydrated, agents]);
  useEffect(() => {
    if (!hydrated || !sharedVault.enabled || agentVaultHydratedRef.current) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/obsidian/agents?vaultPath=${encodeURIComponent(sharedVault.vaultPath || "")}`, { cache: "no-store" }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; agents?: AgentProfile[] } | null;
      if (cancelled) return;
      if (response?.ok && data?.ok && Array.isArray(data.agents) && data.agents.length) {
        setAgents((current) => mergeAgentProfiles(current, data.agents ?? []));
      }
      agentVaultHydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, sharedVault.enabled, sharedVault.vaultPath]);
  useEffect(() => {
    if (!hydrated || !sharedVault.enabled || !agentVaultHydratedRef.current) return;
    const aeonAgents = [
      ...agents,
      ...discoveredMachines.flatMap((machine) => machine.agents ?? []).map(normalizeAgentProfile),
    ].filter((agent, index, list) => agent.runtime === "aeon" && list.findIndex((candidate) => candidate.id === agent.id) === index);
    if (!aeonAgents.length) {
      aeonProfilePruneKeyRef.current = "";
      return;
    }
    const pruneKey = JSON.stringify(aeonAgents
      .map((agent) => [
        agent.id,
        agent.aeonRepo ?? "",
        agent.aeonLocalPath ?? "",
        agent.localDataDir ?? "",
        agent.telemetryUrl ?? "",
      ])
      .sort()) + `|${sharedVault.vaultPath}`;
    if (aeonProfilePruneKeyRef.current === pruneKey) return;
    aeonProfilePruneKeyRef.current = pruneKey;
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/runtimes/aeon/profiles/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agents: aeonAgents, vaultPath: sharedVault.vaultPath }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; stale?: Array<{ id?: string }>; recovered?: AgentProfile[] } | null;
      if (cancelled || !response?.ok || !data?.ok) return;
      const recoveredAgents = Array.isArray(data.recovered) ? data.recovered.map(normalizeAgentProfile) : [];
      const recoveredById = new Map(recoveredAgents.map((agent) => [agent.id, agent]));
      const staleIds = new Set((Array.isArray(data.stale) ? data.stale : []).map((item) => item.id).filter(Boolean));
      if (recoveredById.size) {
        setAgents((current) => current.map((agent) => recoveredById.get(agent.id) ?? agent));
        setDiscoveredMachines((current) => current.map((machine) => ({
          ...machine,
          agents: (machine.agents ?? []).map((agent) => recoveredById.get(agent.id) ?? agent),
        })));
      }
      if (!staleIds.size) return;
      setAgents((current) => current.filter((agent) => !staleIds.has(agent.id)));
      setDiscoveredMachines((current) => current.map((machine) => ({
        ...machine,
        agents: (machine.agents ?? []).filter((agent) => !staleIds.has(agent.id)),
        snapshots: (machine.snapshots ?? []).filter((snapshot) => !staleIds.has(snapshot.agentId)),
      })));
      setFleetSnapshots((current) => Object.fromEntries(
        Object.entries(current).filter(([agentId]) => !staleIds.has(agentId)),
      ));
      setSelectedAgentId((current) => staleIds.has(current) ? "" : current);
    })();
    return () => {
      cancelled = true;
    };
  }, [agents, discoveredMachines, hydrated, sharedVault.enabled, sharedVault.vaultPath]);
  useEffect(() => {
    if (!hydrated || !sharedVault.enabled || !agentVaultHydratedRef.current) return;
    const handle = window.setTimeout(() => {
      void fetch("/api/obsidian/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vaultPath: sharedVault.vaultPath, agents }),
      }).catch(() => null);
    }, 700);
    return () => window.clearTimeout(handle);
  }, [hydrated, sharedVault.enabled, sharedVault.vaultPath, agents]);
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(sharedVault));
  }, [hydrated, sharedVault]);
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(tasks.slice(0, 80)));
  }, [hydrated, tasks]);
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(schedules.slice(0, 120)));
  }, [hydrated, schedules]);
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(walletsByAgent));
  }, [hydrated, walletsByAgent]);
  useEffect(() => {
    if (!hydrated) return;
    if (!Object.values(messagesByAgent).some((messages) => isAutomationChatTranscript(messages))) return;
    const cleanupTimer = window.setTimeout(() => {
      setMessagesByAgent((current) => {
        let changed = false;
        const next = { ...current };
        for (const [key, messages] of Object.entries(current)) {
          if (isAutomationChatTranscript(messages)) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 0);
    return () => window.clearTimeout(cleanupTimer);
  }, [hydrated, messagesByAgent]);
  // Hydrate wallets from the shared vault ledger when sharedVault is enabled.
  // Vault wins where it has a newer `updatedAt` than the locally-stored copy.
  useEffect(() => {
    if (!hydrated || !sharedVault.enabled) return;
    const vaultPath = sharedVault.vaultPath.trim();
    let cancelled = false;
    void (async () => {
      try {
        const params = vaultPath ? `?vaultPath=${encodeURIComponent(vaultPath)}` : "";
        const response = await fetch(`/api/obsidian/wallets${params}`);
        if (!response.ok) return;
        const data = (await response.json()) as {
          ok?: boolean;
          records?: Array<{ agentId: string; wallet: AgentWalletConfig; updatedAt?: string }>;
        };
        if (cancelled || !data?.ok || !Array.isArray(data.records) || data.records.length === 0) return;
        setWalletsByAgent((current) => {
          let mutated = false;
          const next = { ...current };
          for (const record of data.records!) {
            const existing = next[record.agentId];
            const wallet = stripUnfundedWalletBalance(record.wallet);
            const remoteMs = wallet.updatedAt ?? 0;
            const localMs = existing?.updatedAt ?? 0;
            if (!existing || remoteMs > localMs) {
              next[record.agentId] = wallet;
              mutated = true;
            }
          }
          return mutated ? next : current;
        });
      } catch {
        /* vault unreachable — local cache still works */
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, sharedVault.enabled, sharedVault.vaultPath]);
  // Write-through: when wallets change locally, mirror the changed records to
  // the shared vault. Debounced to coalesce rapid edits (slider drags etc).
  const walletVaultSyncedRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!hydrated || !sharedVault.enabled) return;
    const vaultPath = sharedVault.vaultPath.trim();
    const timer = window.setTimeout(() => {
      for (const [agentId, wallet] of Object.entries(walletsByAgent)) {
        const lastSynced = walletVaultSyncedRef.current[agentId] ?? 0;
        if ((wallet.updatedAt ?? 0) <= lastSynced) continue;
        const agent = agents.find((candidate) => candidate.id === agentId);
        walletVaultSyncedRef.current[agentId] = wallet.updatedAt ?? Date.now();
        void fetch("/api/obsidian/wallets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vaultPath: vaultPath || undefined,
            agentId,
            agentName: agent?.name ?? agentId,
            runtime: agent?.runtime,
            machineName: agent?.machineName,
            wallet,
          }),
        }).catch(() => { /* ignore vault write errors */ });
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [hydrated, sharedVault.enabled, sharedVault.vaultPath, walletsByAgent, agents]);
  useEffect(() => {
    if (!hydrated) return;
    const persistTimer = window.setTimeout(() => {
      const compactMessages = compactChatMessagesForStorage(messagesByAgent);
      const serialized = JSON.stringify(compactMessages);
      if (serialized === lastPersistedChatMessagesRef.current) return;
      lastPersistedChatMessagesRef.current = serialized;
      window.localStorage.setItem(CHAT_MESSAGES_STORAGE_KEY, serialized);
      const stats = chatMessagesStorageStats(compactMessages);
      const statsSignature = `${stats.agentCount}:${stats.messageCount}`;
      if (statsSignature === lastPersistedChatStatsRef.current) return;
      lastPersistedChatStatsRef.current = statsSignature;
      logClientTelemetry("chat.messages.persisted", stats);
    }, 700);
    return () => window.clearTimeout(persistTimer);
  }, [hydrated, messagesByAgent]);
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(CHAT_FOLDER_STORAGE_KEY, JSON.stringify(chatCustomFolders));
  }, [chatCustomFolders, hydrated]);
  useEffect(() => {
    if (!hydrated || discoveredMachines.length === 0) return;
    window.localStorage.setItem(DISCOVERED_MACHINES_STORAGE_KEY, JSON.stringify(discoveredMachines.slice(0, 32)));
  }, [discoveredMachines, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    const compactSnapshots = Object.fromEntries(Object.entries(fleetSnapshots)
      .filter(([, snapshot]) => snapshot?.tasks?.length > 0)
      .map(([agentId, snapshot]) => [agentId, {
        ...snapshot,
        tasks: snapshot.tasks.slice(0, 12),
      }]));
    window.localStorage.setItem(FLEET_SNAPSHOTS_STORAGE_KEY, JSON.stringify(compactSnapshots));
  }, [fleetSnapshots, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(MACHINE_NAME_ALIAS_STORAGE_KEY, JSON.stringify(machineNameAliases));
  }, [hydrated, machineNameAliases]);
  useEffect(() => {
    if (!hydrated || !sharedVault.enabled) return;
    const vaultPath = sharedVault.vaultPath.trim();
    let cancelled = false;
    const params = vaultPath ? `?vaultPath=${encodeURIComponent(vaultPath)}` : "";
    void fetch(`/api/obsidian/machine-aliases${params}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { aliases?: Record<string, string> } | null) => {
        if (cancelled || !data?.aliases) return;
        setMachineNameAliases((current) => mergeMachineNameAliases(current, data.aliases ?? {}));
      })
      .catch(() => { /* shared vault aliases are optional */ });
    return () => { cancelled = true; };
  }, [hydrated, sharedVault.enabled, sharedVault.vaultPath]);
  useEffect(() => {
    notificationCursorRef.current = notificationCursor;
    notificationCountRef.current = notifications.length;
  }, [notificationCursor, notifications.length]);
  useEffect(() => {
    if (
      !attachmentMenuOpen
      && !quickAddAttachmentMenuOpen
      && !kanbanSteerAttachmentMenuOpen
      && !Object.values(quickAddMachineMenuOpen).some(Boolean)
      && !Object.values(kanbanCardMachineMenuOpen).some(Boolean)
      && !Object.values(kanbanCardAttachmentMenuOpen).some(Boolean)
      && !Object.values(kanbanCardAttachmentListOpen).some(Boolean)
      && !Object.values(kanbanCardDeliverableMenuOpen).some(Boolean)
    ) return;
    function closeAttachmentMenu(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (target instanceof Node && attachmentMenuRef.current?.contains(target)) return;
      if (target instanceof Node && quickAddAttachmentMenuRef.current?.contains(target)) return;
      if (target instanceof Node && quickAddMachineMenuRef.current?.contains(target)) return;
      if (target instanceof Node && kanbanSteerAttachmentMenuRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-kanban-machine-menu='true']")) return;
      if (target instanceof Element && target.closest("[data-kanban-card-attachment-menu='true']")) return;
      if (target instanceof Element && target.closest("[data-kanban-deliverable-menu='true']")) return;
      setAttachmentMenuOpen(false);
      setQuickAddAttachmentMenuOpen(false);
      setQuickAddMachineMenuOpen({});
      setKanbanCardMachineMenuOpen({});
      setKanbanCardAttachmentMenuOpen({});
      setKanbanCardAttachmentListOpen({});
      setKanbanCardDeliverableMenuOpen({});
      setKanbanSteerAttachmentMenuOpen(false);
    }
    function closeAttachmentMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAttachmentMenuOpen(false);
        setQuickAddAttachmentMenuOpen(false);
        setQuickAddMachineMenuOpen({});
        setKanbanCardMachineMenuOpen({});
        setKanbanCardAttachmentMenuOpen({});
        setKanbanCardAttachmentListOpen({});
        setKanbanCardDeliverableMenuOpen({});
        setKanbanSteerAttachmentMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", closeAttachmentMenu);
    document.addEventListener("touchstart", closeAttachmentMenu);
    document.addEventListener("keydown", closeAttachmentMenuOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeAttachmentMenu);
      document.removeEventListener("touchstart", closeAttachmentMenu);
      document.removeEventListener("keydown", closeAttachmentMenuOnEscape);
    };
  }, [attachmentMenuOpen, kanbanCardAttachmentListOpen, kanbanCardAttachmentMenuOpen, kanbanCardDeliverableMenuOpen, kanbanCardMachineMenuOpen, quickAddAttachmentMenuOpen, quickAddMachineMenuOpen, kanbanSteerAttachmentMenuOpen]);
  useEffect(() => {
    if (!kanbanSteerTargetMenuOpen) return;
    function closeKanbanSteerTargetMenu(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (target instanceof Node && kanbanSteerTargetMenuRef.current?.contains(target)) return;
      setKanbanSteerTargetMenuOpen(false);
    }
    function closeKanbanSteerTargetMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setKanbanSteerTargetMenuOpen(false);
    }
    document.addEventListener("mousedown", closeKanbanSteerTargetMenu);
    document.addEventListener("touchstart", closeKanbanSteerTargetMenu);
    document.addEventListener("keydown", closeKanbanSteerTargetMenuOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeKanbanSteerTargetMenu);
      document.removeEventListener("touchstart", closeKanbanSteerTargetMenu);
      document.removeEventListener("keydown", closeKanbanSteerTargetMenuOnEscape);
    };
  }, [kanbanSteerTargetMenuOpen]);
  useEffect(() => {
    if (!chatContextMenu) return;
    function closeChatContextMenu(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (target instanceof Node && chatContextMenuRef.current?.contains(target)) return;
      setChatContextMenu("");
    }
    function closeChatContextMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setChatContextMenu("");
    }
    document.addEventListener("mousedown", closeChatContextMenu);
    document.addEventListener("touchstart", closeChatContextMenu);
    document.addEventListener("keydown", closeChatContextMenuOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeChatContextMenu);
      document.removeEventListener("touchstart", closeChatContextMenu);
      document.removeEventListener("keydown", closeChatContextMenuOnEscape);
    };
  }, [chatContextMenu]);
  const buildSnapshotAgents = useCallback(() => {
    const discoveredAgents = discoveredMachines.flatMap((machine) => machine.agents ?? []).map(normalizeAgentProfile);
    return dedupeAgents(agents, discoveredAgents).map((agent) => ({
        id: agent.id,
        name: agent.name,
        runtime: agent.runtime,
        gatewayUrl: agent.gatewayUrl,
        token: agent.token,
        agentId: agent.agentId,
        sessionKey: agent.sessionKey,
        chatPath: agent.chatPath,
        statusPath: agent.statusPath,
        localDataDir: agent.localDataDir,
        machineName: agent.machineName,
        telemetryUrl: agent.telemetryUrl,
      }));
  }, [agents, discoveredMachines]);

  const refreshFleetSnapshots = useCallback(async (signal: AbortSignal, mode: "full" | "history") => {
      const snapshotAgents = buildSnapshotAgents();
      if (snapshotAgents.length === 0) return false;
      const response = await fetch("/api/fleet/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          agents: snapshotAgents,
          sharedVault: { controlRoomPath: sharedVault.controlRoomPath },
          mode,
        }),
      }).catch(() => null);
      if (!response?.ok) return false;
      const data = (await response.json().catch(() => null)) as {
        checkedAt?: number;
        snapshots?: AgentSnapshot[];
      } | null;
      if (!data?.snapshots) return false;
      const snapshots = mode === "history"
        ? (data.snapshots ?? []).filter((snapshot) => snapshot.tasks?.length > 0)
        : data.snapshots ?? [];
      if (snapshots.length === 0) return false;
      setFleetSnapshots((current) => mergeSnapshotRecord(current, snapshots));
      setFleetCheckedAt(data.checkedAt ?? Date.now());
      return true;
  }, [buildSnapshotAgents, sharedVault.controlRoomPath]);

  const pollFleetSnapshot = useCallback(async (signal: AbortSignal) => {
      await refreshFleetSnapshots(signal, activeView === "chat" ? "history" : "full");
  }, [activeView, refreshFleetSnapshots]);
  useEffect(() => {
    if (!hydrated || activeView !== "chat" || agents.length === 0) return;
    const refreshKey = JSON.stringify({
      controlRoomPath: sharedVault.controlRoomPath,
      agents: agents.map((agent) => ({
        id: agent.id,
        runtime: agent.runtime,
        localDataDir: agent.localDataDir,
        telemetryUrl: agent.telemetryUrl,
        agentId: agent.agentId,
      })),
    });
    if (chatHistoryRefreshKeyRef.current === refreshKey) return;
    chatHistoryRefreshKeyRef.current = refreshKey;
    const controller = new AbortController();
    void refreshFleetSnapshots(controller.signal, "history").then((loaded) => {
      if (!loaded && chatHistoryRefreshKeyRef.current === refreshKey) {
        chatHistoryRefreshKeyRef.current = "";
      }
    });
    return () => controller.abort();
  }, [activeView, agents, hydrated, refreshFleetSnapshots, sharedVault.controlRoomPath]);
  useVisibilityAwarePolling({
    enabled: hydrated && (activeView === "agents" || activeView === "chat"),
    intervalMs: activeView === "agents" ? 30_000 : 45_000,
    hiddenIntervalMs: 5 * 60_000,
    task: pollFleetSnapshot,
  });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshTailscaleDevices();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshTailscaleDevices]);
  useEffect(() => () => {
    if (hivemindLinkConnectedTimeoutRef.current) {
      window.clearTimeout(hivemindLinkConnectedTimeoutRef.current);
    }
  }, []);
  useEffect(() => {
    if (!hivemindLinkSignInPolling) return undefined;
    let cancelled = false;
    const startedAt = Date.now();
    const firstRefresh = window.setTimeout(() => {
      if (!cancelled) void refreshTailscaleDevices();
    }, 0);
    const timer = window.setInterval(() => {
      if (cancelled) return;
      if (Date.now() - startedAt > 120_000) {
        hivemindLinkSignInPollingRef.current = false;
        setHivemindLinkSignInPolling(false);
        window.clearInterval(timer);
        return;
      }
      void refreshTailscaleDevices();
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearTimeout(firstRefresh);
      window.clearInterval(timer);
    };
  }, [hivemindLinkSignInPolling, refreshTailscaleDevices]);
  const pollFleetDiscovery = useCallback(async (signal: AbortSignal) => {
      setFleetDiscoveryLoading((current) => current || discoveredMachines.length === 0);
      const response = await fetch("/api/fleet/discover?includeSnapshots=0&fresh=1", {
        cache: "no-store",
        signal,
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as {
        machines?: DiscoveredMachine[];
        hivemindLink?: HivemindLinkClientStatus;
      } | null;
      if (!data?.machines) {
        setFleetDiscoveryLoading(false);
        return;
      }
      if (data.hivemindLink) {
        applyHivemindLinkStatus(data.hivemindLink);
      }
      const machines = data.machines;
      const statusUnavailableFallback = tailscaleStatus.startsWith("Tailscale status unavailable")
        && discoveredMachines.length > 1
        && machines.length <= 1
        && machines.every((machine) => machine.device.self);
      if (statusUnavailableFallback) {
        setFleetDiscoveryLoading(false);
        return;
      }
      setDiscoveredMachines(() => mergeDiscoveredMachines([], machines));
      const discoveredSnapshots = data.machines.flatMap((machine) => machine.snapshots ?? []);
      if (discoveredSnapshots.length > 0) {
        setFleetSnapshots((current) => mergeSnapshotRecord(current, discoveredSnapshots));
      }
      setFleetDiscoveryLoading(false);
  }, [applyHivemindLinkStatus, discoveredMachines.length, tailscaleStatus]);
  useVisibilityAwarePolling({
    enabled: hydrated && (activeView === "agents" || activeView === "chat"),
    intervalMs: 60_000,
    hiddenIntervalMs: 5 * 60_000,
    task: pollFleetDiscovery,
  });
  const pollAppVersion = useCallback(async (signal: AbortSignal) => {
      const response = await fetch("/api/app/version", {
        cache: "no-store",
        signal,
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as AppVersion | null;
      if (data?.commit) setAppVersion(data);
  }, []);
  useVisibilityAwarePolling({
    enabled: hydrated,
    intervalMs: 5 * 60_000,
    hiddenIntervalMs: 10 * 60_000,
    task: pollAppVersion,
  });
  const pollMirosharkStatus = useCallback(async (signal: AbortSignal) => {
      const response = await fetch("/api/miroshark/status", {
        cache: "no-store",
        signal,
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as MiroSharkStatus | null;
      if (data?.baseUrl) setMirosharkStatus(data);
  }, []);
  useVisibilityAwarePolling({
    enabled: hydrated,
    intervalMs: mirosharkStatus?.install.running ? (activeView === "swarm" ? 15_000 : 60_000) : 120_000,
    hiddenIntervalMs: 5 * 60_000,
    task: pollMirosharkStatus,
  });
  const { refreshMirosharkMetadata, runMirosharkAction, startNewMirosharkSimulation, applyMirosharkTemplate, updateMirosharkTemplateInput, extractMirosharkHelperText, runMirosharkScenarioHelper, launchMirosharkSwarm, runMirosharkSwarm, runMirosharkExperiment, analyzeMirosharkRun, refreshMirosharkArchive, refreshBrainGraph, refreshRecentDirectories, recordRecentDirectory, loadMachineDirectories, chooseDirectoryForMachine, refreshHermesUpdateRequirement, refreshBrainSkills, importBrainSkills, syncBrainSkillsToAeon, openSkillBrowser: openBrainSkillBrowser, importRemoteSkillToBrain, installGithubSkillToBrain, addWrittenSkillToBrain, refreshNotifications, loadMirosharkArchivedRun, refreshMirosharkRun, mirosharkRunStatus, mirosharkRunIsArchived, mirosharkRunnerStatus, mirosharkPosts, mirosharkFeedIsWaiting, mirosharkFeedIsLive, mirosharkObservedRound, mirosharkTotalRounds, mirosharkCurrentRound, mirosharkProgressPercent, mirosharkRunIsWorking, mirosharkDisplayStep, mirosharkDisplayStatus, mirosharkProgressLabel, mirosharkTemplates, allMirosharkTemplates, mirosharkSelectedTemplate, mirosharkSelectedTemplateFields, mirosharkMissingTemplateFields, mirosharkTelemetryCount, mirosharkActionCount, mirosharkMarketCount, mirosharkTimelineItems, mirosharkActionItems, mirosharkProfileItems, mirosharkMarketItems, mirosharkObservabilityItems, mirosharkLlmCallItems, swarmTemplates, swarmTimelineItems, swarmObservabilityItems, swarmAgents, swarmDecisions, swarmThreadPosts, swarmSocialPosts, mirosharkMarketPricePayloads, swarmMarket, swarmIntegrationItems, swarmMarketPriceItems, swarmExportLinks, currentSwarmRun, swarmRuns, swarmStatusLabel, selectedSwarmRunId } = useMirosharkBrainController({ BRAIN_GRAPH_CLIENT_CACHE_MS, MIROSHARK_TEMPLATE_INPUTS, SWARM_LAUNCH_PRESETS, activeView, agents, appVersion, asRecord, brainGraph, brainGraphLoadedAtRef, brainGraphVaultPathRef, brainSkills, compactValue, composeMirosharkTemplateScenario, createDefaultAgentWallet, defaultMirosharkTemplateInputs, formatRelativeTime, getMiroSharkPosts, getMiroSharkRunStatus, getMiroSharkTemplates, hermesUpdateDetail, hermesUpdateRequiredDetail, honeyLedgerEnabled, isEmptyIntegrationPayload, isLoopbackCollector, isMiroSharkRunTerminal, isUnpublishedSimulationPayload, mirosharkAnalysisAgentId, mirosharkArchiveRuns, mirosharkExperimentEvent, mirosharkHandle, mirosharkMetadata, mirosharkPlatform, mirosharkRounds, mirosharkRun, mirosharkRunPending, mirosharkScenario, mirosharkSelectedTemplateId, mirosharkStat, mirosharkStatus, mirosharkTemplateInputs, mirosharkUserName, mirosharkWorkspaceMode, notificationCountRef, notificationCursorRef, numericRecordValue, payloadArray, payloadCount, payloadData, payloadPreview, pickLinkedDirectory, selectedAgentId, selectedMirosharkRunId, setBrainGraph, setBrainGraphLoading, setBrainGraphStatus, setBrainSkillAeonSyncing, setBrainSkillImportProvider, setBrainSkillImportSuccess, setBrainSkills, setBrainSkillsLoading, setBrainSkillsStatus, setHermesUpdateRequiredDetail, setMachineDirectoryBrowser, setMirosharkActionPending, setMirosharkAnalysisPending, setMirosharkAnalysisResult, setMirosharkAnalysisStatus, setMirosharkArchiveLoading, setMirosharkArchiveRuns, setMirosharkArchiveStatus, setMirosharkExperimentPending, setMirosharkExperimentStatus, setMirosharkHelperPending, setMirosharkHelperStatus, setMirosharkMetadata, setMirosharkPlatform, setMirosharkRounds, setMirosharkRun, setMirosharkRunPending, setMirosharkScenario, setMirosharkSelectedTemplateId, setMirosharkStatus, setMirosharkTemplateInputs, setMirosharkWorkbenchTab, setMirosharkWorkspaceMode, setNotificationCursor, setNotificationSummary, setNotifications, setNotificationsLoading, setNotificationsStatus, setRecentDirectories, setSelectedBrainNodeId, setSelectedMirosharkRunId, setSkillBrowserGithubInstalling, setSkillBrowserGithubOpen, setSkillBrowserGithubUrl, setSkillBrowserImporting, setSkillBrowserLoading, setSkillBrowserOpen, setSkillBrowserSearch, setSkillBrowserSkills, setSkillBrowserStatus, setSkillBrowserView, setSkillBrowserWriting, setSkillBrowserWrittenContent, sharedVault, skillBrowserGithubUrl, skillBrowserWrittenContent, skillRequiresHermesUpdate, swarmEventItem, swarmMarketEventItem, swarmMarketFromItems, swarmMarketPriceEventItem, swarmRunState, swarmTemplateIdFromMirosharkTemplate, swarmTemplateIdFromSurface, walletsByAgent });
  const openSkillBrowser = useCallback(async () => {
    setSkillBrowserMode("brain");
    await openBrainSkillBrowser();
  }, [openBrainSkillBrowser]);
  const openAgentSkillBrowser = useCallback(async () => {
    setSkillBrowserMode("agent-class");
    setSkillBrowserGithubOpen(false);
    setSkillBrowserView("browse");
    setSkillBrowserSearch("");
    await openBrainSkillBrowser();
  }, [openBrainSkillBrowser]);
  const appendMessage = useCallback((agentId: string, message: ChatMessage, storageKey = agentId) => {
    logClientTelemetry("chat.message.appended", { agentId, storageKey, role: message.role, kanbanTaskId: message.kanbanTaskId ?? null, surface: message.surface ?? null, contentLength: message.content.length, attachmentCount: message.attachments?.length ?? 0 });
    setMessagesByAgent((current) => {
      const next = {
        ...current,
        [storageKey]: [...(current[storageKey] ?? []), { ...message, createdAt: message.createdAt ?? Date.now() }],
      };
      if (typeof window !== "undefined") {
        const compactMessages = compactChatMessagesForStorage(next);
        const serialized = JSON.stringify(compactMessages);
        lastPersistedChatMessagesRef.current = serialized;
        window.localStorage.setItem(CHAT_MESSAGES_STORAGE_KEY, serialized);
      }
      return next;
    });
  }, []);
  const recordActiveChatRun = useCallback((run: ActiveChatRunRecord) => {
    writeActiveChatRuns({
      ...readActiveChatRuns(),
      [run.storageKey]: { ...run, updatedAt: Date.now() },
    });
  }, []);
  const clearActiveChatRun = useCallback((storageKey: string) => {
    const next = readActiveChatRuns();
    delete next[storageKey];
    writeActiveChatRuns(next);
  }, []);
  const upsertTask = useCallback((task: AgentTask) => {
    setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)].slice(0, 80));
  }, []);
  const updateTask = useCallback((taskId: string, patch: Partial<AgentTask>) => {
    setTasks((current) => current.map((task) => task.id === taskId ? { ...task, ...patch, updatedAt: Date.now() } : task));
  }, []);
  const openSetupModal = useCallback((machine: MachineGroup) => {
    setSetupMachineKey(machine.key); setSetupCommandCopied(false);
  }, []);
  const addKanbanStorageParams = useCallback((params: URLSearchParams) => {
    if (!sharedVault.enabled) return;
    if (sharedVault.vaultPath.trim()) params.set("vaultPath", sharedVault.vaultPath.trim());
    if (sharedVault.kanbanFolder?.trim()) params.set("kanbanFolder", sharedVault.kanbanFolder.trim());
  }, [sharedVault.enabled, sharedVault.kanbanFolder, sharedVault.vaultPath]);
  const { discoveredAgents, agentAliases, candidateAgents, candidateWorkById, displayAgents, agentWorkById, effectiveSelectedAgentId, selectedAgent, sharedSkillOptions, filteredSkillBrowserSkills, hermesUpdateRequired, filteredSchedulerSkills, selectedBrainNode, visibleBrainNodes, brainLayout, brainGraphStats, selectedBrainTargetIds, messages, lastAssistant, visibleMessages, sessionNotice, selectedChatStreaming, selectedChatHasStreamingChunk, selectedChatProcess, updateChatAutoScroll, machineGroups, renameMachine, kanbanMachineTargets, localKanbanMachineTarget, quickAddMachineTarget, agentsForKanbanTask, visibleAgentCount, fleetViewData, fleetUpdateStatusByMachine, fleetUpdateDetailByMachine, kanbanColumns, visibleKanbanColumns, selectedKanbanTask, selectedKanbanComments, selectedKanbanAgent, selectedKanbanAgentMessages, notificationGroups, selectedKanbanEvents, selectedKanbanBulkIds, selectedWallet, selectedWalletSnapshot, walletStats, honeyAgentRewards, selectedHoneyReward, honeyStats, kanbanAssigneeOptions, workBoardStats, kanbanViewColumns, kanbanInitialLoading, updateKanbanBoardScrollState, agentSpecificEnvCount, sharedEnvSource, runtimeEnvSources, selectedRuntimeEnvSource, sharedEnvCount, unsharedRuntimeEnvCount, sharedBackupStatus, sharedEnvImport, sharedEnvImportDiff, sharedEnvImportNewCount, sharedEnvImportChangedCount, sharedEnvImportSameCount, brainSkillImportableCount, brainSkillImportableLabel, brainSkillImportAllLabel, brainSkillImportAllDescription, navItems, activeNavItem, activeHeader, setupMachine, roleModalAgent, agentCreateMachine } = useDashboardDerivedState({ RUNTIME_LABELS, activeView, agentAliasMap, agentCreateDraft, agentCreateMachineKey, agentRoleModalId, agentSettingsPanel, agents, beeRoleLabel, brainGraph, brainGraphLayout, brainSkills, chatAutoScrollRef, chatDisplayContent, chatMessageStorageKey, chatMessageWindow, chatProcessByKey, chatStreamingByKey, cleanActivityTitle, collectorKey, createAgentProfile, createDefaultAgentWallet, dedupeAgents, discoveredMachines, displayMachineName, fleetAgentState, fleetMachineLocation, fleetMetric, fleetSnapshots, fleetVersionState, formatRelativeTime, getHoneyAgentRewards, getSurvivalSnapshot, groupKanbanTasks, groupNotifications, hermesUpdateRequiredDetail, hiveEnv, hiveEnvRuntimeSourceId, honeyTreasury, hydrated, inferCurrentTask, inferLatestAgentMessage, isChatSidebarTask, isLoopbackCollector, isManualAgentChatMessage, isMeaningfulActive, isMobileMachineOs, isStarterPlaceholder, isVisibleFleetMachine, isWorkView, kanbanAssignees, kanbanBoard, kanbanBoardScrollRef, kanbanError, kanbanIncludeArchived, kanbanLoading, kanbanTaskAssigneeAgent, machineIdentityFromParts, machineNameAliases, machineNeedsChatBridgeRepair, machineNeedsEnvHttpSyncRepair, machineNeedsSkillSyncRepair, machineNetworkIssue, maintenanceReport, messagesByAgent, messagesScrollRef, mirosharkAnalysisAgentId, mirosharkStatus, moneyClawLoadingEnvName, moneyClawStatusByEnvName, normalizeAgentProfile, notificationActorMeta, notificationDisplayBody, notificationDisplayTitle, notificationSourceLabel, notificationSummary, notifications, parseEnvImportText, quickAddMachineTargets, refreshMoneyClawStatus, refreshRuntimeIntegrations, refreshSharedSchedulesFromVault, runtimeCan, runtimeCount, runtimeFileRoots, runtimeModelSelectionsByRuntime, runtimeUsage, schedulerSkillSearch, schedules, selectedAgentId, selectedBrainNodeId, selectedChatLeafKey, selectedChatPreview, selectedKanbanTaskId, selectedKanbanTaskIds, setKanbanBoardScrollState, setMachineNameAliases, setScheduleDraft, setupMachineKey, sharedEnvImportText, sharedVault, skillBrowserSearch, skillBrowserSkills, tailscaleDevices, tailscaleStatus, tasks, updateStatusByMachine, walletExpanded, walletsByAgent, workPriority });
  const { updateAgent, updateAgentProfile: agentUpdateAgentProfile, syncAeonEnvToGitHub, openAgentCreationModal, closeAgentSettingsModal, browseAgentRuntimeFolder, refreshRuntimeIntegrations: agentRefreshRuntimeIntegrations, runRuntimeIntegrationAction, searchRuntimeSessionsForAgent, createAgentFromModal } = useAgentController({ RUNTIME_LABELS, aeonEnvKeys, agentCreateDraft, agentCreateMachine, agents, beeWorkerPreset, collectorKey, createAgentProfile, defaultWorkerClassDraft, displayAgents, hermesUpdateDetail, normalizeAgentProfile, openSetupModal, roleModalAgent, runtimeCount, runtimeSessionQuery, selectedAgent, setActiveView, setAeonEnvSyncStatus, setAeonEnvSyncing, setAgentCreateDraft, setAgentCreateMachineKey, setAgentRenameDraft, setAgentRenameEditing, setAgentRoleModalId, setAgentRuntimeAdvancedOpen, setAgentRuntimeFolderBrowsing, setAgentRuntimeFolderEditing, setAgentRuntimeFolderStatus, setAgentSettingsPanel, setAgentWorkerClassView, setAgents, setCustomWorkerDraft, setCustomWorkerImageError, setCustomWorkerSkillSearch, setDiscoveredMachines, setHermesUpdateRequiredDetail, setRuntimeBackgroundPrompt, setRuntimeIntegrationBusy, setRuntimeIntegrationMessage, setRuntimeIntegrationStatus, setRuntimeModelDraft, setRuntimeModelSelectionsByRuntime, setRuntimeModelSetupMode, setRuntimeSessionQuery, setRuntimeSessionResults, setSelectedAgentId });
  const { toggleScheduleSkill, toggleSchedulerStepMode, updateSchedulerStep, addSchedulerStep, removeSchedulerStep, addSchedulerStepPath, removeSchedulerStepPath, toggleSchedulerStepSkill, updateSchedulerStepModel, isSchedulerFilePath, pickSchedulerFolder, pickSchedulerFiles, addSchedulePath, removeSchedulePath, removeScheduleSkill, resetScheduleDraft, editSchedule, createSchedule, removeSchedule, importExistingSchedules, normalizeImportedScheduleEvery, toggleSchedule, schedulerPlainPrompt, schedulerSharedSnapshot, upsertSharedSchedule, upsertSharedSchedules, fetchPastRunContext, scheduleFromSharedSnapshot, mergeSharedSchedules, refreshSharedSchedulesFromVault: schedulerRefreshSharedSchedulesFromVault, recordSharedScheduledRun, runScheduleNow, schedulerStatusFromSchedule, scheduleIntervalMs, formatSchedulerDuration, schedulerCadenceLabel, schedulerJobs, findScheduleForJob, modalCadenceFromEvery, everyFromModalCadence, schedulerModalInitial, saveScheduleFromModal, browseSchedulerFolder } = useSchedulerController({ RUNTIME_LABELS, SCHEDULER_DYNAMIC_SKILL_ACTIONS_ENABLED, SCHEDULER_HERMES_SKILL_CONTEXT_ENABLED, SCHEDULER_MODEL_OPTIONS, SCHEDULER_RUN_STALE_MS, agents, appVersion, appendMessage, chatSetupIssue, createDefaultAgentWallet, displayAgents, displayMachineName, editingScheduleId, formatRelativeTime, honeyLedgerEnabled, logClientTelemetry, refreshHoneyLedger, scheduleDraft, schedules, selectedAgent, setEditingScheduleId, setMessagesByAgent, setScheduleDraft, setScheduleImportStatus, setScheduleImporting, setSchedulerAttachMenu, setSchedulerDraftOpen, setSchedulerPathDraft, setSchedulerPathKind, setSchedulerRunStates, setSchedulerSelectedStep, setSchedulerSkillSearch, setSchedules, sharedVault, updateTask, upsertTask, walletsByAgent });
  const { updateSharedVault, updateWallet, resetWalletBurnClock, copyPaymentPrompt, refreshMoneyClawStatus: walletRefreshMoneyClawStatus, saveMoneyClawKey, initializeCoreWalletRails, refreshHoneyLedger: walletRefreshHoneyLedger, observeHoneyUsage: walletObserveHoneyUsage, refreshRuntimeUsage, refreshWalletVaultBackupStatus, runWalletVaultBackupAction, refreshMaintenanceReport, runMaintenanceAction, runtimeFileRequest, refreshRuntimeFileRoots, listRuntimeFiles, openRuntimeFile, saveRuntimeFile, returnAllHiveToHoney, claimAllHoneyToBankrHive, enableHoneyLedger, updateWalletAction, createLocalWallet, refreshWalletBalance, sendWalletUsdc, testX402Fetch, addAgentToMachine, requestDuplicateAgent, duplicateAgent, deleteAgent } = useWalletFilesController({ buildAgentPaymentPrompt, createDefaultAgentWallet, createDefaultHoneyTreasuryConfig, displayAgents, duplicateAgentDraft, agents, honeyLedgerEnabled, normalizeMoney, openAgentCreationModal, runtimeFileDraft, runtimeFileOpen, runtimeFilePath, runtimeFileRootKey, runtimeFileRoots, selectedAgent, selectedAgentId, setAgents, setDuplicateAgentDraft, setHoneyLedgerEnabled, setHoneyTreasury, setMaintenanceBusy, setMaintenanceMessage, setMaintenanceReport, setMessagesByAgent, setMoneyClawLoadingEnvName, setMoneyClawStatusByEnvName, setRuntimeFileDraft, setRuntimeFileOpen, setRuntimeFilePath, setRuntimeFileRootKey, setRuntimeFileRoots, setRuntimeFileStatus, setRuntimeFiles, setRuntimeUsage, setRuntimeUsageLoading, setSelectedAgentId, setSharedVault, setWalletActionsByAgent, setWalletVaultBackupBusy, setWalletVaultBackupMessage, setWalletVaultBackupStatus, setWalletsByAgent, sharedVault, updateAgentProfile, walletActionsByAgent, walletsByAgent });
  const { switchRuntime, hasConversation, conversationTitle, hydrateRuntimeSessionChat, startAgentChat, startAgentWorkChat, changeChatWorkingDirectory, closeChatFolderCreator, createChatFolder, chatSidebarTree, selectedChatMachine, selectedChatDirectory, chatFolderCreatorMachine, chatFolderCreatorParentOptions, copySetupCommand } = useChatTreeController({ RUNTIME_CAPABILITIES, RUNTIME_DEFAULTS, RUNTIME_KINDS, RUNTIME_LABELS, activeView, agentWorkById, chatCustomFolders, chatDedupeKey, chatFolderDraft, chatFolderLabel, chatMessageStorageKey, chatMessageWindow, chatPreviewDedupeKey, chatSeedMessagesForTask, chooseDirectoryForMachine, createChatLeafKey, displayAgents, findRosterChatTask, runtimeSessionIdFromTask, isChatSidebarTask, isManualAgentChatMessage, logClientTelemetry, machineGroups, messagesByAgent, parentPathFromPath, preferChatTreeItem, recordRecentDirectory, runtimeCan, runtimeSessionForChat, selectedAgent, selectedChatDirectoryPath, selectedChatLeafKey, setActiveView, setChatCustomFolders, setChatFolderDraft, setChatMessageWindow, setMessagesByAgent, setSelectedAgentId, setSelectedChatDirectoryPath, setSelectedChatLeafKey, setSelectedChatPreview, setSelectedChatRuntimeSessionId, setSetupCommandCopied, setSetupMachineKey, setupCollectorCommand, setStatus, setStatusAgentId, taskChatLeafKey, updateAgent, workPriority, workspaceLabelFromPath });
  const { openMachineInitModal, saveHetznerToken, openHetznerEnvFile, initializeMachineProject, copyMachineInitCommand, refreshAppVersionNow, refreshDiscoveryNow, runMachineUpdate, copyUpdateDetail, refreshKanbanOnce, kanbanStorageBody, notificationStorageBody, raiseHermesAuthAlert, noteIntakeBody, scanNoteIntake, importNoteIntake, markNotificationRead, markAllNotificationsRead, updateNotificationSettings, trackAgentTaskOnKanban } = useFleetNotificationsController({ DEFAULT_SHARED_VAULT, addKanbanStorageParams, appVersion, hydrated, isCollectorAutoUpdateable, kanbanAssigneeFilter, kanbanBoardSlug, kanbanIncludeArchived, kanbanSearch, kanbanTenantFilter, cleanActivityTitle, localDashboardHasUnpublishedChanges, machineInitDraft, machineInitToken, machineNeedsChatBridgeRepair, machineNeedsEnvHttpSyncRepair, machineNeedsSkillSyncRepair, machineVersionCopy, mergeDiscoveredMachines, mergeSnapshotRecord, noteIntakeAutoInFlightRef, notifications, setAppVersion, setCopiedUpdateDetailKey, setDiscoveredMachines, setFleetSnapshots, setKanbanAssignees, setKanbanBoard, setKanbanBoards, setKanbanError, setKanbanStorage, setKanbanTenants, setActiveView, setSelectedKanbanTaskId, setMachineInitCopiedKey, setMachineInitOpen, setMachineInitStatus, setMachineInitToken, setMachineInitTokenStatus, setNoteIntakePending, setNoteIntakePreview, setNoteIntakeStatus, setNotificationCursor, setNotificationSummary, setNotifications, setNotificationsStatus, setTasks, setUpdateStatusByMachine, sharedVault, summarizeHermesAuthError, updateStatusByMachine });
  const { createKanbanTask, createKanbanBoard, patchKanbanTask, bulkPatchKanbanTasks, promoteKanbanIdea, updateKanbanTaskMachine, markKanbanTaskReviewed, requestKanbanTaskUndo, readWorkspaceGitSnapshot, kanbanWorkspaceChangeSummary, addKanbanCardFiles, openKanbanCardFilePicker, handleKanbanCardFileChange, handleKanbanCardImageChange, attachKanbanCardDirectory, attachKanbanCardRecentDirectory, removeKanbanCardAttachment, removeKanbanCardDirectory, moveKanbanTask, deleteKanbanTask, editAndInterruptKanbanTask, openKanbanTaskModal, kanbanTaskMenuItems, orchestrateReadyKanbanTask, addKanbanSystemComment } = useKanbanTaskController({ AbortController, Eye, GitBranch, KANBAN_COLUMNS, KANBAN_PICKUP_PREVIEW_MS, MessageSquare, Pencil, RotateCcw, Trash2, Users, agentsForKanbanTask, appVersion, appendMessage, attachmentSizeLabel, beeRoleIconPath, beeWorkerClassLabel, chatSetupIssue, chooseBeeAssignment, chooseDirectoryForMachine, createDefaultAgentWallet, dispatchKanbanTaskToAgentRef, displayAgents, honeyLedgerEnabled, kanbanBoard, kanbanBoardSlug, kanbanCardAttachmentTargetId, kanbanCardFileInputRef, kanbanCardImageInputRef, kanbanDispatchCooldownRef, kanbanEditDraft, kanbanEditPendingTaskId, kanbanReadyPickupAttemptRef, kanbanReadyPickupInFlightRef, kanbanReadyPickupSignature, kanbanRuntimeAbortRef, kanbanStorageBody, kanbanTaskAssigneeAgent, kanbanTaskInterruptPrompt, linkedDirectoryLabel, logClientTelemetry, newBoardDraft, quickAddAttachments, quickAddDirectories, quickAddDrafts, quickAddMachineTarget, readComposerFiles, recordRecentDirectory, refreshHoneyLedger, refreshKanbanOnce, selectedKanbanAgent, selectedKanbanBulkIds, selectedKanbanTask, selectedKanbanTaskId, setKanbanBoard, setKanbanBoardSlug, setKanbanBulkPending, setKanbanCardAttachmentMenuOpen, setKanbanCardAttachmentTargetId, setKanbanCardRecentsExpanded, setKanbanEditDraft, setKanbanEditPendingTaskId, setKanbanError, setKanbanPickupPreviewByTask, setKanbanStorage, setKanbanTaskModal, setMessagesByAgent, setNewBoardDraft, setQuickAddAttachmentError, setQuickAddAttachments, setQuickAddDirectories, setQuickAddDrafts, setQuickAddMachineMenuOpen, setQuickAddMachineTargets, setQuickAddStatus, setSelectedKanbanTaskId, setSelectedKanbanTaskIds, sharedVault, updateTask, upsertTask, wait, walletsByAgent });
  const { createKanbanArtistHandoffTask, requeueStaleKanbanTask, dispatchKanbanTaskToAgent, addKanbanComment, refreshKanbanAgentSession, steerSelectedKanbanTask } = useKanbanDispatchController({ AbortController, KANBAN_COLUMNS, KANBAN_DISPATCH_NO_PROGRESS_MS, KANBAN_NO_ASSISTANT_QUIET_MS, KANBAN_NO_ASSISTANT_STALL_MS, KANBAN_SESSION_POLL_FAILURE_LIMIT, KANBAN_STALE_AGENT_COOLDOWN_MS, KANBAN_TOOL_OUTPUT_STALL_MS, addKanbanSystemComment, appVersion, appendMessage, attachmentSizeLabel, attachmentSummary, chatSetupIssue, commentDraft, compactDiagnosticPreview, createDefaultAgentWallet, displayAgents, extractKanbanVisualBrief, formatDurationShort, honeyLedgerEnabled, hydrated, isHermesAuthFailure, isInternalHermesSessionPrelude, isKanbanAwaitingAgentUpdate, isKanbanStaleWorkingTask, isTransientDelegationMessage, kanbanBoard, kanbanBoardSlug, kanbanDispatchCooldownRef, kanbanNoAssistantStalledDetail, kanbanReadyPickupAttemptRef, kanbanReadyPickupInFlightRef, kanbanReadyPickupSignature, kanbanRuntimeAbortRef, kanbanSessionPollFailureRef, kanbanSessionPollRef, kanbanStaleAge, kanbanStaleRequeueAttemptRef, kanbanSteerAttachments, kanbanSteerDirectories, kanbanSteerDraft, kanbanSteerTargetStatus, kanbanSteeringTaskId, kanbanStorageBody, kanbanTaskAssigneeAgent, kanbanTaskAssignmentForAgent, kanbanTaskDispatchPrompt, kanbanToolOutputStalledDetail, kanbanWorkspaceChangeSummary, logClientTelemetry, messageContentParts, messagesByAgent, orchestrateReadyKanbanTask, patchKanbanTask, raiseHermesAuthAlert, readWorkspaceGitSnapshot, refreshHoneyLedger, refreshKanbanOnce, selectedKanbanAgent, selectedKanbanTask, setCommentDraft, setKanbanError, setKanbanSteerAttachmentError, setKanbanSteerAttachmentMenuOpen, setKanbanSteerAttachments, setKanbanSteerDirectories, setKanbanSteerDraft, setKanbanSteeringTaskId, setMessagesByAgent, sharedVault, simpleStableHash, summarizeKanbanToolOutput, updateTask, upsertTask, walletsByAgent });
  // eslint-disable-next-line react-hooks/refs
  selectedChatTargetRef.current = { agentId: selectedAgentId, leafKey: selectedChatLeafKey };

  // When the AEON automation modal opens, load the AEON agent's runtime skills so the
  // skill picker offers the workspace's full inventory instead of the (often empty)
  // Obsidian shared-brain list.
  useEffect(() => {
    if (!schedulerDraftOpen || activeView !== "aeon") return;
    const agent = displayAgents.find((item) => item.id === scheduleDraft.agentId && item.runtime === "aeon")
      ?? displayAgents.find((item) => item.runtime === "aeon")
      ?? (selectedAgent?.runtime === "aeon" ? selectedAgent : null);
    let cancelled = false;
    void (async () => {
      if (!agent) {
        await Promise.resolve();
        if (!cancelled) setAeonSkillOptions([]);
        return;
      }
      const response = await fetch("/api/runtimes/aeon/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, vaultPath: sharedVault.vaultPath }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null);
      if (cancelled) return;
      setAeonSkillOptions((data?.skills ?? [])
        .filter((skill) => skill?.slug)
        .map((skill) => ({
          slug: String(skill.slug),
          name: skill.name || String(skill.slug),
          description: skill.description || "",
        })));
    })();
    return () => { cancelled = true; };
  }, [schedulerDraftOpen, activeView, scheduleDraft.agentId, displayAgents, selectedAgent, sharedVault.vaultPath]);

  useEffect(() => {
    if (!hydrated || activeView !== "chat" || !selectedAgent) return;
    const storageKey = chatMessageStorageKey(selectedAgent.id, selectedChatLeafKey);
    const pollSession = async () => {
      const sessionId = chatRuntimeSessionIdsByKey[storageKey] || selectedChatRuntimeSessionId || "";
      const response = await fetch("/api/chat/agent-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: selectedAgent,
          sessionId: sessionId || undefined,
          sinceMs: sessionId ? undefined : Date.now() - ACTIVE_CHAT_RUN_TTL_MS,
          chatStorageKey: storageKey,
        }),
      }).catch(() => null);
      if (!response?.ok) return;
      const data = await response.json().catch(() => null);
      const session = data?.ok ? data.session : null;
      if (!session) return;
      const sessionKey = String(session.sessionId ?? session.id ?? "");
      const endedAt = Number(session.endedAt || 0);
      const updatedAt = Number(session.updatedAt || session.startedAt || 0);
      const recent = !updatedAt || Date.now() - updatedAt < ACTIVE_CHAT_RUN_TTL_MS;
      const sessionMessages = runtimeSessionMessages(session);
      const visibleSessionMessages = sessionMessages.filter((message) => message.role === "user" || message.role === "assistant");
      const latestSessionMessage = Array.isArray(session.messages) ? session.messages.at(-1) : null;
      const latestSessionRole = String(latestSessionMessage?.role ?? visibleSessionMessages.at(-1)?.role ?? "").toLowerCase();
      const localRun = readActiveChatRuns()[storageKey];
      const hasAssistantReply = latestSessionRole === "assistant"
        || visibleSessionMessages.some((message) => message.role === "assistant" && message.content.trim())
        || chatTranscriptHasAssistantReply(messagesByAgent[storageKey]);
      const localRunStillFresh = Boolean(localRun && localRun.status === "active" && Date.now() - localRun.updatedAt < CHAT_RESPONSE_STALL_TIMEOUT_MS && !hasAssistantReply);
      if (!recent || (!visibleSessionMessages.length && endedAt)) return;
      if (sessionKey) setChatRuntimeSessionIdsByKey((current) => (
        current[storageKey] === sessionKey ? current : { ...current, [storageKey]: sessionKey }
      ));
      const active = !endedAt && recent && !hasAssistantReply && (localRunStillFresh || latestSessionRole !== "assistant");
      if (active) {
        setChatStreamingByKey((current) => ({
          ...current,
          [storageKey]: current[storageKey]?.agentId === selectedAgent.id
            && current[storageKey]?.leafKey === selectedChatLeafKey
            && current[storageKey]?.hasChunk === visibleSessionMessages.some((message) => message.role === "assistant")
            ? current[storageKey]
            : {
              agentId: selectedAgent.id,
              leafKey: selectedChatLeafKey,
              hasChunk: visibleSessionMessages.some((message) => message.role === "assistant"),
            },
        }));
      } else {
        setChatStreamingByKey((current) => {
          if (!current[storageKey]) return current;
          const next = { ...current };
          delete next[storageKey];
          return next;
        });
      }
      const processEntries = (Array.isArray(session.messages) ? session.messages : [])
        .map((message: any) => {
          const entry = chatProcessFromSessionMessage(message);
          return entry ? { at: Number(message.createdAt || Date.now()), ...entry } : null;
        })
        .filter(Boolean);
      setChatProcessByKey((current) => {
        const existing = current[storageKey] ?? [];
        const seen = new Set(existing.map((entry) => `${entry.label}:${entry.detail ?? ""}`));
        const merged = [...existing];
        if (active && merged.length === 0) {
          merged.push({ at: Date.now(), label: "Runtime session active", detail: "Pulled from the agent session store." });
        }
        for (const entry of processEntries) {
          const key = `${entry.label}:${entry.detail ?? ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(entry);
        }
        return { ...current, [storageKey]: merged.slice(-80) };
      });
      if (visibleSessionMessages.length) {
        setMessagesByAgent((current) => {
          const existing = current[storageKey] ?? [];
          const seen = new Set(existing.map((message) => (
            message.sourceSessionId && typeof message.sourceIndex === "number"
              ? `${message.sourceSessionId}:${message.sourceIndex}`
              : `${message.role}:${message.content.trim()}`
          )));
          const additions = visibleSessionMessages.filter((message) => {
            const key = message.sourceSessionId && typeof message.sourceIndex === "number"
              ? `${message.sourceSessionId}:${message.sourceIndex}`
              : `${message.role}:${message.content.trim()}`;
            return !seen.has(key);
          });
          if (!additions.length) return current;
          return { ...current, [storageKey]: [...existing, ...additions].slice(-120) };
        });
      }
      if (active) {
        writeActiveChatRuns({
          ...readActiveChatRuns(),
          [storageKey]: {
            storageKey,
            agentId: selectedAgent.id,
            leafKey: selectedChatLeafKey,
            startedAt: Number(session.startedAt || Date.now()),
            updatedAt: Date.now(),
            sessionId: sessionKey,
            status: "active",
            requestLabel: visibleSessionMessages.find((message) => message.role === "user")?.content,
          },
        });
      } else {
        const activeRuns = readActiveChatRuns();
        if (activeRuns[storageKey]) {
          delete activeRuns[storageKey];
          writeActiveChatRuns(activeRuns);
        }
      }
      resumedRuntimeSessionKeysRef.current.add(`${storageKey}:${sessionKey || updatedAt}`);
    };
    void pollSession();
    const timer = window.setInterval(() => void pollSession(), chatStreamingByKey[storageKey] ? 5_000 : 12_000);
    return () => window.clearInterval(timer);
  }, [activeView, chatRuntimeSessionIdsByKey, chatStreamingByKey, hydrated, messagesByAgent, selectedAgent, selectedChatLeafKey, selectedChatRuntimeSessionId]);

  // eslint-disable-next-line react-hooks/refs
  updateAgentProfileRef.current = agentUpdateAgentProfile;
  // eslint-disable-next-line react-hooks/refs
  refreshRuntimeIntegrationsRef.current = agentRefreshRuntimeIntegrations;
  // eslint-disable-next-line react-hooks/refs
  refreshSharedSchedulesFromVaultRef.current = schedulerRefreshSharedSchedulesFromVault;
  // eslint-disable-next-line react-hooks/refs
  importExistingSchedulesRef.current = importExistingSchedules;
  // eslint-disable-next-line react-hooks/refs
  refreshMoneyClawStatusRef.current = walletRefreshMoneyClawStatus;
  // eslint-disable-next-line react-hooks/refs
  refreshHoneyLedgerRef.current = walletRefreshHoneyLedger;
  // eslint-disable-next-line react-hooks/refs
  observeHoneyUsageRef.current = walletObserveHoneyUsage;

  const tradingBrainRuntimeCards = useMemo(() => {
    const groups = new Map<string, { id: string; label: string; agents: AgentProfile[]; detail: string }>();
    const addAgentToGroup = (id: string, label: string, agent: AgentProfile, detail: string) => {
      const existing = groups.get(id) ?? { id, label, agents: [], detail };
      if (!existing.agents.some((candidate) => candidate.id === agent.id)) existing.agents.push(agent);
      groups.set(id, existing);
    };
    displayAgents.forEach((agent) => {
      const runtimeId = runtimeCardIdForAgent(agent);
      addAgentToGroup(runtimeId, RUNTIME_LABELS[agent.runtime] ?? agent.runtime, agent, `${agent.runtimeKind ?? "runtime"} runtime`);
      if (isCodexBackedAgent(agent)) addAgentToGroup("codex", "Codex", agent, "Codex-backed agent profile");
    });
    return Array.from(groups.values()).map((group) => {
      const attachedCount = group.agents.filter(hasTradingBrainPrompt).length;
      return {
        id: group.id,
        label: group.label,
        detail: group.detail,
        agentCount: group.agents.length,
        attachedCount,
        allAttached: group.agents.length > 0 && attachedCount === group.agents.length,
      };
    }).sort((left, right) => left.label.localeCompare(right.label));
  }, [displayAgents]);
  const tradingBrainAllRuntimeAttached = tradingBrainRuntimeCards.length > 0 && tradingBrainRuntimeCards.every((card) => card.allAttached);

  const setTradingBrainForRuntime = useCallback((runtimeId: string, attach: boolean) => {
    const targets = displayAgents.filter((agent) => (
      runtimeCardIdForAgent(agent) === runtimeId || (runtimeId === "codex" && isCodexBackedAgent(agent))
    ));
    targets.forEach((agent) => {
      updateAgentProfile(agent.id, {
        skillProfilePrompt: attach
          ? withTradingBrainPrompt(agent)
          : stripTradingBrainPrompt(agent.skillProfilePrompt ?? ""),
      });
    });
    setTradingBrainActionStatus(`${attach ? "Added Trading Brain to" : "Removed Trading Brain from"} ${targets.length} agent runtime${targets.length === 1 ? "" : "s"}.`);
  }, [displayAgents, updateAgentProfile]);

  const setTradingBrainForAllRuntimes = useCallback((attach: boolean) => {
    displayAgents.forEach((agent) => {
      updateAgentProfile(agent.id, {
        skillProfilePrompt: attach
          ? withTradingBrainPrompt(agent)
          : stripTradingBrainPrompt(agent.skillProfilePrompt ?? ""),
      });
    });
    setTradingBrainActionStatus(`${attach ? "Added Trading Brain to" : "Removed Trading Brain from"} all ${displayAgents.length} available agent runtime${displayAgents.length === 1 ? "" : "s"}.`);
  }, [displayAgents, updateAgentProfile]);

  useEffect(() => {
    if (!hydrated || activeView !== "scheduler" || !sharedVault.enabled) return;
    const syncKey = [
      sharedVault.vaultPath.trim(),
      sharedVault.scheduledFolder?.trim() || "",
      String(displayAgents.length),
    ].join("::");
    if (schedulerVaultAutoSyncKeyRef.current === syncKey) return;
    schedulerVaultAutoSyncKeyRef.current = syncKey;
    setScheduleImportStatus("Syncing shared vault automations...");
    void refreshSharedSchedulesFromVault().then(() => {
      setScheduleImportStatus((current) => (
        current === "Syncing shared vault automations..." ? "" : current
      ));
    });
  }, [activeView, displayAgents.length, hydrated, refreshSharedSchedulesFromVault, sharedVault.enabled, sharedVault.scheduledFolder, sharedVault.vaultPath]);

  // Auto-pull runtime schedules (e.g. Aeon autopilot skills from aeon.yml) into the dispatch board
  // when the scheduler view opens, so users don't have to click "Import existing" each time.
  useEffect(() => {
    if (!hydrated || activeView !== "scheduler") return;
    const runtimeAgentKey = displayAgents
      .filter((agent) => runtimeCan(agent, "schedules"))
      .map((agent) => agent.id)
      .join("::");
    if (!runtimeAgentKey) return;
    if (schedulerRuntimeAutoImportKeyRef.current === runtimeAgentKey) return;
    schedulerRuntimeAutoImportKeyRef.current = runtimeAgentKey;
    void importExistingSchedulesRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, displayAgents, hydrated]);
  // eslint-disable-next-line react-hooks/refs
  dispatchKanbanTaskToAgentRef.current = dispatchKanbanTaskToAgent;
  const { checkStatus, checkVaultStatus, checkControlRoomStatus, runVaultTailnetSync, pairSyncthingCollector, pairSyncthingVaultSync, inspectBrainNode, startBrainPan, moveBrainPan, endBrainPan, addChatFiles, handleChatFileChange, handleChatImageChange, removeChatAttachment, attachChatDirectory, attachChatRecentDirectory, removeChatDirectory, addQuickAddFiles, handleQuickAddFileChange, handleQuickAddImageChange, removeQuickAddAttachment, attachQuickAddDirectory, attachQuickAddRecentDirectory, removeQuickAddDirectory, addKanbanSteerFiles, handleKanbanSteerFileChange, handleKanbanSteerImageChange, removeKanbanSteerAttachment, attachKanbanSteerDirectory, attachKanbanSteerRecentDirectory, removeKanbanSteerDirectory, updateVoiceTranscript, appendVoiceTranscriptToInput, cleanupVoiceCapture, startVoiceWaveform, startAudioRecording, stopAudioRecording, sendMessage, generateKanbanTaskFromChat, dismissChatKanbanGeneration, chatKanbanGeneration } = useStatusChatInputController({ AbortController, CHAT_RESPONSE_STALL_TIMEOUT_MS, Uint8Array, appendMessage, attachmentSummary, brainDragMovedRef, brainDragRef, brainGraph, brainPan, busy: selectedChatStreaming, chatAttachments, chatAutoScrollRef, chatDirectories, chatMessageStorageKey, chatRuntimeSessionIdsByKey, chatSetupIssue, chooseDirectoryForMachine, clearActiveChatRun, collectorKey, createDefaultAgentWallet, discoveredMachines, honeyLedgerEnabled, hydrated, isManualAgentChatMessage, kanbanBoardSlug, kanbanReadyPickupInFlightRef, kanbanStorageBody, linkedDirectoryLabel, localKanbanMachineTarget, machineGroups, messageContentParts, messages, orchestrateReadyKanbanTask, quickAddMachineTarget, quickAddMachineTargets, readComposerFiles, recordActiveChatRun, recordRecentDirectory, recording, refreshHoneyLedger, refreshKanbanOnce, selectedAgent, selectedBrainNodeId, selectedChatDirectoryPath, selectedChatLeafKey, selectedChatRuntimeSessionId, selectedChatTargetRef, selectedKanbanAgent, selectedKanbanTask, setAttachmentError, setAttachmentMenuOpen, setBrainGraph, setBrainGraphStatus, setBrainPan, setChatAttachments, setChatDirectories, setChatProcessByKey, setControlRoomStatus, setChatRuntimeSessionIdsByKey, setChatStreamingByKey, setKanbanBoard, setKanbanError, setKanbanSteerAttachmentError, setKanbanSteerAttachmentMenuOpen, setKanbanSteerAttachments, setKanbanSteerDirectories, setKanbanSteerDraft, setKanbanStorage, setMessagesByAgent, setQuickAddAttachmentError, setQuickAddAttachmentMenuOpen, setQuickAddAttachments, setQuickAddDirectories, setQuickAddDrafts, setRecentDirectoriesExpanded, setRecording, setSelectedBrainNodeId, setSelectedChatPreview, setSelectedChatRuntimeSessionId, setStatus, setStatusAgentId, setText, setVaultStatus, setVaultSyncPending, setVaultSyncStatus, setVoiceBands, setVoiceTarget, setVoiceTranscript, sharedVault, speechRecognitionConstructor, syncthingAutoPairRef, tailscaleDevices, text, updateSharedVault, updateTask, upsertTask, voiceAnimationRef, voiceAudioContextRef, voiceRecognitionRef, voiceStreamRef, voiceTarget, voiceTranscriptRef, walletsByAgent });
  useDashboardPollingEffects({
    activeView, hydrated, refreshMirosharkArchive, refreshBrainGraph, refreshBrainSkills, refreshRecentDirectories, refreshMirosharkRun,
    sharedVault, brainSkills, brainSkillsLoading, walletPanelMode, refreshRuntimeUsage, refreshWalletVaultBackupStatus,
    refreshMaintenanceReport, refreshRuntimeFileRoots, hiveEnv, hiveEnvLoading, refreshHiveEnv, agentWorkerClassView,
    refreshNotifications, mirosharkRun, mirosharkPosts, mirosharkRunnerStatus, mirosharkArchiveSaveKeyRef, mirosharkScenario,
    setMirosharkArchiveStatus, isMiroSharkRunTerminal, mirosharkPlatform, setMirosharkRun, kanbanBoardSlug,
    kanbanIncludeArchived, kanbanTenantFilter, kanbanAssigneeFilter, kanbanSearch, setKanbanLoading, setKanbanError,
    setKanbanBoard, setKanbanBoards, setKanbanTenants, setKanbanAssignees, setKanbanStorage, setSelectedKanbanTaskId,
  });
  const updateSkillAutoSync = useCallback(async (
    providerId: BrainSkillProviderId,
    patch: Partial<{ autoImport: boolean; autoUpdate: boolean; trackRemovals: boolean; allowDelete: boolean }>,
  ) => {
    if (sharedVault.skillAutoSyncAll) return;
    const currentPolicy = sharedVault.skillAutoSync?.[providerId] ?? {
      autoImport: false,
      autoUpdate: false,
      trackRemovals: false,
      allowDelete: false,
    };
    const nextPolicy = { ...currentPolicy, ...patch };
    const nextSkillAutoSync = {
      ...(sharedVault.skillAutoSync ?? {}),
      [providerId]: nextPolicy,
    };
    updateSharedVault({ skillAutoSync: nextSkillAutoSync });
    setBrainSkillsStatus(`Configuring ${providerId} skill auto-sync...`);
    const response = await fetch("/api/obsidian/skills/auto-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        policies: nextSkillAutoSync,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; collectors?: Array<{ ok?: boolean }>; error?: string } | null;
    if (!response?.ok || !data?.ok) {
      setBrainSkillsStatus(data?.error ?? "Could not configure skill auto-sync.");
      return;
    }
    const configured = data.collectors?.filter((collector) => collector.ok).length ?? 0;
    setBrainSkillsStatus(`Skill auto-sync updated on ${configured} agent bridge${configured === 1 ? "" : "s"}.`);
  }, [setBrainSkillsStatus, sharedVault.skillAutoSync, sharedVault.skillAutoSyncAll, sharedVault.vaultPath, updateSharedVault]);
  const updateAllSkillAutoSync = useCallback(async (enabled: boolean) => {
    const providerIds = (brainSkills?.providers ?? BRAIN_SKILL_PROVIDER_FALLBACK).map((provider) => provider.id);
    const nextSkillAutoSync = enabled
      ? Object.fromEntries(providerIds.map((providerId) => [providerId, {
        autoImport: true,
        autoUpdate: true,
        trackRemovals: true,
        allowDelete: false,
      }]))
      : Object.fromEntries(providerIds.map((providerId) => [providerId, {
        autoImport: false,
        autoUpdate: false,
        trackRemovals: false,
        allowDelete: false,
      }]));
    updateSharedVault({ skillAutoSyncAll: enabled, skillAutoSync: nextSkillAutoSync });
    setBrainSkillsStatus(enabled ? "Configuring auto-sync for all skill providers..." : "Turning off provider skill auto-sync...");
    const response = await fetch("/api/obsidian/skills/auto-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        policies: nextSkillAutoSync,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; collectors?: Array<{ ok?: boolean }>; error?: string } | null;
    if (!response?.ok || !data?.ok) {
      setBrainSkillsStatus(data?.error ?? "Could not configure provider skill auto-sync.");
      return;
    }
    const configured = data.collectors?.filter((collector) => collector.ok).length ?? 0;
    setBrainSkillsStatus(`${enabled ? "Enabled" : "Disabled"} all-provider skill auto-sync on ${configured} agent bridge${configured === 1 ? "" : "s"}.`);
  }, [brainSkills?.providers, setBrainSkillsStatus, sharedVault.vaultPath, updateSharedVault]);

  const refreshGbrainStatus = useCallback(async () => {
    if (!sharedVault.enabled) {
      setGbrainActionStatus("Turn on the shared vault before checking GBrain.");
      return;
    }
    setGbrainBusy("status");
    const params = new URLSearchParams();
    if (sharedVault.vaultPath?.trim()) params.set("vaultPath", sharedVault.vaultPath.trim());
    if (sharedVault.brainServicesFolder?.trim()) params.set("brainServicesFolder", sharedVault.brainServicesFolder.trim());
    Object.entries(sharedVault.gbrain ?? {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      params.set(key, String(value));
    });
    const response = await fetch(`/api/brain/gbrain/status?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; status?: DashboardGBrainStatus; error?: string } | null;
    if (data?.status) {
      setGbrainStatus(data.status);
      setGbrainActionStatus(data.status.installed ? "GBrain status refreshed." : data.status.error ?? "GBrain is ready to install or connect.");
    } else {
      setGbrainActionStatus(data?.error ?? "Could not check GBrain status.");
    }
    setGbrainBusy("");
  }, [sharedVault.brainServicesFolder, sharedVault.enabled, sharedVault.gbrain, sharedVault.vaultPath]);

  async function runGbrainAction(action: "install" | "connect" | "import" | "embed" | "dream") {
    if (!sharedVault.enabled) {
      setGbrainActionStatus("Turn on the shared vault before changing GBrain.");
      return;
    }
    setGbrainBusy(action);
    setGbrainActionStatus(`${action === "embed" ? "Refreshing embeddings" : action === "dream" ? "Running dream cycle" : `${action[0].toUpperCase()}${action.slice(1)}ing GBrain`}...`);
    const response = await fetch(`/api/brain/gbrain/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        brainServicesFolder: sharedVault.brainServicesFolder.trim() || undefined,
        gbrain: {
          ...sharedVault.gbrain,
          enabled: action === "connect" || action === "install" ? true : sharedVault.gbrain.enabled,
        },
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; status?: DashboardGBrainStatus; error?: string } | null;
    if (!response?.ok || !data?.ok) {
      setGbrainActionStatus(data?.error ?? `GBrain ${action} failed.`);
      setGbrainBusy("");
      return;
    }
    if (data.status) setGbrainStatus(data.status);
    if ((action === "connect" || action === "install") && !sharedVault.gbrain.enabled) {
      updateSharedVault({ gbrain: { ...sharedVault.gbrain, enabled: true, installMode: action === "install" ? "local" : sharedVault.gbrain.installMode } });
    }
    setGbrainActionStatus(`GBrain ${action === "embed" ? "embedding refresh" : action} complete.`);
    setGbrainBusy("");
    if (action === "connect" || action === "install") void refreshBrainSkills();
  }

  async function queryGbrainFromDashboard() {
    const query = gbrainQuery.trim();
    if (!query) {
      setGbrainActionStatus("Enter a GBrain query first.");
      return;
    }
    setGbrainBusy("query");
    setGbrainActionStatus("Asking GBrain...");
    setGbrainQueryResult("");
    const response = await fetch("/api/brain/gbrain/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        brainServicesFolder: sharedVault.brainServicesFolder.trim() || undefined,
        gbrain: sharedVault.gbrain,
        query,
        mode: "think",
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; output?: string; status?: DashboardGBrainStatus; error?: string } | null;
    if (!response?.ok || !data?.ok) {
      setGbrainActionStatus(data?.error ?? "GBrain query failed.");
      setGbrainBusy("");
      return;
    }
    if (data.status) setGbrainStatus(data.status);
    setGbrainQueryResult(data.output || "(GBrain returned no text.)");
    setGbrainActionStatus("GBrain answer ready.");
    setGbrainBusy("");
  }

  const refreshTradingBrainStatus = useCallback(async () => {
    if (!sharedVault.enabled) {
      setTradingBrainActionStatus("Turn on the shared vault before checking Trading Brain.");
      return;
    }
    setTradingBrainBusy("status");
    const params = new URLSearchParams();
    if (sharedVault.vaultPath?.trim()) params.set("vaultPath", sharedVault.vaultPath.trim());
    if (sharedVault.brainServicesFolder?.trim()) params.set("brainServicesFolder", sharedVault.brainServicesFolder.trim());
    const response = await fetch(`/api/brain/trading-brain/status?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; status?: DashboardTradingBrainStatus; error?: string } | null;
    if (data?.status) {
      setTradingBrainStatus(data.status);
      setTradingBrainActionStatus(data.status.installed ? "Trading Brain status refreshed." : data.status.error ?? "Trading Brain is ready to install.");
    } else {
      setTradingBrainActionStatus(data?.error ?? "Could not check Trading Brain status.");
    }
    setTradingBrainBusy("");
  }, [sharedVault.brainServicesFolder, sharedVault.enabled, sharedVault.vaultPath]);

  async function installTradingBrainFromDashboard() {
    if (!sharedVault.enabled) {
      setTradingBrainActionStatus("Turn on the shared vault before installing Trading Brain.");
      return;
    }
    setTradingBrainBusy("install");
    setTradingBrainActionStatus("Installing Trading Brain scaffold...");
    const response = await fetch("/api/brain/trading-brain/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        brainServicesFolder: sharedVault.brainServicesFolder.trim() || undefined,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; status?: DashboardTradingBrainStatus; written?: string[]; error?: string } | null;
    if (!response?.ok || !data?.ok) {
      setTradingBrainActionStatus(data?.error ?? "Trading Brain install failed.");
      setTradingBrainBusy("");
      return;
    }
    if (data.status) setTradingBrainStatus(data.status);
    setTradingBrainActionStatus(`Trading Brain installed${data?.written?.length ? ` with ${data.written.length} new file${data.written.length === 1 ? "" : "s"}` : ""}.`);
    setTradingBrainBusy("");
    void refreshBrainGraph();
  }

  useEffect(() => {
    if (!hydrated || activeView !== "vault" || vaultPanelMode !== "brain-services") return;
    const refreshTimer = window.setTimeout(() => {
      void refreshGbrainStatus();
      void refreshTradingBrainStatus();
    }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [activeView, hydrated, refreshGbrainStatus, refreshTradingBrainStatus, vaultPanelMode]);

  const agentSettingsMachineName = agentCreateMachine?.name ?? roleModalAgent?.machineName ?? "this machine";
  const agentSettingsTitle = agentCreateMachine ? "Add agent" : "Agent settings";
  const agentSettingsDescription = agentCreateMachine
    ? `Create a runtime profile attached to ${agentSettingsMachineName}.`
    : "Manage role, memory, workspace, runtime access, and security for this agent.";
  const agentSettingsWorkerClass = agentCreateMachine ? agentCreateDraft.workerClass : roleModalAgent?.workerClass ?? "general";
  const agentSettingsWorkerPreset = beeWorkerPreset(agentSettingsWorkerClass);
  const agentSettingsCustomWorkers = agentCreateMachine
    ? agentCreateDraft.customWorkerClasses
    : roleModalAgent?.customWorkerClasses ?? (roleModalAgent?.customWorkerClass ? [roleModalAgent.customWorkerClass] : []);
  const { agentSettingsSelectedCustomWorkerId, agentSettingsCustomWorker, agentSettingsWorkerLabel, agentSettingsWorkerImage, agentSettingsSkillProfile, agentSettingsPreferredSkills, agentSettingsRuntime, agentSettingsProvider, agentSettingsModel, runtimeModelSelection, runtimeModelProviders, selectedRuntimeProvider, selectedRuntimeModels, selectedRuntimeModelId, selectedRuntimeModel, updateAgentRuntimeModel, agentSettingsIntegrationTarget, addHermesModelFromDraft, selectAgentWorkerClass, selectCustomWorkerClass, updateAgentSkillProfile, addAgentPreferredSkill, removeAgentPreferredSkill, openCustomWorkerClassCreator, applyCustomWorkerClass, toggleCustomWorkerSkill, uploadCustomWorkerImage, filteredCustomWorkerSkills, selectedHetznerServerType, showHivemindLinkConnectedBanner } = useAgentSettingsController({ HETZNER_SERVER_TYPE_OPTIONS, agentCreateDraft, agentCreateMachine, agentSettingsCustomWorkers, agentSettingsWorkerClass, agentSettingsWorkerPreset, agents, beeRoleIconPath, beeWorkerPreset, createAgentProfile, customWorkerDraft, customWorkerProfileFromDraft, customWorkerSkillSearch, hivemindLinkBannerDismissed, hivemindLinkConnectedUntil, hivemindLinkStatus, machineInitDraft, roleModalAgent, runRuntimeIntegrationAction, runtimeCount, runtimeIntegrationStatus, runtimeModelDraft, runtimeModelSelectionsByRuntime, setAgentCreateDraft, setAgentWorkerClassView, setCustomWorkerDraft, setCustomWorkerImageError, setCustomWorkerSkillSearch, setRuntimeModelDraft, sharedSkillOptions, updateAgentProfile });
  useEffect(() => {
    if (!roleModalAgent && !agentCreateMachine) return;
    let cancelled = false;
    const hintedAgents = agentCreateMachine?.agents ?? (roleModalAgent ? [roleModalAgent] : []);
    const integrationTargetsByRuntime = new Map<AgentRuntime, AgentProfile>();
    for (const agent of hintedAgents) {
      if (runtimeCan(agent, "modelSelection") && !integrationTargetsByRuntime.has(agent.runtime)) {
        integrationTargetsByRuntime.set(agent.runtime, agent);
      }
    }
    if (agentSettingsIntegrationTarget && runtimeCan(agentSettingsIntegrationTarget, "modelSelection")) {
      integrationTargetsByRuntime.set(agentSettingsIntegrationTarget.runtime, agentSettingsIntegrationTarget);
    }
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setRuntimeAvailability(hintedAgents.length
        ? Object.fromEntries(hintedAgents.map((agent) => [
          agent.runtime,
          { installed: true, detail: `${RUNTIME_LABELS[agent.runtime] ?? agent.runtime} is configured on this machine.` },
        ]))
        : {});
    });
    void fetch("/api/runtimes/availability", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data?.ok && data.runtimes) {
          setRuntimeAvailability((current) => ({ ...current, ...data.runtimes }));
        }
      })
      .catch(() => undefined);
    for (const target of integrationTargetsByRuntime.values()) {
      if (runtimeModelSelectionsByRuntime[target.runtime]) continue;
      void refreshRuntimeIntegrations(target);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentCreateMachine?.key, roleModalAgent?.id]);
  const showHivemindLinkSignInBanner = !hivemindLinkBannerDismissed
    && !showHivemindLinkConnectedBanner
    && Boolean(hivemindLinkStatus?.authUrl)
    && hivemindLinkStatus?.ok !== true;
  return (
    <main className="shell commandShell">
      <DashboardHeader {...{ Image, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, activeHeader, activeView, isWorkView, kanbanBoard, navItems, notificationClass, notificationSummary, setActiveView, setKanbanLoading, viewIcon }} />

      <div className="commandMain">
      <AgentsPanel {...{ AgentCell, AgentTaskList, Bot, Button, CellMenu, Check, CircleAlert, Copy, CopyPlus, ExternalLink, FleetView, MachineCell, MessageSquare, PlugZap, Plus, QUIET_SNAPSHOT_HOLD_MS, RefreshCcw, Settings2, Trash2, WalletCards, activeView, addAgentToMachine, agentWorkById, agents, appVersion, beeRoleLabel, busyAgentId, cleanActivityTitle, copiedUpdateDetailKey, copyUpdateDetail, deleteAgent, displayAgents, fleetCheckedAt, fleetClass, fleetDiscoveryLoading, fleetSnapshots, fleetUpdateDetailByMachine, fleetUpdateStatusByMachine, fleetViewData, formatRelativeTime, friendlyEmptyTitle, runtimeSessionIdFromTask, hivemindLinkSignInPolling, hivemindLinkSignInPollingRef, hivemindLinkStatus, hydrateRuntimeSessionChat, isCollectorAutoUpdateable, isMeaningfulActive, localDashboardHasUnpublishedChanges, machineGroups, machineNeedsChatBridgeRepair, machineNeedsEnvHttpSyncRepair, machineVersionCopy, markNotificationRead, openMachineInitModal, openSetupModal, renameMachine, renderAgentKey, requestDuplicateAgent, runMachineUpdate, selectedAgent, setActiveView, setAgentRenameDraft, setAgentRenameEditing, setAgentRoleModalId, setAgentRuntimeAdvancedOpen, setAgentRuntimeFolderEditing, setAgentRuntimeFolderStatus, setAgentSettingsPanel, setHivemindLinkBannerDismissed, setHivemindLinkConnectedUntil, setHivemindLinkSignInPolling, setSelectedAgentId, showHivemindLinkConnectedBanner, showHivemindLinkSignInBanner, startAgentChat, startAgentWorkChat, tailscaleStatus, taskChatLeafKey, trackAgentTaskOnKanban, updateStatusByMachine }} />
      <KanbanPanel {...{ AttachmentListMenuContent, AttachmentMenuContent, CellMenu, ChatMarkdown, Check, ChevronDown, ChevronRight, ComposerField, DEFAULT_SHARED_VAULT, ExternalLink, Eye, FolderOpen, Image, KANBAN_COLUMNS, KANBAN_STEER_TARGETS, MessageAttachments, MessageSquare, Paperclip, Plus, RotateCcw, Search, Settings2, activeView, addKanbanComment, attachKanbanCardDirectory, attachKanbanCardRecentDirectory, attachKanbanSteerDirectory, attachKanbanSteerRecentDirectory, attachQuickAddDirectory, attachQuickAddRecentDirectory, bulkPatchKanbanTasks, chatClass, commentDraft, createKanbanBoard, createKanbanTask, displayAgents, editAndInterruptKanbanTask, expandedKanbanCards, formatDurationShort, formatMessageTimestamp, formatRelativeTime, handleKanbanCardFileChange, handleKanbanCardImageChange, handleKanbanSteerFileChange, handleKanbanSteerImageChange, handleQuickAddFileChange, handleQuickAddImageChange, importNoteIntake, initialWorkHistory, isKanbanStaleWorkingTask, isKanbanTerminalMessage, isWorkView, kanbanAssigneeFilter, kanbanAssigneeOptions, kanbanBoard, kanbanBoardScrollRef, kanbanBoardScrollState, kanbanBoardSlug, kanbanBoards, kanbanBulkAssignee, kanbanBulkPending, kanbanCardAttachmentListOpen, kanbanCardAttachmentMenuOpen, kanbanCardDeliverableMenuOpen, kanbanCardFileInputRef, kanbanCardImageInputRef, kanbanCardMachineMenuOpen, kanbanCardMessage, kanbanCardRecentsExpanded, kanbanClass, kanbanEditDraft, kanbanEditPendingTaskId, kanbanError, kanbanEventLabel, kanbanIncludeArchived, kanbanInitialLoading, kanbanLoading, kanbanMachineTargets, kanbanPickupPreviewByTask, kanbanSearch, kanbanStaleAge, kanbanSteerAttachmentError, kanbanSteerAttachmentMenuOpen, kanbanSteerAttachmentMenuRef, kanbanSteerAttachments, kanbanSteerDirectories, kanbanSteerDraft, kanbanSteerFileInputRef, kanbanSteerImageInputRef, kanbanSteerTargetMenuOpen, kanbanSteerTargetMenuRef, kanbanSteerTargetStatus, kanbanSteeringTaskId, kanbanStorage, kanbanTaskBee, kanbanTaskMenuItems, kanbanTaskModal, kanbanTenantFilter, kanbanTenants, kanbanViewColumns, markKanbanTaskReviewed, moveKanbanTask, newBoardDraft, noteIntakePending, noteIntakePreview, noteIntakeStatus, openKanbanCardFilePicker, openKanbanTaskModal, patchKanbanTask, quickAddAttachmentError, quickAddAttachmentMenuOpen, quickAddAttachmentMenuRef, quickAddAttachments, quickAddDirectories, quickAddDrafts, quickAddFileInputRef, quickAddImageInputRef, quickAddMachineMenuOpen, quickAddMachineMenuRef, quickAddMachineTarget, quickAddMachineTargets, quickAddStatus, recentDirectories, recentDirectoriesExpanded, recording, removeKanbanCardAttachment, removeKanbanCardDirectory, removeKanbanSteerAttachment, removeKanbanSteerDirectory, removeQuickAddAttachment, removeQuickAddDirectory, scanNoteIntake, selectedKanbanAgent, selectedKanbanAgentMessages, selectedKanbanBulkIds, selectedKanbanComments, selectedKanbanEvents, selectedKanbanTask, selectedKanbanTaskId, selectedKanbanTaskIds, setActiveView, setCommentDraft, setExpandedKanbanCards, setKanbanAssigneeFilter, setKanbanBoardSlug, setKanbanBulkAssignee, setKanbanCardAttachmentListOpen, setKanbanCardAttachmentMenuOpen, setKanbanCardDeliverableMenuOpen, setKanbanCardMachineMenuOpen, setKanbanCardRecentsExpanded, setKanbanEditDraft, setKanbanIncludeArchived, setKanbanLoading, setKanbanSearch, setKanbanSteerAttachmentMenuOpen, setKanbanSteerDraft, setKanbanSteerTargetMenuOpen, setKanbanSteerTargetStatus, setKanbanTaskModal, setKanbanTenantFilter, setNewBoardDraft, setQuickAddAttachmentError, setQuickAddAttachmentMenuOpen, setQuickAddDrafts, setQuickAddMachineMenuOpen, setQuickAddMachineTargets, setQuickAddStatus, setRecentDirectoriesExpanded, setSelectedKanbanTaskId, setSelectedKanbanTaskIds, sharedVault, startAudioRecording, steerSelectedKanbanTask, stopAudioRecording, updateKanbanTaskMachine, updateSharedVault, voiceBands, voiceTarget, voiceTranscript, walletClass, workBoardStats }} />
      <SchedulerPanel {...{ AlignLeft, Button, Check, ChevronDown, Clock3, Cpu, FileText, FileUp, FolderOpen, Link, List, LoaderCircle, Paperclip, Pencil, Plus, Puzzle, RUNTIME_LABELS, Repeat2, SCHEDULER_MODEL_OPTIONS, SCHEDULE_PRESETS, SchedulerView, Search, Send, Sparkles, TaskModal, Trash2, activeView, addSchedulePath, addSchedulerStep, addSchedulerStepPath, browseSchedulerFolder, createSchedule, displayAgents, editSchedule, editingScheduleId, filteredSchedulerSkills, findScheduleForJob, fleetClass, importExistingSchedules, isSchedulerFilePath, machineGroups, openSkillBrowser, pickSchedulerFiles, pickSchedulerFolder, refreshSharedSchedulesFromVault, removeSchedule, removeSchedulePath, removeScheduleSkill, removeSchedulerStep, removeSchedulerStepPath, renderAgentKey, resetScheduleDraft, runScheduleNow, saveScheduleFromModal, scheduleDraft, scheduleImportStatus, scheduleImporting, schedulerAttachMenu, schedulerDraftOpen, schedulerJobs, schedulerModalInitial, schedulerPathDraft, schedulerPathKind, schedulerRunStates, schedulerSelectedStep, schedulerSkillSearch, schedules, selectedAgent, setScheduleDraft, setScheduleImportStatus, setSchedulerAttachMenu, setSchedulerDraftOpen, setSchedulerPathDraft, setSchedulerPathKind, setSchedulerSelectedStep, setSchedulerSkillSearch, sharedSkillOptions, aeonSkillOptions, toggleSchedule, toggleScheduleSkill, toggleSchedulerStepMode, toggleSchedulerStepSkill, updateSchedulerStep, updateSchedulerStepModel, vaultClass }} />
      <SwarmPanel {...{ SwarmView, activeView, allMirosharkTemplates, analyzeMirosharkRun, applyMirosharkTemplate, currentSwarmRun, displayAgents, launchMirosharkSwarm, loadMirosharkArchivedRun, mirosharkAnalysisAgentId, mirosharkAnalysisPending, mirosharkAnalysisResult, mirosharkAnalysisStatus, mirosharkArchiveLoading, mirosharkArchiveStatus, mirosharkExperimentPending, mirosharkExperimentStatus, mirosharkHelperPending, mirosharkHelperStatus, mirosharkMissingTemplateFields, mirosharkPlatform, mirosharkProgressLabel, mirosharkRounds, mirosharkRunPending, mirosharkScenario, mirosharkSelectedTemplate, mirosharkSelectedTemplateFields, mirosharkTemplateInputs, runMirosharkExperiment, runMirosharkScenarioHelper, runtimeModelSelectionsByRuntime, selectedAgent, selectedSwarmRunId, setMirosharkAnalysisAgentId, setMirosharkPlatform, setMirosharkRounds, setMirosharkScenario, startNewMirosharkSimulation, swarmAgents, swarmDecisions, swarmMarket, swarmRuns, swarmSocialPosts, swarmStatusLabel, swarmTemplates, updateMirosharkTemplateInput }} />
      <WalletPanel {...{ AGENT_PAYMENT_PROVIDER_COPY, AgentWalletCard, AgentWalletCardCompact, Button, ChevronLeft, Download, HandCoins, LoaderCircle, RUNTIME_LABELS, RefreshCcw, activeView, copyPaymentPrompt, createDefaultAgentWallet, createLocalWallet, displayAgents, claimAllHoneyToBankrHive, enableHoneyLedger, formatHiveAmount, formatRelativeTime, getSurvivalSnapshot, honeyLedgerEnabled, honeyStats, initializeCoreWalletRails, moneyClawStatusByEnvName, refreshRuntimeUsage, refreshWalletBalance, renderAgentKey, resetWalletBurnClock, returnAllHiveToHoney, runWalletVaultBackupAction, runtimeUsage, runtimeUsageLoading, saveMoneyClawKey, selectedAgent, selectedHoneyReward, selectedWallet, selectedWalletSnapshot, sendWalletUsdc, setSelectedAgentId, setWalletExpanded, setWalletPanelMode, testX402Fetch, updateWallet, updateWalletAction, vaultClass, walletActionsByAgent, walletClass, walletExpanded, walletPanelMode, walletStats, walletVaultBackupBusy, walletVaultBackupMessage, walletVaultBackupStatus, walletsByAgent }} />
      <VaultPanel {...{ Activity, BRAIN_SKILL_PROVIDER_FALLBACK, Bot, BrainCircuit, BrainGraphLoader, Button, Cell, Check, CircleAlert, Clock3, DEFAULT_SHARED_VAULT, Download, Eye, FileText, FolderOpen, GitBranch, Hexagon, Image, KeyRound, LoaderCircle, MemoryCell, Network, PlugZap, RefreshCcw, Repeat2, Sparkles, activeView, brainGraph, brainGraphEdgePath, brainGraphLoading, brainGraphStats, brainGraphStatus, brainLayout, brainNodePoints, brainPan, brainSkillAeonSyncing, brainSkillImportAllDescription, brainSkillImportAllLabel, brainSkillImportProvider, brainSkillImportSuccess, brainSkillImportableCount, brainSkills, brainSkillsLoading, brainSkillsStatus, checkControlRoomStatus, checkVaultStatus, controlRoomStatus, displayAgents, endBrainPan, formatBrainDate, gbrainActionStatus, gbrainBusy, gbrainQuery, gbrainQueryResult, gbrainStatus, hermesUpdateRequired, hermesUpdateRequiredDetail, importBrainSkills, inspectBrainNode, installTradingBrainFromDashboard, moveBrainPan, openSkillBrowser, pairSyncthingVaultSync, queryGbrainFromDashboard, refreshBrainGraph, refreshBrainSkills, refreshGbrainStatus, refreshRuntimeFileRoots, refreshTradingBrainStatus, runGbrainAction, runVaultTailnetSync, selectedAgent, selectedBrainNode, selectedBrainTargetIds, setActiveView, setGbrainQuery, setSkillBrowserSearch, setTradingBrainForAllRuntimes, setTradingBrainForRuntime, setVaultPanelMode, sharedVault, skillBrowserSearch, skillRequiresHermesUpdate, splitBrainLabel, startBrainPan, syncBrainSkillsToAeon, tradingBrainActionStatus, tradingBrainAllRuntimeAttached, tradingBrainBusy, tradingBrainRuntimeCards, tradingBrainStatus, updateAllSkillAutoSync, updateSharedVault, updateSkillAutoSync, vaultClass, vaultPanelMode, vaultStatus, vaultSyncPending, vaultSyncStatus, visibleBrainNodes, walletClass }} />
      {activeView === "integrations" ? <NangoIntegrationsView embedded /> : null}
      <UtilityPanels {...{ AgentEnvCard, Activity, Button, Check, ChevronDown, ChevronLeft, Download, EnvValueRow, FileText, FileUp, FolderOpen, LoaderCircle, MorePanel, NotificationsPanel, Pencil, Plus, RefreshCcw, RotateCcw, ShieldCheck, Sparkles, URL, Upload, activeView, addAgentEnvValue, addSharedEnvValue, agentEnvDrafts, agentSpecificEnvCount, displayAgents, fleetClass, formatRelativeTime, generateSharedEnvSecret, hiveEnvLoading, hiveEnvRestoring, hiveEnvSavingKey, hiveEnvStatus, hiveEnvSyncing, importSharedEnvEntries, listRuntimeFiles, maintenanceBusy, maintenanceMessage, maintenanceReport, markAllNotificationsRead, markNotificationRead, memoryTelemetry, memoryTelemetryLoading, notificationCursor, notificationGroups, notificationSummary, notifications, notificationsLoading, notificationsStatus, openRuntimeFile, promoteRuntimeEnvValue, refreshHiveEnv, refreshMaintenanceReport, refreshMemoryTelemetry, refreshNotifications, refreshRuntimeFileRoots, renderAgentKey, restoreSharedEnvBackup, revealedEnvValues, runMaintenanceAction, runtimeEnvSources, runtimeFileDraft, runtimeFileOpen, runtimeFilePath, runtimeFileRootKey, runtimeFileRoots, runtimeFileStatus, runtimeFiles, runtimeModelSelectionsByRuntime, saveAgentEnvValue, saveRuntimeFile, saveSharedEnvValue, selectedRuntimeEnvSource, setActiveView, setAgentEnvDrafts, setHiveEnvRuntimeSourceId, setRuntimeFileDraft, setRuntimeFileOpen, setRuntimeFilePath, setRuntimeFileRootKey, setSharedEnvAddMenuOpen, setSharedEnvDraft, setSharedEnvEditable, setSharedEnvImportOpen, setSharedEnvImportText, sharedBackupStatus, sharedEnvAddMenuOpen, sharedEnvCount, sharedEnvDraft, sharedEnvEditable, sharedEnvImport, sharedEnvImportChangedCount, sharedEnvImportDiff, sharedEnvImportNewCount, sharedEnvImportOpen, sharedEnvImportSameCount, sharedEnvImportText, sharedEnvImporting, sharedEnvSource, sharedVault, syncSharedEnvMachines, toggleEnvValue, updateNotificationSettings, vaultClass, walletClass }} />
      <AeonAutopilotPanel activeView={activeView} displayAgents={displayAgents} selectedAgentId={selectedAgentId} setAgents={setAgents} sharedVault={sharedVault} machineGroups={machineGroups} chooseDirectoryForMachine={chooseDirectoryForMachine} setActiveView={setActiveView} setSelectedAgentId={setSelectedAgentId} setAgentRoleModalId={setAgentRoleModalId} setAgentSettingsPanel={setAgentSettingsPanel} updateAgentProfile={updateAgentProfile}
        schedulerJobs={schedulerJobs}
        schedulerRunStates={schedulerRunStates}
        onSchedulerOpen={() => void importExistingSchedules()}
        onSchedulerToggleJob={(job) => void toggleSchedule(job.id)}
        onSchedulerRunJob={(job) => { const schedule = findScheduleForJob(job); if (schedule) void runScheduleNow(schedule); }}
        onSchedulerEditJob={(job) => { const schedule = findScheduleForJob(job); if (schedule) editSchedule(schedule); }}
        onSchedulerNewJob={(agentId?: string) => {
          const preferredAeonAgent = agentId ? displayAgents.find((agent) => agent.id === agentId && agent.runtime === "aeon") : undefined;
          const selectedAeonAgent = selectedAgent?.runtime === "aeon" ? selectedAgent : undefined;
          const aeonAgentId = preferredAeonAgent?.id ?? selectedAeonAgent?.id ?? displayAgents.find((agent) => agent.runtime === "aeon")?.id ?? displayAgents[0]?.id ?? "";
          resetScheduleDraft(aeonAgentId);
          setScheduleDraft((current) => ({ ...current, agentId: aeonAgentId }));
          setScheduleImportStatus("");
          setSchedulerDraftOpen(true);
        }}
      />
      <PhonePanel activeView={activeView} fleetClass={fleetClass} formatRelativeTime={formatRelativeTime} />
      <ChatPanel {...{ Activity, AgentResponseLoader, AlignLeft, BEE_WORKER_PRESET_LIST, BrainCircuit, Button, ChatMarkdown, Check, ChevronDown, ChevronRight, ChevronUp, CircleAlert, ComposerField, Copy, Cpu, Download, Eye, FileText, Folder, FolderOpen, FolderPlus, GitBranch, HERMES_UPDATE_INTEGRATION_KEYS, Hammer, Image, KanbanSquare, LoaderCircle, MessageAttachments, MessageSquare, Minus, Monitor, Pencil, PlugZap, Plus, RUNTIME_LABELS, RefreshCcw, Repeat2, Search, Send, Settings2, ShieldCheck, Sparkles, Terminal, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Upload, activeView, addAgentPreferredSkill, addHermesModelFromDraft, aeonEnvKeys, aeonEnvSyncStatus, aeonEnvSyncing, agentCreateDraft, agentCreateMachine, agentRenameDraft, agentRenameEditing, agentRuntimeAdvancedOpen, agentRuntimeFolderBrowsing, agentRuntimeFolderEditing, agentRuntimeFolderStatus, agentSettingsCustomWorker, agentSettingsCustomWorkers, agentSettingsDescription, agentSettingsIntegrationTarget, agentSettingsPanel, agentSettingsPreferredSkills, agentSettingsProvider, agentSettingsRuntime, agentSettingsSelectedCustomWorkerId, agentSettingsSkillProfile, agentSettingsTitle, agentSettingsWorkerClass, agentSettingsWorkerImage, agentSettingsWorkerLabel, agentSettingsWorkerPreset, agentWorkerClassView, applyCustomWorkerClass, attachChatDirectory, attachChatRecentDirectory, attachmentError, attachmentMenuOpen, attachmentMenuRef, beeRoleIconPath, beeRoleLabel, browseAgentRuntimeFolder, busy: selectedChatStreaming, changeChatWorkingDirectory, chatAttachments, chatClass, chatContextMenu, chatContextMenuRef, chatDirectories, chatDisplayContent, chatFileInputRef, chatFolderCreatorMachine, chatFolderCreatorParentOptions, chatFolderDraft, chatImageInputRef, chatKanbanGeneration, chatSidebarTree, checkStatus, closeAgentSettingsModal, closeChatFolderCreator, createAgentFromModal, createChatFolder, customWorkerDraft, customWorkerImageError, customWorkerImageInputRef, customWorkerSkillSearch, dismissChatKanbanGeneration, displayAgents, expandedChatFolders, filteredCustomWorkerSkills, filteredSkillBrowserSkills, fleetClass, formatAgentEnvText, formatRelativeTime, generateKanbanTaskFromChat, handleChatFileChange, handleChatImageChange, hasStreamingChunk: selectedChatHasStreamingChunk, hermesUpdateRequired, hermesUpdateRequiredDetail, importRemoteSkillToBrain, installGithubSkillToBrain, addWrittenSkillToBrain, lastAssistant, machineGroups, messagesEndRef, messagesScrollRef, openAgentSkillBrowser, openCustomWorkerClassCreator, openSkillBrowser, parseAgentEnvText, providerIconPath, providerIconRenderMode, recentDirectories, recentDirectoriesExpanded, recording, refreshRuntimeIntegrations, removeAgentPreferredSkill, removeChatAttachment, removeChatDirectory, roleModalAgent, runRuntimeIntegrationAction, runtimeAvailability, runtimeBackgroundPrompt, runtimeCapabilities, runtimeIconFallback, runtimeIconPath, runtimeIconRenderMode, runtimeIntegrationBusy, runtimeIntegrationMessage, runtimeIntegrationStatus, runtimeModelDraft, runtimeModelProviders, runtimeModelSelection, runtimeModelSelectionsByRuntime, runtimeModelSetupMode, runtimeSessionQuery, runtimeSessionResults, runtimeSetupDefinition, runtimeSetupKey, runtimeUpdateConfirmKey, searchRuntimeSessionsForAgent, selectAgentWorkerClass, selectCustomWorkerClass, selectedAgent, selectedChatDirectory, selectedChatMachine, selectedChatProcess, selectedRuntimeModel, selectedRuntimeModelId, selectedRuntimeModels, selectedRuntimeProvider, sendMessage, sessionNotice, setActiveView, setAeonEnvKeys, setAgentCreateDraft, setAgentRenameDraft, setAgentRenameEditing, setAgentRuntimeAdvancedOpen, setAgentRuntimeFolderEditing, setAgentRuntimeFolderStatus, setAgentSettingsPanel, setAgentWorkerClassView, setAttachmentMenuOpen, setChatContextMenu, setChatFolderDraft, setCustomWorkerDraft, setCustomWorkerSkillSearch, setExpandedChatFolders, setRecentDirectoriesExpanded, setRuntimeBackgroundPrompt, setRuntimeModelDraft, setRuntimeModelSetupMode, setRuntimeSessionQuery, setRuntimeSetupKey, setRuntimeUpdateConfirmKey, setSkillBrowserGithubOpen, setSkillBrowserGithubUrl, setSkillBrowserOpen, setSkillBrowserSearch, setSkillBrowserView, setSkillBrowserWrittenContent, setStatus, setStatusAgentId, setText, sharedVault, skillBrowserGithubInstalling, skillBrowserGithubOpen, skillBrowserGithubUrl, skillBrowserImporting, skillBrowserLoading, skillBrowserMode, skillBrowserOpen, skillBrowserSearch, skillBrowserStatus, skillBrowserView, skillBrowserWrittenContent, skillBrowserWriting, skillRequiresHermesUpdate, startAgentChat, startAudioRecording, status, statusAgentId, stopAudioRecording, switchRuntime, syncAeonEnvToGitHub, text, toggleCustomWorkerSkill, updateAgent, updateAgentProfile, updateAgentRuntimeModel, updateAgentSkillProfile, updateChatAutoScroll, uploadCustomWorkerImage, vaultClass, visibleMessages, voiceBands, voiceTarget, voiceTranscript, workerCapabilityBadges }} />

      <DashboardModals {...{ Button, Check, ChevronLeft, Copy, CopyPlus, FileText, FolderOpen, HETZNER_IMAGE_OPTIONS, HETZNER_LOCATION_OPTIONS, HETZNER_SERVER_TYPE_OPTIONS, LoaderCircle, Plus, SetupCell, copyMachineInitCommand, copySetupCommand, displayAgents, duplicateAgent, duplicateAgentDraft, fleetClass, initializeMachineProject, kanbanClass, loadMachineDirectories, machineDirectoryBrowser, machineInitCopiedKey, machineInitDraft, machineInitOpen, machineInitStatus, machineInitToken, machineInitTokenStatus, openHetznerEnvFile, saveHetznerToken, selectedHetznerServerType, setDuplicateAgentDraft, setMachineDirectoryBrowser, setMachineInitDraft, setMachineInitOpen, setMachineInitToken, setMachineInitTokenStatus, setSetupMachineKey, setupCollectorCommand, setupCommandCopied, setupMachine }} />
      </div>
    </main>
  );
}
