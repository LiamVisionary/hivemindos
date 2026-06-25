// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

"use client";
import { Component, FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ChangeEvent, type PointerEvent } from "react";
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
import type { AdaptiveOpenRouterConfig, AdaptiveRoutingConfig, AgentProfile, AgentRuntime, BeeWorkerClass, CustomWorkerClassProfile, ResearchMethod, RuntimeCapabilities, SharedVaultConfig, UsePodAgentConfig, VeniceAgentConfig, WorkerTaskPreference } from "@/lib/types/agent-runtime";
import type { AgentNotification, AgentNotificationSettings, AgentNotificationSummary } from "@/lib/types/agent-notifications";
import { HIVEMIND_OS_RUNTIME, createAgentProfile, DEFAULT_SHARED_VAULT, RUNTIME_CAPABILITIES, RUNTIME_DEFAULTS, RUNTIME_KINDS, RUNTIME_LABELS } from "@/lib/types/agent-runtime";
import type { AgentPaymentProvider, AgentWalletConfig, HoneyTreasuryConfig } from "@/lib/types/agent-wallet";
import type { KanbanBoard, KanbanLinkedDirectory, KanbanMachineTarget, KanbanStatus, KanbanTask, KanbanTaskAttachment } from "@/lib/types/kanban";
import type { RecentDirectory } from "@/lib/types/recent-directories";
import type { MiroSharkAnalysisMode, MiroSharkIntelligence } from "@/lib/services/miroshark/run-intelligence";
import { KANBAN_COLUMNS } from "@/lib/types/kanban";
import { AGENT_PAYMENT_PROVIDER_COPY } from "@/lib/config/agent-payments";
import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import { providerIconPath, providerIconRenderMode, runtimeIconFallback, runtimeIconPath, runtimeIconRenderMode } from "@/lib/config/runtime-icons";
import { BEE_WORKER_PRESET_LIST, beeWorkerPreset, renderBeeSoulTemplate } from "@/lib/config/bee-worker-presets";
import { logClientTelemetry } from "@/lib/utils/client-telemetry";
import { clearReportedIssue, reportIssue } from "@/lib/utils/issue-reporter";
import { loadDashboardStateSnapshot, removeDashboardStateValue, saveDashboardStateValue, type DashboardStateSnapshot, type SnapshotRetryInfo } from "@/lib/services/dashboard-state-client";
import { readNativeDashboardBootstrap } from "@/lib/native/dashboard-bootstrap";
import { getNativeAppVersion } from "@/lib/native/desktop-status";
import { getNativeFleetAppsCache, getNativeFleetDiscovery, getNativeTailscaleDevices } from "@/lib/native/fleet";
import { getNativeObsidianAgents } from "@/lib/native/obsidian";
import { readNativeHiveEnv } from "@/lib/native/hive-env";
import { readNativeMemoryTelemetry } from "@/lib/native/memory";
import { listenForQueenSettingsOpen } from "@/lib/native/queen-voice-events";
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
import { WalletPanelLoading } from "@/features/dashboard/views/WalletPanelLoading";
import { QUEEN_CLAP_WAKE_STORAGE_KEY } from "@/features/queen-voice/clap-activation";
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
import { activeConnectedAppBadges, type FleetHostedApp } from "@/components/fleet/active-apps";
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
  SchedulerView,
  SetupCell,
  TaskModal,
} from "@/features/dashboard/lazy-components";
import { ChatMarkdown } from "@/features/dashboard/ChatMarkdown";
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
  brainGraphLayout,
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
} from "@/features/dashboard/dashboard-display-helpers";
import { createStyleClass } from "@/features/dashboard/style-classes";
import {
  applyFleetSyncAutoRepairIssues,
  buildFleetSyncRepairTargets,
  runFleetSyncAutoRepairs,
  type FleetSyncAutoRepairState,
  type FleetSyncPeerHealth,
  type FleetSyncRepairTarget,
  type FleetSyncthingDevice,
} from "@/features/dashboard/fleet-sync-auto-repair";
import type { DashboardGBrainStatus, DashboardNeo4jBrainStatus, DashboardQmdStatus, DashboardSyntoStatus, DashboardTradingBrainStatus, DashboardView, RuntimeSessionSearchResult, WorkView } from "@/features/dashboard/dashboard-types";
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
import {
  agentAliasMap,
  agentMatchesSuppression,
  collectorKey,
  displayMachineName,
  filterSuppressedAgents,
  isLoopbackCollector,
  isMobileMachineOs,
  isVisibleFleetMachine,
  machineIdentityFromParts,
  renderAgentKey,
  SUPPRESSED_DISCOVERED_AGENTS_STORAGE_KEY,
  withoutAgentSuppression,
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
  clearPendingChatSaves,
  compactChatMessagesForStorage,
  diffChatMessagesForPendingSave,
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
  readPendingChatSaves,
  readStoredValue,
  runtimeCan,
  runtimeCapabilities,
  runtimeCount,
  runtimeSetupDefinition,
  seedAgents,
  mergePendingChatMessages,
  skillRequiresHermesUpdate,
  workerCapabilityBadges,
  writePendingChatSaves,
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
import { useTailnetAutoCleanup } from "@/features/dashboard/hooks/use-tailnet-auto-cleanup";
import { useRuntimeSessionSearch } from "@/features/dashboard/hooks/use-runtime-session-search";
import { useVisibilityAwarePolling } from "@/features/dashboard/hooks/use-visibility-aware-polling";
import { useFleetAutoUpdate } from "@/features/dashboard/hooks/use-fleet-auto-update";
import { useAgentController } from "@/features/dashboard/hooks/use-agent-controller";
import { useSchedulerController } from "@/features/dashboard/hooks/use-scheduler-controller";
import { useWalletFilesController } from "@/features/dashboard/hooks/use-wallet-files-controller";
import { useChatTreeController } from "@/features/dashboard/hooks/use-chat-tree-controller";
import { useFleetNotificationsController } from "@/features/dashboard/hooks/use-fleet-notifications-controller";
import { useKanbanTaskController } from "@/features/dashboard/hooks/use-kanban-task-controller";
import { useKanbanDispatchController } from "@/features/dashboard/hooks/use-kanban-dispatch-controller";
import { useStatusChatInputController } from "@/features/dashboard/hooks/use-status-chat-input-controller";
import { useAgentSettingsController } from "@/features/dashboard/hooks/use-agent-settings-controller";
import { dashboardTargetFromSearch } from "@/features/dashboard/dashboard-navigation";
import { chatTelemetryMessages, chatTelemetrySession } from "@/lib/services/telemetry/chat-dev-telemetry";
import { useDashboardNavigationController } from "@/features/dashboard/hooks/use-dashboard-navigation-controller";
import {
  baseDashboardScreenContext,
  mergeDashboardScreenContext,
  type DashboardContextItem,
} from "@/features/dashboard/screen-context";
// DashboardHeader is retained as a legacy component; the app now navigates via
// the left AppNavShelf (the redesigned hive shelf) instead of a top header.
import { DashboardAppCompletionToast, type DashboardAppCompletionNotification } from "@/features/dashboard/views/DashboardHeader";
import { AppNavShelf } from "@/components/fleet-hive";
import { DashboardCommandPalette } from "@/features/dashboard/views/DashboardCommandPalette";
import { DashboardPinsOverlay } from "@/features/dashboard/views/DashboardPinsOverlay";
import { ProgressRewardPopup } from "@/features/dashboard/progress-rewards/ProgressRewardPopup";
import { hydrateMruRuntime } from "@/features/dashboard/agent-mru-runtime";
import { useBeePilot } from "@/features/dashboard/bee-pilot/use-bee-pilot";
import { BeePilotPopup } from "@/features/dashboard/bee-pilot/BeePilotPopup";
import { QueenChatProvider } from "@/features/queen-voice/queen-chat-store";
import { BeeCursorOverlay } from "@/features/dashboard/bee-pilot/BeeCursorOverlay";
const kanbanClass = createStyleClass(kanbanStyles);
const fleetClass = createStyleClass(fleetStyles);
const chatClass = createStyleClass(chatStyles);
const notificationClass = createStyleClass(notificationStyles);
const vaultClass = createStyleClass(vaultStyles);
const walletClass = createStyleClass(walletStyles);
const DASHBOARD_ROUTE_LABELS: Record<DashboardView, string> = {
  agents: "Fleet", kanban: "Work", scheduler: "Scheduler", swarm: "Swarm", history: "Work History", wallet: "Wallets", trade: "Trade", vault: "Brain",
  integrations: "Integrations", maintenance: "Diagnostics", sessions: "Sessions", tools: "Tools", memory: "Memory", files: "Files",
  notifications: "Alerts", messaging: "Messaging", chat: "Agent Chat", more: "More", env: "Env", "my-apps": "Apps & Services", phone: "Phone", aeon: "Aeon", fusion: "Hive Fusion", governance: "Zero Human Company",
};

type DashboardRouteLoadingProps = { children?: React.ReactNode; detail?: string; label?: string; view?: DashboardView };
function DashboardRouteLoading({ children, detail, label, view }: DashboardRouteLoadingProps) {
  const routeLabel = label ?? (view ? DASHBOARD_ROUTE_LABELS[view] : "dashboard view");
  const routeTitle = routeLabel === "dashboard view" ? "Loading dashboard view" : `Loading ${routeLabel}`;
  const routeDetail = detail ?? (view ? `Opening ${routeLabel}` : "Opening the selected control surface");
  return (
    <section className={vaultClass("brainGraphPanel", "tabPanel")} aria-label={routeTitle} data-hivemindos-route-loading="true">
      <div className={vaultClass("brainGraphCanvas")}>
        <BrainGraphLoader title={routeTitle} detail={routeDetail} />
        {children}
      </div>
    </section>
  );
}

type DashboardRouteErrorBoundaryProps = {
  children: React.ReactNode;
  onRetry: () => void;
  resetKey: string;
  view: DashboardView;
};

class DashboardRouteErrorBoundary extends Component<DashboardRouteErrorBoundaryProps, { error: unknown }> {
  state = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidUpdate(previousProps: DashboardRouteErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <DashboardRouteLoading
        view={this.props.view}
        label="Reloading view"
        detail="A route chunk missed the current app bundle. Try again or switch views."
      >
        <button
          type="button"
          onClick={() => {
            this.setState({ error: null });
            this.props.onRetry();
          }}
          style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid var(--accent-strong, #2f6b52)", background: "transparent", color: "var(--accent-strong, #6fe0b0)", fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em", textTransform: "uppercase" }}
        >
          Try again
        </button>
      </DashboardRouteLoading>
    );
  }
}

function preloadDashboardChunk(loader: () => Promise<unknown>) {
  void loader().catch(() => undefined);
}
// Shown when hydration can't reach the local dashboard service after several
// tries. The snapshot loader keeps retrying in the background and this notice
// auto-clears the moment it succeeds, so a transient slow start just flashes
// briefly; a persistent failure gets a readable, recoverable screen instead of
// an endless honeycomb spinner that needs devtools to diagnose.
const HYDRATION_STALL_THRESHOLD = 5;
function HydrationStalledNotice({ info }: { info: SnapshotRetryInfo }) {
  const reason = info.kind === "network"
    ? "The local HivemindOS service isn't responding yet."
    : info.kind === "server"
      ? `The local HivemindOS service returned an error${info.status ? ` (${info.status})` : ""}.`
      : "The local HivemindOS service returned an unexpected response.";
  return (
    <section
      className={vaultClass("brainGraphPanel", "tabPanel")}
      aria-label="Connecting to HivemindOS"
      data-hivemindos-hydration-stalled={info.kind}
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--bg, #060a08)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div className={vaultClass("brainGraphCanvas")} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", maxWidth: 420, padding: 24, gap: 16 }}>
        <BrainGraphLoader title="Still connecting to HivemindOS…" detail={`${reason} It will connect automatically the moment it's ready.`} />
        <button
          type="button"
          onClick={() => { if (typeof window !== "undefined") window.location.reload(); }}
          style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid var(--accent-strong, #2f6b52)", background: "transparent", color: "var(--accent-strong, #6fe0b0)", fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em", textTransform: "uppercase" }}
        >
          Reload now
        </button>
        <p style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.6, margin: 0 }}>
          Still stuck after reloading? Fully quit and reopen the app. If it persists, send a photo of this screen to support.
        </p>
      </div>
    </section>
  );
}
const routeLoadingFor = (view: DashboardView) => function RouteLoading() { return <DashboardRouteLoading view={view} />; };
const routeLoadingFromProps = (props: { activeView?: DashboardView }) => <DashboardRouteLoading view={props?.activeView} />;
const AgentsPanel = dynamic(() => import("@/features/dashboard/views/AgentsPanel").then((mod) => mod.AgentsPanel), { ssr: false, loading: routeLoadingFor("agents") });
const KanbanPanel = dynamic(() => import("@/features/dashboard/views/KanbanPanel").then((mod) => mod.KanbanPanel), { ssr: false, loading: routeLoadingFromProps });
const SchedulerPanel = dynamic(() => import("@/features/dashboard/views/SchedulerPanel").then((mod) => mod.SchedulerPanel), { ssr: false, loading: routeLoadingFor("scheduler") });
const SwarmPanel = dynamic(() => import("@/features/dashboard/views/SwarmPanel").then((mod) => mod.SwarmPanel), { ssr: false, loading: routeLoadingFor("swarm") });
const WalletPanel = dynamic(() => import("@/features/dashboard/views/WalletPanel").then((mod) => mod.WalletPanel), { ssr: false, loading: WalletPanelLoading });
const TradePanel = dynamic(() => import("@/features/dashboard/views/trade/TradePanel").then((mod) => mod.TradePanel), { ssr: false, loading: routeLoadingFor("trade") });
const VaultPanel = dynamic(() => import("@/features/dashboard/views/VaultPanel").then((mod) => mod.VaultPanel), { ssr: false, loading: routeLoadingFor("vault") });
const UtilityPanels = dynamic(() => import("@/features/dashboard/views/UtilityPanels").then((mod) => mod.UtilityPanels), { ssr: false, loading: routeLoadingFromProps });
const ChatPanel = dynamic(() => import("@/features/dashboard/views/ChatPanel").then((mod) => mod.ChatPanel), { ssr: false, loading: routeLoadingFor("chat") });
const MorePanel = dynamic(() => import("@/features/dashboard/MorePanel").then((mod) => mod.MorePanel), { ssr: false, loading: routeLoadingFromProps });
const FusionPanel = dynamic(() => import("@/features/dashboard/views/FusionPanel").then((mod) => mod.FusionPanel), { ssr: false, loading: routeLoadingFor("fusion") });
const GovernancePanel = dynamic(() => import("@/features/dashboard/views/GovernancePanel").then((mod) => mod.GovernancePanel), { ssr: false, loading: routeLoadingFor("governance") });
const AeonAutopilotPanel = dynamic(() => import("@/components/aeon").then((mod) => mod.AeonAutopilotPanel), { ssr: false, loading: routeLoadingFor("aeon") });
const PhonePanel = dynamic(() => import("@/features/dashboard/views/PhonePanel").then((mod) => mod.PhonePanel), { ssr: false, loading: routeLoadingFor("phone") });
const DashboardModals = dynamic(() => import("@/features/dashboard/views/DashboardModals").then((mod) => mod.DashboardModals), { ssr: false });
const AgentSettingsModal = dynamic(() => import("@/features/dashboard/views/chat/AgentSettingsModal").then((mod) => mod.AgentSettingsModal), {
  ssr: false,
  // The chunk is normally preloaded after launch (see the idle preload effect
  // in DashboardApp); this overlay keeps the first click responsive when the
  // user beats the preload (worst in dev, where the chunk compiles on demand).
  loading: () => (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", padding: 20, background: "rgba(34,29,20,0.34)", backdropFilter: "blur(18px)" }}>
      <LoaderCircle size={28} className="animate-spin" style={{ color: "var(--fg)" }} />
    </div>
  ),
});
const SkillBrowserModal = dynamic(() => import("@/features/dashboard/views/chat/SkillBrowserModal").then((mod) => mod.SkillBrowserModal), { ssr: false });

// Opening the agent settings modal recomputes runtime availability; the result
// is usually identical to what's already in state. Returning the current
// reference lets React bail out instead of re-rendering the whole dashboard.
function sameRuntimeAvailability(
  current: Record<string, { installed: boolean; detail: string }>,
  next: Record<string, { installed: boolean; detail: string }>,
) {
  const currentKeys = Object.keys(current);
  if (currentKeys.length !== Object.keys(next).length) return false;
  return currentKeys.every((key) => {
    const a = current[key];
    const b = next[key];
    return !!b && a.installed === b.installed && a.detail === b.detail;
  });
}
const NotificationsPanel = dynamic(() => import("@/features/notifications/NotificationsPanel").then((mod) => mod.NotificationsPanel), { ssr: false });
const ConnectPhoneFab = dynamic(() => import("@/components/phone/ConnectPhoneFab").then((mod) => mod.ConnectPhoneFab), { ssr: false });
const QueenBeeVoiceOverlay = dynamic(() => import("@/features/queen-voice/QueenBeeVoiceOverlay").then((mod) => mod.QueenBeeVoiceOverlay), { ssr: false });
const PersistentHiveChat = dynamic(() => import("@/features/queen-voice/PersistentHiveChat").then((mod) => mod.PersistentHiveChat), { ssr: false });
const GuidedDashboardTour = dynamic(() => import("@/features/dashboard/GuidedDashboardTour").then((mod) => mod.GuidedDashboardTour), { ssr: false });
const IntegrationsView = dynamic(() => import("@/features/integrations/IntegrationsView"), { ssr: false, loading: routeLoadingFor("integrations") });
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
function isUtilityPanelView(view: DashboardView) {
  return ["maintenance", "sessions", "tools", "memory", "files", "notifications", "messaging", "env", "my-apps", "more"].includes(view);
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
    const existing = merged.get(key);
    merged.set(key, normalizeAgentProfile({
      ...(existing ?? {}),
      ...agent,
      usePod: existing?.usePod || agent.usePod ? { ...(existing?.usePod ?? {}), ...(agent.usePod ?? {}) } : undefined,
      venice: existing?.venice || agent.venice ? { ...(existing?.venice ?? {}), ...(agent.venice ?? {}) } : undefined,
    }));
  }
  return [...merged.values()];
}

