"use client";

/* Every lazily-loaded dashboard component lives here — the view panels the
   render switch mounts, the shared cells, and the hover-prefetch loaders.
   Loader thunks are declared once and reused by both dynamic() and
   DASHBOARD_VIEW_PRELOADERS so the import list can't drift from the prefetch
   list (previously two hand-synced switches in DashboardApp). */

import dynamic from "next/dynamic";
import { LoaderCircle } from "lucide-react";

import { FleetViewLoadingShell } from "@/components/fleet/fleet-loading";
import { routeLoadingFor, routeLoadingFromProps } from "@/features/dashboard/dashboard-route-chrome";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import { AgentWalletTileLoading, WalletPanelLoading } from "@/features/dashboard/views/WalletPanelLoading";

// ── shared cells / cards ─────────────────────────────────────────────────────

export const AgentWalletCard = dynamic(() => import("@/components/wallet/AgentWalletCard").then((mod) => mod.AgentWalletCard), { ssr: false });
export const AgentWalletCardCompact = dynamic(() => import("@/components/wallet/AgentWalletCardCompact").then((mod) => mod.AgentWalletCardCompact), {
  ssr: false,
  loading: AgentWalletCardCompactLoadingFallback,
});
export const AgentCell = dynamic(() => import("@/components/cells/AgentCell").then((mod) => mod.AgentCell), { ssr: false });
export const AgentTaskList = dynamic(() => import("@/components/cells/AgentTaskList").then((mod) => mod.AgentTaskList), { ssr: false });
export const FleetView = dynamic(() => import("@/components/fleet").then((mod) => mod.FleetView), {
  ssr: false,
  loading: FleetViewLoadingFallback,
});
export const MachineCell = dynamic(() => import("@/components/cells/MachineCell").then((mod) => mod.MachineCell), { ssr: false });
export const MemoryCell = dynamic(() => import("@/components/cells/MemoryCell").then((mod) => mod.MemoryCell), { ssr: false });
export const SchedulerView = dynamic(() => import("@/components/scheduler").then((mod) => mod.SchedulerView), { ssr: false });
export const SetupCell = dynamic(() => import("@/components/cells/SetupCell").then((mod) => mod.SetupCell), { ssr: false });
export const TaskModal = dynamic(() => import("@/components/task-modal").then((mod) => mod.TaskModal), { ssr: false });

function FleetViewLoadingFallback() {
  return <FleetViewLoadingShell mastheadMode="mobile" />;
}

function AgentWalletCardCompactLoadingFallback() {
  return <AgentWalletTileLoading index={0} />;
}

// ── view panels (one loader thunk per chunk, reused for prefetch) ────────────

const loadAgentsPanel = () => import("@/features/dashboard/views/AgentsPanel");
const loadKanbanPanel = () => import("@/features/dashboard/views/KanbanPanel");
const loadSchedulerPanel = () => import("@/features/dashboard/views/SchedulerPanel");
const loadSwarmPanel = () => import("@/features/dashboard/views/SwarmPanel");
const loadWalletPanel = () => import("@/features/dashboard/views/WalletPanel");
const loadTradePanel = () => import("@/features/dashboard/views/trade/TradePanel");
const loadVaultPanel = () => import("@/features/dashboard/views/VaultPanel");
const loadUtilityPanels = () => import("@/features/dashboard/views/UtilityPanels");
const loadChatPanel = () => import("@/features/dashboard/views/ChatPanel");
const loadMorePanel = () => import("@/features/dashboard/MorePanel");
const loadFusionPanel = () => import("@/features/dashboard/views/FusionPanel");
const loadGovernancePanel = () => import("@/features/dashboard/views/GovernancePanel");
const loadManagedCloudAgentsPanel = () => import("@/features/dashboard/views/ManagedCloudAgentsPanel");
const loadHivemindOSManagementPanel = () => import("@/features/dashboard/views/HivemindOSManagementPanel");
const loadHiveComputePanel = () => import("@/features/dashboard/views/HiveComputePanel");
const loadMiniAppsPanel = () => import("@/features/dashboard/views/MiniAppsPanel");
const loadTelemetryView = () => import("@/features/dashboard/views/telemetry/TelemetryView");
const loadAeonAutopilotPanel = () => import("@/components/aeon");
const loadPhonePanel = () => import("@/features/dashboard/views/PhonePanel");
const loadIntegrationsView = () => import("@/features/integrations/IntegrationsView");
const loadBeelineView = () => import("@/features/beeline/BeelineView");