function readActiveChatRuns(snapshot: DashboardStateSnapshot): Record<string, ActiveChatRunRecord> {
  try {
    const parsed = JSON.parse(snapshot[ACTIVE_CHAT_RUNS_STORAGE_KEY] || "{}") as Record<string, ActiveChatRunRecord>;
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

function compactActiveChatRuns(runs: Record<string, ActiveChatRunRecord>) {
  const now = Date.now();
  return Object.fromEntries(Object.entries(runs)
    .filter(([, run]) => now - run.updatedAt < ACTIVE_CHAT_RUN_TTL_MS));
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

function activeChatRunHasAssistantReply(messages: ChatMessage[] | undefined, run: ActiveChatRunRecord) {
  return chatTranscriptHasAssistantReply(chatMessagesForActiveRun(messages ?? [], run));
}

function chatMessagesForActiveRun(messages: ChatMessage[], run?: ActiveChatRunRecord) {
  if (!run?.startedAt) return messages;
  const cutoff = run.startedAt - 1_000;
  const recentMessages = messages.filter((message) => !message.createdAt || message.createdAt >= cutoff);
  const requestLabel = String(run.requestLabel ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (requestLabel) {
    for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
      const message = recentMessages[index];
      if (message?.role !== "user") continue;
      const content = normalizedChatMessageContent(message);
      const matchesRequest = Boolean(content) && (content === requestLabel
        || content.startsWith(requestLabel)
        || requestLabel.startsWith(content));
      if (matchesRequest) return recentMessages.slice(index);
    }
  }
  // The timestamp cutoff alone can include the previous turn's assistant reply
  // when the next turn starts within the same second (e.g. a queued message
  // auto-sending the moment the prior turn finishes), which made the new run
  // look already answered and killed its thinking indicator. A run's
  // transcript always starts with its own user prompt, so drop anything
  // recorded before the first in-window user message.
  const firstUserIndex = recentMessages.findIndex((message) => message.role === "user");
  return firstUserIndex >= 0 ? recentMessages.slice(firstUserIndex) : [];
}

function sessionMessageCreatedAtMs(message: { createdAt?: unknown; timestamp?: unknown }) {
  const raw = Number(message.createdAt ?? message.timestamp ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw < 10_000_000_000 ? Math.round(raw * 1000) : Math.round(raw);
}

function chatProcessEventsFromSessionMessages(messages: unknown[], run?: Pick<ActiveChatRunRecord, "startedAt" | "runId">) {
  const cutoff = run?.startedAt ? run.startedAt - 2_000 : 0;
  return messages
    .map((message: any) => {
      const createdAt = sessionMessageCreatedAtMs(message);
      if (cutoff && (!createdAt || createdAt < cutoff)) return null;
      const entry = chatProcessFromSessionMessage(message);
      return entry ? { at: createdAt || Date.now(), runId: run?.runId, ...entry } : null;
    })
    .filter(Boolean) as Array<{ at: number; label: string; detail?: string; status?: string; runId?: string }>;
}

function chatProcessFromSessionMessage(message: ChatMessage | { role?: string; content?: string }) {
  const role = String(message?.role ?? "").trim().toLowerCase();
  const content = String(message?.content ?? "").trim();
  if (!content || role === "user" || role === "assistant") return null;
  if (role === "tool" && /^Runtime event$/i.test(content)) return null;
  const detail = content.replace(/\s+/g, " ").slice(0, 180);
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
  const rawMessages = Array.isArray((session as { messages?: unknown[] } | null)?.messages)
    ? (session as { messages: unknown[] }).messages
    : [];
  const sessionId = String((session as { sessionId?: string; id?: string } | null)?.sessionId ?? (session as { id?: string } | null)?.id ?? "");
  const output: ChatMessage[] = [];
  let pendingProcessEvents: Array<{ at: number; label: string; detail?: string; status?: string }> = [];
  for (const message of rawMessages.filter((item): item is { role?: string; content?: string; createdAt?: number; index?: number } => (
      typeof item === "object"
      && item !== null
      && typeof (item as { content?: unknown }).content === "string"
    ))) {
    const processEvent = chatProcessFromSessionMessage(message);
    if (processEvent) {
      pendingProcessEvents.push({ at: Number(message.createdAt || Date.now()), ...processEvent });
      continue;
    }
    const role = message.role === "assistant" || message.role === "system" || message.role === "user" ? message.role : "system";
    const normalizedMessage: ChatMessage = {
      role,
      content: message.content ?? "",
      createdAt: typeof message.createdAt === "number" ? message.createdAt : undefined,
      sourceSessionId: sessionId || undefined,
      sourceIndex: typeof message.index === "number" ? message.index : undefined,
      surface: role === "assistant" || role === "user" ? "chat" : undefined,
      processEvents: role === "assistant" && pendingProcessEvents.length ? pendingProcessEvents : undefined,
    };
    output.push(...splitCombinedUserAssistantMessage(normalizedMessage));
    if (role === "assistant" && pendingProcessEvents.length) pendingProcessEvents = [];
  }
  if (pendingProcessEvents.length) {
    output.push({
      role: "assistant",
      content: "",
      createdAt: pendingProcessEvents.at(-1)?.at,
      sourceSessionId: sessionId || undefined,
      surface: "chat",
      processEvents: pendingProcessEvents,
    });
  }
  return output;
}

function runtimeSessionIdFromChatLeafKey(leafKey = "") {
  const marker = "-hermes-state:";
  const markerIndex = leafKey.indexOf(marker);
  if (markerIndex === -1) return "";
  const afterMarker = leafKey.slice(markerIndex + marker.length);
  return afterMarker.split("-hermes-state-")[0]?.trim() ?? "";
}

function normalizedChatMessageContent(message: Pick<ChatMessage, "content">) {
  return message.content.replace(/\s+/g, " ").trim().toLowerCase();
}

function sameVisibleChatMessage(left: ChatMessage | undefined, right: ChatMessage | undefined) {
  if (!left || !right) return false;
  return left.role === right.role && normalizedChatMessageContent(left) === normalizedChatMessageContent(right);
}

function chatMessageCreatedAtMs(message: Pick<ChatMessage, "createdAt"> | undefined) {
  const raw = Number(message?.createdAt || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw < 10_000_000_000 ? Math.round(raw * 1000) : Math.round(raw);
}

function userMessagesLikelySameTurn(localMessage: ChatMessage | undefined, sessionMessage: ChatMessage | undefined) {
  if (!localMessage || !sessionMessage || localMessage.role !== "user" || sessionMessage.role !== "user") return false;
  if (sameVisibleChatMessage(localMessage, sessionMessage)) return true;
  const localContent = normalizedChatMessageContent(localMessage);
  const sessionContent = normalizedChatMessageContent(sessionMessage);
  if (!localContent || !sessionContent) return false;
  const contentLooksRelated = localContent.startsWith(sessionContent)
    || sessionContent.startsWith(localContent)
    || (localContent.length <= 32 && sessionContent.includes(localContent))
    || (sessionContent.length <= 32 && localContent.includes(sessionContent));
  const localAt = chatMessageCreatedAtMs(localMessage);
  const sessionAt = chatMessageCreatedAtMs(sessionMessage);
  const closeInTime = Boolean(localAt && sessionAt && Math.abs(localAt - sessionAt) <= 30_000);
  const genericTurnText = /^(?:media message|\(sent attachments\)|linked \d+ director(?:y|ies))$/i;
  return contentLooksRelated || (closeInTime && (genericTurnText.test(localContent) || genericTurnText.test(sessionContent)));
}

function combinedUserAssistantSplitIndex(content: string) {
  const markers = [
    /\*\*(?=(?:Private x402|[^*\n]{0,120}\b(?:ready|complete|unavailable|failed)\b))/i,
    /\n(?=(?:Private x402|Endpoint\s+[`'"]?https?:\/\/|HTTP status|Content received:))/i,
  ];
  return markers.reduce((best, pattern) => {
    const match = pattern.exec(content);
    if (!match || !match.index) return best;
    return best < 0 ? match.index : Math.min(best, match.index);
  }, -1);
}

function assistantTailLooksLikeResponse(content: string) {
  return /Private x402|Reply\s+`?confirm|Endpoint\s+[`'"]?https?:\/\/|HTTP status|Content received:|^\*\*[^*\n]{0,120}\b(?:ready|complete|unavailable|failed)\b/i.test(content.trim());
}

function splitCombinedUserAssistantMessage(message: ChatMessage): ChatMessage[] {
  if (message.role !== "user") return [message];
  const content = message.content ?? "";
  const splitIndex = combinedUserAssistantSplitIndex(content);
  if (splitIndex <= 0) return [message];
  const userContent = content.slice(0, splitIndex).trimEnd();
  const assistantContent = content.slice(splitIndex).trimStart();
  if (!userContent || !assistantTailLooksLikeResponse(assistantContent)) return [message];
  return [
    { ...message, content: userContent },
    {
      role: "assistant",
      content: assistantContent,
      createdAt: Number(message.createdAt || 0) ? Number(message.createdAt) + 1 : undefined,
      sourceSessionId: message.sourceSessionId,
      sourceIndex: typeof message.sourceIndex === "number" ? message.sourceIndex + 0.1 : undefined,
      surface: "chat",
    },
  ];
}

function findLastChatMessageIndex(messages: ChatMessage[], predicate: (message: ChatMessage) => boolean) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index])) return index;
  }
  return -1;
}

function findNextChatUserIndex(messages: ChatMessage[], startIndex: number) {
  for (let index = startIndex + 1; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function withPreservedProcessEvents(nextMessage: ChatMessage, previousMessage?: ChatMessage) {
  let next = nextMessage;
  const mergedProcessEvents = mergeChatProcessEvents(previousMessage?.processEvents, next.processEvents);
  if (mergedProcessEvents.length) {
    next = { ...next, processEvents: mergedProcessEvents };
  }
  if (previousMessage?.applicationGeneration && !next.applicationGeneration) {
    next = { ...next, applicationGeneration: previousMessage.applicationGeneration };
  }
  if (previousMessage?.imageGeneration && !next.imageGeneration) {
    next = { ...next, imageGeneration: previousMessage.imageGeneration };
  }
  return next;
}

function mergeChatProcessEvents(
  first: ChatMessage["processEvents"] = [],
  second: ChatMessage["processEvents"] = [],
) {
  const output: NonNullable<ChatMessage["processEvents"]> = [];
  const indexByKey = new Map<string, number>();
  for (const event of [...(first ?? []), ...(second ?? [])]) {
    if (!event) continue;
    const key = [event.runId ?? "", event.label ?? "", event.detail ?? "", event.status ?? ""].join("\u001f");
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, output.length);
      output.push(event);
    } else if (Number(event.at ?? 0) >= Number(output[existingIndex]?.at ?? 0)) {
      output[existingIndex] = event;
    }
  }
  return output.sort((left, right) => Number(left.at ?? 0) - Number(right.at ?? 0)).slice(-80);
}

function chatMessageHasActiveSurface(message?: ChatMessage) {
  return Boolean(
    message
    && (
      message.content.trim()
      || message.agentPrompt
      || (message.processEvents?.length ?? 0) > 0
      || message.applicationGeneration
      || message.imageGeneration
    ),
  );
}

function chatMessageHasGenerationSurface(message?: ChatMessage) {
  return Boolean(message?.applicationGeneration || message?.imageGeneration);
}

function dedupeChatTranscript(messages: ChatMessage[]) {
  const output: ChatMessage[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (sameVisibleChatMessage(output.at(-1), message)) {
      const previous = output.at(-1);
      if ((message.processEvents?.length ?? 0) > 0 && !(previous?.processEvents?.length ?? 0)) {
        output[output.length - 1] = { ...previous, processEvents: message.processEvents } as ChatMessage;
      }
      continue;
    }
    if (message.role === "user") {
      const previousUserIndex = findLastChatMessageIndex(output, (item) => sameVisibleChatMessage(item, message));
      if (previousUserIndex >= 0) {
        const between = output.slice(previousUserIndex + 1);
        const duplicateActiveTurn = between.length > 0 && between.every((item) => (
          item.role === "assistant"
          && !chatMessageHasActiveSurface(item)
        ));
        if (duplicateActiveTurn) continue;
        const nextAssistant = messages[index + 1];
        const previousAssistant = [...between].reverse().find((item) => item.role === "assistant" && chatMessageHasActiveSurface(item));
        if (
          nextAssistant?.role === "assistant"
          && previousAssistant
          && sameVisibleChatMessage(previousAssistant, nextAssistant)
        ) {
          const previousAssistantIndex = findLastChatMessageIndex(output, (item) => sameVisibleChatMessage(item, previousAssistant));
          if (previousAssistantIndex >= 0) {
            output[previousAssistantIndex] = withPreservedProcessEvents(output[previousAssistantIndex], nextAssistant);
          }
          index += 1;
          continue;
        }
      }
    }
    if (message.role === "assistant" && chatMessageHasActiveSurface(message)) {
      const currentUser = [...output].reverse().find((item) => item.role === "user");
      const previousCardAssistantIndex = findLastChatMessageIndex(output, (item) => (
        item.role === "assistant"
        && chatMessageHasGenerationSurface(item)
      ));
      const previousCardUser = [...output.slice(0, previousCardAssistantIndex)].reverse().find((item) => item.role === "user");
      if (
        previousCardAssistantIndex >= 0
        && sameVisibleChatMessage(previousCardUser, currentUser)
        && !sameVisibleChatMessage(output[previousCardAssistantIndex], message)
      ) {
        output[previousCardAssistantIndex] = withPreservedProcessEvents(message, output[previousCardAssistantIndex]);
        continue;
      }
      const previousAssistantIndex = findLastChatMessageIndex(output, (item) => sameVisibleChatMessage(item, message));
      const previousUser = [...output.slice(0, previousAssistantIndex)].reverse().find((item) => item.role === "user");
      if (previousAssistantIndex >= 0 && sameVisibleChatMessage(previousUser, currentUser)) {
        output[previousAssistantIndex] = withPreservedProcessEvents(message, output[previousAssistantIndex]);
        continue;
      }
    }
    output.push(message);
  }
  return output;
}

function preserveLocalTurnProcessEvents(sessionTurn: ChatMessage[], localTurn: ChatMessage[]) {
  const localAssistantProcessMessages = localTurn.filter((message) => (
    message.role === "assistant"
    && ((message.processEvents?.length ?? 0) > 0 || message.applicationGeneration || message.imageGeneration)
  ));
  const localUserMessage = localTurn.find((message) => message.role === "user" && message.content.trim());
  let fallbackProcessIndex = 0;
  return sessionTurn.map((message) => {
    if (message.role === "user" && userMessagesLikelySameTurn(localUserMessage, message)) {
      return {
        ...message,
        content: localUserMessage?.content ?? message.content,
        attachments: localUserMessage?.attachments,
        surface: localUserMessage?.surface ?? message.surface,
        createdAt: localUserMessage?.createdAt ?? message.createdAt,
      };
    }
    if (message.role !== "assistant") return message;
    const sameContentProcessMessage = localAssistantProcessMessages.find((localMessage) => (
      sameVisibleChatMessage(localMessage, message)
    ));
    const fallbackProcessMessage = localAssistantProcessMessages[fallbackProcessIndex];
    if (!sameContentProcessMessage && fallbackProcessMessage) fallbackProcessIndex += 1;
    const processSource = sameContentProcessMessage ?? fallbackProcessMessage;
    if (!processSource) return message;
    return {
      ...message,
      processEvents: mergeChatProcessEvents(processSource.processEvents, message.processEvents),
      applicationGeneration: message.applicationGeneration ?? processSource.applicationGeneration,
      imageGeneration: message.imageGeneration ?? processSource.imageGeneration,
    };
  });
}

function mergeRuntimeSessionMessages(existing: ChatMessage[], sessionMessages: ChatMessage[]) {
  const visibleSessionMessages = sessionMessages.filter((message) => message.role === "user" || message.role === "assistant");
  if (!visibleSessionMessages.length) return existing;
  const sessionUser = visibleSessionMessages.find((message) => message.role === "user" && message.content.trim());
  if (sessionUser) {
    const localUserIndex = findLastChatMessageIndex(existing, (message) => userMessagesLikelySameTurn(message, sessionUser));
    if (localUserIndex >= 0) {
      const nextLocalUserIndex = findNextChatUserIndex(existing, localUserIndex);
      const localTurn = existing.slice(localUserIndex, nextLocalUserIndex >= 0 ? nextLocalUserIndex : existing.length);
      const sessionTurn = preserveLocalTurnProcessEvents(visibleSessionMessages, localTurn);
      return dedupeChatTranscript([
        ...existing.slice(0, localUserIndex),
        ...sessionTurn,
        ...(nextLocalUserIndex >= 0 ? existing.slice(nextLocalUserIndex) : []),
      ]).slice(-120);
    }
  }
  let enrichedExisting = existing;
  for (const sessionMessage of visibleSessionMessages) {
    if (sessionMessage.role !== "assistant" || !sessionMessage.processEvents?.length) continue;
    const existingIndex = findLastChatMessageIndex(enrichedExisting, (message) => sameVisibleChatMessage(message, sessionMessage));
    if (existingIndex < 0) continue;
    const existingMessage = enrichedExisting[existingIndex];
    if ((existingMessage.processEvents?.length ?? 0) >= sessionMessage.processEvents.length) continue;
    enrichedExisting = [
      ...enrichedExisting.slice(0, existingIndex),
      { ...existingMessage, processEvents: sessionMessage.processEvents },
      ...enrichedExisting.slice(existingIndex + 1),
    ];
  }
  const seen = new Set(enrichedExisting.map((message) => `${message.role}:${normalizedChatMessageContent(message)}`));
  const additions = visibleSessionMessages.filter((message) => {
    const key = `${message.role}:${normalizedChatMessageContent(message)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!additions.length) return enrichedExisting === existing ? dedupeChatTranscript(existing).slice(-120) : dedupeChatTranscript(enrichedExisting).slice(-120);
  return dedupeChatTranscript([...enrichedExisting, ...additions]).slice(-120);
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
const APP_COMPLETION_MIN_VISIBLE_MS = 10_000;
const APP_COMPLETION_TOAST_VISIBLE_MS = 6_000;
const FLEET_SYNC_HEALTH_POLL_MS = 30_000;
const FLEET_SYNC_HEALTH_INITIAL_DELAY_MS = 2_500;
const FLEET_PASSIVE_REFRESH_DELAY_MS = 2_000;
const FLEET_EMPTY_REFRESH_DELAY_MS = 300;
const FLEET_SYNC_STALLED_MS = 5 * 60 * 1000;
const FLEET_SYNC_REPAIR_TIMEOUT_MS = 70_000;
const FLEET_AUTO_UPDATE_PAUSED_STORAGE_KEY = "hivemindos.fleet.autoUpdate.paused.v1";
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
  suppressedDiscoveredAgents: ".suppressedDiscoveredAgents.v1",
};

type ActiveChatRunRecord = {
  storageKey: string;
  agentId: string;
  leafKey: string;
  startedAt: number;
  updatedAt: number;
  runId?: string;
  requestLabel?: string;
  sessionId?: string;
  status?: "active" | "stalled";
};

function parseStoredSuppressedDiscoveredAgentKeys(snapshot: DashboardStateSnapshot = {}) {
  const raw = readStoredValue(snapshot, SUPPRESSED_DISCOVERED_AGENTS_STORAGE_KEY, STORAGE_SUFFIXES.suppressedDiscoveredAgents);
  if (!raw) return new Set<string>();
  try {
    const parsed = JSON.parse(raw) as unknown;
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { keys?: unknown[] }).keys)
        ? (parsed as { keys: unknown[] }).keys
        : [];
    return new Set(values.filter((key): key is string => typeof key === "string" && Boolean(key.trim())));
  } catch {
    return new Set<string>();
  }
}

type ChatStreamState = {
  agentId: string;
  leafKey: string;
  hasChunk: boolean;
  startedAt?: number;
  runId?: string;
};

type DashboardAppProps = {
  initialChatAgentId?: string;
  initialChatLeaf?: string;
  initialView?: DashboardView;
  initialVaultPanelMode?: DashboardVaultPanelMode;
  initialWorkHistory?: WorkHistoryPayload;
};

export type DashboardVaultPanelMode = "hive-vault" | "shared-skills" | "brain-services" | "env" | "config";

export default function DashboardApp({ initialChatAgentId, initialChatLeaf, initialView, initialVaultPanelMode, initialWorkHistory }: DashboardAppProps = {}) {
  // Initialize all persisted state with deterministic seed values so SSR and
  // first client render match. Server-backed dashboard state is read inside a useEffect below.
  const [hydrated, setHydrated] = useState(false);
  // Non-null once the snapshot load has failed enough times to warrant telling
  // the user (see HydrationStalledNotice). Cleared on successful hydration.
  const [hydrationStalled, setHydrationStalled] = useState<SnapshotRetryInfo | null>(null);
  const dashboardStateRef = useRef<DashboardStateSnapshot>({});
  const [agents, setAgents] = useState<AgentProfile[]>(seedAgents);
  const agentVaultHydratedRef = useRef(false);
  const aeonProfilePruneKeyRef = useRef("");
  const [selectedAgentId, setSelectedAgentId] = useState(initialChatAgentId || seedAgents()[0]?.id || "");
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
  const [brainPan, setBrainPan] = useState({ x: 0, y: 0, scale: 1 });
  const [brainSkills, setBrainSkills] = useState<BrainSkillInventory | null>(null);
  const [brainSkillsStatus, setBrainSkillsStatus] = useState("");
  const [brainSkillsLoading, setBrainSkillsLoading] = useState(false);
  const [gbrainStatus, setGbrainStatus] = useState<DashboardGBrainStatus | null>(null);
  const [gbrainActionStatus, setGbrainActionStatus] = useState("");
  const [gbrainBusy, setGbrainBusy] = useState("");
  const [gbrainQuery, setGbrainQuery] = useState("");
  const [gbrainQueryResult, setGbrainQueryResult] = useState("");
  const [qmdStatus, setQmdStatus] = useState<DashboardQmdStatus | null>(null);
  const [qmdActionStatus, setQmdActionStatus] = useState("");
  const [qmdBusy, setQmdBusy] = useState("");
  const [qmdQuery, setQmdQuery] = useState("");
  const [qmdQueryResult, setQmdQueryResult] = useState("");
  const [neo4jStatus, setNeo4jStatus] = useState<DashboardNeo4jBrainStatus | null>(null);
  const [neo4jActionStatus, setNeo4jActionStatus] = useState("");
  const [neo4jBusy, setNeo4jBusy] = useState("");
  const [neo4jQuery, setNeo4jQuery] = useState("MATCH (m:Memory)-[:MENTIONS]->(e:Entity) RETURN m.title AS memory, e.name AS entity LIMIT 25");
  const [neo4jQueryResult, setNeo4jQueryResult] = useState("");
  const [syntoStatus, setSyntoStatus] = useState<DashboardSyntoStatus | null>(null);
  const [syntoActionStatus, setSyntoActionStatus] = useState("");
  const [syntoBusy, setSyntoBusy] = useState("");
  const [syntoQuery, setSyntoQuery] = useState("");
  const [syntoQueryResult, setSyntoQueryResult] = useState("");
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
  const [skillBrowserView, setSkillBrowserView] = useState<"catalog" | "installed" | "packs" | "audit" | "write" | "fusion">("catalog");
  const [skillBrowserWrittenContent, setSkillBrowserWrittenContent] = useState("");
  const [skillBrowserWriting, setSkillBrowserWriting] = useState(false);
  const [skillBrowserMode, setSkillBrowserMode] = useState<"brain" | "agent-class">("brain");
  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, ChatMessage[]>>({});
  const messagesByAgentRef = useRef<Record<string, ChatMessage[]>>({});
  const lastPersistedChatMessagesRef = useRef("");
  const lastPersistedChatStatsRef = useRef("");
  const lastConfirmedChatMessagesRef = useRef<Record<string, ChatMessage[]>>({});
  const runtimeSessionFallbackMessagesRef = useRef<Record<string, ChatMessage[]>>({});
  const runtimeSessionPollInFlightRef = useRef<Set<string>>(new Set());
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
  const [fleetHostedApps, setFleetHostedApps] = useState<FleetHostedApp[]>([]);
  const [fleetSyncPeerHealth, setFleetSyncPeerHealth] = useState<Record<string, FleetSyncPeerHealth>>({});
  const [fleetSyncAutoRepairByDevice, setFleetSyncAutoRepairByDevice] = useState<Record<string, FleetSyncAutoRepairState>>({});
  const fleetSnapshotRefreshInFlightRef = useRef<{ key: string; promise: Promise<boolean> } | null>(null);
  const fleetSyncProgressRef = useRef<Record<string, { signature: string; lastChangedAt: number }>>({});
  const fleetSyncAutoRepairRef = useRef<Record<string, FleetSyncAutoRepairState>>({});
  const [appCompletionNotifications, setAppCompletionNotifications] = useState<DashboardAppCompletionNotification[]>([]);
  const previousConnectedAppBadgesRef = useRef<{ initialized: boolean; badges: Map<string, { item: ReturnType<typeof activeConnectedAppBadges>[number]; firstSeenAt: number }> }>({
    initialized: false,
    badges: new Map(),
  });
  const [tailscaleDevices, setTailscaleDevices] = useState<TailscaleDevice[]>([]);
  const [tailscaleStatus, setTailscaleStatus] = useState("Checking Tailnet...");
  const [hivemindLinkStatus, setHivemindLinkStatus] = useState<HivemindLinkClientStatus | null>(null);
  const [hivemindLinkBannerDismissed, setHivemindLinkBannerDismissed] = useState(false);
  const [hivemindLinkConnectedUntil, setHivemindLinkConnectedUntil] = useState(0);
  const [hivemindLinkSignInPolling, setHivemindLinkSignInPolling] = useState(false);
  const [discoveredMachines, setDiscoveredMachines] = useState<DiscoveredMachine[]>([]);
  const [suppressedDiscoveredAgentKeys, setSuppressedDiscoveredAgentKeys] = useState<Set<string>>(() => new Set());
  const [recentAgentArrival, setRecentAgentArrival] = useState<{ agentId: string; at: number } | null>(null);
  const [machineNameAliases, setMachineNameAliases] = useState<Record<string, string>>({});
  const [appVersion, setAppVersion] = useState<AppVersion | null>(null);
  const [updateStatusByMachine, setUpdateStatusByMachine] = useState<Record<string, MachineUpdateStatus>>({});
  const [fleetAutoUpdatePaused, setFleetAutoUpdatePaused] = useState(false);
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
  const [queenClapWakeEnabled, setQueenClapWakeEnabled] = useState(false);
  const [aeonEnvKeys, setAeonEnvKeys] = useState("ANTHROPIC_API_KEY\nCLAUDE_CODE_OAUTH_TOKEN\nBANKR_LLM_KEY\nGH_GLOBAL");
  const [aeonEnvSyncStatus, setAeonEnvSyncStatus] = useState("");
  const [aeonEnvSyncing, setAeonEnvSyncing] = useState(false);
  const [agentCreateDraft, setAgentCreateDraft] = useState<{
    name: string;
    runtime: AgentRuntime;
    provider?: string;
    model?: string;
    adaptiveOpenRouter?: AdaptiveOpenRouterConfig;
    adaptiveRouting?: AdaptiveRoutingConfig;
    usePod?: UsePodAgentConfig;
    venice?: VeniceAgentConfig;
    workerClass: BeeWorkerClass;
    customWorkerClass?: CustomWorkerClassProfile;
    customWorkerClasses: CustomWorkerClassProfile[];
    selectedCustomWorkerClassId?: string;
    soulPrompt?: string;
    skillProfilePrompt: string;
    preferredSkillSlugs: string[];
    taskPreferences?: WorkerTaskPreference[];
    researchMethod?: ResearchMethod;
    useSharedVault: boolean;
  }>({
    name: "",
    runtime: "hermes",
    provider: "openai-codex",
    model: "",
    adaptiveRouting: undefined,
    usePod: undefined,
    venice: undefined,
    workerClass: "general",
    customWorkerClass: undefined,
    customWorkerClasses: [],
    selectedCustomWorkerClassId: undefined,
    soulPrompt: renderBeeSoulTemplate(beeWorkerPreset("general").soulTemplate, ""),
    skillProfilePrompt: beeWorkerPreset("general").taskProfile,
    preferredSkillSlugs: beeWorkerPreset("general").skillSlugs,
    taskPreferences: undefined,
    researchMethod: undefined,
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
  // Bumped to force the runtime-availability probe to re-run (e.g. after the
  // in-app runtime installer finishes), so the runtime card flips to Configured.
  const [runtimeAvailabilityNonce, setRuntimeAvailabilityNonce] = useState(0);
  const refreshRuntimeAvailability = useCallback(() => setRuntimeAvailabilityNonce((value) => value + 1), []);
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
  const [activeView, setActiveView] = useState<DashboardView>(initialView ?? "agents");
  const [fleetChatOpenSpaceRightInset, setFleetChatOpenSpaceRightInset] = useState(0);
  const [fleetChatTone, setFleetChatTone] = useState<"hive" | "legacy">("hive");
  const [routeRetry, setRouteRetry] = useState(0);
  // requestedView updates urgently for instant nav-rail feedback; activeView is
  // switched inside a transition so mounting the (heavy, unvirtualized) target
  // panel no longer blocks the click. They re-sync whenever activeView settles,
  // which also keeps the rail highlight correct for programmatic navigation.
  const [requestedView, setRequestedView] = useState<DashboardView>(initialView ?? "agents");
  const [isViewPending, startViewTransition] = useTransition();
  useEffect(() => { setRequestedView(activeView); }, [activeView]);
  const [dashboardTheme, setDashboardTheme] = useState<DashboardTheme>("dark");
  const [chatStreamingByKey, setChatStreamingByKey] = useState<Record<string, ChatStreamState>>({});
  const chatStreamingByKeyRef = useRef<Record<string, ChatStreamState>>({});
  const [chatProcessByKey, setChatProcessByKey] = useState<Record<string, Array<{ at: number; label: string; detail?: string; status?: string; runId?: string }>>>({});
  const [chatRuntimeSessionIdsByKey, setChatRuntimeSessionIdsByKey] = useState<Record<string, string>>({});
  const chatRuntimeSessionIdsByKeyRef = useRef<Record<string, string>>({});
  const activeChatStreams = Object.values(chatStreamingByKey);
  const chatRequestActive = activeChatStreams.length > 0;
  const busyAgentId = activeChatStreams[0]?.agentId ?? "";
  const [chatMessageWindow, setChatMessageWindow] = useState<{ agentId: string; limit: number } | null>(null);
  const [selectedChatLeafKey, setSelectedChatLeafKey] = useState(initialChatLeaf ?? "");
  const [selectedChatRuntimeSessionId, setSelectedChatRuntimeSessionId] = useState(runtimeSessionIdFromChatLeafKey(initialChatLeaf ?? ""));
  const selectedChatRuntimeSessionIdRef = useRef(selectedChatRuntimeSessionId);
  const selectedChatTargetRef = useRef({ agentId: selectedAgentId, leafKey: "" });
  const selectedChatTelemetrySignatureRef = useRef("");
  const [selectedChatPreview, setSelectedChatPreview] = useState<{ agentId: string; leafKey: string; messages: ChatMessage[] } | null>(null);
  const [chatHistoryLoadingByKey, setChatHistoryLoadingByKey] = useState<Record<string, boolean>>({});
  const [runtimeSessionLoadedByKey, setRuntimeSessionLoadedByKey] = useState<Record<string, string>>({});
  const runtimeSessionLoadedByKeyRef = useRef<Record<string, string>>({});
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
    scale: number;
    unitX: number;
    unitY: number;
    moved: boolean;
    nodeId: string;
  } | null>(null);
  const brainDragMovedRef = useRef(false);

  // Warm the agent-settings modal chunk while the app is idle so the first
  // "add agent" / settings click doesn't stall on an on-demand chunk load
  // (in dev that load also includes compiling the 3.5k-line module).
  useEffect(() => {
    const preload = () => {
      preloadDashboardChunk(() => import("@/features/dashboard/views/chat/AgentSettingsModal"));
    };
    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: 2000 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timeoutId = window.setTimeout(preload, 1000);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    messagesByAgentRef.current = messagesByAgent;
  }, [messagesByAgent]);

  useEffect(() => {
    chatStreamingByKeyRef.current = chatStreamingByKey;
  }, [chatStreamingByKey]);

  useEffect(() => {
    chatRuntimeSessionIdsByKeyRef.current = chatRuntimeSessionIdsByKey;
  }, [chatRuntimeSessionIdsByKey]);

  useEffect(() => {
    selectedChatRuntimeSessionIdRef.current = selectedChatRuntimeSessionId;
  }, [selectedChatRuntimeSessionId]);

  useEffect(() => {
    runtimeSessionLoadedByKeyRef.current = runtimeSessionLoadedByKey;
  }, [runtimeSessionLoadedByKey]);

  // Warm the agent-settings modal chunk while the app is idle so the first
  // "add agent" / settings click doesn't stall on an on-demand chunk load
  // (in dev that load also includes compiling the 3.5k-line module).
  useEffect(() => {
    const preload = () => {
      preloadDashboardChunk(() => import("@/features/dashboard/views/chat/AgentSettingsModal"));
    };
    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timeoutId = window.setTimeout(preload, 1500);
    return () => window.clearTimeout(timeoutId);
  }, []);

  // Warm the lazily-imported view panels during idle time so the FIRST switch
  // to each view doesn't stall on an on-demand chunk load. This is the dominant
  // cause of "the tab highlights instantly but the view appears 2-3s later":
  // each view is a dynamic(() => import(...)) and the chunk is only loaded on
  // first navigation (in dev that load also compiles the 1.5k+ line panel via
  // webpack). Imported one at a time on successive idle ticks so we never spike
  // the dev server, which has a memory ceiling and restarts under load. Agents
  // is the default view and is already loaded, so it is omitted; most-trafficked
  // views come first so they warm soonest.
  useEffect(() => {
    let cancelled = false;
    let handle: { type: "idle" | "timeout"; id: number } | null = null;
    const loaders: Array<() => Promise<unknown>> = [
      () => import("@/features/dashboard/views/KanbanPanel"),
      () => import("@/features/dashboard/views/VaultPanel"),
      () => import("@/features/dashboard/views/ChatPanel"),
      () => import("@/features/dashboard/views/WalletPanel"),
      () => import("@/features/dashboard/MorePanel"),
      () => import("@/features/dashboard/views/UtilityPanels"),
      () => import("@/features/dashboard/views/SchedulerPanel"),
      () => import("@/features/dashboard/views/SwarmPanel"),
      () => import("@/features/dashboard/views/PhonePanel"),
      () => import("@/features/dashboard/views/FusionPanel"),
      () => import("@/features/dashboard/views/GovernancePanel"),
      () => import("@/components/aeon"),
      () => import("@/features/integrations/IntegrationsView"),
    ];
    let index = 0;
    const runNext = () => {
      if (cancelled || index >= loaders.length) return;
      const loader = loaders[index];
      index += 1;
      // Kick off the import, then schedule the next only after it settles, so we
      // compile/fetch one chunk at a time instead of all at once.
      void loader().catch(() => undefined).finally(() => {
        if (!cancelled) schedule();
      });
    };
    const schedule = () => {
      if (cancelled || index >= loaders.length) return;
      if ("requestIdleCallback" in window) {
        handle = { type: "idle", id: window.requestIdleCallback(runNext, { timeout: 3000 }) };
      } else {
        handle = { type: "timeout", id: window.setTimeout(runNext, 250) };
      }
    };
    // Defer the start so first paint and launch-critical work win the main thread.
    const startId = window.setTimeout(schedule, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(startId);
      if (handle?.type === "idle" && "cancelIdleCallback" in window) window.cancelIdleCallback(handle.id);
      else if (handle?.type === "timeout") window.clearTimeout(handle.id);
    };
  }, []);

  // Prefetch a view's lazy chunk the moment the user hovers/focuses its nav
  // button, so the chunk is already loading during the (typically 300-800ms)
  // hover->click gap. This makes even the first click to a not-yet-idle-warmed
  // view feel instant instead of waiting on the on-demand import inside the
  // transition. Each view is prefetched at most once.
  const prefetchedViewsRef = useRef<Set<DashboardView>>(new Set());
  const prefetchView = useCallback((view: DashboardView) => {
    if (prefetchedViewsRef.current.has(view)) return;
    prefetchedViewsRef.current.add(view);
    const load: () => Promise<unknown> = (() => {
      switch (view) {
        case "kanban":
        case "history": return () => import("@/features/dashboard/views/KanbanPanel");
        case "vault": return () => import("@/features/dashboard/views/VaultPanel");
        case "chat": return () => import("@/features/dashboard/views/ChatPanel");
        case "wallet": return () => import("@/features/dashboard/views/WalletPanel");
        case "more": return () => import("@/features/dashboard/MorePanel");
        case "scheduler": return () => import("@/features/dashboard/views/SchedulerPanel");
        case "swarm": return () => import("@/features/dashboard/views/SwarmPanel");
        case "phone": return () => import("@/features/dashboard/views/PhonePanel");
        case "fusion": return () => import("@/features/dashboard/views/FusionPanel");
        case "governance": return () => import("@/features/dashboard/views/GovernancePanel");
        case "aeon": return () => import("@/components/aeon");
        case "integrations": return () => import("@/features/integrations/IntegrationsView");
        case "agents": return () => Promise.resolve();
        default: return () => import("@/features/dashboard/views/UtilityPanels");
      }
    })();
    void load().catch(() => undefined);
  }, []);

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
    const nativeBootstrap = await readNativeDashboardBootstrap({ maxAgeMs: 5 * 60 * 1000 });
    const nativeData = nativeBootstrap?.tailscaleDevices ?? await getNativeTailscaleDevices();
    const useNativeData = Boolean(nativeData?.ok || nativeData?.backendState || (nativeData?.devices?.length ?? 0) > 1);
    const response = useNativeData ? null : await fetch("/api/tailscale/devices", { cache: "no-store" }).catch(() => null);
    const fallbackData = await response?.json().catch(() => null) as {
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
    const data = useNativeData ? nativeData : fallbackData ?? nativeData;
    let devices = data?.devices ?? [];
    // The native desktop command ALWAYS returns a local "self" device, even with
    // no Tailscale installed. The selected source above can be the HTTP endpoint,
    // whose no-Tailscale response may not carry self — so if the chosen devices
    // lack a self, re-inject the native self. This guarantees a fresh desktop
    // install always shows its own machine cell + the add-agent cell (the add hex
    // lives inside a machine cluster, so zero machines = no way to onboard).
    // `nativeData` is null on the web build, so this is naturally desktop-only.
    if (!devices.some((device) => device.self)) {
      const nativeSelf = (nativeData?.devices ?? []).find((device) => device.self);
      if (nativeSelf) {
        devices = [nativeSelf, ...devices];
      }
    }
    const localOnlyStatusFallback = data?.tailnetHealth?.state === "status-unavailable"
      && devices.length <= 1
      && devices.every((device) => device.self || device.ip === "127.0.0.1");
    if (!localOnlyStatusFallback) {
      setTailscaleDevices(devices);
    } else {
      // status-unavailable + self-only: either a momentary Tailscale blip OR a
      // fresh machine with no Tailscale at all (every new Windows/Linux install).
      // Don't clobber an EXISTING multi-machine fleet down to just self — but on a
      // FRESH install (no prior fleet) we MUST still surface self, otherwise the
      // fleet view is empty: no self "This Mac" cell and no add-agent cell (that
      // hex lives inside a machine cluster), just a perpetual loading spinner with
      // no way to onboard a first agent. So fall back to showing self only when we
      // have nothing yet.
      setTailscaleDevices((current) => (current.length > 0 ? current : devices));
    }
    if (devices.length > 0 && !localOnlyStatusFallback) {
      setDiscoveredMachines((current) => mergeDiscoveredMachines(current, devicesToDiscoveredMachines(devices)));
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
      const nativeBootstrap = await readNativeDashboardBootstrap({
        maxAgeMs: 5 * 60 * 1000,
        allowPrivateFilesystem: true,
        vaultPath: sharedVault.enabled ? sharedVault.vaultPath : undefined,
        kanbanFolder: sharedVault.enabled ? sharedVault.kanbanFolder : undefined,
        kanbanBoard: kanbanBoardSlug,
        scheduledFolder: sharedVault.enabled ? sharedVault.scheduledFolder : undefined,
      });
      const nativeData = nativeBootstrap?.hiveEnv ?? await readNativeHiveEnv({ force: true });
      const response = nativeData ? null : await fetch("/api/env", { cache: "no-store" }).catch(() => null);
      const data = nativeData ?? (await response?.json().catch(() => null) as HiveEnvPayload | null);
      if ((!nativeData && !response?.ok) || !data?.ok) {
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
  }, [kanbanBoardSlug, sharedVault.enabled, sharedVault.kanbanFolder, sharedVault.scheduledFolder, sharedVault.vaultPath]);
  const refreshMemoryTelemetry = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setMemoryTelemetryLoading(true);
    try {
      const nativeData = await readNativeMemoryTelemetry({ force: !options.silent });
      const response = nativeData?.ok ? null : await fetch("/api/memory-telemetry", { cache: "no-store" }).catch(() => null);
      const data = nativeData?.ok ? nativeData : await response?.json().catch(() => null) as MemoryTelemetryPayload | null;
      if (response?.ok && data?.ok) setMemoryTelemetry(data);
      if (nativeData?.ok) setMemoryTelemetry(nativeData);
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
      label: "Hivemind Sync env",
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
  const persistDashboardStateValue = useCallback((key: string, value: string) => {
    dashboardStateRef.current = { ...dashboardStateRef.current, [key]: value };
    return saveDashboardStateValue(key, value);
  }, []);
  const updateQueenClapWakeEnabled = useCallback((enabled: boolean) => {
    setQueenClapWakeEnabled(enabled);
    void persistDashboardStateValue(QUEEN_CLAP_WAKE_STORAGE_KEY, enabled ? "1" : "0");
  }, [persistDashboardStateValue]);
  const persistChatMessages = useCallback((compactMessages: Record<string, ChatMessage[]>, serialized: string) => {
    void persistDashboardStateValue(CHAT_MESSAGES_STORAGE_KEY, serialized).then((saved) => {
      if (saved) {
        lastConfirmedChatMessagesRef.current = compactMessages;
        clearPendingChatSaves();
        const stats = chatMessagesStorageStats(compactMessages);
        const statsSignature = `${stats.agentCount}:${stats.messageCount}`;
        if (statsSignature === lastPersistedChatStatsRef.current) return;
        lastPersistedChatStatsRef.current = statsSignature;
        logClientTelemetry("chat.messages.persisted", stats);
        return;
      }
      // The server never stored this save (e.g. dev-server restart returned a
      // proxy 503). Stash the unsaved delta so a reload can restore it.
      writePendingChatSaves(diffChatMessagesForPendingSave(lastConfirmedChatMessagesRef.current, compactMessages));
      logClientTelemetry("chat.messages.persist_failed", chatMessagesStorageStats(compactMessages));
    });
  }, [persistDashboardStateValue]);
  const deleteDashboardStateValue = useCallback((key: string) => {
    const next = { ...dashboardStateRef.current };
    delete next[key];
    dashboardStateRef.current = next;
    void removeDashboardStateValue(key);
  }, []);
  const discoveredAgentIsSuppressed = useCallback((agent: AgentProfile) => (
    agentMatchesSuppression(agent, suppressedDiscoveredAgentKeys)
  ), [suppressedDiscoveredAgentKeys]);
  const persistActiveChatRuns = useCallback((runs: Record<string, ActiveChatRunRecord>) => {
    const compact = compactActiveChatRuns(runs);
    if (Object.keys(compact).length) {
      persistDashboardStateValue(ACTIVE_CHAT_RUNS_STORAGE_KEY, JSON.stringify(compact));
    } else {
      deleteDashboardStateValue(ACTIVE_CHAT_RUNS_STORAGE_KEY);
    }
  }, [deleteDashboardStateValue, persistDashboardStateValue]);
  // Hydrate persisted state on the client after the first render. Reading
  // server-backed dashboard state inside useState init would diverge from SSR and trigger
  // a hydration mismatch — this is the canonical pattern to avoid it,
  // even though the lint rule flags setState-in-effect in general.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
    const dashboardState = await loadDashboardStateSnapshot((info) => {
      if (cancelled || info.attempt < HYDRATION_STALL_THRESHOLD) return;
      setHydrationStalled(info);
      // Record the broken boot centrally (anonymized) so it's visible without
      // the user opening devtools. reportIssue de-dupes per session.
      reportIssue({
        kind: "hydration_stall",
        detail: `Dashboard never hydrated: /api/dashboard/state ${info.kind}${info.status ? ` ${info.status}` : ""}`,
        failureKind: info.kind,
        status: info.status,
        attempt: info.attempt,
        severity: "error",
      });
    });
    if (cancelled) return;
    setHydrationStalled(null);
    clearReportedIssue("hydration_stall");
    dashboardStateRef.current = dashboardState;
    setQueenClapWakeEnabled(readStoredValue(dashboardState, QUEEN_CLAP_WAKE_STORAGE_KEY) === "1");
    hydrateMruRuntime(dashboardState);
    const storedAgents = parseStoredAgents(dashboardState);
    const routeTarget = dashboardTargetFromSearch(window.location.search);
    setAgents(storedAgents);
    setSelectedAgentId((current: string) => (
      routeTarget?.view === "chat" && routeTarget.agentId ? routeTarget.agentId :
      storedAgents.some((agent) => agent.id === current) ? current : storedAgents[0]?.id ?? current
    ));
    if (routeTarget?.view === "chat" && routeTarget.chatLeaf) {
      setSelectedChatLeafKey(routeTarget.chatLeaf);
      const routeSessionId = runtimeSessionIdFromChatLeafKey(routeTarget.chatLeaf);
      if (routeSessionId) setSelectedChatRuntimeSessionId(routeSessionId);
    }
    setSharedVault(parseStoredVault(dashboardState));
    setTasks(parseStoredTasks(dashboardState));
    setSchedules(parseStoredSchedules(dashboardState));
    setWalletsByAgent(parseStoredWallets(dashboardState));
    const serverChatMessages: Record<string, ChatMessage[]> = Object.fromEntries(Object.entries(parseStoredChatMessages(dashboardState))
      .map(([storageKey, transcript]) => [storageKey, dedupeChatTranscript(transcript)]));
    lastConfirmedChatMessagesRef.current = serverChatMessages;
    // Restore chats whose last save never reached the server (reload raced a
    // dev-server restart) from the localStorage stash.
    const storedChatMessages = mergePendingChatMessages(serverChatMessages, readPendingChatSaves());
    const routeSessionId = routeTarget?.view === "chat" && routeTarget.chatLeaf ? runtimeSessionIdFromChatLeafKey(routeTarget.chatLeaf) : "";
    const routeChatStorageKey = routeTarget?.view === "chat" && routeTarget.agentId && routeTarget.chatLeaf
      ? chatMessageStorageKey(routeTarget.agentId, routeTarget.chatLeaf)
      : "";
    const routeStoredMessages = routeChatStorageKey ? storedChatMessages[routeChatStorageKey] ?? [] : [];
    const stagedSelectedRuntimeLeafTranscript = Boolean(routeChatStorageKey && routeSessionId && routeStoredMessages.length);
    if (stagedSelectedRuntimeLeafTranscript) {
      runtimeSessionFallbackMessagesRef.current = {
        ...runtimeSessionFallbackMessagesRef.current,
        [routeChatStorageKey]: routeStoredMessages,
      };
    }
    setMessagesByAgent(storedChatMessages);
    const storedChatStats = chatMessagesStorageStats(storedChatMessages);
    lastPersistedChatStatsRef.current = `${storedChatStats.agentCount}:${storedChatStats.messageCount}`;
    logClientTelemetry("chat.messages.hydrated", storedChatStats);
    if (routeTarget?.view === "chat") {
      logClientTelemetry("chat.open.local_storage_hydrated", {
        agentId: routeTarget.agentId ?? null,
        chatLeaf: routeTarget.chatLeaf ?? null,
        routeSessionId: routeSessionId || null,
        routeChatStorageKey: routeChatStorageKey || null,
        stagedSelectedRuntimeLeafTranscript,
        restoredSelectedMessageCount: routeStoredMessages.length,
        stagedMessages: stagedSelectedRuntimeLeafTranscript ? chatTelemetryMessages(routeStoredMessages) : [],
        storedAgentCount: storedChatStats.agentCount,
        storedMessageCount: storedChatStats.messageCount,
      }, { threadId: routeChatStorageKey || undefined, runId: routeSessionId || undefined });
    }
    const activeRuns = Object.fromEntries(Object.entries(readActiveChatRuns(dashboardState))
      .filter(([storageKey, run]) => !activeChatRunHasAssistantReply(storedChatMessages[storageKey], run)));
    persistActiveChatRuns(activeRuns);
    if (Object.keys(activeRuns).length) {
      setChatStreamingByKey(Object.fromEntries(Object.entries(activeRuns).map(([storageKey, run]) => [
        storageKey,
        { agentId: run.agentId, leafKey: run.leafKey, hasChunk: false, startedAt: run.startedAt, runId: run.runId },
      ])));
      setChatProcessByKey(Object.fromEntries(Object.entries(activeRuns).map(([storageKey, run]) => [
        storageKey,
        [
          { at: Date.now(), label: "Resumed after reload", detail: "Checking the runtime session for activity.", runId: run.runId },
        ].filter((entry) => entry.detail !== ""),
      ])));
      setChatRuntimeSessionIdsByKey(Object.fromEntries(Object.entries(activeRuns)
        .filter(([, run]) => Boolean(run.sessionId))
        .map(([storageKey, run]) => [storageKey, run.sessionId])));
    }
    setHoneyLedgerEnabled(parseStoredHoneyLedgerEnabled(dashboardState));
    setHoneyTreasury(parseStoredHoneyTreasury());
    setChatCustomFolders(parseStoredChatFolders(dashboardState));
    const storedDiscoveredMachines = parseStoredDiscoveredMachines(dashboardState);
    const storedFleetSnapshots = parseStoredFleetSnapshots(dashboardState);
    setDiscoveredMachines(storedDiscoveredMachines);
    setSuppressedDiscoveredAgentKeys(parseStoredSuppressedDiscoveredAgentKeys(dashboardState));
    setFleetSnapshots(storedFleetSnapshots);
    setFleetCheckedAt(Math.max(0, ...Object.values(storedFleetSnapshots).map((snapshot) => snapshot.checkedAt || 0)) || null);
    setFleetDiscoveryLoading(storedDiscoveredMachines.length === 0);
    setMachineNameAliases(parseStoredMachineNameAliases(dashboardState));
    const storedTheme = readStoredValue(dashboardState, THEME_STORAGE_KEY, STORAGE_SUFFIXES.theme);
    setDashboardTheme(storedTheme === "hive-light" ? "hive-light" : "dark");
    setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [persistActiveChatRuns]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useVisibilityAwarePolling({
    enabled: hydrated && honeyLedgerEnabled,
    intervalMs: activeView === "wallet" ? 60_000 : 120_000,
    hiddenIntervalMs: 5 * 60_000,
    task: () => observeHoneyUsage(),
  });
  useEffect(() => {
    if (!hydrated) return;
    persistDashboardStateValue(HONEY_LEDGER_ENABLED_STORAGE_KEY, honeyLedgerEnabled ? "true" : "false");
  }, [honeyLedgerEnabled, hydrated, persistDashboardStateValue]);
  useEffect(() => {
    document.documentElement.dataset.theme = dashboardTheme;
    if (!hydrated) return;
    persistDashboardStateValue(THEME_STORAGE_KEY, dashboardTheme);
  }, [dashboardTheme, hydrated, persistDashboardStateValue]);
  useEffect(() => {
    if (!hydrated) return;
    persistDashboardStateValue(STORAGE_KEY, JSON.stringify(agents));
  }, [hydrated, agents, persistDashboardStateValue]);
  useEffect(() => {
    if (!hydrated || !sharedVault.enabled || agentVaultHydratedRef.current) return;
    let cancelled = false;
    void (async () => {
      // Static desktop build has no /api server — read vault agents natively.
      const native = await getNativeObsidianAgents(sharedVault.vaultPath || "");
      const data = native ?? await (async () => {
        const response = await fetch(`/api/obsidian/agents?vaultPath=${encodeURIComponent(sharedVault.vaultPath || "")}`, { cache: "no-store" }).catch(() => null);
        return await response?.json().catch(() => null) as { ok?: boolean; agents?: AgentProfile[] } | null;
      })();
      if (cancelled) return;
      if (data?.ok && Array.isArray(data.agents) && data.agents.length) {
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
      ...discoveredMachines
        .flatMap((machine) => machine.agents ?? [])
        .map(normalizeAgentProfile)
        .filter((agent) => !discoveredAgentIsSuppressed(agent)),
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
  }, [agents, discoveredAgentIsSuppressed, discoveredMachines, hydrated, sharedVault.enabled, sharedVault.vaultPath]);
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
    persistDashboardStateValue(VAULT_STORAGE_KEY, JSON.stringify(sharedVault));
  }, [hydrated, sharedVault, persistDashboardStateValue]);
  useEffect(() => {
    if (!hydrated) return;
    persistDashboardStateValue(TASK_STORAGE_KEY, JSON.stringify(tasks.slice(0, 80)));
  }, [hydrated, tasks, persistDashboardStateValue]);
  useEffect(() => {
    if (!hydrated) return;
    persistDashboardStateValue(SCHEDULE_STORAGE_KEY, JSON.stringify(schedules.slice(0, 120)));
  }, [hydrated, schedules, persistDashboardStateValue]);
  useEffect(() => {
    if (!hydrated) return;
    persistDashboardStateValue(WALLET_STORAGE_KEY, JSON.stringify(walletsByAgent));
  }, [hydrated, walletsByAgent, persistDashboardStateValue]);
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
  }, [hydrated, messagesByAgent, persistDashboardStateValue]);
  // Write-through baseline + a flag marking the vault read-back as settled. The
  // write-through effect waits on this flag so its first run starts from a
  // correct per-agent baseline (seeded below) instead of mirroring every wallet
  // back to the vault on boot.
  const walletVaultSyncedRef = useRef<Record<string, number>>({});
  const [walletVaultReadbackDone, setWalletVaultReadbackDone] = useState(false);
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
        const records = data.records;
        // The vault already holds these versions, so baseline the write-through
        // ref to them: only wallets that are newer LOCALLY than the vault should
        // mirror back. Without this, every wallet looks "changed" on boot
        // (ref starts at 0) and re-writes its ledger file fleet-wide.
        for (const record of records) {
          const remoteMs = stripUnfundedWalletBalance(record.wallet).updatedAt ?? 0;
          const prior = walletVaultSyncedRef.current[record.agentId] ?? 0;
          if (remoteMs > prior) walletVaultSyncedRef.current[record.agentId] = remoteMs;
        }
        setWalletsByAgent((current) => {
          let mutated = false;
          const next = { ...current };
          for (const record of records) {
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
      } finally {
        // Unblock the write-through even on failure, so local-only wallets still
        // sync once; a seeded baseline simply means fewer of them are "new".
        if (!cancelled) setWalletVaultReadbackDone(true);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, sharedVault.enabled, sharedVault.vaultPath]);
  // Write-through: when wallets change locally, mirror the changed records to
  // the shared vault. Debounced to coalesce rapid edits (slider drags etc).
  // Waits for the read-back baseline so boot doesn't re-mirror unchanged records.
  useEffect(() => {
    if (!hydrated || !sharedVault.enabled || !walletVaultReadbackDone) return;
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
  }, [hydrated, sharedVault.enabled, sharedVault.vaultPath, walletsByAgent, agents, walletVaultReadbackDone]);
  useEffect(() => {
    if (!hydrated) return;
    const persistTimer = window.setTimeout(() => {
      const compactMessages = compactChatMessagesForStorage(messagesByAgent);
      const serialized = JSON.stringify(compactMessages);
      if (serialized === lastPersistedChatMessagesRef.current) return;
      lastPersistedChatMessagesRef.current = serialized;
      persistChatMessages(compactMessages, serialized);
    }, 700);
    return () => window.clearTimeout(persistTimer);
  }, [hydrated, messagesByAgent, persistChatMessages]);
  useEffect(() => {
    if (!hydrated) return;
    persistDashboardStateValue(CHAT_FOLDER_STORAGE_KEY, JSON.stringify(chatCustomFolders));
  }, [chatCustomFolders, hydrated, persistDashboardStateValue]);
  useEffect(() => {
    if (!hydrated || discoveredMachines.length === 0) return;
    persistDashboardStateValue(DISCOVERED_MACHINES_STORAGE_KEY, JSON.stringify(discoveredMachines.slice(0, 32)));
  }, [discoveredMachines, hydrated, persistDashboardStateValue]);
  useEffect(() => {
    if (!hydrated) return;
    const values = [...suppressedDiscoveredAgentKeys].slice(-500);
    if (values.length) {
      persistDashboardStateValue(SUPPRESSED_DISCOVERED_AGENTS_STORAGE_KEY, JSON.stringify(values));
    }
  }, [hydrated, persistDashboardStateValue, suppressedDiscoveredAgentKeys]);
  useEffect(() => {
    if (!hydrated) return;
    const compactSnapshots = Object.fromEntries(Object.entries(fleetSnapshots)
      .filter(([, snapshot]) => snapshot?.tasks?.length > 0)
      .map(([agentId, snapshot]) => [agentId, {
        ...snapshot,
        tasks: snapshot.tasks.slice(0, 12),
      }]));
    persistDashboardStateValue(FLEET_SNAPSHOTS_STORAGE_KEY, JSON.stringify(compactSnapshots));
  }, [fleetSnapshots, hydrated, persistDashboardStateValue]);
  useEffect(() => {
    if (!hydrated) return;
    persistDashboardStateValue(MACHINE_NAME_ALIAS_STORAGE_KEY, JSON.stringify(machineNameAliases));
  }, [hydrated, machineNameAliases, persistDashboardStateValue]);
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
    const configuredAgents = filterSuppressedAgents(agents, suppressedDiscoveredAgentKeys);
    const discoveredAgents = filterSuppressedAgents(
      discoveredMachines
        .flatMap((machine) => machine.agents ?? [])
        .map(normalizeAgentProfile),
      suppressedDiscoveredAgentKeys,
    );
    return dedupeAgents(configuredAgents, discoveredAgents).map((agent) => ({
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
        collectorCapabilities: agent.collectorCapabilities,
      }));
  }, [agents, discoveredMachines, suppressedDiscoveredAgentKeys]);

  const refreshFleetSnapshots = useCallback(async (signal: AbortSignal, mode: "full" | "history") => {
      if (signal.aborted) return false;
      const snapshotAgents = buildSnapshotAgents();
      if (snapshotAgents.length === 0) return false;
      const refreshKey = JSON.stringify({
        mode,
        controlRoomPath: sharedVault.controlRoomPath,
        agents: snapshotAgents.map((agent) => [agent.id, agent.runtime, agent.telemetryUrl, agent.localDataDir, agent.agentId]),
      });
      if (fleetSnapshotRefreshInFlightRef.current?.key === refreshKey) return fleetSnapshotRefreshInFlightRef.current.promise;
      const refreshPromise = (async () => {
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
      })().finally(() => {
        if (fleetSnapshotRefreshInFlightRef.current?.key === refreshKey) {
          fleetSnapshotRefreshInFlightRef.current = null;
        }
      });
      fleetSnapshotRefreshInFlightRef.current = { key: refreshKey, promise: refreshPromise };
      return refreshPromise;
  }, [buildSnapshotAgents, sharedVault.controlRoomPath]);

  const pollFleetSnapshot = useCallback(async (signal: AbortSignal) => {
      await refreshFleetSnapshots(signal, activeView === "chat" ? "history" : "full");
  }, [activeView, refreshFleetSnapshots]);
  const refreshCreatedAgentSnapshot = useCallback(async (agent: AgentProfile) => {
    const checkedAt = Date.now();
    setFleetSnapshots((current) => mergeSnapshotRecord(current, [{
      agentId: agent.id,
      ok: false,
      runtimeReachable: false,
      processRunning: false,
      summary: "Checking newly added agent...",
      sources: ["dashboard add agent"],
      tasks: [],
      checkedAt,
    }]));
    setFleetCheckedAt(checkedAt);
    const response = await fetch("/api/fleet/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agents: [agent],
        sharedVault: { controlRoomPath: sharedVault.controlRoomPath },
        mode: "full",
      }),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as {
      checkedAt?: number;
      snapshots?: AgentSnapshot[];
    } | null;
    if (!response?.ok || !data?.snapshots?.length) return;
    setFleetSnapshots((current) => mergeSnapshotRecord(current, data.snapshots ?? []));
    setFleetCheckedAt(data.checkedAt ?? Date.now());
  }, [sharedVault.controlRoomPath]);
  // A deliberate user add must win over past removals: deleting an agent
  // suppresses its workspace key, which a newly created agent on the same
  // machine can collide with (e.g. the canonical ~/.hermes first-agent key) —
  // without clearing it the new agent never shows up. Also records the arrival
  // so the fleet view can spotlight the new agent's hex.
  const noteAgentArrival = useCallback((agent: AgentProfile) => {
    setSuppressedDiscoveredAgentKeys((current) => withoutAgentSuppression(current, agent) ?? current);
    setRecentAgentArrival({ agentId: agent.id, at: Date.now() });
  }, []);
  const clearRecentAgentArrival = useCallback(() => setRecentAgentArrival(null), []);
  const handleAgentCreated = useCallback(async (agent: AgentProfile) => {
    noteAgentArrival(agent);
    await refreshCreatedAgentSnapshot(agent);
  }, [noteAgentArrival, refreshCreatedAgentSnapshot]);
  useEffect(() => {
    if (!hydrated || activeView !== "chat" || chatRequestActive || agents.length === 0) return;
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
  }, [activeView, agents, chatRequestActive, hydrated, refreshFleetSnapshots, sharedVault.controlRoomPath]);
  useVisibilityAwarePolling({
    enabled: hydrated && !chatRequestActive && (activeView === "agents" || activeView === "chat"),
    intervalMs: activeView === "agents" ? 30_000 : 45_000,
    hiddenIntervalMs: 5 * 60_000,
    initialDelayMs: fleetCheckedAt ? FLEET_PASSIVE_REFRESH_DELAY_MS : FLEET_EMPTY_REFRESH_DELAY_MS,
    task: pollFleetSnapshot,
  });
  const refreshFleetHostedApps = useCallback(async (signal: AbortSignal) => {
    const nativeBootstrap = await readNativeDashboardBootstrap({ maxAgeMs: 5 * 60 * 1000 });
    const nativeData = nativeBootstrap?.fleetApps ?? await getNativeFleetAppsCache<{ apps?: FleetHostedApp[] }>({ maxAgeMs: 5 * 60 * 1000 });
    if (nativeData?.apps) {
      setFleetHostedApps(nativeData.apps);
    }
    const response = await fetch("/api/fleet/apps", { cache: "no-store", signal }).catch(() => null);
    const data = await response?.json().catch(() => null) as { apps?: FleetHostedApp[] } | null;
    if (!response?.ok || !data?.apps) return;
    setFleetHostedApps(data.apps);
  }, []);
  useVisibilityAwarePolling({
    enabled: hydrated && !chatRequestActive,
    intervalMs: activeView === "agents" ? 30_000 : 45_000,
    hiddenIntervalMs: 5 * 60_000,
    initialDelayMs: activeView === "agents" ? FLEET_PASSIVE_REFRESH_DELAY_MS : 5_000,
    task: refreshFleetHostedApps,
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
      const nativeData = await getNativeFleetDiscovery();
      const response = nativeData?.machines ? null : await fetch("/api/fleet/discover?includeSnapshots=0&stale=1", {
        cache: "no-store",
        signal,
      }).catch(() => null);
      const data = nativeData?.machines ? nativeData : await response?.json().catch(() => null) as {
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
      setDiscoveredMachines((current) => mergeDiscoveredMachines(current, machines));
      const discoveredSnapshots = data.machines.flatMap((machine) => machine.snapshots ?? []);
      if (discoveredSnapshots.length > 0) {
        setFleetSnapshots((current) => mergeSnapshotRecord(current, discoveredSnapshots));
      }
      setFleetDiscoveryLoading(false);
  }, [applyHivemindLinkStatus, discoveredMachines.length, tailscaleStatus]);
  useVisibilityAwarePolling({
    enabled: hydrated && !chatRequestActive && (activeView === "agents" || activeView === "chat"),
    intervalMs: 60_000,
    hiddenIntervalMs: 5 * 60_000,
    initialDelayMs: discoveredMachines.length > 0 ? FLEET_PASSIVE_REFRESH_DELAY_MS : FLEET_EMPTY_REFRESH_DELAY_MS,
    task: pollFleetDiscovery,
  });
  const pollAppVersion = useCallback(async (signal: AbortSignal) => {
      const nativeBootstrap = await readNativeDashboardBootstrap({ maxAgeMs: 5 * 60 * 1000 });
      const nativeStatus = nativeBootstrap?.desktopStatus;
      const nativeVersion = nativeStatus?.commit ? nativeStatus : await getNativeAppVersion(signal);
      if (nativeVersion?.commit) {
        setAppVersion(nativeVersion);
        return;
      }
      const response = await fetch("/api/app/version", {
        cache: "no-store",
        signal,
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as AppVersion | null;
      if (data?.commit) setAppVersion(data);
  }, []);
  useVisibilityAwarePolling({
    enabled: hydrated && !chatRequestActive,
    intervalMs: 5 * 60_000,
    hiddenIntervalMs: 10 * 60_000,
    initialDelayMs: 5_000,
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
    enabled: hydrated && !chatRequestActive,
    intervalMs: mirosharkStatus?.install.running ? (activeView === "swarm" ? 15_000 : 60_000) : 120_000,
    hiddenIntervalMs: 5 * 60_000,
    initialDelayMs: activeView === "swarm" ? FLEET_PASSIVE_REFRESH_DELAY_MS : 5_000,
    task: pollMirosharkStatus,
  });
  const { refreshMirosharkMetadata, runMirosharkAction, startNewMirosharkSimulation, extractMirosharkHelperText, launchMirosharkSwarm, runMirosharkSwarm, runMirosharkExperiment, refreshMirosharkArchive, refreshBrainGraph, refreshRecentDirectories, recordRecentDirectory, loadMachineDirectories, chooseDirectoryForMachine, refreshHermesUpdateRequirement, refreshBrainSkills, importBrainSkills, syncBrainSkillsToAeon, openSkillBrowser: openBrainSkillBrowser, importRemoteSkillToBrain, convertSkillToAeon, installGithubSkillToBrain, addWrittenSkillToBrain, refreshNotifications, loadMirosharkArchivedRun, refreshMirosharkRun, mirosharkRunStatus, mirosharkRunIsArchived, mirosharkRunnerStatus, mirosharkPosts, mirosharkFeedIsWaiting, mirosharkFeedIsLive, mirosharkObservedRound, mirosharkTotalRounds, mirosharkCurrentRound, mirosharkProgressPercent, mirosharkRunIsWorking, mirosharkDisplayStep, mirosharkDisplayStatus, mirosharkProgressLabel, mirosharkTemplates, mirosharkTelemetryCount, mirosharkActionCount, mirosharkMarketCount, mirosharkTimelineItems, mirosharkActionItems, mirosharkProfileItems, mirosharkMarketItems, mirosharkObservabilityItems, mirosharkLlmCallItems, swarmTimelineItems, swarmObservabilityItems, swarmAgents, swarmDecisions, swarmThreadPosts, mirosharkMarketPricePayloads, swarmMarket, swarmIntegrationItems, swarmMarketPriceItems, swarmExportLinks, currentSwarmRun, swarmRuns, swarmStatusLabel, selectedSwarmRunId } = useMirosharkBrainController({ BRAIN_GRAPH_CLIENT_CACHE_MS, MIROSHARK_TEMPLATE_INPUTS, SWARM_LAUNCH_PRESETS, activeView, agents, appVersion, asRecord, brainGraph, brainGraphLoadedAtRef, brainGraphVaultPathRef, brainSkills, compactValue, composeMirosharkTemplateScenario, createDefaultAgentWallet, defaultMirosharkTemplateInputs, formatRelativeTime, getMiroSharkPosts, getMiroSharkRunStatus, getMiroSharkTemplates, hermesUpdateDetail, hermesUpdateRequiredDetail, honeyLedgerEnabled, isEmptyIntegrationPayload, isLoopbackCollector, isMiroSharkRunTerminal, isUnpublishedSimulationPayload, mirosharkAnalysisAgentId, mirosharkArchiveRuns, mirosharkExperimentEvent, mirosharkHandle, mirosharkMetadata, mirosharkPlatform, mirosharkRounds, mirosharkRun, mirosharkRunPending, mirosharkScenario, mirosharkSelectedTemplateId, mirosharkStat, mirosharkStatus, mirosharkTemplateInputs, mirosharkUserName, mirosharkWorkspaceMode, notificationCountRef, notificationCursorRef, numericRecordValue, payloadArray, payloadCount, payloadData, payloadPreview, pickLinkedDirectory, selectedAgentId, selectedMirosharkRunId, setBrainGraph, setBrainGraphLoading, setBrainGraphStatus, setBrainSkillAeonSyncing, setBrainSkillImportProvider, setBrainSkillImportSuccess, setBrainSkills, setBrainSkillsLoading, setBrainSkillsStatus, setHermesUpdateRequiredDetail, setMachineDirectoryBrowser, setMirosharkActionPending, setMirosharkAnalysisPending, setMirosharkAnalysisResult, setMirosharkAnalysisStatus, setMirosharkArchiveLoading, setMirosharkArchiveRuns, setMirosharkArchiveStatus, setMirosharkExperimentPending, setMirosharkExperimentStatus, setMirosharkHelperPending, setMirosharkHelperStatus, setMirosharkMetadata, setMirosharkPlatform, setMirosharkRounds, setMirosharkRun, setMirosharkRunPending, setMirosharkScenario, setMirosharkSelectedTemplateId, setMirosharkStatus, setMirosharkTemplateInputs, setMirosharkWorkbenchTab, setMirosharkWorkspaceMode, setNotificationCursor, setNotificationSummary, setNotifications, setNotificationsLoading, setNotificationsStatus, setRecentDirectories, setSelectedBrainNodeId, setSelectedMirosharkRunId, setSkillBrowserGithubInstalling, setSkillBrowserGithubOpen, setSkillBrowserGithubUrl, setSkillBrowserImporting, setSkillBrowserLoading, setSkillBrowserOpen, setSkillBrowserSearch, setSkillBrowserSkills, setSkillBrowserStatus, setSkillBrowserView, setSkillBrowserWriting, setSkillBrowserWrittenContent, sharedVault, skillBrowserGithubUrl, skillBrowserWrittenContent, skillRequiresHermesUpdate, swarmEventItem, swarmMarketEventItem, swarmMarketFromItems, swarmMarketPriceEventItem, swarmRunState, swarmTemplateIdFromMirosharkTemplate, swarmTemplateIdFromSurface, walletsByAgent });
  const openSkillBrowser = useCallback(async () => {
    setSkillBrowserMode("brain");
    await openBrainSkillBrowser();
  }, [openBrainSkillBrowser]);
  const openAgentSkillBrowser = useCallback(async () => {
    setSkillBrowserMode("agent-class");
    setSkillBrowserGithubOpen(false);
    setSkillBrowserView("catalog");
    setSkillBrowserSearch("");
    // Full card browser (Catalog/Installed/Packs/… + GitHub row) for agent-class
    // mode, not the old shared-only attach picker. Phase 1 still paints the
    // shared shelf instantly, then catalogs/packs/provider installs enrich.
    await openBrainSkillBrowser();
  }, [openBrainSkillBrowser]);
  const appendMessage = useCallback((agentId: string, message: ChatMessage, storageKey = agentId) => {
    logClientTelemetry("chat.message.appended", { agentId, storageKey, role: message.role, kanbanTaskId: message.kanbanTaskId ?? null, surface: message.surface ?? null, contentLength: message.content.length, attachmentCount: message.attachments?.length ?? 0 });
    setMessagesByAgent((current) => {
      const next = {
        ...current,
        [storageKey]: [...(current[storageKey] ?? []), { ...message, createdAt: message.createdAt ?? Date.now() }],
      };
      const compactMessages = compactChatMessagesForStorage(next);
      const serialized = JSON.stringify(compactMessages);
      lastPersistedChatMessagesRef.current = serialized;
      persistChatMessages(compactMessages, serialized);
      return next;
    });
  }, [persistChatMessages]);
  const recordActiveChatRun = useCallback((run: ActiveChatRunRecord) => {
    persistActiveChatRuns({
      ...readActiveChatRuns(dashboardStateRef.current),
      [run.storageKey]: { ...run, updatedAt: Date.now() },
    });
  }, [persistActiveChatRuns]);
  const clearActiveChatRun = useCallback((storageKey: string) => {
    const next = readActiveChatRuns(dashboardStateRef.current);
    delete next[storageKey];
    persistActiveChatRuns(next);
  }, [persistActiveChatRuns]);
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
  const { discoveredAgents, agentAliases, candidateAgents, candidateWorkById, displayAgents, agentWorkById, effectiveSelectedAgentId, selectedAgent, sharedSkillOptions, filteredSkillBrowserSkills, hermesUpdateRequired, filteredSchedulerSkills, selectedBrainNode, brainGraphStats, messages, lastAssistant, visibleMessages, sessionNotice, selectedChatStreaming, selectedChatHasStreamingChunk, selectedChatProcess, updateChatAutoScroll, machineGroups, renameMachine, kanbanMachineTargets, localKanbanMachineTarget, quickAddMachineTarget, agentsForKanbanTask, visibleAgentCount, fleetViewData, fleetUpdateStatusByMachine, fleetUpdateDetailByMachine, kanbanColumns, visibleKanbanColumns, selectedKanbanTask, selectedKanbanComments, selectedKanbanAgent, selectedKanbanAgentMessages, notificationGroups, selectedKanbanEvents, selectedKanbanBulkIds, selectedWallet, selectedWalletSnapshot, walletStats, honeyAgentRewards, selectedHoneyReward, honeyStats, kanbanAssigneeOptions, workBoardStats, kanbanViewColumns, kanbanInitialLoading, updateKanbanBoardScrollState, agentSpecificEnvCount, sharedEnvSource, runtimeEnvSources, selectedRuntimeEnvSource, sharedEnvCount, unsharedRuntimeEnvCount, sharedBackupStatus, sharedEnvImport, sharedEnvImportDiff, sharedEnvImportNewCount, sharedEnvImportChangedCount, sharedEnvImportSameCount, brainSkillImportableCount, brainSkillImportableLabel, brainSkillImportAllLabel, brainSkillImportAllDescription, navItems, activeHeader, setupMachine, roleModalAgent, agentCreateMachine } = useDashboardDerivedState({ RUNTIME_LABELS, activeView, agentAliasMap, agentCreateDraft, agentCreateMachineKey, agentRoleModalId, agentSettingsPanel, agents, beeRoleLabel, brainGraph, brainGraphLayout, brainSkills, chatAutoScrollRef, chatDisplayContent, chatMessageStorageKey, chatMessageWindow, chatProcessByKey, chatStreamingByKey, cleanActivityTitle, collectorKey, createAgentProfile, createDefaultAgentWallet, dedupeAgents, discoveredMachines, displayMachineName, fleetAgentState, fleetMachineLocation, fleetMetric, fleetSnapshots, fleetVersionState, formatRelativeTime, getHoneyAgentRewards, getSurvivalSnapshot, groupKanbanTasks, groupNotifications, hermesUpdateRequiredDetail, hiveEnv, hiveEnvRuntimeSourceId, honeyTreasury, hydrated, inferCurrentTask, inferLatestAgentMessage, isChatSidebarTask, isLoopbackCollector, isManualAgentChatMessage, isMeaningfulActive, isMobileMachineOs, isStarterPlaceholder, isVisibleFleetMachine, isWorkView, kanbanAssignees, kanbanBoard, kanbanBoardScrollRef, kanbanError, kanbanIncludeArchived, kanbanLoading, kanbanTaskAssigneeAgent, machineIdentityFromParts, machineNameAliases, machineNeedsChatBridgeRepair, machineNeedsEnvHttpSyncRepair, machineNeedsSkillSyncRepair, machineNetworkIssue, maintenanceReport, messagesByAgent, messagesScrollRef, mirosharkAnalysisAgentId, mirosharkStatus, moneyClawLoadingEnvName, moneyClawStatusByEnvName, normalizeAgentProfile, notificationActorMeta, notificationDisplayBody, notificationDisplayTitle, notificationSummary, notificationSourceLabel, notifications, parseEnvImportText, quickAddMachineTargets, refreshMoneyClawStatus, refreshRuntimeIntegrations, refreshSharedSchedulesFromVault, runtimeCan, runtimeCount, runtimeFileRoots, runtimeModelSelectionsByRuntime, runtimeUsage, schedulerSkillSearch, schedules, selectedAgentId, selectedBrainNodeId, selectedChatLeafKey, selectedChatPreview, selectedKanbanTaskId, selectedKanbanTaskIds, setKanbanBoardScrollState, setMachineNameAliases, setScheduleDraft, setupMachineKey, sharedEnvImportText, sharedVault, skillBrowserSearch, skillBrowserSkills, tailscaleDevices, tailscaleStatus, tasks, updateStatusByMachine, walletExpanded, walletsByAgent, workPriority, suppressedDiscoveredAgentKeys });
  const tailnetCleanupState = useTailnetAutoCleanup(hydrated);
  const tailnetCleanup = useMemo(() => ({
    visible: tailnetCleanupState.stalePlanVisible || Boolean(tailnetCleanupState.cleanupNotice),
    candidates: tailnetCleanupState.stalePlan?.candidates ?? [],
    staleAgeDays: tailnetCleanupState.stalePlan?.staleAgeDays ?? 7,
    busy: tailnetCleanupState.cleanupBusy,
    notice: tailnetCleanupState.cleanupNotice,
    onCleanupNow: () => void tailnetCleanupState.runCleanupNow(),
    onAlwaysCleanup: () => void tailnetCleanupState.enableAlwaysCleanup(),
    onDismiss: tailnetCleanupState.dismissCleanup,
  }), [tailnetCleanupState]);
  const selectedChatStorageKey = selectedAgent ? chatMessageStorageKey(selectedAgent.id, selectedChatLeafKey) : "";
  const selectedChatLeafRuntimeSessionId = runtimeSessionIdFromChatLeafKey(selectedChatLeafKey);
  const selectedChatRuntimeLeafLoading = Boolean(
    hydrated
    && activeView === "chat"
    && selectedChatStorageKey
    && selectedChatLeafRuntimeSessionId
    && runtimeSessionLoadedByKey[selectedChatStorageKey] !== selectedChatLeafRuntimeSessionId
  );
  const selectedChatHistoryLoading = Boolean(selectedChatStorageKey && chatHistoryLoadingByKey[selectedChatStorageKey]) || selectedChatRuntimeLeafLoading;
  const chatInitialLoading = activeView === "chat" && !hydrated;
  // "Queen Bee Settings" from the desktop menu/tray opens the agent settings
  // modal for the queen. The ref keeps the subscription stable across renders.
  const queenSettingsAgentsRef = useRef<AgentProfile[]>(displayAgents);
  useEffect(() => {
    queenSettingsAgentsRef.current = displayAgents;
  }, [displayAgents]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listenForQueenSettingsOpen(() => {
      const agents = queenSettingsAgentsRef.current ?? [];
      const queen = agents.find((agent) => agent.beeRole === "queen")
        ?? agents.find((agent) => /queen/i.test(agent.name));
      if (!queen) return;
      setSelectedAgentId(queen.id);
      setAgentRenameDraft(queen.name);
      setAgentRenameEditing(false);
      setAgentRuntimeFolderEditing(false);
      setAgentRuntimeFolderStatus("");
      setAgentRuntimeAdvancedOpen(false);
      setAgentSettingsPanel("role");
      setAgentRoleModalId(queen.id);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    if (!hydrated || activeView !== "chat" || !selectedAgent || !selectedChatStorageKey) return;
    const element = messagesScrollRef.current;
    const lastMessage = visibleMessages.at(-1);
    const signature = JSON.stringify({
      storageKey: selectedChatStorageKey,
      loading: selectedChatHistoryLoading,
      messageCount: visibleMessages.length,
      lastRole: lastMessage?.role ?? "",
      lastLength: lastMessage?.content?.length ?? 0,
      scrollTop: element ? Math.round(element.scrollTop) : null,
      scrollHeight: element ? Math.round(element.scrollHeight) : null,
    });
    if (selectedChatTelemetrySignatureRef.current === signature) return;
    selectedChatTelemetrySignatureRef.current = signature;
    logClientTelemetry("chat.view.snapshot", {
      agentId: selectedAgent.id,
      agentName: selectedAgent.name,
      runtime: selectedAgent.runtime,
      leafKey: selectedChatLeafKey,
      storageKey: selectedChatStorageKey,
      selectedChatHistoryLoading,
      selectedChatRuntimeLeafLoading,
      selectedChatLeafRuntimeSessionId: selectedChatLeafRuntimeSessionId || null,
      selectedChatRuntimeSessionId: selectedChatRuntimeSessionId || null,
      messageCount: visibleMessages.length,
      messages: chatTelemetryMessages(visibleMessages),
      scroll: element ? {
        top: element.scrollTop,
        height: element.scrollHeight,
        clientHeight: element.clientHeight,
      } : null,
    }, { threadId: selectedChatStorageKey, runId: selectedChatRuntimeSessionId || selectedChatLeafRuntimeSessionId || undefined });
  }, [activeView, hydrated, selectedAgent, selectedChatHistoryLoading, selectedChatLeafKey, selectedChatLeafRuntimeSessionId, selectedChatRuntimeLeafLoading, selectedChatRuntimeSessionId, selectedChatStorageKey, visibleMessages]);
  const fleetSyncVaultPath = sharedVault.vaultPath.trim() || DEFAULT_SHARED_VAULT.vaultPath;
  useEffect(() => {
    if (!hydrated || !fleetSyncVaultPath) {
      fleetSyncProgressRef.current = {};
      const reset = window.setTimeout(() => setFleetSyncPeerHealth({}), 0);
      return () => window.clearTimeout(reset);
    }

    let cancelled = false;
    let inFlight = false;
    let timer: number | null = null;
    const readSyncHealth = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      const params = new URLSearchParams({ vaultPath: fleetSyncVaultPath });
      const response = await fetch(`/api/syncthing/status?${params.toString()}`, { cache: "no-store" }).catch(() => null);
      const data = await response?.json().catch(() => null);
      try {
        if (cancelled || !data?.ok) return;

        const now = Date.now();
        const peers = Array.isArray(data.vaultFolder?.devices) ? data.vaultFolder.devices as FleetSyncthingDevice[] : [];
        const activePeerIds = new Set<string>();
        const next: Record<string, FleetSyncPeerHealth> = {};

        for (const peer of peers) {
          if (!peer?.deviceID) continue;
          const completion = typeof peer.completion === "number" ? peer.completion : null;
          const needItems = typeof peer.needItems === "number" ? peer.needItems : null;
          const needBytes = typeof peer.needBytes === "number" ? peer.needBytes : null;
          const remoteState = typeof peer.remoteState === "string" ? peer.remoteState : null;
          const incomplete = (typeof completion === "number" && completion < 99.95) || (typeof needItems === "number" && needItems > 0);
          const remoteNotSharing = Boolean(remoteState && !/^(?:valid|idle)$/i.test(remoteState));
          if (!incomplete && !remoteNotSharing) continue;

          const signature = [completion ?? "", needItems ?? "", needBytes ?? "", remoteState ?? ""].join(":");
          const previous = fleetSyncProgressRef.current[peer.deviceID];
          if (!previous || previous.signature !== signature) {
            fleetSyncProgressRef.current[peer.deviceID] = { signature, lastChangedAt: now };
          }
          const lastChangedAt = fleetSyncProgressRef.current[peer.deviceID]?.lastChangedAt ?? now;
          const unchangedMs = Math.max(0, now - lastChangedAt);
          activePeerIds.add(peer.deviceID);
          next[peer.deviceID] = {
            ...peer,
            completion,
            needItems,
            needBytes,
            remoteState,
            stalled: remoteNotSharing || unchangedMs >= FLEET_SYNC_STALLED_MS,
            unchangedMs,
          };
        }

        for (const deviceID of Object.keys(fleetSyncProgressRef.current)) {
          if (!activePeerIds.has(deviceID)) delete fleetSyncProgressRef.current[deviceID];
        }
        setFleetSyncPeerHealth(next);
      } finally {
        inFlight = false;
        if (!cancelled) {
          timer = window.setTimeout(() => void readSyncHealth(), FLEET_SYNC_HEALTH_POLL_MS);
        }
      }
    };

    timer = window.setTimeout(() => void readSyncHealth(), FLEET_SYNC_HEALTH_INITIAL_DELAY_MS);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [fleetSyncVaultPath, hydrated, sharedVault.enabled, sharedVault.syncProvider]);

  const fleetSyncPeers = useMemo(() => Object.values(fleetSyncPeerHealth), [fleetSyncPeerHealth]);
  const fleetSyncRepairTargets = useMemo<FleetSyncRepairTarget[]>(() => buildFleetSyncRepairTargets({
    machines: fleetViewData.machines,
    hostedApps: fleetHostedApps,
    peers: fleetSyncPeers,
  }), [fleetHostedApps, fleetSyncPeers, fleetViewData.machines]);
  const fleetViewDataWithApps = useMemo(() => applyFleetSyncAutoRepairIssues({
    fleetViewData,
    hostedApps: fleetHostedApps,
    targets: fleetSyncRepairTargets,
    autoRepairByDevice: fleetSyncAutoRepairByDevice,
  }), [fleetHostedApps, fleetSyncAutoRepairByDevice, fleetSyncRepairTargets, fleetViewData]);
  const activeConnectedAppBadgesForShell = useMemo(
    () => activeConnectedAppBadges(fleetViewDataWithApps.machines),
    [fleetViewDataWithApps.machines],
  );
  useEffect(() => {
    const now = Date.now();
    const previous = previousConnectedAppBadgesRef.current;
    const currentBadges = new Map(activeConnectedAppBadgesForShell.map((item) => [
      item.key,
      {
        item,
        firstSeenAt: previous.badges.get(item.key)?.firstSeenAt ?? now,
      },
    ]));
    const currentActiveTaskKeys = new Set(fleetViewData.machines.flatMap((machine) => (
      machine.agents.flatMap((agent) => {
        const taskKey = agent.currentTaskId || agent.task || "";
        return agent.activityStatus === "active" && taskKey ? [`${machine.id}:${agent.id}:${taskKey}`] : [];
      })
    )));

    if (previous.initialized) {
      const completedNotifications = Array.from(previous.badges.values())
        .filter((tracked) => !currentBadges.has(tracked.item.key))
        .filter((tracked) => now - tracked.firstSeenAt >= APP_COMPLETION_MIN_VISIBLE_MS)
        .filter((tracked) => !currentActiveTaskKeys.has(`${tracked.item.machineId}:${tracked.item.agentId}:${tracked.item.taskKey}`))
        .map(({ item }) => ({
          id: `app-complete-${item.key}-${Date.now()}`,
          app: item.app,
          message: `Task completed by ${item.agentName}`,
        }));
      if (completedNotifications.length > 0) {
        setAppCompletionNotifications((queue) => [...queue, ...completedNotifications]);
      }
    }

    previousConnectedAppBadgesRef.current = {
      initialized: true,
      badges: currentBadges,
    };
  }, [activeConnectedAppBadgesForShell, fleetViewData.machines]);
  const appCompletionNotification = appCompletionNotifications[0] ?? null;
  const appCompletionNotificationId = appCompletionNotification?.id ?? null;
  useEffect(() => {
    if (!appCompletionNotificationId) return;
    const timer = window.setTimeout(() => {
      setAppCompletionNotifications((queue) => queue.filter((notification) => notification.id !== appCompletionNotificationId));
    }, APP_COMPLETION_TOAST_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [appCompletionNotificationId]);
  useEffect(() => {
    const message = scheduleImportStatus.trim();
    if (!message) return;
    const timer = window.setTimeout(() => {
      setAppCompletionNotifications((queue) => [
        ...queue,
        {
          id: `scheduler-notice-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          initials: "CR",
          message,
          title: "Scheduler",
        },
      ]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [scheduleImportStatus]);
  const { updateAgent, updateAgentProfile: agentUpdateAgentProfile, syncAeonEnvToGitHub, openAgentCreationModal, closeAgentSettingsModal, browseAgentRuntimeFolder, refreshRuntimeIntegrations: agentRefreshRuntimeIntegrations, runRuntimeIntegrationAction, searchRuntimeSessionsForAgent, createAgentFromModal } = useAgentController({ RUNTIME_LABELS, aeonEnvKeys, agentCreateDraft, agentCreateMachine, agents, beeWorkerPreset, collectorKey, createAgentProfile, defaultWorkerClassDraft, displayAgents, hermesUpdateDetail, normalizeAgentProfile, onAgentCreated: handleAgentCreated, openSetupModal, roleModalAgent, runtimeCount, runtimeSessionQuery, selectedAgent, setActiveView, setAeonEnvSyncStatus, setAeonEnvSyncing, setAgentCreateDraft, setAgentCreateMachineKey, setAgentRenameDraft, setAgentRenameEditing, setAgentRoleModalId, setAgentRuntimeAdvancedOpen, setAgentRuntimeFolderBrowsing, setAgentRuntimeFolderEditing, setAgentRuntimeFolderStatus, setAgentSettingsPanel, setAgentWorkerClassView, setAgents, setCustomWorkerDraft, setCustomWorkerImageError, setCustomWorkerSkillSearch, setDiscoveredMachines, setHermesUpdateRequiredDetail, setRuntimeBackgroundPrompt, setRuntimeIntegrationBusy, setRuntimeIntegrationMessage, setRuntimeIntegrationStatus, setRuntimeModelDraft, setRuntimeModelSelectionsByRuntime, setRuntimeModelSetupMode, setRuntimeSessionQuery, setRuntimeSessionResults, setSelectedAgentId });
  const { searchAllRuntimeSessions, sessionSearchLoading, sessionSearchMessage, sessionSearchQuery, sessionSearchResults, setSessionSearchQuery } = useRuntimeSessionSearch(displayAgents);
  const { toggleScheduleSkill, toggleSchedulerStepMode, updateSchedulerStep, addSchedulerStep, removeSchedulerStep, addSchedulerStepPath, removeSchedulerStepPath, toggleSchedulerStepSkill, updateSchedulerStepModel, isSchedulerFilePath, pickSchedulerFolder, pickSchedulerFiles, addSchedulePath, removeSchedulePath, removeScheduleSkill, resetScheduleDraft, editSchedule, createSchedule, removeSchedule, importExistingSchedules, normalizeImportedScheduleEvery, toggleSchedule, schedulerPlainPrompt, schedulerSharedSnapshot, upsertSharedSchedule, upsertSharedSchedules, fetchPastRunContext, scheduleFromSharedSnapshot, mergeSharedSchedules, refreshSharedSchedulesFromVault: schedulerRefreshSharedSchedulesFromVault, recordSharedScheduledRun, runScheduleNow, schedulerStatusFromSchedule, scheduleIntervalMs, formatSchedulerDuration, schedulerCadenceLabel, schedulerJobs, findScheduleForJob, modalCadenceFromEvery, everyFromModalCadence, schedulerModalInitial, saveScheduleFromModal, browseSchedulerFolder } = useSchedulerController({ RUNTIME_LABELS, SCHEDULER_DYNAMIC_SKILL_ACTIONS_ENABLED, SCHEDULER_HERMES_SKILL_CONTEXT_ENABLED, SCHEDULER_MODEL_OPTIONS, SCHEDULER_RUN_STALE_MS, agents, appVersion, appendMessage, chatSetupIssue, createDefaultAgentWallet, displayAgents, displayMachineName, editingScheduleId, formatRelativeTime, honeyLedgerEnabled, logClientTelemetry, refreshHoneyLedger, scheduleDraft, schedules, selectedAgent, setEditingScheduleId, setMessagesByAgent, setScheduleDraft, setScheduleImportStatus, setScheduleImporting, setSchedulerAttachMenu, setSchedulerDraftOpen, setSchedulerPathDraft, setSchedulerPathKind, setSchedulerRunStates, setSchedulerSelectedStep, setSchedulerSkillSearch, setSchedules, sharedVault, updateTask, upsertTask, walletsByAgent });
  const { updateSharedVault, updateWallet, resetWalletBurnClock, copyPaymentPrompt, exportWalletSecrets, refreshMoneyClawStatus: walletRefreshMoneyClawStatus, saveMoneyClawKey, initializeCoreWalletRails, refreshHoneyLedger: walletRefreshHoneyLedger, observeHoneyUsage: walletObserveHoneyUsage, refreshRuntimeUsage, refreshWalletVaultBackupStatus, runWalletVaultBackupAction, refreshMaintenanceReport, runMaintenanceAction, runtimeFileRequest, refreshRuntimeFileRoots, listRuntimeFiles, openRuntimeFile, saveRuntimeFile, returnAllHiveToHoney, claimAllHoneyToBankrHive, enableHoneyLedger, updateWalletAction, createLocalWallet, refreshWalletBalance, sendWalletUsdc, testX402Fetch, addAgentToMachine, requestDuplicateAgent, duplicateAgent, deleteAgent } = useWalletFilesController({ buildAgentPaymentPrompt, createDefaultAgentWallet, createDefaultHoneyTreasuryConfig, displayAgents, duplicateAgentDraft, agents, honeyLedgerEnabled, normalizeMoney, onAgentAdded: noteAgentArrival, openAgentCreationModal, runtimeFileDraft, runtimeFileOpen, runtimeFilePath, runtimeFileRootKey, runtimeFileRoots, selectedAgent, selectedAgentId, setAgents, setDiscoveredMachines, setDuplicateAgentDraft, setFleetSnapshots, setHoneyLedgerEnabled, setHoneyTreasury, setMaintenanceBusy, setMaintenanceMessage, setMaintenanceReport, setMessagesByAgent, setMoneyClawLoadingEnvName, setMoneyClawStatusByEnvName, setRuntimeFileDraft, setRuntimeFileOpen, setRuntimeFilePath, setRuntimeFileRootKey, setRuntimeFileRoots, setRuntimeFileStatus, setRuntimeFiles, setRuntimeUsage, setRuntimeUsageLoading, setSelectedAgentId, setSharedVault, setSuppressedDiscoveredAgentKeys, setWalletActionsByAgent, setWalletVaultBackupBusy, setWalletVaultBackupMessage, setWalletVaultBackupStatus, setWalletsByAgent, sharedVault, updateAgentProfile, walletActionsByAgent, walletsByAgent });
  const { switchRuntime, hasConversation, conversationTitle, hydrateRuntimeSessionChat, startAgentChat, startAgentWorkChat, changeChatWorkingDirectory, closeChatFolderCreator, createChatFolder, chatSidebarTree, selectedChatMachine, selectedChatDirectory, chatFolderCreatorMachine, chatFolderCreatorParentOptions, copySetupCommand } = useChatTreeController({ RUNTIME_CAPABILITIES, RUNTIME_DEFAULTS, RUNTIME_KINDS, RUNTIME_LABELS, activeView, agentWorkById, chatCustomFolders, chatDedupeKey, chatFolderDraft, chatFolderLabel, chatMessageStorageKey, chatMessageWindow, chatPreviewDedupeKey, chatSeedMessagesForTask, chooseDirectoryForMachine, createChatLeafKey, displayAgents, findRosterChatTask, runtimeSessionIdFromTask, isChatSidebarTask, isManualAgentChatMessage, logClientTelemetry, machineGroups, messagesByAgent, parentPathFromPath, preferChatTreeItem, recordRecentDirectory, runtimeCan, runtimeSessionForChat, selectedAgent, selectedAgentId, selectedChatDirectoryPath, selectedChatLeafKey, setActiveView, setChatCustomFolders, setChatFolderDraft, setChatHistoryLoadingByKey, setChatMessageWindow, setMessagesByAgent, setSelectedAgentId, setSelectedChatDirectoryPath, setSelectedChatLeafKey, setSelectedChatPreview, setSelectedChatRuntimeSessionId, setSetupCommandCopied, setSetupMachineKey, setupCollectorCommand, setStatus, setStatusAgentId, taskChatLeafKey, updateAgent, workPriority, workspaceLabelFromPath });
  const { openMachineInitModal, saveHetznerToken, openHetznerEnvFile, initializeMachineProject, copyMachineInitCommand, refreshAppVersionNow, refreshDiscoveryNow, runMachineUpdate, copyUpdateDetail, refreshKanbanOnce, kanbanStorageBody, notificationStorageBody, raiseHermesAuthAlert, noteIntakeBody, scanNoteIntake, importNoteIntake, markNotificationRead, markAllNotificationsRead, updateNotificationSettings, trackAgentTaskOnKanban } = useFleetNotificationsController({ DEFAULT_SHARED_VAULT, addKanbanStorageParams, appVersion, hydrated, isCollectorAutoUpdateable, kanbanAssigneeFilter, kanbanBoardSlug, kanbanIncludeArchived, kanbanSearch, kanbanTenantFilter, cleanActivityTitle, localDashboardHasUnpublishedChanges, machineInitDraft, machineInitToken, machineNeedsChatBridgeRepair, machineNeedsEnvHttpSyncRepair, machineNeedsSkillSyncRepair, machineVersionCopy, mergeDiscoveredMachines, mergeSnapshotRecord, noteIntakeAutoInFlightRef, notifications, setAppVersion, setCopiedUpdateDetailKey, setDiscoveredMachines, setFleetSnapshots, setKanbanAssignees, setKanbanBoard, setKanbanBoards, setKanbanError, setKanbanStorage, setKanbanTenants, setActiveView, setSelectedKanbanTaskId, setMachineInitCopiedKey, setMachineInitOpen, setMachineInitStatus, setMachineInitToken, setMachineInitTokenStatus, setNoteIntakePending, setNoteIntakePreview, setNoteIntakeStatus, setNotificationCursor, setNotificationSummary, setNotifications, setNotificationsStatus, setTasks, setUpdateStatusByMachine, sharedVault, summarizeHermesAuthError, updateStatusByMachine });
  const { createKanbanTask, createKanbanBoard, patchKanbanTask, bulkPatchKanbanTasks, promoteKanbanIdea, updateKanbanTaskMachine, markKanbanTaskReviewed, requestKanbanTaskUndo, readWorkspaceGitSnapshot, kanbanWorkspaceChangeSummary, addKanbanCardFiles, openKanbanCardFilePicker, handleKanbanCardFileChange, handleKanbanCardImageChange, attachKanbanCardDirectory, attachKanbanCardRecentDirectory, removeKanbanCardAttachment, removeKanbanCardDirectory, moveKanbanTask, deleteKanbanTask, editAndInterruptKanbanTask, openKanbanTaskModal, kanbanTaskMenuItems, orchestrateReadyKanbanTask, addKanbanSystemComment } = useKanbanTaskController({ AbortController, Eye, GitBranch, KANBAN_COLUMNS, KANBAN_PICKUP_PREVIEW_MS, MessageSquare, Pencil, RotateCcw, Trash2, Users, agentsForKanbanTask, appVersion, appendMessage, attachmentSizeLabel, beeRoleIconPath, beeWorkerClassLabel, chatSetupIssue, chooseBeeAssignment, chooseDirectoryForMachine, createDefaultAgentWallet, dispatchKanbanTaskToAgentRef, displayAgents, honeyLedgerEnabled, kanbanBoard, kanbanBoardSlug, kanbanCardAttachmentTargetId, kanbanCardFileInputRef, kanbanCardImageInputRef, kanbanDispatchCooldownRef, kanbanEditDraft, kanbanEditPendingTaskId, kanbanReadyPickupAttemptRef, kanbanReadyPickupInFlightRef, kanbanReadyPickupSignature, kanbanRuntimeAbortRef, kanbanStorageBody, kanbanTaskAssigneeAgent, kanbanTaskInterruptPrompt, linkedDirectoryLabel, logClientTelemetry, newBoardDraft, quickAddAttachments, quickAddDirectories, quickAddDrafts, quickAddMachineTarget, readComposerFiles, recordRecentDirectory, refreshHoneyLedger, refreshKanbanOnce, selectedKanbanAgent, selectedKanbanBulkIds, selectedKanbanTask, selectedKanbanTaskId, setKanbanBoard, setKanbanBoardSlug, setKanbanBulkPending, setKanbanCardAttachmentMenuOpen, setKanbanCardAttachmentTargetId, setKanbanCardRecentsExpanded, setKanbanEditDraft, setKanbanEditPendingTaskId, setKanbanError, setKanbanPickupPreviewByTask, setKanbanStorage, setKanbanTaskModal, setMessagesByAgent, setNewBoardDraft, setQuickAddAttachmentError, setQuickAddAttachments, setQuickAddDirectories, setQuickAddDrafts, setQuickAddMachineMenuOpen, setQuickAddMachineTargets, setQuickAddStatus, setSelectedKanbanTaskId, setSelectedKanbanTaskIds, sharedVault, updateTask, upsertTask, wait, walletsByAgent });
  const { createKanbanArtistHandoffTask, requeueStaleKanbanTask, dispatchKanbanTaskToAgent, addKanbanComment, refreshKanbanAgentSession, steerSelectedKanbanTask } = useKanbanDispatchController({ AbortController, KANBAN_COLUMNS, KANBAN_DISPATCH_NO_PROGRESS_MS, KANBAN_NO_ASSISTANT_QUIET_MS, KANBAN_NO_ASSISTANT_STALL_MS, KANBAN_SESSION_POLL_FAILURE_LIMIT, KANBAN_STALE_AGENT_COOLDOWN_MS, KANBAN_TOOL_OUTPUT_STALL_MS, addKanbanSystemComment, appVersion, appendMessage, attachmentSizeLabel, attachmentSummary, chatSetupIssue, commentDraft, compactDiagnosticPreview, createDefaultAgentWallet, displayAgents, extractKanbanVisualBrief, formatDurationShort, honeyLedgerEnabled, hydrated, isHermesAuthFailure, isInternalHermesSessionPrelude, isKanbanAwaitingAgentUpdate, isKanbanStaleWorkingTask, isTransientDelegationMessage, kanbanBoard, kanbanBoardSlug, kanbanDispatchCooldownRef, kanbanNoAssistantStalledDetail, kanbanReadyPickupAttemptRef, kanbanReadyPickupInFlightRef, kanbanReadyPickupSignature, kanbanRuntimeAbortRef, kanbanSessionPollFailureRef, kanbanSessionPollRef, kanbanStaleAge, kanbanStaleRequeueAttemptRef, kanbanSteerAttachments, kanbanSteerDirectories, kanbanSteerDraft, kanbanSteerTargetStatus, kanbanSteeringTaskId, kanbanStorageBody, kanbanTaskAssigneeAgent, kanbanTaskAssignmentForAgent, kanbanTaskDispatchPrompt, kanbanToolOutputStalledDetail, kanbanWorkspaceChangeSummary, logClientTelemetry, messageContentParts, messagesByAgent, orchestrateReadyKanbanTask, patchKanbanTask, raiseHermesAuthAlert, readWorkspaceGitSnapshot, refreshHoneyLedger, refreshKanbanOnce, selectedKanbanAgent, selectedKanbanTask, setCommentDraft, setKanbanError, setKanbanSteerAttachmentError, setKanbanSteerAttachmentMenuOpen, setKanbanSteerAttachments, setKanbanSteerDirectories, setKanbanSteerDraft, setKanbanSteeringTaskId, setMessagesByAgent, sharedVault, simpleStableHash, summarizeKanbanToolOutput, updateTask, upsertTask, walletsByAgent });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setFleetAutoUpdatePaused(window.localStorage.getItem(FLEET_AUTO_UPDATE_PAUSED_STORAGE_KEY) === "1");
      } catch {
        // Stay unpaused when storage is unavailable.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const toggleFleetAutoUpdatePaused = useCallback(() => {
    setFleetAutoUpdatePaused((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(FLEET_AUTO_UPDATE_PAUSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Toggle still applies for this session.
      }
      return next;
    });
  }, []);
  useFleetAutoUpdate({
    enabled: hydrated,
    paused: fleetAutoUpdatePaused,
    machineGroups,
    appVersion,
    updateStatusByMachine,
    runMachineUpdate,
  });
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
    const leafRuntimeSessionId = runtimeSessionIdFromChatLeafKey(selectedChatLeafKey);
    const leafRuntimeSessionLoaded = Boolean(leafRuntimeSessionId && runtimeSessionLoadedByKeyRef.current[storageKey] === leafRuntimeSessionId);
    if (leafRuntimeSessionLoaded && !chatStreamingByKeyRef.current[storageKey]) return;
    const initialSessionId = chatRuntimeSessionIdsByKeyRef.current[storageKey] || selectedChatRuntimeSessionIdRef.current || leafRuntimeSessionId || "";
    const initialActiveRun = readActiveChatRuns(dashboardStateRef.current)[storageKey];
    const initialActiveRunFresh = Boolean(initialActiveRun && initialActiveRun.status === "active" && Date.now() - initialActiveRun.updatedAt < CHAT_RESPONSE_STALL_TIMEOUT_MS);
    if (!initialSessionId && !chatStreamingByKeyRef.current[storageKey] && !initialActiveRunFresh) {
      logClientTelemetry("chat.runtime.poll.skipped", {
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        runtime: selectedAgent.runtime,
        leafKey: selectedChatLeafKey,
        storageKey,
        reason: "no-runtime-session",
      }, { threadId: storageKey });
      return;
    }
    const markRuntimeLeafLoaded = () => {
      if (!leafRuntimeSessionId) return;
      runtimeSessionLoadedByKeyRef.current = {
        ...runtimeSessionLoadedByKeyRef.current,
        [storageKey]: leafRuntimeSessionId,
      };
      setRuntimeSessionLoadedByKey((current) => (
        current[storageKey] === leafRuntimeSessionId ? current : { ...current, [storageKey]: leafRuntimeSessionId }
      ));
    };
    const resolveRuntimeLeafFetchFailure = (type: string, payload: Record<string, unknown>, sessionId = "") => {
      const cachedMessages = messagesByAgentRef.current[storageKey] ?? [];
      const fallbackMessages = cachedMessages.length > 0
        ? cachedMessages
        : runtimeSessionFallbackMessagesRef.current[storageKey] ?? [];
      const fallbackToCachedTranscript = Boolean(leafRuntimeSessionId && fallbackMessages.length > 1);
      logClientTelemetry(type, {
        ...payload,
        cachedMessageCount: fallbackMessages.length,
        cachedMessages: chatTelemetryMessages(fallbackMessages),
        fallbackToCachedTranscript,
      }, { threadId: storageKey, runId: sessionId || undefined });
      if (!fallbackToCachedTranscript) {
        markRuntimeLeafLoaded();
        return;
      }
      if (!cachedMessages.length) {
        setMessagesByAgent((current) => current[storageKey]?.length
          ? current
          : { ...current, [storageKey]: dedupeChatTranscript(fallbackMessages).slice(-120) });
        setSelectedChatPreview((current) => (
          current?.agentId === selectedAgent.id && current.leafKey === selectedChatLeafKey
            ? { ...current, messages: fallbackMessages }
            : current
        ));
      }
      markRuntimeLeafLoaded();
    };
    const pollSession = async () => {
      const sessionId = chatRuntimeSessionIdsByKeyRef.current[storageKey] || selectedChatRuntimeSessionIdRef.current || leafRuntimeSessionId || "";
      const activeRun = readActiveChatRuns(dashboardStateRef.current)[storageKey];
      const activeRunFresh = Boolean(activeRun && activeRun.status === "active" && Date.now() - activeRun.updatedAt < CHAT_RESPONSE_STALL_TIMEOUT_MS);
      if (!sessionId && !chatStreamingByKeyRef.current[storageKey] && !activeRunFresh) {
        logClientTelemetry("chat.runtime.poll.skipped", {
          agentId: selectedAgent.id,
          agentName: selectedAgent.name,
          runtime: selectedAgent.runtime,
          leafKey: selectedChatLeafKey,
          storageKey,
          reason: "no-runtime-session",
        }, { threadId: storageKey });
        return;
      }
      const pollRequestKey = `${storageKey}:${sessionId || "recent"}`;
      if (runtimeSessionPollInFlightRef.current.has(pollRequestKey)) return;
      runtimeSessionPollInFlightRef.current.add(pollRequestKey);
      const pollStartedAt = Date.now();
      logClientTelemetry("chat.runtime.poll.start", {
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        runtime: selectedAgent.runtime,
        leafKey: selectedChatLeafKey,
        storageKey,
        sessionId: sessionId || null,
        leafRuntimeSessionId: leafRuntimeSessionId || null,
        selectedChatRuntimeSessionId: selectedChatRuntimeSessionId || null,
      }, { threadId: storageKey, runId: sessionId || undefined });
      try {
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
        if (!response?.ok) {
          resolveRuntimeLeafFetchFailure("chat.runtime.poll.failed", {
            agentId: selectedAgent.id,
            leafKey: selectedChatLeafKey,
            storageKey,
            sessionId: sessionId || null,
            status: response?.status ?? null,
            elapsedMs: Date.now() - pollStartedAt,
          }, sessionId);
          return;
        }
        const data = await response.json().catch(() => null);
        const session = data?.ok ? data.session : null;
        if (!session) {
          resolveRuntimeLeafFetchFailure("chat.runtime.poll.empty", {
            agentId: selectedAgent.id,
            leafKey: selectedChatLeafKey,
            storageKey,
            sessionId: sessionId || null,
            elapsedMs: Date.now() - pollStartedAt,
          }, sessionId);
          return;
        }
        const sessionKey = String(session.sessionId ?? session.id ?? "");
        const endedAt = Number(session.endedAt || 0);
        const updatedAt = Number(session.updatedAt || session.startedAt || 0);
        const recent = !updatedAt || Date.now() - updatedAt < ACTIVE_CHAT_RUN_TTL_MS;
        // "recent" (20m) governs loading historical transcripts; whether a run is
        // still STREAMING uses a tight window: a backend that's genuinely working
        // writes session events well within the stall timeout, so a session with
        // no writes for that long is orphaned (e.g. backend restarted) — stop the
        // "cooking" indicator instead of holding it for the full 20 minutes.
        const sessionStreamingFresh = !updatedAt || Date.now() - updatedAt < CHAT_RESPONSE_STALL_TIMEOUT_MS;
        const sessionMessages = runtimeSessionMessages(session);
        const visibleSessionMessages = sessionMessages.filter((message) => message.role === "user" || message.role === "assistant");
        const latestSessionMessage = Array.isArray(session.messages) ? session.messages.at(-1) : null;
        const latestSessionRole = String(latestSessionMessage?.role ?? visibleSessionMessages.at(-1)?.role ?? "").toLowerCase();
        const localRun = readActiveChatRuns(dashboardStateRef.current)[storageKey];
        const localRunActive = Boolean(localRun && localRun.status === "active" && Date.now() - localRun.updatedAt < CHAT_RESPONSE_STALL_TIMEOUT_MS);
        const visibleRunMessages = localRunActive ? chatMessagesForActiveRun(visibleSessionMessages, localRun) : visibleSessionMessages;
        const latestRunMessage = visibleRunMessages.at(-1);
        const latestRunRole = String(latestRunMessage?.role ?? (localRunActive ? "" : latestSessionRole)).toLowerCase();
        const latestRunHasAssistantReply = latestRunRole === "assistant" && Boolean(latestRunMessage?.content?.trim() || latestRunMessage?.agentPrompt);
        const hasAssistantReply = latestRunHasAssistantReply
          || visibleRunMessages.some((message) => message.role === "assistant" && message.content.trim())
          || (!localRunActive && chatTranscriptHasAssistantReply(messagesByAgentRef.current[storageKey]));
        const replaceRuntimeLeafHistory = Boolean(leafRuntimeSessionId && !localRunActive);
        const runStartedAt = localRun?.startedAt
          ?? chatStreamingByKeyRef.current[storageKey]?.startedAt
          ?? Number(session.startedAt || Date.now());
        const runId = localRun?.runId
          ?? chatStreamingByKeyRef.current[storageKey]?.runId
          ?? (localRunActive ? `${storageKey}:${runStartedAt}` : undefined);
        logClientTelemetry("chat.runtime.poll.response", {
          agentId: selectedAgent.id,
          leafKey: selectedChatLeafKey,
          storageKey,
          requestedSessionId: sessionId || null,
          sessionKey: sessionKey || null,
          elapsedMs: Date.now() - pollStartedAt,
          recent,
          endedAt: endedAt || null,
          updatedAt: updatedAt || null,
          localRunActive,
          replaceRuntimeLeafHistory,
          visibleSessionMessageCount: visibleSessionMessages.length,
          visibleRunMessageCount: visibleRunMessages.length,
          latestSessionRole,
          latestRunRole,
          hasAssistantReply,
          session: chatTelemetrySession(session),
          visibleSessionMessages: chatTelemetryMessages(visibleSessionMessages),
        }, { threadId: storageKey, runId: sessionKey || sessionId || undefined });
        if (replaceRuntimeLeafHistory && !visibleSessionMessages.length) {
          markRuntimeLeafLoaded();
          return;
        }
        if (!replaceRuntimeLeafHistory && (!recent || (!visibleSessionMessages.length && endedAt))) {
          markRuntimeLeafLoaded();
          return;
        }
        if (sessionKey) {
          chatRuntimeSessionIdsByKeyRef.current = {
            ...chatRuntimeSessionIdsByKeyRef.current,
            [storageKey]: sessionKey,
          };
          setChatRuntimeSessionIdsByKey((current) => (
            current[storageKey] === sessionKey ? current : { ...current, [storageKey]: sessionKey }
          ));
        }
        const active = localRunActive
          ? !hasAssistantReply
          : !replaceRuntimeLeafHistory && !endedAt && sessionStreamingFresh && !hasAssistantReply && latestSessionRole !== "assistant";
        if (active) {
          const hasChunk = visibleRunMessages.some((message) => message.role === "assistant");
          setChatStreamingByKey((current) => {
            const existing = current[storageKey];
            const nextEntry = {
              agentId: selectedAgent.id,
              leafKey: selectedChatLeafKey,
              hasChunk,
              startedAt: runStartedAt,
              runId,
            };
            if (
              existing?.agentId === nextEntry.agentId
              && existing?.leafKey === nextEntry.leafKey
              && existing?.hasChunk === nextEntry.hasChunk
              && existing?.startedAt === nextEntry.startedAt
              && existing?.runId === nextEntry.runId
            ) {
              return current;
            }
            chatStreamingByKeyRef.current = { ...chatStreamingByKeyRef.current, [storageKey]: nextEntry };
            return { ...current, [storageKey]: nextEntry };
          });
        } else {
          setChatStreamingByKey((current) => {
            if (!current[storageKey]) return current;
            const next = { ...current };
            delete next[storageKey];
            const nextRef = { ...chatStreamingByKeyRef.current };
            delete nextRef[storageKey];
            chatStreamingByKeyRef.current = nextRef;
            return next;
          });
        }
        const processEntries = chatProcessEventsFromSessionMessages(
          Array.isArray(session.messages) ? session.messages : [],
          active ? { startedAt: runStartedAt, runId } : undefined,
        );
        setChatProcessByKey((current) => {
          if (!active) {
            if (!current[storageKey]) return current;
            const next = { ...current };
            delete next[storageKey];
            return next;
          }
          const existing = (current[storageKey] ?? []).filter((entry) => (
            (!runId || entry.runId === runId)
            && (!runStartedAt || entry.at >= runStartedAt - 2_000)
          ));
          const seen = new Set(existing.map((entry) => `${entry.label}:${entry.detail ?? ""}`));
          const merged = [...existing];
          if (active && merged.length === 0) {
            merged.push({ at: Date.now(), label: "Runtime session active", detail: "Pulled from the agent session store.", runId });
          }
          for (const entry of processEntries) {
            if (runId && entry.runId !== runId) continue;
            if (runStartedAt && entry.at < runStartedAt - 2_000) continue;
            const key = `${entry.label}:${entry.detail ?? ""}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(entry);
          }
          const nextEntries = merged.slice(-80);
          const prevEntries = current[storageKey] ?? [];
          // Bail out (return the same object reference) when the polled process
          // log is unchanged, so a 5-12s poll that found nothing new doesn't
          // re-render DashboardApp and the active panel. Mirrors the equality
          // guard the sibling setMessagesByAgent already uses below.
          if (
            prevEntries.length === nextEntries.length
            && prevEntries.every((entry, index) => {
              const other = nextEntries[index];
              return !!other
                && other.label === entry.label
                && (other.detail ?? "") === (entry.detail ?? "")
                && other.at === entry.at
                && (other.runId ?? "") === (entry.runId ?? "")
                && (other.status ?? "") === (entry.status ?? "");
            })
          ) {
            return current;
          }
          return { ...current, [storageKey]: nextEntries };
        });
        const incomingSessionMessages = replaceRuntimeLeafHistory
          ? visibleSessionMessages
          : localRunActive
            ? visibleRunMessages
            : visibleSessionMessages;
        if (incomingSessionMessages.length) {
          setMessagesByAgent((current) => {
            const existing = current[storageKey] ?? [];
            const merged = replaceRuntimeLeafHistory
              ? dedupeChatTranscript(incomingSessionMessages).slice(-120)
              : mergeRuntimeSessionMessages(existing, incomingSessionMessages);
            logClientTelemetry("chat.runtime.poll.merge_decision", {
              agentId: selectedAgent.id,
              leafKey: selectedChatLeafKey,
              storageKey,
              sessionKey: sessionKey || null,
              replaceRuntimeLeafHistory,
              existingMessageCount: existing.length,
              incomingMessageCount: incomingSessionMessages.length,
              mergedMessageCount: merged.length,
              changed: !(merged === existing || JSON.stringify(merged) === JSON.stringify(existing)),
              existingMessages: chatTelemetryMessages(existing),
              incomingMessages: chatTelemetryMessages(incomingSessionMessages),
              mergedMessages: chatTelemetryMessages(merged),
            }, { threadId: storageKey, runId: sessionKey || sessionId || undefined });
            return merged === existing || JSON.stringify(merged) === JSON.stringify(existing)
              ? current
              : { ...current, [storageKey]: merged };
          });
          if (replaceRuntimeLeafHistory) {
            setSelectedChatPreview((current) => (
              current?.agentId === selectedAgent.id && current.leafKey === selectedChatLeafKey
                ? { ...current, messages: incomingSessionMessages }
                : current
            ));
          }
        }
        if (active) {
          const runMessages = chatMessagesForActiveRun(visibleSessionMessages, { startedAt: runStartedAt, requestLabel: localRun?.requestLabel } as ActiveChatRunRecord);
          persistActiveChatRuns({
            ...readActiveChatRuns(dashboardStateRef.current),
            [storageKey]: {
              storageKey,
              agentId: selectedAgent.id,
              leafKey: selectedChatLeafKey,
              startedAt: runStartedAt,
              updatedAt: Date.now(),
              sessionId: sessionKey,
              runId,
              status: "active",
              requestLabel: runMessages.find((message) => message.role === "user")?.content,
            },
          });
        } else {
          const activeRuns = readActiveChatRuns(dashboardStateRef.current);
          if (activeRuns[storageKey]) {
            delete activeRuns[storageKey];
            persistActiveChatRuns(activeRuns);
          }
        }
        resumedRuntimeSessionKeysRef.current.add(`${storageKey}:${sessionKey || updatedAt}`);
        markRuntimeLeafLoaded();
      } catch (error) {
        logClientTelemetry("chat.runtime.poll.error", {
          agentId: selectedAgent.id,
          leafKey: selectedChatLeafKey,
          storageKey,
          sessionId: sessionId || null,
          elapsedMs: Date.now() - pollStartedAt,
          error: error instanceof Error ? error.message : String(error),
        }, { threadId: storageKey, runId: sessionId || undefined });
        if (!leafRuntimeSessionId) markRuntimeLeafLoaded();
      } finally {
        runtimeSessionPollInFlightRef.current.delete(pollRequestKey);
      }
    };
    void pollSession();
    const timer = window.setInterval(() => void pollSession(), chatStreamingByKeyRef.current[storageKey] ? 5_000 : 12_000);
    return () => window.clearInterval(timer);
  }, [activeView, hydrated, persistActiveChatRuns, selectedAgent, selectedChatLeafKey, selectedChatRuntimeSessionId]);

  // Global stale-run sweep. The per-thread poller above only re-evaluates the
  // OPEN thread, so a run orphaned by a backend restart (or one that finished
  // while you were on another screen) would show "cooking" forever in its
  // thread — clearing only when revisited. This clears the streaming/process
  // indicator for any non-foreground run past the stall window (the same 130s
  // after which a run leaves the local "active" state anyway). It only clears
  // the indicator + persisted run record; reopening the thread re-polls the
  // session and resumes the indicator if the backend is genuinely still active.
  useEffect(() => {
    if (!hydrated) return;
    const selectedKey = activeView === "chat" && selectedAgent
      ? chatMessageStorageKey(selectedAgent.id, selectedChatLeafKey)
      : "";
    const sweep = () => {
      const now = Date.now();
      const runs = readActiveChatRuns(dashboardStateRef.current);
      const candidateKeys = new Set([
        ...Object.keys(runs),
        ...Object.keys(chatStreamingByKeyRef.current),
      ]);
      const staleKeys: string[] = [];
      for (const key of candidateKeys) {
        if (!key || key === selectedKey) continue;
        const run = runs[key];
        const lastActivityAt = run?.updatedAt ?? chatStreamingByKeyRef.current[key]?.startedAt ?? 0;
        const hasReply = run
          ? activeChatRunHasAssistantReply(messagesByAgentRef.current[key], run)
          : chatTranscriptHasAssistantReply(messagesByAgentRef.current[key]);
        if (hasReply || now - lastActivityAt > CHAT_RESPONSE_STALL_TIMEOUT_MS) staleKeys.push(key);
      }
      if (!staleKeys.length) return;
      for (const key of staleKeys) clearActiveChatRun(key);
      setChatStreamingByKey((current) => {
        let changed = false;
        const next = { ...current };
        for (const key of staleKeys) if (next[key]) { delete next[key]; changed = true; }
        if (!changed) return current;
        chatStreamingByKeyRef.current = next;
        return next;
      });
      setChatProcessByKey((current) => {
        let changed = false;
        const next = { ...current };
        for (const key of staleKeys) if (next[key]) { delete next[key]; changed = true; }
        return changed ? next : current;
      });
    };
    sweep();
    const id = window.setInterval(sweep, 30_000);
    return () => window.clearInterval(id);
  }, [hydrated, activeView, selectedAgent, selectedChatLeafKey, clearActiveChatRun]);

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
    void importExistingSchedulesRef.current?.({ quiet: true });
  }, [activeView, displayAgents, hydrated]);
  // eslint-disable-next-line react-hooks/refs
  dispatchKanbanTaskToAgentRef.current = dispatchKanbanTaskToAgent;
  const { checkStatus, checkVaultStatus, checkControlRoomStatus, runVaultTailnetSync, pairSyncthingCollector, pairSyncthingVaultSync, inspectBrainNode, startBrainPan, moveBrainPan, endBrainPan, addChatFiles, handleChatFileChange, handleChatFileReferenceDrop, handleChatImageChange, removeChatAttachment, attachChatDirectory, attachChatRecentDirectory, removeChatDirectory, addQuickAddFiles, handleQuickAddFileChange, handleQuickAddImageChange, removeQuickAddAttachment, attachQuickAddDirectory, attachQuickAddRecentDirectory, removeQuickAddDirectory, addKanbanSteerFiles, handleKanbanSteerFileChange, handleKanbanSteerImageChange, removeKanbanSteerAttachment, attachKanbanSteerDirectory, attachKanbanSteerRecentDirectory, removeKanbanSteerDirectory, updateVoiceTranscript, appendVoiceTranscriptToInput, cleanupVoiceCapture, startVoiceWaveform, startAudioRecording, stopAudioRecording, sendMessage, sendPromptMessage, queuedChatMessages, flushingChatQueueId, removeQueuedChatMessage, sendQueuedChatMessageNow, generateKanbanTaskFromChat, dismissChatKanbanGeneration, chatKanbanGeneration } = useStatusChatInputController({ AbortController, CHAT_RESPONSE_STALL_TIMEOUT_MS, Uint8Array, agents: displayAgents, appendMessage, attachmentSummary, brainDragMovedRef, brainDragRef, brainGraph, brainPan, busy: selectedChatStreaming, chatAttachments, chatAutoScrollRef, chatDirectories, chatMessageStorageKey, chatRuntimeSessionIdsByKey, chatSetupIssue, chooseDirectoryForMachine, clearActiveChatRun, collectorKey, createDefaultAgentWallet, discoveredMachines, honeyLedgerEnabled, hydrated, isManualAgentChatMessage, kanbanBoardSlug, kanbanReadyPickupInFlightRef, kanbanStorageBody, linkedDirectoryLabel, localKanbanMachineTarget, machineGroups, messageContentParts, messages, orchestrateReadyKanbanTask, quickAddMachineTarget, quickAddMachineTargets, readComposerFiles, recordActiveChatRun, recordRecentDirectory, recording, refreshHoneyLedger, refreshKanbanOnce, refreshMaintenanceReport, refreshNotifications, refreshRuntimeUsage, searchAllRuntimeSessions, selectedAgent, selectedBrainNodeId, selectedChatDirectoryPath, selectedChatLeafKey, selectedChatRuntimeSessionId, selectedChatTargetRef, selectedKanbanAgent, selectedKanbanTask, setActiveView, setAttachmentError, setAttachmentMenuOpen, setBrainGraph, setBrainGraphStatus, setBrainPan, setChatAttachments, setChatDirectories, setChatProcessByKey, setControlRoomStatus, setChatRuntimeSessionIdsByKey, setChatStreamingByKey, setKanbanBoard, setKanbanError, setKanbanSteerAttachmentError, setKanbanSteerAttachmentMenuOpen, setKanbanSteerAttachments, setKanbanSteerDirectories, setKanbanSteerDraft, setKanbanStorage, setMessagesByAgent, setQuickAddAttachmentError, setQuickAddAttachmentMenuOpen, setQuickAddAttachments, setQuickAddDirectories, setQuickAddDrafts, setRecentDirectoriesExpanded, setRecording, setSelectedBrainNodeId, setSelectedChatPreview, setSelectedChatRuntimeSessionId, setStatus, setStatusAgentId, setText, setVaultStatus, setVaultSyncPending, setVaultSyncStatus, setVoiceBands, setVoiceTarget, setVoiceTranscript, sharedVault, speechRecognitionConstructor, syncthingAutoPairRef, tailscaleDevices, text, updateAgentProfile, updateSharedVault, updateTask, upsertTask, voiceAnimationRef, voiceAudioContextRef, voiceRecognitionRef, voiceStreamRef, voiceTarget, voiceTranscriptRef, walletsByAgent });
  const updateFleetSyncAutoRepair = useCallback((deviceID: string, nextState: FleetSyncAutoRepairState | null) => {
    setFleetSyncAutoRepairByDevice((current) => {
      const next = { ...current };
      if (nextState) next[deviceID] = nextState;
      else delete next[deviceID];
      fleetSyncAutoRepairRef.current = next;
      return next;
    });
  }, []);
  const fixFleetSyncIssue = useCallback(async (machine: FleetMachine) => {
    const collectorUrl = machine.collectorUrl || (/^https?:\/\//i.test(machine.tailnet) ? machine.tailnet : "");
    const remoteCollectorUrl = collectorUrl;
    if (!remoteCollectorUrl) {
      const error = `No verified agent bridge URL is available for ${machine.name}. Refresh Fleet after the collector reports ready.`;
      setVaultSyncStatus({ ok: false, method: "syncthing", error });
      throw new Error(error);
    }
    setVaultSyncPending(`syncthing:${machine.id}`);
    setVaultSyncStatus(null);
    const repairTimeout = new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(`Timed out contacting ${machine.name}'s agent bridge for Syncthing repair.`)), FLEET_SYNC_REPAIR_TIMEOUT_MS);
    });
    const data = await Promise.race([
      pairSyncthingCollector({
        remoteCollectorUrl,
        remoteName: machine.name,
        remoteTailscaleIp: machine.ip && machine.ip !== "—" ? machine.ip : undefined,
        remoteAddressHost: remoteHost || undefined,
        remotePath: sharedVault.tailnetSyncPath,
      }),
      repairTimeout,
    ]).catch((error) => {
      const message = error instanceof Error ? error.message : `Could not repair Syncthing sync for ${machine.name}.`;
      return { ok: false, error: message };
    });
    setVaultSyncPending("");
    if (!data?.ok) {
      const error = data?.error ?? `Could not repair Syncthing sync for ${machine.name}.`;
      setVaultSyncStatus({ ok: false, method: "syncthing", error });
      throw new Error(error);
    }
    setVaultSyncStatus({ ...data, method: "syncthing", message: `Syncthing repaired and rescanned ${machine.name}.` });
    void checkVaultStatus();
  }, [checkVaultStatus, pairSyncthingCollector, setVaultSyncPending, setVaultSyncStatus, sharedVault.tailnetSyncPath]);
  useEffect(() => {
    runFleetSyncAutoRepairs({
      enabled: hydrated && sharedVault.enabled && sharedVault.syncProvider === "syncthing",
      targets: fleetSyncRepairTargets,
      autoRepairRef: fleetSyncAutoRepairRef,
      updateAutoRepair: updateFleetSyncAutoRepair,
      repairMachine: fixFleetSyncIssue,
    });
  }, [
    fixFleetSyncIssue,
    fleetSyncRepairTargets,
    hydrated,
    sharedVault.enabled,
    sharedVault.syncProvider,
    updateFleetSyncAutoRepair,
  ]);
  useDashboardPollingEffects({
    activeView, hydrated, chatRequestActive, refreshMirosharkArchive, refreshBrainGraph, refreshBrainSkills, refreshRecentDirectories, refreshMirosharkRun,
    sharedVault, brainSkills, brainSkillsLoading, walletPanelMode, refreshRuntimeUsage, refreshWalletVaultBackupStatus,
    refreshMaintenanceReport, refreshRuntimeFileRoots, hiveEnv, hiveEnvLoading, refreshHiveEnv, agentWorkerClassView, vaultPanelMode,
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
    const installingGbrain = action === "connect" || action === "install";
    if (installingGbrain && !data.status?.installed) { setGbrainActionStatus(data.status?.error ?? `GBrain ${action} finished, but the CLI is still unavailable.`); setGbrainBusy(""); return; }
    if (installingGbrain && !sharedVault.gbrain.enabled) updateSharedVault({ gbrain: { ...sharedVault.gbrain, enabled: true, installMode: action === "install" ? "local" : sharedVault.gbrain.installMode } });
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

  const refreshQmdStatus = useCallback(async () => {
    if (!sharedVault.enabled) {
      setQmdActionStatus("Turn on the shared vault before checking QMD.");
      return;
    }
    setQmdBusy("status");
    const params = new URLSearchParams();
    if (sharedVault.vaultPath?.trim()) params.set("vaultPath", sharedVault.vaultPath.trim());
    if (sharedVault.brainServicesFolder?.trim()) params.set("brainServicesFolder", sharedVault.brainServicesFolder.trim());
    Object.entries(sharedVault.qmd ?? {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      params.set(key, String(value));
    });
    const response = await fetch(`/api/brain/qmd/status?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; status?: DashboardQmdStatus; error?: string } | null;
    if (data?.status) {
      setQmdStatus(data.status);
      setQmdActionStatus(data.status.installed ? data.status.ok ? "QMD status refreshed." : data.status.error ?? "QMD needs indexing." : data.status.error ?? "QMD is ready to install or connect.");
    } else {
      setQmdActionStatus(data?.error ?? "Could not check QMD status.");
    }
    setQmdBusy("");
  }, [sharedVault.brainServicesFolder, sharedVault.enabled, sharedVault.qmd, sharedVault.vaultPath]);

  async function runQmdAction(action: "install" | "connect" | "index" | "embed") {
    if (!sharedVault.enabled) {
      setQmdActionStatus("Turn on the shared vault before changing QMD.");
      return;
    }
    setQmdBusy(action);
    setQmdActionStatus(`${action === "embed" ? "Refreshing QMD vectors" : action === "index" ? "Indexing shared vault with QMD" : action === "install" ? "Installing and setting up QMD" : "Connecting QMD"}...`);
    const response = await fetch(`/api/brain/qmd/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        brainServicesFolder: sharedVault.brainServicesFolder.trim() || undefined,
        qmd: {
          ...sharedVault.qmd,
          enabled: action === "connect" || action === "install" ? true : sharedVault.qmd.enabled,
        },
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; status?: DashboardQmdStatus; error?: string } | null;
    if (!response?.ok || !data?.ok) {
      setQmdActionStatus(data?.error ?? `QMD ${action} failed.`);
      setQmdBusy("");
      return;
    }
    if (data.status) setQmdStatus(data.status);
    const installingQmd = action === "connect" || action === "install";
    if (installingQmd && !data.status?.installed) {
      setQmdActionStatus(data.status?.error ?? `QMD ${action} finished, but the CLI is still unavailable.`);
      setQmdBusy("");
      return;
    }
    if (installingQmd && !sharedVault.qmd.enabled) {
      updateSharedVault({ qmd: { ...sharedVault.qmd, enabled: true, installMode: action === "install" ? "npm-global" : sharedVault.qmd.installMode } });
    }
    setQmdActionStatus(`QMD ${action === "embed" ? "embedding refresh" : action} complete.`);
    setQmdBusy("");
  }

  async function queryQmdFromDashboard() {
    const query = qmdQuery.trim();
    if (!query) {
      setQmdActionStatus("Enter a QMD query first.");
      return;
    }
    setQmdBusy("query");
    setQmdActionStatus("Searching QMD...");
    setQmdQueryResult("");
    const response = await fetch("/api/brain/qmd/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        brainServicesFolder: sharedVault.brainServicesFolder.trim() || undefined,
        qmd: sharedVault.qmd,
        query,
        mode: sharedVault.qmd.searchMode,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; output?: string; status?: DashboardQmdStatus; error?: string } | null;
    if (!response?.ok || !data?.ok) {
      setQmdActionStatus(data?.error ?? "QMD query failed.");
      setQmdBusy("");
      return;
    }
    if (data.status) setQmdStatus(data.status);
    setQmdQueryResult(data.output || "(QMD returned no text.)");
    setQmdActionStatus("QMD results ready.");
    setQmdBusy("");
  }

  const refreshNeo4jStatus = useCallback(async () => {
    if (!sharedVault.enabled) {
      setNeo4jActionStatus("Turn on the shared vault before checking Neo4j.");
      return;
    }
    setNeo4jBusy("status");
    const params = new URLSearchParams();
    if (sharedVault.vaultPath?.trim()) params.set("vaultPath", sharedVault.vaultPath.trim());
    if (sharedVault.brainServicesFolder?.trim()) params.set("brainServicesFolder", sharedVault.brainServicesFolder.trim());
    Object.entries(sharedVault.neo4j ?? {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      params.set(key, String(value));
    });
    const response = await fetch(`/api/brain/neo4j/status?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; status?: DashboardNeo4jBrainStatus; error?: string } | null;
    if (data?.status) {
      setNeo4jStatus(data.status);
      setNeo4jActionStatus(data.status.connected ? "Neo4j status refreshed." : data.status.error ?? "Neo4j is ready to connect.");
    } else {
      setNeo4jActionStatus(data?.error ?? "Could not check Neo4j status.");
    }
    setNeo4jBusy("");
  }, [sharedVault.brainServicesFolder, sharedVault.enabled, sharedVault.neo4j, sharedVault.vaultPath]);

  async function runNeo4jAction(action: "connect" | "sync") {
    if (!sharedVault.enabled) {
      setNeo4jActionStatus("Turn on the shared vault before changing Neo4j.");
      return;
    }
    setNeo4jBusy(action);
    setNeo4jActionStatus(action === "sync" ? "Syncing derived graph into Neo4j..." : "Connecting Neo4j...");
    const response = await fetch(`/api/brain/neo4j/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        brainServicesFolder: sharedVault.brainServicesFolder.trim() || undefined,
        neo4j: {
          ...sharedVault.neo4j,
          enabled: true,
          installMode: "existing",
        },
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; status?: DashboardNeo4jBrainStatus; synced?: { memories?: number; compiledKnowledgePages?: number }; error?: string } | null;
    if (!response?.ok || !data?.ok) {
      setNeo4jActionStatus(data?.error ?? `Neo4j ${action} failed.`);
      setNeo4jBusy("");
      return;
    }
    if (data.status) setNeo4jStatus(data.status);
    if (!sharedVault.neo4j.enabled) updateSharedVault({ neo4j: { ...sharedVault.neo4j, enabled: true, installMode: "existing" } });
    setNeo4jActionStatus(action === "sync" && data.synced
      ? `Neo4j sync complete: ${data.synced.memories ?? 0} memories, ${data.synced.compiledKnowledgePages ?? 0} compiled pages.`
      : "Neo4j connected.");
    setNeo4jBusy("");
  }

  async function queryNeo4jFromDashboard() {
    const query = neo4jQuery.trim();
    if (!query) {
      setNeo4jActionStatus("Enter a read-only Cypher query first.");
      return;
    }
    setNeo4jBusy("query");
    setNeo4jActionStatus("Querying Neo4j...");
    setNeo4jQueryResult("");
    const response = await fetch("/api/brain/neo4j/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        brainServicesFolder: sharedVault.brainServicesFolder.trim() || undefined,
        neo4j: sharedVault.neo4j,
        query,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; rows?: unknown[]; status?: DashboardNeo4jBrainStatus; error?: string } | null;
    if (!response?.ok || !data?.ok) {
      setNeo4jActionStatus(data?.error ?? "Neo4j query failed.");
      setNeo4jBusy("");
      return;
    }
    if (data.status) setNeo4jStatus(data.status);
    setNeo4jQueryResult(JSON.stringify(data.rows ?? [], null, 2));
    setNeo4jActionStatus("Neo4j query results ready.");
    setNeo4jBusy("");
  }

  const refreshSyntoStatus = useCallback(async () => {
    if (!sharedVault.enabled) {
      setSyntoActionStatus("Turn on the shared vault before checking Syntho.");
      return;
    }
    setSyntoBusy("status");
    const params = new URLSearchParams();
    if (sharedVault.vaultPath?.trim()) params.set("vaultPath", sharedVault.vaultPath.trim());
    if (sharedVault.synthesisFolder?.trim()) params.set("synthesisFolder", sharedVault.synthesisFolder.trim());
    if (sharedVault.brainServicesFolder?.trim()) params.set("brainServicesFolder", sharedVault.brainServicesFolder.trim());
    Object.entries(sharedVault.synto ?? {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      params.set(key, String(value));
    });
    const response = await fetch(`/api/brain/synto/status?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; status?: DashboardSyntoStatus; error?: string } | null;
    if (data?.status) {
      setSyntoStatus(data.status);
      setSyntoActionStatus(data.status.installed ? data.status.initialized ? "Syntho status refreshed." : "Syntho is installed. Initialize Synthesis to activate it." : data.status.error ?? "Syntho is ready to install or connect.");
    } else {
      setSyntoActionStatus(data?.error ?? "Could not check Syntho status.");
    }
    setSyntoBusy("");
  }, [sharedVault.brainServicesFolder, sharedVault.enabled, sharedVault.synthesisFolder, sharedVault.synto, sharedVault.vaultPath]);

  async function runSyntoAction(action: "install" | "connect" | "init" | "run" | "maintain" | "compare" | "eval" | "doctor" | "pack") {
    if (!sharedVault.enabled) {
      setSyntoActionStatus("Turn on the shared vault before changing Syntho.");
      return;
    }
    setSyntoBusy(action);
    const actionLabel = action === "init"
      ? "Initializing Syntho"
      : action === "pack"
        ? "Exporting Syntho pack"
        : action === "eval"
          ? "Evaluating Syntho wiki"
          : action === "compare"
            ? "Comparing Syntho model output"
            : `${action[0].toUpperCase()}${action.slice(1)}ing Syntho`;
    setSyntoActionStatus(`${actionLabel}...`);
    const response = await fetch(`/api/brain/synto/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        synthesisFolder: sharedVault.synthesisFolder.trim() || undefined,
        brainServicesFolder: sharedVault.brainServicesFolder.trim() || undefined,
        synto: {
          ...sharedVault.synto,
          enabled: action === "connect" || action === "install" ? true : sharedVault.synto.enabled,
        },
        fix: false,
        backlog: true,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; status?: DashboardSyntoStatus; output?: string; error?: string } | null;
    if (!response?.ok || !data?.ok) {
      setSyntoActionStatus(data?.error ?? `Syntho ${action} failed.`);
      setSyntoBusy("");
      return;
    }
    if (data.status) setSyntoStatus(data.status);
    if (data.output) setSyntoQueryResult(data.output);
    if ((action === "connect" || action === "install") && !sharedVault.synto.enabled) {
      updateSharedVault({ synto: { ...sharedVault.synto, enabled: true, installMode: action === "install" ? "uv-tool" : "existing" } });
    }
    setSyntoActionStatus(`Syntho ${action === "init" ? "initialization" : action} complete.`);
    setSyntoBusy("");
  }

  async function querySyntoFromDashboard() {
    const query = syntoQuery.trim();
    if (!query) {
      setSyntoActionStatus("Enter a Syntho query first.");
      return;
    }
    setSyntoBusy("query");
    setSyntoActionStatus("Asking Syntho...");
    setSyntoQueryResult("");
    const response = await fetch("/api/brain/synto/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        synthesisFolder: sharedVault.synthesisFolder.trim() || undefined,
        brainServicesFolder: sharedVault.brainServicesFolder.trim() || undefined,
        synto: sharedVault.synto,
        query,
        synthesize: false,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; output?: string; status?: DashboardSyntoStatus; error?: string } | null;
    if (!response?.ok || !data?.ok) {
      setSyntoActionStatus(data?.error ?? "Syntho query failed.");
      setSyntoBusy("");
      return;
    }
    if (data.status) setSyntoStatus(data.status);
    setSyntoQueryResult(data.output || "(Syntho returned no text.)");
    setSyntoActionStatus("Syntho answer ready.");
    setSyntoBusy("");
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
      void refreshQmdStatus();
      void refreshNeo4jStatus();
      void refreshSyntoStatus();
      void refreshTradingBrainStatus();
    }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [activeView, hydrated, refreshGbrainStatus, refreshNeo4jStatus, refreshQmdStatus, refreshSyntoStatus, refreshTradingBrainStatus, vaultPanelMode]);

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
  const { agentSettingsSelectedCustomWorkerId, agentSettingsCustomWorker, agentSettingsWorkerLabel, agentSettingsWorkerImage, agentSettingsSoulPrompt, agentSettingsSkillProfile, agentSettingsPreferredSkills, agentSettingsRuntime, agentSettingsProvider, runtimeModelSelection, runtimeModelSelectionFresh, runtimeModelProviders, selectedRuntimeProvider, selectedRuntimeModels, selectedRuntimeModelId, selectedRuntimeModel, updateAgentRuntimeModel, agentSettingsIntegrationTarget, addHermesModelFromDraft, selectAgentWorkerClass, selectCustomWorkerClass, updateAgentSoulPrompt, updateAgentSkillProfile, addAgentPreferredSkill, removeAgentPreferredSkill, openCustomWorkerClassCreator, applyCustomWorkerClass, installPackagedAgent, toggleCustomWorkerSkill, uploadCustomWorkerImage, filteredCustomWorkerSkills, selectedHetznerServerType, showHivemindLinkConnectedBanner } = useAgentSettingsController({ HETZNER_SERVER_TYPE_OPTIONS, agentCreateDraft, agentCreateMachine, agentSettingsCustomWorkers, agentSettingsWorkerClass, agentSettingsWorkerPreset, agents, beeRoleIconPath, beeWorkerPreset, createAgentProfile, customWorkerDraft, customWorkerProfileFromDraft, customWorkerSkillSearch, hivemindLinkBannerDismissed, hivemindLinkConnectedUntil, hivemindLinkStatus, machineInitDraft, roleModalAgent, runRuntimeIntegrationAction, runtimeCount, runtimeIntegrationStatus, runtimeModelDraft, runtimeModelSelectionsByRuntime, setAgentCreateDraft, setAgentWorkerClassView, setCustomWorkerDraft, setCustomWorkerImageError, setCustomWorkerSkillSearch, setRuntimeModelDraft, sharedSkillOptions, updateAgentProfile });
  useEffect(() => {
    if (!roleModalAgent && !agentCreateMachine) return;
    let cancelled = false;
    const hintedAgents = agentCreateMachine?.agents ?? (roleModalAgent ? [roleModalAgent] : []);
    const allKnownAgentsByTarget = new Map<string, AgentProfile>();
    const rememberAgent = (agent?: AgentProfile | null) => {
      if (!agent) return;
      const telemetryUrl = agent.telemetryUrl?.trim().replace(/\/+$/, "") || "local";
      const gatewayUrl = agent.gatewayUrl?.trim().replace(/\/+$/, "") || "";
      const machineName = agent.machineName?.trim() || "";
      const localDataDir = agent.localDataDir?.trim() || "";
      const agentId = agent.agentId?.trim() || agent.id?.trim() || "";
      allKnownAgentsByTarget.set([agent.runtime, telemetryUrl, gatewayUrl, machineName, localDataDir, agentId].join("|"), agent);
    };
    for (const agent of displayAgents) rememberAgent(agent);
    for (const machine of machineGroups) {
      for (const agent of machine.agents ?? []) rememberAgent(agent);
    }
    for (const agent of hintedAgents) rememberAgent(agent);
    rememberAgent(agentSettingsIntegrationTarget);
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
      const hinted = hintedAgents.length
        ? Object.fromEntries(hintedAgents.map((agent) => [
          agent.runtime,
          { installed: true, detail: `${RUNTIME_LABELS[agent.runtime] ?? agent.runtime} is configured on this machine.` },
        ]))
        : {};
      setRuntimeAvailability((current) => sameRuntimeAvailability(current, hinted) ? current : hinted);
    });
    void fetch("/api/runtimes/availability", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data?.ok && data.runtimes) {
          setRuntimeAvailability((current) => {
            const next = { ...current, ...data.runtimes };
            return sameRuntimeAvailability(current, next) ? current : next;
          });
        }
      })
      .catch(() => undefined);
    const runtimeCheckTimer = window.setTimeout(() => {
      if (agentSettingsRuntime === HIVEMIND_OS_RUNTIME) {
        for (const target of allKnownAgentsByTarget.values()) {
          if (target.runtime === HIVEMIND_OS_RUNTIME && runtimeCan(target, "modelSelection")) {
            void refreshRuntimeIntegrations(target);
          }
        }
        return;
      }
      for (const target of integrationTargetsByRuntime.values()) {
        if (!runtimeModelSelectionsByRuntime[target.runtime]) void refreshRuntimeIntegrations(target);
      }
    }, agentCreateMachine ? 350 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(runtimeCheckTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentCreateMachine?.key, roleModalAgent?.id, agentSettingsRuntime, runtimeAvailabilityNonce]);
  const showHivemindLinkSignInBanner = !hivemindLinkBannerDismissed
    && !showHivemindLinkConnectedBanner
    && Boolean(hivemindLinkStatus?.authUrl)
    && hivemindLinkStatus?.ok !== true;
  const {
    commandPaletteOpen,
    navigateDashboardTarget,
    navigationRecents,
    openDashboardNotification,
    popoutDashboardTarget,
    setCommandPaletteOpen,
  } = useDashboardNavigationController({
    activeView,
    hydrated,
    selectedAgentId,
    selectedChatLeafKey,
    selectedKanbanTaskId,
    setActiveView,
    setSelectedAgentId,
    setSelectedChatLeafKey,
    setSelectedKanbanTaskId,
    setVaultPanelMode,
    tasks,
    vaultPanelMode,
  });
  const baseHiveScreenContext = useMemo(() => {
    const context = baseDashboardScreenContext(activeView);
    const selections: DashboardContextItem[] = [];
    const openModals: DashboardContextItem[] = [];
    const openPanels: DashboardContextItem[] = [];
    const addSelection = (item: DashboardContextItem | null | undefined) => {
      if (item?.label) selections.push(item);
    };
    const addModal = (item: DashboardContextItem | null | undefined) => {
      if (item?.label) openModals.push(item);
    };
    const addPanel = (item: DashboardContextItem | null | undefined) => {
      if (item?.label) openPanels.push(item);
    };
    const currentRoute = typeof window === "undefined" ? "" : `${window.location.pathname}${window.location.search}`;
    const sectionForView = (): DashboardContextItem | undefined => {
      switch (activeView) {
        case "agents":
          return { kind: "section", id: "fleet", label: "Fleet", detail: `${machineGroups.length} machines, ${displayAgents.length} visible agents` };
        case "kanban":
          return { kind: "section", id: "work-board", label: "Work board", detail: `Board: ${kanbanBoard?.name || kanbanBoardSlug}` };
        case "history":
          return { kind: "section", id: "work-history", label: "Work history", detail: kanbanIncludeArchived ? "Archived tasks included" : "Active history filters" };
        case "scheduler":
          return { kind: "section", id: "schedules", label: "Schedules", detail: schedulerDraftOpen ? "Schedule draft open" : `${schedules.length} schedules` };
        case "swarm":
          return { kind: "section", id: mirosharkWorkbenchTab, label: "MiroShark swarm", detail: swarmStatusLabel || mirosharkDisplayStatus || undefined };
        case "wallet":
          return { kind: "section", id: walletPanelMode, label: walletPanelMode === "usage" ? "Wallet usage" : "Agent wallets", detail: `${walletStats.enabled ?? 0} enabled wallets` };
        case "vault": {
          const labels = {
            "hive-vault": "Shared brain graph",
            "shared-skills": "Shared skills",
            "brain-services": "Brain services",
            env: "Shared env",
            config: "Vault configuration",
          };
          return { kind: "section", id: vaultPanelMode, label: labels[vaultPanelMode] ?? "Shared Brain" };
        }
        case "chat":
          return { kind: "section", id: selectedChatLeafKey || "agent-chat", label: selectedAgent ? `Chat with ${selectedAgent.name}` : "Agent chat", detail: selectedChatDirectory?.path || selectedChatLeafKey || undefined };
        case "env":
          return { kind: "section", id: "shared-env", label: "Shared env", detail: selectedRuntimeEnvSource?.label };
        case "files":
          return { kind: "section", id: "runtime-files", label: "Runtime files", detail: runtimeFilePath || runtimeFileRootKey || undefined };
        case "sessions":
          return { kind: "section", id: "runtime-sessions", label: "Runtime session search", detail: sessionSearchQuery || undefined };
        case "notifications":
          return { kind: "section", id: "notifications", label: "Notifications", detail: notificationSummary?.unread ? `${notificationSummary.unread} unread` : undefined };
        default:
          return { kind: "section", id: activeView, label: DASHBOARD_ROUTE_LABELS[activeView] ?? String(activeView) };
      }
    };

    addSelection(selectedAgent ? { kind: "agent", id: selectedAgent.id, label: selectedAgent.name, detail: [selectedAgent.runtime, selectedAgent.machineName].filter(Boolean).join(" on ") } : null);
    addSelection(selectedKanbanTask ? { kind: "task", id: selectedKanbanTask.id, label: selectedKanbanTask.title, detail: selectedKanbanTask.status } : null);
    addSelection(selectedWallet ? { kind: "wallet", id: selectedWallet.agentId, label: selectedAgent?.name ?? "Selected wallet", detail: `${selectedWallet.provider} on ${selectedWallet.network}` } : null);
    addSelection(selectedBrainNode ? { kind: "brain node", id: selectedBrainNode.id, label: selectedBrainNode.label ?? selectedBrainNode.title ?? selectedBrainNode.id, detail: selectedBrainNode.kind } : null);
    addSelection(selectedRuntimeEnvSource ? { kind: "env source", id: selectedRuntimeEnvSource.id, label: selectedRuntimeEnvSource.label, detail: selectedRuntimeEnvSource.runtime } : null);
    addSelection(selectedSwarmRunId ? { kind: "swarm run", id: selectedSwarmRunId, label: selectedSwarmRunId, detail: currentSwarmRun?.status ?? swarmStatusLabel } : null);

    addModal(commandPaletteOpen ? { kind: "dialog", id: "command-palette", label: "Command palette" } : null);
    addModal(agentCreateMachine ? { kind: "dialog", id: "add-agent", label: "Add agent", detail: `Machine: ${agentCreateMachine.name}; panel: ${agentSettingsPanel}` } : null);
    addModal(roleModalAgent ? { kind: "dialog", id: "agent-settings", label: "Agent settings", detail: `${roleModalAgent.name}; panel: ${agentSettingsPanel}` } : null);
    addModal(skillBrowserOpen ? { kind: "dialog", id: "skill-browser", label: "Skill browser", detail: skillBrowserView } : null);
    addModal(skillBrowserGithubOpen ? { kind: "dialog", id: "skill-browser-github", label: "GitHub skill import" } : null);
    addModal(machineInitOpen ? { kind: "dialog", id: "machine-initializer", label: "Machine initializer", detail: machineInitDraft.projectName || machineInitDraft.serverType } : null);
    addModal(setupMachine ? { kind: "dialog", id: "machine-setup", label: "Machine setup", detail: setupMachine.name } : null);
    addModal(duplicateAgentDraft ? { kind: "dialog", id: "duplicate-agent", label: "Duplicate agent", detail: displayAgents.find((agent) => agent.id === duplicateAgentDraft.agentId)?.name ?? duplicateAgentDraft.agentId } : null);
    addModal(machineDirectoryBrowser ? { kind: "dialog", id: "directory-browser", label: "Directory browser", detail: `${machineDirectoryBrowser.machine.name} ${machineDirectoryBrowser.path}`.trim() } : null);
    addModal(chatFolderCreatorMachine ? { kind: "dialog", id: "chat-folder-creator", label: "Chat folder creator", detail: chatFolderCreatorMachine.name } : null);
    addModal(schedulerDraftOpen ? { kind: "dialog", id: "schedule-draft", label: "Schedule draft", detail: scheduleDraft.name || `Step ${schedulerSelectedStep + 1}` } : null);
    addModal(kanbanTaskModal ? { kind: "dialog", id: `kanban-task-${kanbanTaskModal}`, label: `Work task ${kanbanTaskModal}`, detail: selectedKanbanTask?.title } : null);
    addModal(sharedEnvImportOpen ? { kind: "dialog", id: "shared-env-import", label: "Import .env" } : null);
    addModal(runtimeFileOpen ? { kind: "dialog", id: "runtime-file", label: "Runtime file editor", detail: runtimeFileOpen.path } : null);

    addPanel(sharedEnvAddMenuOpen ? { kind: "popover", id: "shared-env-add", label: "Shared env add menu" } : null);
    addPanel(schedulerAttachMenu ? { kind: "popover", id: "scheduler-attach", label: "Scheduler attach menu", detail: schedulerAttachMenu } : null);
    addPanel(attachmentMenuOpen ? { kind: "popover", id: "chat-attachment-menu", label: "Chat attachment menu" } : null);
    addPanel(quickAddAttachmentMenuOpen ? { kind: "popover", id: "quick-add-attachments", label: "Work quick-add attachment menu" } : null);
    addPanel(kanbanSteerAttachmentMenuOpen ? { kind: "popover", id: "kanban-steer-attachments", label: "Task steering attachment menu" } : null);
    addPanel(kanbanSteerTargetMenuOpen ? { kind: "popover", id: "kanban-steer-target", label: "Task steering target menu", detail: kanbanSteerTargetStatus } : null);
    addPanel(Object.values(quickAddMachineMenuOpen).some(Boolean) ? { kind: "popover", id: "quick-add-machine", label: "Work quick-add machine menu" } : null);
    addPanel(Object.values(kanbanCardMachineMenuOpen).some(Boolean) ? { kind: "popover", id: "kanban-card-machine", label: "Task card machine menu" } : null);
    addPanel(Object.values(kanbanCardAttachmentMenuOpen).some(Boolean) ? { kind: "popover", id: "kanban-card-attachments", label: "Task card attachment menu" } : null);
    addPanel(Object.values(kanbanCardAttachmentListOpen).some(Boolean) ? { kind: "popover", id: "kanban-card-attachment-list", label: "Task card attachment list" } : null);
    addPanel(Object.values(kanbanCardDeliverableMenuOpen).some(Boolean) ? { kind: "popover", id: "kanban-card-deliverables", label: "Task card deliverable menu" } : null);

    return mergeDashboardScreenContext(context, {
      route: currentRoute,
      section: sectionForView(),
      selections,
      openModals,
      openPanels,
    });
  }, [
    activeView,
    agentCreateMachine,
    agentSettingsPanel,
    attachmentMenuOpen,
    chatFolderCreatorMachine,
    commandPaletteOpen,
    currentSwarmRun?.status,
    displayAgents,
    duplicateAgentDraft,
    kanbanBoard?.name,
    kanbanBoardSlug,
    kanbanCardAttachmentListOpen,
    kanbanCardAttachmentMenuOpen,
    kanbanCardDeliverableMenuOpen,
    kanbanCardMachineMenuOpen,
    kanbanIncludeArchived,
    kanbanSteerAttachmentMenuOpen,
    kanbanSteerTargetMenuOpen,
    kanbanSteerTargetStatus,
    kanbanTaskModal,
    machineDirectoryBrowser,
    machineGroups.length,
    machineInitDraft.projectName,
    machineInitDraft.serverType,
    machineInitOpen,
    mirosharkDisplayStatus,
    mirosharkWorkbenchTab,
    notificationSummary?.unread,
    quickAddAttachmentMenuOpen,
    quickAddMachineMenuOpen,
    roleModalAgent,
    runtimeFileOpen,
    runtimeFilePath,
    runtimeFileRootKey,
    scheduleDraft.name,
    schedulerAttachMenu,
    schedulerDraftOpen,
    schedulerSelectedStep,
    schedules.length,
    selectedAgent,
    selectedBrainNode,
    selectedChatDirectory?.path,
    selectedChatLeafKey,
    selectedKanbanTask,
    selectedRuntimeEnvSource,
    selectedSwarmRunId,
    selectedWallet,
    sessionSearchQuery,
    setupMachine,
    sharedEnvAddMenuOpen,
    sharedEnvImportOpen,
    skillBrowserGithubOpen,
    skillBrowserOpen,
    skillBrowserView,
    swarmStatusLabel,
    vaultPanelMode,
    walletPanelMode,
    walletStats.enabled,
  ]);
  const beePilot = useBeePilot({
    activeView,
    agents: displayAgents,
    machineGroups,
    kanbanTasks: kanbanBoard?.tasks ?? [],
    sharedVault,
    navigate: navigateDashboardTarget,
    openAgentCreationModal,
    openAgentSettings: (agentId) => {
      setAgentSettingsPanel("role");
      setAgentRoleModalId(agentId);
    },
    setQuickAddStatus,
    setQuickAddDraft: (column, text) => setQuickAddDrafts((current) => ({ ...current, [column]: text })),
    setKanbanSearch,
    openWalletForAgent: (agentId) => {
      setSelectedAgentId(agentId);
      setWalletExpanded(true);
    },
    setSchedulerDraftOpen,
    openSkillBrowser: () => {
      void openSkillBrowser();
    },
    setChatText: setText,
    screenContext: baseHiveScreenContext,
  });
  const hiveScreenContext = useMemo(() => mergeDashboardScreenContext(baseHiveScreenContext, {
    openModals: beePilot.open ? [{ kind: "dialog", id: "bee-pilot", label: "Bee Pilot command popup" }] : [],
  }), [baseHiveScreenContext, beePilot.open]);
  useEffect(() => {
    if (!hydrated) return;
    void readNativeDashboardBootstrap({
      maxAgeMs: 5 * 60 * 1000,
      force: true,
      allowPrivateFilesystem: true,
      vaultPath: sharedVault.enabled ? sharedVault.vaultPath : undefined,
      kanbanFolder: sharedVault.enabled ? sharedVault.kanbanFolder : undefined,
      kanbanBoard: kanbanBoardSlug,
      scheduledFolder: sharedVault.enabled ? sharedVault.scheduledFolder : undefined,
    });
  }, [hydrated, kanbanBoardSlug, sharedVault.enabled, sharedVault.kanbanFolder, sharedVault.scheduledFolder, sharedVault.vaultPath]);
  const handleAeonWorkspaceCreated = useCallback((agent: AgentProfile) => { setAgents((current) => current.some((item) => item.id === agent.id) ? current.map((item) => item.id === agent.id ? { ...item, ...agent } : item) : [...current, agent]); setSelectedAgentId(agent.id); }, []);
  // Chat, Fleet, and Scheduler fill the full width right of the rail so dense
  // canvas/detail views reach the edge instead of showing the default route gutter.
  const fullWidthRouteShellStyle = (activeView === "chat" || activeView === "agents" || activeView === "scheduler")
    ? { width: "100%", maxWidth: "none", margin: 0, overflow: "hidden" }
    : undefined;
  const queenChatOpenSpaceRightInset = activeView === "agents" ? fleetChatOpenSpaceRightInset : 0;

  return (
    <QueenChatProvider runQueenCommand={beePilot.runVoiceCommand}>
    <>
      {!hydrated && hydrationStalled ? <HydrationStalledNotice info={hydrationStalled} /> : null}
      {/* The fixed left rail + transient toast live OUTSIDE <main> so they don't
          consume a grid row in .commandShell (which would push .commandMain down). */}
      <AppNavShelf
        activeView={requestedView}
        onPrefetch={prefetchView}
        onNavigate={(id) => {
          if (id === requestedView && id === activeView) return;
          setRequestedView(id);
          if (id === "kanban" && !kanbanBoard) setKanbanLoading(true);
          startViewTransition(() => setActiveView(id));
        }}
        theme={dashboardTheme === "hive-light" ? "light" : "dark"}
        onToggleTheme={() => setDashboardTheme((current) => (current === "hive-light" ? "dark" : "hive-light"))}
        appVersion={appVersion?.version ?? null}
        notificationUnread={notificationSummary?.unread ?? 0}
      />
      {appCompletionNotification ? (
        <DashboardAppCompletionToast key={appCompletionNotification.id} notification={appCompletionNotification} />
      ) : null}
      {/* Thin top bar while a view switch renders in the background (transition
          pending). Fixed-position so it never relayouts the heavy panel tree. */}
      {isViewPending ? (
        <div
          aria-hidden="true"
          style={{ position: "fixed", insetInline: 0, top: 0, height: 2, zIndex: 9999, background: "var(--accent-strong, #6fe0b0)", opacity: 0.85, pointerEvents: "none" }}
        />
      ) : null}
      <main className="shell commandShell">
      <div className="commandMain" style={fullWidthRouteShellStyle}>
      <DashboardRouteErrorBoundary
        resetKey={`${activeView}:${routeRetry}`}
        view={activeView}
        onRetry={() => setRouteRetry((current) => current + 1)}
      >
      <Suspense fallback={<DashboardRouteLoading view={activeView} />}>
      {activeView === "agents" ? <AgentsPanel {...{ AgentCell, AgentTaskList, Bot, Button, CellMenu, Check, CircleAlert, Copy, CopyPlus, ExternalLink, FleetView, MachineCell, MessageSquare, PlugZap, Plus, QUIET_SNAPSHOT_HOLD_MS, RefreshCcw, Settings2, Trash2, WalletCards, activeView, addAgentToMachine, agentWorkById, agents, appVersion, beeRoleLabel, busyAgentId, cleanActivityTitle, copiedUpdateDetailKey, copyUpdateDetail, deleteAgent, displayAgents, fleetAutoUpdatePaused, fleetCheckedAt, fleetClass, fleetDiscoveryLoading, fleetHostedApps, fleetSnapshots, fleetUpdateDetailByMachine, fleetUpdateStatusByMachine, fleetViewData: fleetViewDataWithApps, formatRelativeTime, friendlyEmptyTitle, runtimeSessionIdFromTask, hivemindLinkSignInPolling, hivemindLinkSignInPollingRef, hivemindLinkStatus, hydrateRuntimeSessionChat, isCollectorAutoUpdateable, isMeaningfulActive, localDashboardHasUnpublishedChanges, machineGroups, machineNeedsChatBridgeRepair, machineNeedsEnvHttpSyncRepair, machineVersionCopy, markNotificationRead, openMachineInitModal, openSetupModal, onChatOpenSpaceRightInsetChange: setFleetChatOpenSpaceRightInset, onChatToneChange: setFleetChatTone, onFixSyncIssue: fixFleetSyncIssue, onRecentAgentArrivalSeen: clearRecentAgentArrival, onToggleFleetAutoUpdatePaused: toggleFleetAutoUpdatePaused, recentAgentArrival, renameMachine, renderAgentKey, requestDuplicateAgent, runMachineUpdate, selectedAgent, setActiveView, setAgentRenameDraft, setAgentRenameEditing, setAgentRoleModalId, setAgentRuntimeAdvancedOpen, setAgentRuntimeFolderEditing, setAgentRuntimeFolderStatus, setAgentSettingsPanel, setHivemindLinkBannerDismissed, setHivemindLinkConnectedUntil, setHivemindLinkSignInPolling, setSelectedAgentId, showHivemindLinkConnectedBanner, showHivemindLinkSignInBanner, startAgentChat, startAgentWorkChat, tailnetCleanup, tailscaleStatus, taskChatLeafKey, trackAgentTaskOnKanban, updateStatusByMachine, walletsByAgent }} /> : null}
      {(activeView === "kanban" || activeView === "history") ? <KanbanPanel {...{ AttachmentListMenuContent, AttachmentMenuContent, CellMenu, ChatMarkdown, Check, ChevronDown, ChevronRight, ComposerField, DEFAULT_SHARED_VAULT, ExternalLink, Eye, FolderOpen, Image, KANBAN_COLUMNS, KANBAN_STEER_TARGETS, MessageAttachments, MessageSquare, Paperclip, Plus, RotateCcw, Search, Settings2, activeView, addKanbanComment, attachKanbanCardDirectory, attachKanbanCardRecentDirectory, attachKanbanSteerDirectory, attachKanbanSteerRecentDirectory, attachQuickAddDirectory, attachQuickAddRecentDirectory, bulkPatchKanbanTasks, chatClass, commentDraft, createKanbanBoard, createKanbanTask, displayAgents, editAndInterruptKanbanTask, expandedKanbanCards, formatDurationShort, formatMessageTimestamp, formatRelativeTime, handleKanbanCardFileChange, handleKanbanCardImageChange, handleKanbanSteerFileChange, handleKanbanSteerImageChange, handleQuickAddFileChange, handleQuickAddImageChange, importNoteIntake, initialWorkHistory, isKanbanStaleWorkingTask, isKanbanTerminalMessage, isWorkView, kanbanAssigneeFilter, kanbanAssigneeOptions, kanbanBoard, kanbanBoardScrollRef, kanbanBoardScrollState, kanbanBoardSlug, kanbanBoards, kanbanBulkAssignee, kanbanBulkPending, kanbanCardAttachmentListOpen, kanbanCardAttachmentMenuOpen, kanbanCardDeliverableMenuOpen, kanbanCardFileInputRef, kanbanCardImageInputRef, kanbanCardMachineMenuOpen, kanbanCardMessage, kanbanCardRecentsExpanded, kanbanClass, kanbanEditDraft, kanbanEditPendingTaskId, kanbanError, kanbanEventLabel, kanbanIncludeArchived, kanbanInitialLoading, kanbanLoading, kanbanMachineTargets, kanbanPickupPreviewByTask, kanbanSearch, kanbanStaleAge, kanbanSteerAttachmentError, kanbanSteerAttachmentMenuOpen, kanbanSteerAttachmentMenuRef, kanbanSteerAttachments, kanbanSteerDirectories, kanbanSteerDraft, kanbanSteerFileInputRef, kanbanSteerImageInputRef, kanbanSteerTargetMenuOpen, kanbanSteerTargetMenuRef, kanbanSteerTargetStatus, kanbanSteeringTaskId, kanbanStorage, kanbanTaskBee, kanbanTaskMenuItems, kanbanTaskModal, kanbanTenantFilter, kanbanTenants, kanbanViewColumns, markKanbanTaskReviewed, moveKanbanTask, newBoardDraft, noteIntakePending, noteIntakePreview, noteIntakeStatus, openKanbanCardFilePicker, openKanbanTaskModal, patchKanbanTask, quickAddAttachmentError, quickAddAttachmentMenuOpen, quickAddAttachmentMenuRef, quickAddAttachments, quickAddDirectories, quickAddDrafts, quickAddFileInputRef, quickAddImageInputRef, quickAddMachineMenuOpen, quickAddMachineMenuRef, quickAddMachineTarget, quickAddMachineTargets, quickAddStatus, recentDirectories, recentDirectoriesExpanded, recording, refreshKanbanOnce, removeKanbanCardAttachment, removeKanbanCardDirectory, removeKanbanSteerAttachment, removeKanbanSteerDirectory, removeQuickAddAttachment, removeQuickAddDirectory, scanNoteIntake, selectedKanbanAgent, selectedKanbanAgentMessages, selectedKanbanBulkIds, selectedKanbanComments, selectedKanbanEvents, selectedKanbanTask, selectedKanbanTaskId, selectedKanbanTaskIds, setActiveView, setCommentDraft, setExpandedKanbanCards, setKanbanAssigneeFilter, setKanbanBoardSlug, setKanbanBulkAssignee, setKanbanCardAttachmentListOpen, setKanbanCardAttachmentMenuOpen, setKanbanCardDeliverableMenuOpen, setKanbanCardMachineMenuOpen, setKanbanCardRecentsExpanded, setKanbanEditDraft, setKanbanError, setKanbanIncludeArchived, setKanbanLoading, setKanbanSearch, setKanbanSteerAttachmentMenuOpen, setKanbanSteerDraft, setKanbanSteerTargetMenuOpen, setKanbanSteerTargetStatus, setKanbanTaskModal, setKanbanTenantFilter, setNewBoardDraft, setQuickAddAttachmentError, setQuickAddAttachmentMenuOpen, setQuickAddDrafts, setQuickAddMachineMenuOpen, setQuickAddMachineTargets, setQuickAddStatus, setRecentDirectoriesExpanded, setSelectedKanbanTaskId, setSelectedKanbanTaskIds, sharedVault, startAudioRecording, steerSelectedKanbanTask, stopAudioRecording, updateKanbanTaskMachine, updateSharedVault, voiceBands, voiceTarget, voiceTranscript, walletClass, workBoardStats }} /> : null}
      {(activeView === "scheduler" || (activeView === "aeon" && schedulerDraftOpen)) ? <SchedulerPanel {...{ AlignLeft, Button, Check, ChevronDown, Clock3, Cpu, FileText, FileUp, FolderOpen, Link, List, LoaderCircle, Paperclip, Pencil, Plus, Puzzle, RUNTIME_LABELS, Repeat2, SCHEDULER_MODEL_OPTIONS, SCHEDULE_PRESETS, SchedulerView, Search, Send, Sparkles, TaskModal, Trash2, activeView, addSchedulePath, addSchedulerStep, addSchedulerStepPath, browseSchedulerFolder, createSchedule, displayAgents, editSchedule, editingScheduleId, filteredSchedulerSkills, findScheduleForJob, fleetClass, importExistingSchedules, isSchedulerFilePath, machineGroups, openSkillBrowser, pickSchedulerFiles, pickSchedulerFolder, refreshSharedSchedulesFromVault, removeSchedule, removeSchedulePath, removeScheduleSkill, removeSchedulerStep, removeSchedulerStepPath, renderAgentKey, resetScheduleDraft, runScheduleNow, saveScheduleFromModal, scheduleDraft, scheduleImportStatus, scheduleImporting, schedulerAttachMenu, schedulerDraftOpen, schedulerJobs, schedulerModalInitial, schedulerPathDraft, schedulerPathKind, schedulerRunStates, schedulerSelectedStep, schedulerSkillSearch, schedules, selectedAgent, setActiveView, setScheduleDraft, setScheduleImportStatus, setSchedulerAttachMenu, setSchedulerDraftOpen, setSchedulerPathDraft, setSchedulerPathKind, setSchedulerSelectedStep, setSchedulerSkillSearch, sharedSkillOptions, aeonSkillOptions, toggleSchedule, toggleScheduleSkill, toggleSchedulerStepMode, toggleSchedulerStepSkill, updateSchedulerStep, updateSchedulerStepModel, vaultClass }} /> : null}
      {activeView === "swarm" ? <SwarmPanel {...{ setActiveView, swarmRuns, currentSwarmRun, swarmMarket, swarmAgents, swarmDecisions, swarmStatusLabel, selectedSwarmRunId, mirosharkRunPending, mirosharkProgressLabel, mirosharkArchiveStatus, mirosharkStatus, mirosharkScenario, walletsByAgent, displayAgents, selectedAgent, setSelectedAgentId, getSurvivalSnapshot, sharedVault, loadMirosharkArchivedRun, startNewMirosharkSimulation, launchMirosharkSwarm, setMirosharkScenario, setMirosharkRounds, setMirosharkPlatform, runMirosharkExperiment }} /> : null}
      {activeView === "wallet" ? <WalletPanel {...{ AGENT_PAYMENT_PROVIDER_COPY, AgentWalletCard, AgentWalletCardCompact, Button, ChevronLeft, Download, HandCoins, LoaderCircle, RUNTIME_LABELS, RefreshCcw, activeView, copyPaymentPrompt, createDefaultAgentWallet, createLocalWallet, displayAgents, claimAllHoneyToBankrHive, enableHoneyLedger, exportWalletSecrets, formatHiveAmount, formatRelativeTime, getSurvivalSnapshot, honeyLedgerEnabled, honeyStats, hiveEnv, hydrated, initializeCoreWalletRails, moneyClawStatusByEnvName, refreshRuntimeIntegrations, refreshRuntimeUsage, refreshWalletBalance, renderAgentKey, resetWalletBurnClock, returnAllHiveToHoney, runWalletVaultBackupAction, runtimeUsage, runtimeUsageLoading, saveMoneyClawKey, selectedAgent, selectedHoneyReward, selectedWallet, selectedWalletSnapshot, setHoneyLedgerEnabled, sharedVault, sendWalletUsdc, setSelectedAgentId, setWalletExpanded, setWalletPanelMode, testX402Fetch, updateAgentProfile, updateWallet, updateWalletAction, vaultClass, walletActionsByAgent, walletClass, walletExpanded, walletPanelMode, walletStats, walletVaultBackupBusy, walletVaultBackupMessage, walletVaultBackupStatus, walletsByAgent }} /> : null}
      {activeView === "trade" ? <TradePanel {...{ activeView, displayAgents, walletsByAgent, selectedAgent, setSelectedAgentId, getSurvivalSnapshot, hiveEnv, hydrated, RUNTIME_LABELS, sharedVault, setActiveView, theme: dashboardTheme === "hive-light" ? "light" : "dark" }} /> : null}
      {activeView === "vault" ? <VaultPanel {...{ Activity, BRAIN_SKILL_PROVIDER_FALLBACK, Bot, BrainCircuit, BrainGraphLoader, Button, Cell, Check, CircleAlert, Clock3, DEFAULT_SHARED_VAULT, Download, Eye, FileText, FolderOpen, GitBranch, Hexagon, Image, KeyRound, LoaderCircle, Network, PlugZap, RefreshCcw, Repeat2, Search, Sparkles, activeView, brainGraph, brainGraphLoading, brainGraphStats, brainGraphStatus, brainPan, brainSkillAeonSyncing, brainSkillImportAllDescription, brainSkillImportAllLabel, brainSkillImportProvider, brainSkillImportSuccess, brainSkillImportableCount, brainSkills, brainSkillsLoading, brainSkillsStatus, checkControlRoomStatus, checkVaultStatus, controlRoomStatus, displayAgents, endBrainPan, formatBrainDate, gbrainActionStatus, gbrainBusy, gbrainQuery, gbrainQueryResult, gbrainStatus, hermesUpdateRequired, hermesUpdateRequiredDetail, importBrainSkills, inspectBrainNode, installTradingBrainFromDashboard, moveBrainPan, neo4jActionStatus, neo4jBusy, neo4jQuery, neo4jQueryResult, neo4jStatus, openSkillBrowser, pairSyncthingVaultSync, qmdActionStatus, qmdBusy, qmdQuery, qmdQueryResult, qmdStatus, queryGbrainFromDashboard, queryNeo4jFromDashboard, queryQmdFromDashboard, querySyntoFromDashboard, refreshBrainGraph, refreshBrainSkills, refreshGbrainStatus, refreshNeo4jStatus, refreshQmdStatus, refreshRuntimeFileRoots, refreshSyntoStatus, refreshTradingBrainStatus, runGbrainAction, runNeo4jAction, runQmdAction, runSyntoAction, runVaultTailnetSync, selectedAgent, selectedBrainNode, setActiveView, setBrainPan, setChatAttachments, setChatDirectories, setGbrainQuery, setNeo4jQuery, setQmdQuery, setQuickAddDrafts, setQuickAddStatus, setSkillBrowserOpen, setSkillBrowserSearch, setSkillBrowserView, setSkillBrowserWrittenContent, setSyntoQuery, setText, setTradingBrainForAllRuntimes, setTradingBrainForRuntime, setVaultPanelMode, sharedVault, skillBrowserSearch, skillRequiresHermesUpdate, startAgentChat, startBrainPan, syncBrainSkillsToAeon, syntoActionStatus, syntoBusy, syntoQuery, syntoQueryResult, syntoStatus, tradingBrainActionStatus, tradingBrainAllRuntimeAttached, tradingBrainBusy, tradingBrainRuntimeCards, tradingBrainStatus, updateAllSkillAutoSync, updateSharedVault, updateSkillAutoSync, vaultClass, vaultPanelMode, vaultStatus, vaultSyncPending, vaultSyncStatus, walletClass }} /> : null}
      {activeView === "integrations" ? <IntegrationsView embedded /> : null}
      {(isUtilityPanelView(activeView) || (activeView === "vault" && vaultPanelMode === "env")) ? <UtilityPanels {...{ AgentEnvCard, Activity, Button, Check, ChevronDown, ChevronLeft, Download, EnvValueRow, FileText, FileUp, FolderOpen, LoaderCircle, MorePanel, NotificationsPanel, Pencil, Plus, RefreshCcw, RotateCcw, ShieldCheck, Sparkles, URL, Upload, activeView, addAgentEnvValue, addSharedEnvValue, agentEnvDrafts, agentSpecificEnvCount, displayAgents, fleetClass, formatRelativeTime, generateSharedEnvSecret, hiveEnvLoading, hiveEnvRestoring, hiveEnvSavingKey, hiveEnvStatus, hiveEnvSyncing, importSharedEnvEntries, listRuntimeFiles, maintenanceBusy, maintenanceMessage, maintenanceReport, markAllNotificationsRead, markNotificationRead, memoryTelemetry, memoryTelemetryLoading, notificationCursor, notificationGroups, notificationSummary, notifications, notificationsLoading, notificationsStatus, onOpenNotification: openDashboardNotification, openRuntimeFile, promoteRuntimeEnvValue, refreshHiveEnv, refreshMaintenanceReport, refreshMemoryTelemetry, refreshNotifications, refreshRuntimeFileRoots, renderAgentKey, restoreSharedEnvBackup, revealedEnvValues, runMaintenanceAction, runtimeEnvSources, runtimeFileDraft, runtimeFileOpen, runtimeFilePath, runtimeFileRootKey, runtimeFileRoots, runtimeFileStatus, runtimeFiles, runtimeModelSelectionsByRuntime, saveAgentEnvValue, saveRuntimeFile, saveSharedEnvValue, searchAllRuntimeSessions, selectedRuntimeEnvSource, sessionSearchLoading, sessionSearchMessage, sessionSearchQuery, sessionSearchResults, setActiveView, setAgentEnvDrafts, setHiveEnvRuntimeSourceId, setRuntimeFileDraft, setRuntimeFileOpen, setRuntimeFilePath, setRuntimeFileRootKey, setSessionSearchQuery, setSharedEnvAddMenuOpen, setSharedEnvDraft, setSharedEnvEditable, setSharedEnvImportOpen, setSharedEnvImportText, sharedBackupStatus, sharedEnvAddMenuOpen, sharedEnvCount, sharedEnvDraft, sharedEnvEditable, sharedEnvImport, sharedEnvImportChangedCount, sharedEnvImportDiff, sharedEnvImportNewCount, sharedEnvImportOpen, sharedEnvImportSameCount, sharedEnvImportText, sharedEnvImporting, sharedEnvSource, sharedVault, startAgentChat, syncSharedEnvMachines, toggleEnvValue, updateNotificationSettings, vaultClass, vaultPanelMode, walletClass }} /> : null}
      {activeView === "aeon" ? <AeonAutopilotPanel agentProfiles={displayAgents.filter((agent) => agent.runtime === "aeon")} sharedVault={sharedVault} machineGroups={machineGroups} chooseDirectoryForMachine={chooseDirectoryForMachine} onWorkspaceCreated={handleAeonWorkspaceCreated} /> : null}
      {activeView === "fusion" ? <FusionPanel sharedVault={sharedVault} /> : activeView === "phone" ? <PhonePanel activeView={activeView} fleetClass={fleetClass} formatRelativeTime={formatRelativeTime} sharedVault={sharedVault} /> : null}
      {activeView === "governance" ? <GovernancePanel theme={dashboardTheme === "hive-light" ? "light" : "dark"} /> : null}
      {activeView === "chat" && chatInitialLoading ? <DashboardRouteLoading view="chat" /> : null}
      {((activeView === "chat" && !chatInitialLoading) || chatFolderCreatorMachine) ? <ChatPanel {...{ Activity, AgentResponseLoader, AlignLeft, BEE_WORKER_PRESET_LIST, BrainCircuit, Button, ChatMarkdown, Check, ChevronDown, ChevronRight, ChevronUp, CircleAlert, ComposerField, Copy, Cpu, Download, Eye, FileText, Folder, FolderOpen, FolderPlus, GitBranch, HERMES_UPDATE_INTEGRATION_KEYS, Hammer, Image, KanbanSquare, LoaderCircle, MessageAttachments, MessageSquare, Minus, Monitor, Pencil, PlugZap, Plus, RUNTIME_LABELS, RefreshCcw, Repeat2, Search, Send, Settings2, ShieldCheck, Sparkles, Terminal, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Upload, activeView, addAgentPreferredSkill, addHermesModelFromDraft, aeonEnvKeys, aeonEnvSyncStatus, aeonEnvSyncing, agentCreateDraft, agentCreateMachine, agentRenameDraft, agentRenameEditing, agentRuntimeAdvancedOpen, agentRuntimeFolderBrowsing, agentRuntimeFolderEditing, agentRuntimeFolderStatus, agentSettingsCustomWorker, agentSettingsCustomWorkers, agentSettingsDescription, agentSettingsIntegrationTarget, agentSettingsPanel, agentSettingsPreferredSkills, agentSettingsProvider, agentSettingsRuntime, agentSettingsSelectedCustomWorkerId, agentSettingsSkillProfile, agentSettingsTitle, agentSettingsWorkerClass, agentSettingsWorkerImage, agentSettingsWorkerLabel, agentSettingsWorkerPreset, agentWorkerClassView, applyCustomWorkerClass, attachChatDirectory, attachChatRecentDirectory, attachmentError, attachmentMenuOpen, attachmentMenuRef, beeRoleIconPath, beeRoleLabel, browseAgentRuntimeFolder, busy: selectedChatStreaming, changeChatWorkingDirectory, chatAttachments, chatAutoScrollRef, chatClass, chatContextMenu, chatContextMenuRef, chatDirectories, chatDisplayContent, chatFileInputRef, chatFolderCreatorMachine, chatFolderCreatorParentOptions, chatFolderDraft, chatImageInputRef, chatKanbanGeneration, chatSidebarTree, chatStreamingByKey, checkStatus, closeAgentSettingsModal, closeChatFolderCreator, createAgentFromModal, createChatFolder, customWorkerDraft, customWorkerImageError, customWorkerImageInputRef, customWorkerSkillSearch, dismissChatKanbanGeneration, displayAgents, expandedChatFolders, filteredCustomWorkerSkills, filteredSkillBrowserSkills, fleetClass, flushingChatQueueId, formatAgentEnvText, formatRelativeTime, generateKanbanTaskFromChat, handleChatFileChange, handleChatFileReferenceDrop, handleChatImageChange, hasStreamingChunk: selectedChatHasStreamingChunk, hermesUpdateRequired, hermesUpdateRequiredDetail, importRemoteSkillToBrain, convertSkillToAeon, installGithubSkillToBrain, addWrittenSkillToBrain, lastAssistant, logClientTelemetry, machineGroups, messagesEndRef, messagesScrollRef, openAgentSkillBrowser, openCustomWorkerClassCreator, openSkillBrowser, parseAgentEnvText, providerIconPath, providerIconRenderMode, queuedChatMessages, recentDirectories, recentDirectoriesExpanded, recording, refreshRuntimeIntegrations, removeAgentPreferredSkill, removeChatAttachment, removeChatDirectory, removeQueuedChatMessage, roleModalAgent, runRuntimeIntegrationAction, runtimeAvailability, runtimeBackgroundPrompt, runtimeCapabilities, runtimeIconFallback, runtimeIconPath, runtimeIconRenderMode, runtimeIntegrationBusy, runtimeIntegrationMessage, runtimeIntegrationStatus, runtimeModelDraft, runtimeModelProviders, runtimeModelSelection, runtimeModelSelectionsByRuntime, runtimeModelSetupMode, runtimeSessionQuery, runtimeSessionResults, runtimeSetupDefinition, runtimeSetupKey, runtimeUpdateConfirmKey, searchRuntimeSessionsForAgent, selectAgentWorkerClass, selectCustomWorkerClass, selectedAgent, selectedChatDirectory, selectedChatHistoryLoading, selectedChatLeafKey, selectedChatMachine, selectedChatProcess, selectedChatStorageKey, selectedRuntimeModel, selectedRuntimeModelId, selectedRuntimeModels, selectedRuntimeProvider, sendMessage, sendPromptMessage, sendQueuedChatMessageNow, sessionNotice, setActiveView, setAeonEnvKeys, setAgentCreateDraft, setAgentRenameDraft, setAgentRenameEditing, setAgentRuntimeAdvancedOpen, setAgentRuntimeFolderEditing, setAgentRuntimeFolderStatus, setAgentSettingsPanel, setAgentWorkerClassView, setAttachmentMenuOpen, setChatContextMenu, setChatFolderDraft, setCustomWorkerDraft, setCustomWorkerSkillSearch, setExpandedChatFolders, setRecentDirectoriesExpanded, setRuntimeBackgroundPrompt, setRuntimeModelDraft, setRuntimeModelSetupMode, setRuntimeSessionQuery, setRuntimeSetupKey, setRuntimeUpdateConfirmKey, setSkillBrowserGithubOpen, setSkillBrowserGithubUrl, setSkillBrowserOpen, setSkillBrowserSearch, setSkillBrowserView, setSkillBrowserWrittenContent, setStatus, setStatusAgentId, setText, sharedVault, skillBrowserGithubInstalling, skillBrowserGithubOpen, skillBrowserGithubUrl, skillBrowserImporting, skillBrowserLoading, skillBrowserMode, skillBrowserOpen, skillBrowserSearch, skillBrowserStatus, skillBrowserView, skillBrowserWrittenContent, skillBrowserWriting, skillRequiresHermesUpdate, startAgentChat, startAudioRecording, status, statusAgentId, stopAudioRecording, switchRuntime, syncAeonEnvToGitHub, text, toggleCustomWorkerSkill, updateAgent, updateAgentProfile, updateAgentRuntimeModel, updateAgentSkillProfile, updateChatAutoScroll, uploadCustomWorkerImage, vaultClass, visibleMessages, voiceBands, voiceTarget, voiceTranscript, workerCapabilityBadges }} /> : null}
      {(roleModalAgent || agentCreateMachine) ? <AgentSettingsModal {...{ BEE_WORKER_PRESET_LIST, BrainCircuit, Button, Check, ChevronRight, Copy, Cpu, Eye, FolderOpen, HERMES_UPDATE_INTEGRATION_KEYS, Image, KanbanSquare, LoaderCircle, MessageSquare, Minus, Pencil, PlugZap, Plus, RUNTIME_LABELS, RefreshCcw, Repeat2, Search, Send, Settings2, ShieldCheck, Sparkles, Upload, addHermesModelFromDraft, agentCreateDraft, agentCreateMachine, agentRenameDraft, agentRenameEditing, agentRuntimeAdvancedOpen, agentRuntimeFolderBrowsing, agentRuntimeFolderEditing, agentRuntimeFolderStatus, agentSettingsCustomWorker, agentSettingsCustomWorkers, agentSettingsDescription, agentSettingsIntegrationTarget, agentSettingsPanel, agentSettingsPreferredSkills, agentSettingsProvider, agentSettingsRuntime, agentSettingsSelectedCustomWorkerId, agentSettingsSoulPrompt, agentSettingsSkillProfile, agentSettingsTitle, agentSettingsWorkerClass, agentSettingsWorkerImage, agentSettingsWorkerLabel, agentSettingsWorkerPreset, agentWorkerClassView, applyCustomWorkerClass, installPackagedAgent, beeRoleIconPath, browseAgentRuntimeFolder, chooseDirectoryForMachine, closeAgentSettingsModal, createAgentFromModal, customWorkerDraft, customWorkerImageError, customWorkerImageInputRef, customWorkerSkillSearch, displayAgents, filteredCustomWorkerSkills, fleetClass, hermesUpdateRequired, machineGroups, onAeonWorkspaceCreated: handleAeonWorkspaceCreated, onQueenClapWakeEnabledChange: updateQueenClapWakeEnabled, openAgentSkillBrowser, openCustomWorkerClassCreator, providerIconPath, providerIconRenderMode, queenClapWakeEnabled, refreshRuntimeIntegrations, refreshRuntimeAvailability, removeAgentPreferredSkill, roleModalAgent, runRuntimeIntegrationAction, runtimeAvailability, runtimeBackgroundPrompt, runtimeCapabilities, runtimeIconFallback, runtimeIconPath, runtimeIconRenderMode, runtimeIntegrationBusy, runtimeIntegrationMessage, runtimeIntegrationStatus, runtimeModelDraft, runtimeModelProviders, runtimeModelSelection, runtimeModelSelectionsByRuntime, runtimeModelSelectionFresh, runtimeModelSetupMode, runtimeSessionQuery, runtimeSessionResults, runtimeSetupDefinition, runtimeSetupKey, runtimeUpdateConfirmKey, searchRuntimeSessionsForAgent, selectAgentWorkerClass, selectCustomWorkerClass, selectedRuntimeModelId, selectedRuntimeModels, selectedRuntimeProvider, setActiveView, setAgentCreateDraft, setAgentRenameDraft, setAgentRenameEditing, setAgentRuntimeAdvancedOpen, setAgentRuntimeFolderEditing, setAgentRuntimeFolderStatus, setAgentSettingsPanel, setAgentWorkerClassView, setCustomWorkerDraft, setCustomWorkerSkillSearch, setRuntimeBackgroundPrompt, setRuntimeModelDraft, setRuntimeModelSetupMode, setRuntimeSessionQuery, setRuntimeSetupKey, setRuntimeUpdateConfirmKey, sharedVault, startAgentChat, toggleCustomWorkerSkill, updateAgentProfile, updateAgentRuntimeModel, updateAgentSoulPrompt, updateAgentSkillProfile, uploadCustomWorkerImage, workerCapabilityBadges }} /> : null}
      <SkillBrowserModal {...{ Button, Copy, Download, GitBranch, Image, LoaderCircle, Minus, Plus, RefreshCcw, Sparkles, addAgentPreferredSkill, addWrittenSkillToBrain, agentSettingsPreferredSkills, convertSkillToAeon, fleetClass, hermesUpdateRequired, hermesUpdateRequiredDetail, importRemoteSkillToBrain, installGithubSkillToBrain, openAgentSkillBrowser, openSkillBrowser, removeAgentPreferredSkill, setSkillBrowserGithubOpen, setSkillBrowserGithubUrl, setSkillBrowserOpen, setSkillBrowserSearch, setSkillBrowserView, setSkillBrowserWrittenContent, sharedVaultPath: sharedVault.enabled ? sharedVault.vaultPath : undefined, skillBrowserGithubInstalling, skillBrowserGithubOpen, skillBrowserGithubUrl, skillBrowserImporting, skillBrowserLoading, skillBrowserMode, skillBrowserOpen, skillBrowserSearch, skillBrowserSkills, skillBrowserStatus, skillBrowserView, skillBrowserWrittenContent, skillBrowserWriting, skillRequiresHermesUpdate, vaultClass }} /></Suspense>
      </DashboardRouteErrorBoundary>
      <DashboardModals {...{ Button, Check, ChevronLeft, Copy, CopyPlus, FileText, FolderOpen, HETZNER_IMAGE_OPTIONS, HETZNER_LOCATION_OPTIONS, HETZNER_SERVER_TYPE_OPTIONS, LoaderCircle, Plus, SetupCell, copyMachineInitCommand, copySetupCommand, displayAgents, duplicateAgent, duplicateAgentDraft, fleetClass, initializeMachineProject, kanbanClass, loadMachineDirectories, machineDirectoryBrowser, machineInitCopiedKey, machineInitDraft, machineInitOpen, machineInitStatus, machineInitToken, machineInitTokenStatus, openHetznerEnvFile, saveHetznerToken, selectedHetznerServerType, setDuplicateAgentDraft, setMachineDirectoryBrowser, setMachineInitDraft, setMachineInitOpen, setMachineInitToken, setMachineInitTokenStatus, setSetupMachineKey, setupCollectorCommand, setupCommandCopied, setupMachine }} />
      <DashboardCommandPalette
        activeView={activeView}
        displayAgents={displayAgents}
        kanbanTasks={kanbanBoard?.tasks ?? []}
        navItems={navItems}
        notifications={notifications}
        open={commandPaletteOpen}
        recents={navigationRecents}
        onNavigate={navigateDashboardTarget}
        onOpenChange={setCommandPaletteOpen}
        onPopout={popoutDashboardTarget}
      />
      {process.env.NODE_ENV === "development" ? (
        <DashboardPinsOverlay
          activeView={activeView}
          formatRelativeTime={formatRelativeTime}
          sharedVault={sharedVault}
        />
      ) : null}
      <BeePilotPopup
        open={beePilot.open}
        input={beePilot.input}
        phase={beePilot.phase}
        status={beePilot.status}
        onOpenChange={beePilot.setOpen}
        onInputChange={beePilot.setInput}
        onSubmit={(command, origin) => void beePilot.runCommand(command, origin)}
        onDismissStatus={beePilot.dismissStatus}
      />
      <BeeCursorOverlay controller={beePilot.bee} />
      {activeView === "agents" ? <ConnectPhoneFab /> : null}
      <QueenBeeVoiceOverlay
        clapWakeEnabled={queenClapWakeEnabled}
        onClapWakeEnabledChange={updateQueenClapWakeEnabled}
        onDriveDashboard={beePilot.runVoiceCommand}
        openSpaceRightInset={queenChatOpenSpaceRightInset}
      />
      <GuidedDashboardTour
        selectView={setActiveView}
        openFirstChat={() => {
          const target = displayAgents.find((agent) => runtimeCan(agent, "chat"));
          if (!target) {
            setActiveView("chat");
            return false;
          }
          startAgentChat(target.id);
          return true;
        }}
      />
      <ProgressRewardPopup enabled={hydrated} />
      </div></main>
      {/* App-wide "Message the hive" pill — persists across every view, pairing
          with the always-mounted Queen transcript overlay. Hidden only on the
          dedicated chat view, which has its own composer. */}
      <PersistentHiveChat
        hidden={activeView === "chat"}
        openSpaceRightInset={queenChatOpenSpaceRightInset}
        screenContext={hiveScreenContext}
        tone={activeView === "agents" ? fleetChatTone : "hive"}
      />
    </>
    </QueenChatProvider>
  );
}