export const AgentsPanel = dynamic(() => loadAgentsPanel().then((mod) => mod.AgentsPanel), { ssr: false, loading: routeLoadingFor("agents") });
export const KanbanPanel = dynamic(() => loadKanbanPanel().then((mod) => mod.KanbanPanel), { ssr: false, loading: routeLoadingFromProps });
export const SchedulerPanel = dynamic(() => loadSchedulerPanel().then((mod) => mod.SchedulerPanel), { ssr: false, loading: routeLoadingFor("scheduler") });
export const SwarmPanel = dynamic(() => loadSwarmPanel().then((mod) => mod.SwarmPanel), { ssr: false, loading: routeLoadingFor("swarm") });
export const WalletPanel = dynamic(() => loadWalletPanel().then((mod) => mod.WalletPanel), { ssr: false, loading: WalletPanelLoading });
export const TradePanel = dynamic(() => loadTradePanel().then((mod) => mod.TradePanel), { ssr: false, loading: routeLoadingFor("trade") });
export const VaultPanel = dynamic(() => loadVaultPanel().then((mod) => mod.VaultPanel), { ssr: false, loading: routeLoadingFor("vault") });
export const UtilityPanels = dynamic(() => loadUtilityPanels().then((mod) => mod.UtilityPanels), { ssr: false, loading: routeLoadingFromProps });
export const ChatPanel = dynamic(() => loadChatPanel().then((mod) => mod.ChatPanel), { ssr: false, loading: routeLoadingFor("chat") });
export const MorePanel = dynamic(() => loadMorePanel().then((mod) => mod.MorePanel), { ssr: false, loading: routeLoadingFromProps });
export const FusionPanel = dynamic(() => loadFusionPanel().then((mod) => mod.FusionPanel), { ssr: false, loading: routeLoadingFor("fusion") });
export const GovernancePanel = dynamic(() => loadGovernancePanel().then((mod) => mod.GovernancePanel), { ssr: false, loading: routeLoadingFor("governance") });
export const ManagedCloudAgentsPanel = dynamic(() => loadManagedCloudAgentsPanel().then((mod) => mod.ManagedCloudAgentsPanel), { ssr: false, loading: routeLoadingFor("cloud") });
export const HivemindOSManagementPanel = dynamic(() => loadHivemindOSManagementPanel().then((mod) => mod.HivemindOSManagementPanel), { ssr: false, loading: routeLoadingFor("credit-admin") });
export const HiveComputePanel = dynamic(() => loadHiveComputePanel().then((mod) => mod.HiveComputePanel), { ssr: false, loading: routeLoadingFor("compute") });
export const MiniAppsPanel = dynamic(() => loadMiniAppsPanel().then((mod) => mod.MiniAppsPanel), { ssr: false, loading: routeLoadingFor("mini-apps") });
export const PodcastStudioView = dynamic(() => import("@/features/dashboard/views/PodcastStudioView").then((mod) => mod.PodcastStudioView), { ssr: false, loading: routeLoadingFor("podcast") });
export const TelemetryView = dynamic(() => loadTelemetryView().then((mod) => mod.TelemetryView), { ssr: false, loading: routeLoadingFor("memory") });
export const AeonAutopilotPanel = dynamic(() => loadAeonAutopilotPanel().then((mod) => mod.AeonAutopilotPanel), { ssr: false, loading: routeLoadingFor("aeon") });
export const PhonePanel = dynamic(() => loadPhonePanel().then((mod) => mod.PhonePanel), { ssr: false, loading: routeLoadingFor("phone") });
export const DashboardModals = dynamic(() => import("@/features/dashboard/views/DashboardModals").then((mod) => mod.DashboardModals), { ssr: false });
export const AgentSettingsModal = dynamic(() => import("@/features/dashboard/views/chat/AgentSettingsModal").then((mod) => mod.AgentSettingsModal), {
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
export const SkillBrowserModal = dynamic(() => import("@/features/dashboard/views/chat/SkillBrowserModal").then((mod) => mod.SkillBrowserModal), { ssr: false });
export const IntegrationsView = dynamic(() => loadIntegrationsView(), { ssr: false, loading: routeLoadingFor("integrations") });
export const BeelineView = dynamic(() => loadBeelineView().then((mod) => mod.BeelineView), { ssr: false, loading: routeLoadingFor("beeline") });

/**
 * Hover/focus prefetch loaders per view. Views without an entry share the
 * UtilityPanels chunk; "agents" is eagerly mounted so it needs no prefetch.
 */
export const DASHBOARD_VIEW_PRELOADERS: Partial<Record<DashboardView, () => Promise<unknown>>> = {
  kanban: loadKanbanPanel,
  history: loadKanbanPanel,
  vault: loadVaultPanel,
  chat: loadChatPanel,
  wallet: loadWalletPanel,
  more: loadMorePanel,
  scheduler: loadSchedulerPanel,
  swarm: loadSwarmPanel,
  trade: loadTradePanel,
  phone: loadPhonePanel,
  fusion: loadFusionPanel,
  governance: loadGovernancePanel,
  cloud: loadManagedCloudAgentsPanel,
  compute: loadHiveComputePanel,
  "mini-apps": loadMiniAppsPanel,
  memory: loadTelemetryView,
  aeon: loadAeonAutopilotPanel,
  integrations: loadIntegrationsView,
  beeline: loadBeelineView,
};

export function preloadDashboardView(view: DashboardView) {
  if (view === "agents") return Promise.resolve();
  const loader = DASHBOARD_VIEW_PRELOADERS[view] ?? loadUtilityPanels;
  return loader().catch(() => undefined);
}
