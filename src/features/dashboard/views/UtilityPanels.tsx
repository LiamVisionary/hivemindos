"use client";

import { useEffect, useMemo, useState, type ComponentType, type Dispatch, type ElementType, type SetStateAction } from "react";
import { Search } from "lucide-react";
import type { AgentProfile, AgentRuntime, SharedVaultConfig } from "@/lib/types/agent-runtime";
import { runtimeEnvFeature, runtimeUsesAgentEnvOverlay } from "@/lib/types/agent-runtime";
import type { AgentNotification, AgentNotificationSettings, AgentNotificationSummary } from "@/lib/types/agent-notifications";
import type { MemoryTelemetryPayload } from "@/lib/types/memory-telemetry";
import type { AgentEnvCardProps, EnvValueRowProps } from "@/features/env/env-components";
import type { MorePanelProps } from "@/features/dashboard/MorePanel";
import type { NotificationGroup, NotificationsPanelProps } from "@/features/notifications/NotificationsPanel";
import { AgentNativeInsightsPanel } from "@/features/dashboard/views/AgentNativeInsightsPanel";
import { MyAppsPanel } from "@/features/dashboard/views/MyAppsPanel";
import { AgentToolsPanel } from "@/features/dashboard/views/AgentToolsPanel";
import { MessagingChannelsPanel } from "@/features/dashboard/views/MessagingChannelsPanel";
import { BrainEnvPanel } from "@/features/dashboard/views/BrainEnvPanel";
import type {
  DashboardView,
  HiveEnvBackupStatus,
  HiveEnvImportEntry,
  HiveEnvSource,
  MaintenanceReport,
  RuntimeFileEntry,
  RuntimeFileRoot,
  RuntimeModelSelection,
  RuntimeSessionSearchResult,
} from "@/features/dashboard/dashboard-types";
import type { RuntimeSecretStatus } from "@/lib/services/runtime-adapters/types";

type ClassNameBuilder = (...names: Array<string | false | null | undefined>) => string;
type EnvDraft = { key: string; value: string };
type RuntimeOpenFile = RuntimeFileEntry & { content?: string };
type HiveEnvImportPreview = {
  entries: HiveEnvImportEntry[];
  error?: string;
};
type SystemCockpitCheck = { id: string; label: string; status: string; detail: string };
type SystemCockpitHealth = { ok: boolean; status: string; generatedAt: string; checks: SystemCockpitCheck[] };
type SystemCockpitSmokeItem = { id: string; label: string; status: string; detail: string; nextAction?: string };
type SystemCockpitSmoke = { ok: boolean; generatedAt: string; items: SystemCockpitSmokeItem[] };
type SystemCockpitCookbookEntry = { id: string; title: string; area: string; severity: string; symptoms: string[]; fixes: string[] };
type SystemCockpitModelFit = { machineId: string; machineName: string; tier: string; label: string; rationale: string[]; preferredProviders: string[]; caution?: string };
type SystemCockpitLiveProbe = { id: string; label: string; status: "ok" | "degraded" | "down"; detail: string };
type IconComponent = ElementType<{
  "aria-hidden"?: boolean | "true" | "false";
  className?: string;
}>;

function describeRuntimeFileRoot(root: RuntimeFileRoot): string {
  if (root.key.startsWith("agent-")) return "This agent's runtime home — sessions and local data.";
  switch (root.key) {
    case "hivemindos": return "The HivemindOS app's own source tree.";
    case "hivemindos-state": return "Dashboard state, leases, and local config.";
    case "shared-vault": return "The shared Obsidian brain — notes, memory, and skills.";
    case "hermes": return "Where the Hermes runtime stores sessions and config.";
    case "openclaw": return "OpenClaw agent homes.";
    case "aeon": return "Where the Aeon runtime stores its data.";
    default: return "Allowlisted runtime folder.";
  }
}


type UtilityPanelsProps = {
  AgentEnvCard: ComponentType<AgentEnvCardProps>;
  Activity: IconComponent;
  Button: ElementType;
  Check: IconComponent;
  ChevronDown: IconComponent;
  ChevronLeft: IconComponent;
  Download: IconComponent;
  EnvValueRow: ComponentType<EnvValueRowProps>;
  FileText: IconComponent;
  FileUp: IconComponent;
  FolderOpen: IconComponent;
  LoaderCircle: IconComponent;
  MorePanel: ComponentType<MorePanelProps>;
  NotificationsPanel: ComponentType<NotificationsPanelProps>;
  Pencil: IconComponent;
  Plus: IconComponent;
  RefreshCcw: IconComponent;
  RotateCcw: IconComponent;
  ShieldCheck: IconComponent;
  Sparkles: IconComponent;
  URL: typeof globalThis.URL;
  Upload: IconComponent;
  activeView: DashboardView;
  addAgentEnvValue: (agent: AgentProfile) => void | Promise<void>;
  addSharedEnvValue: () => void | Promise<void>;
  agentEnvDrafts: Record<string, EnvDraft | undefined>;
  agentSpecificEnvCount: number;
  displayAgents: AgentProfile[];
  fleetClass: ClassNameBuilder;
  formatRelativeTime: (timestamp: number) => string;
  generateSharedEnvSecret: () => void;
  hiveEnvLoading: boolean;
  hiveEnvRestoring: boolean;
  hiveEnvSavingKey: string;
  hiveEnvStatus: string;
  hiveEnvSyncing: boolean;
  importSharedEnvEntries: () => void | Promise<void>;
  listRuntimeFiles: (rootKey: string, relativePath: string) => void | Promise<void>;
  maintenanceBusy: string;
  maintenanceMessage: string;
  maintenanceReport: MaintenanceReport | null | undefined;
  markAllNotificationsRead: () => void | Promise<void>;
  markNotificationRead: (id: string) => void | Promise<void>;
  memoryTelemetry: MemoryTelemetryPayload | null | undefined;
  notificationCursor: string | number | null;
  notificationGroups: NotificationGroup[];
  notificationSummary: AgentNotificationSummary | null;
  notifications: AgentNotification[];
  notificationsLoading: boolean;
  notificationsStatus: string;
  onOpenNotification?: (notification: AgentNotification) => void;
  onNavigateTarget?: NotificationsPanelProps["onNavigateTarget"];
  onDiscussInChat?: NotificationsPanelProps["onDiscussInChat"];
  schedules?: NotificationsPanelProps["schedules"];
  openRuntimeFile: (file: RuntimeFileEntry) => void | Promise<void>;
  pinnedUtilities: DashboardView[];
  togglePinnedUtility: (id: DashboardView) => void;
  promoteRuntimeEnvValue: (source: HiveEnvSource, key: string, value: string) => void | Promise<void>;
  refreshHiveEnv: () => void | Promise<void>;
  refreshMaintenanceReport: () => void | Promise<void>;
  refreshMemoryTelemetry: () => void | Promise<void>;
  refreshNotifications: (options?: { append?: boolean }) => void | Promise<void>;
  refreshRuntimeFileRoots: () => void | Promise<void>;
  renderAgentKey: (agent: AgentProfile, index: number) => string;
  restoreSharedEnvBackup: () => void | Promise<void>;
  revealedEnvValues: Record<string, boolean>;
  runMaintenanceAction: (action: string) => void | Promise<void>;
  runtimeEnvSources: HiveEnvSource[];
  runtimeFileDraft: string;
  runtimeFileOpen: RuntimeOpenFile | null;
  runtimeFilePath: string;
  runtimeFileRootKey: string;
  runtimeFileRoots: RuntimeFileRoot[];
  runtimeFileStatus: string;
  runtimeFiles: RuntimeFileEntry[];
  runtimeModelSelectionsByRuntime: Partial<Record<AgentRuntime, RuntimeModelSelection>>;
  searchAllRuntimeSessions: (queryOverride?: string) => void | Promise<void>;
  saveAgentEnvValue: (agent: AgentProfile, key: string, value: string, previousValue: string) => void | Promise<void>;
  saveRuntimeFile: () => void | Promise<void>;
  saveSharedEnvValue: (source: HiveEnvSource, key: string, value: string, previousValue: string) => void | Promise<void>;
  selectedRuntimeEnvSource: HiveEnvSource | null | undefined;
  sessionSearchLoading: boolean;
  sessionSearchMessage: string;
  sessionSearchQuery: string;
  sessionSearchResults: RuntimeSessionSearchResult[];
  setActiveView: Dispatch<SetStateAction<DashboardView>>;
  setAgentEnvDrafts: Dispatch<SetStateAction<Record<string, EnvDraft>>>;
  setHiveEnvRuntimeSourceId: Dispatch<SetStateAction<string>>;
  setRuntimeFileDraft: Dispatch<SetStateAction<string>>;
  setRuntimeFileOpen: Dispatch<SetStateAction<RuntimeOpenFile | null>>;
  setRuntimeFilePath: Dispatch<SetStateAction<string>>;
  setRuntimeFileRootKey: Dispatch<SetStateAction<string>>;
  setSessionSearchQuery: Dispatch<SetStateAction<string>>;
  setSharedEnvAddMenuOpen: Dispatch<SetStateAction<boolean>>;
  setSharedEnvDraft: Dispatch<SetStateAction<EnvDraft>>;
  setSharedEnvEditable: Dispatch<SetStateAction<boolean>>;
  setSharedEnvImportOpen: Dispatch<SetStateAction<boolean>>;
  setSharedEnvImportText: Dispatch<SetStateAction<string>>;
  sharedBackupStatus: HiveEnvBackupStatus | null | undefined;
  sharedEnvAddMenuOpen: boolean;
  sharedEnvCount: number;
  sharedEnvDraft: EnvDraft;
  sharedEnvEditable: boolean;
  sharedEnvImport: HiveEnvImportPreview;
  sharedEnvImportChangedCount: number;
  sharedEnvImportDiff: HiveEnvImportEntry[];
  sharedEnvImportNewCount: number;
  sharedEnvImportOpen: boolean;
  sharedEnvImportSameCount: number;
  sharedEnvImportText: string;
  sharedEnvImporting: boolean;
  sharedEnvSource: HiveEnvSource | null | undefined;
  sharedVault: SharedVaultConfig;
  startAgentChat: (agentId: string, options?: { fresh?: boolean; runtimeSessionId?: string }) => void | Promise<void>;
  syncSharedEnvMachines: () => void | Promise<void>;
  toggleEnvValue: (key: string) => void;
  updateNotificationSettings: (settings: Partial<AgentNotificationSettings>) => void | Promise<void>;
  vaultClass: ClassNameBuilder;
  vaultPanelMode?: "atlas" | "dream-inbox" | "skill-roi" | "hive-vault" | "shared-skills" | "brain-services" | "env" | "config";
  walletClass: ClassNameBuilder;
};

export function UtilityPanels(props: UtilityPanelsProps) {
  const { AgentEnvCard, Activity, Button, Check, ChevronLeft, Download, FileText, FileUp, FolderOpen, LoaderCircle, MorePanel, NotificationsPanel, Pencil, Plus, RefreshCcw, RotateCcw, ShieldCheck, Sparkles, Upload, activeView, addAgentEnvValue, addSharedEnvValue, agentEnvDrafts, agentSpecificEnvCount, displayAgents, fleetClass, formatRelativeTime, generateSharedEnvSecret, hiveEnvLoading, hiveEnvRestoring, hiveEnvSavingKey, hiveEnvStatus, hiveEnvSyncing, importSharedEnvEntries, listRuntimeFiles, maintenanceBusy, maintenanceMessage, maintenanceReport, markAllNotificationsRead, markNotificationRead, memoryTelemetry, notificationCursor, notificationGroups, notificationSummary, notifications, notificationsLoading, notificationsStatus, onOpenNotification, onNavigateTarget, onDiscussInChat, schedules, openRuntimeFile, pinnedUtilities, togglePinnedUtility, promoteRuntimeEnvValue, refreshHiveEnv, refreshMaintenanceReport, refreshMemoryTelemetry, refreshNotifications, refreshRuntimeFileRoots, renderAgentKey, restoreSharedEnvBackup, revealedEnvValues, runMaintenanceAction, runtimeEnvSources, runtimeFileDraft, runtimeFileOpen, runtimeFilePath, runtimeFileRootKey, runtimeFileRoots, runtimeFileStatus, runtimeFiles, runtimeModelSelectionsByRuntime, saveAgentEnvValue, saveRuntimeFile, saveSharedEnvValue, searchAllRuntimeSessions, selectedRuntimeEnvSource, sessionSearchLoading, sessionSearchMessage, sessionSearchQuery, sessionSearchResults, setActiveView, setAgentEnvDrafts, setHiveEnvRuntimeSourceId, setRuntimeFileDraft, setRuntimeFileOpen, setRuntimeFilePath, setRuntimeFileRootKey, setSessionSearchQuery, setSharedEnvAddMenuOpen, setSharedEnvDraft, setSharedEnvEditable, setSharedEnvImportOpen, setSharedEnvImportText, sharedBackupStatus, sharedEnvAddMenuOpen, sharedEnvCount, sharedEnvDraft, sharedEnvEditable, sharedEnvImport, sharedEnvImportChangedCount, sharedEnvImportDiff, sharedEnvImportNewCount, sharedEnvImportOpen, sharedEnvImportSameCount, sharedEnvImportText, sharedEnvImporting, sharedEnvSource, sharedVault, startAgentChat, syncSharedEnvMachines, toggleEnvValue, updateNotificationSettings, vaultClass, vaultPanelMode } = props;
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const aeonAgent = useMemo(() => displayAgents.find((agent) => agent.runtime === "aeon") ?? null, [displayAgents]);
  const agentEnvOverlayAgents = useMemo(
    () => displayAgents.filter((agent) => runtimeUsesAgentEnvOverlay(agent.runtime)),
    [displayAgents],
  );
  const runtimeManagedEnvAgents = useMemo(
    () => displayAgents.filter((agent) => !runtimeUsesAgentEnvOverlay(agent.runtime) && runtimeEnvFeature(agent.runtime).kind !== "none"),
    [displayAgents],
  );
  const envPanelVisible = activeView === "env" || (activeView === "vault" && vaultPanelMode === "env");
  const [aeonSecretStatus, setAeonSecretStatus] = useState<RuntimeSecretStatus | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemCockpitHealth | null>(null);
  const [systemSmoke, setSystemSmoke] = useState<SystemCockpitSmoke | null>(null);
  const [systemCookbook, setSystemCookbook] = useState<SystemCockpitCookbookEntry[]>([]);
  const [systemModelFit, setSystemModelFit] = useState<SystemCockpitModelFit[]>([]);
  const [systemLiveProbes, setSystemLiveProbes] = useState<SystemCockpitLiveProbe[]>([]);
  const [systemCockpitLoading, setSystemCockpitLoading] = useState(false);
  const [systemCockpitError, setSystemCockpitError] = useState("");
  const [envSearchQuery, setEnvSearchQuery] = useState("");
  useEffect(() => {
    if (!envPanelVisible || !aeonAgent) return;
    let cancelled = false;
    fetch("/api/runtimes/aeon/secrets/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: aeonAgent, vaultPath: sharedVault.vaultPath, fast: true }),
    })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!cancelled && data?.secrets) setAeonSecretStatus(data.secrets);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [aeonAgent, envPanelVisible, sharedVault.vaultPath]);
  useEffect(() => {
    if (activeView !== "maintenance") return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return Promise.reject(new Error("cancelled"));
        setSystemCockpitLoading(true);
        setSystemCockpitError("");
        const modelFit = fetch("/api/fleet/discover?stale=1&includeSnapshots=0")
          .then((response) => response.ok ? response.json() : Promise.reject(new Error("Fleet discovery unavailable.")))
          .then((fleet) => fetch("/api/system/model-fit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ machines: Array.isArray(fleet?.machines) ? fleet.machines : [] }),
          }))
          .then((response) => response.ok ? response.json() : Promise.reject(new Error("Model-fit recommendations unavailable.")))
          .catch(() => ({ recommendations: [] }));
        const liveProbe = Promise.allSettled([
          fetch("/api/fleet/discover?stale=1&includeSnapshots=0").then((response) => response.ok ? response.json() : Promise.reject(new Error("Fleet unavailable."))),
          fetch("/api/runtimes/availability").then((response) => response.ok ? response.json() : Promise.reject(new Error("Runtime availability unavailable."))),
          fetch("/api/syncthing/status").then((response) => response.ok ? response.json() : Promise.reject(new Error("Syncthing unavailable."))),
          fetch("/api/miroshark/status").then((response) => response.ok ? response.json() : Promise.reject(new Error("MiroShark unavailable."))),
          fetch("/api/brain/services/status").then((response) => response.ok ? response.json() : Promise.reject(new Error("Brain services unavailable."))),
        ]).then(([fleet, runtimes, syncthing, miroshark, brain]) => {
          const fleetMachines = fleet.status === "fulfilled" && Array.isArray(fleet.value?.machines) ? fleet.value.machines : [];
          const readyCollectors = fleetMachines.filter((machine: { collector?: unknown }) => machine.collector === "ready" || /^https?:\/\//.test(String(machine.collector ?? ""))).length;
          const runtimeCount = runtimes.status === "fulfilled" && runtimes.value?.runtimes && typeof runtimes.value.runtimes === "object" ? Object.keys(runtimes.value.runtimes).length : 0;
          const syncthingOk = syncthing.status === "fulfilled" && syncthing.value?.ok !== false;
          const mirosharkRunning = miroshark.status === "fulfilled" && Boolean(miroshark.value?.install?.running);
          const brainOk = brain.status === "fulfilled" && brain.value?.ok !== false;
          return [
            { id: "fleet-collectors", label: "Fleet collectors", status: readyCollectors ? "ok" : fleet.status === "fulfilled" ? "degraded" : "down", detail: readyCollectors ? `${readyCollectors} ready collector${readyCollectors === 1 ? "" : "s"}` : "No ready collectors reported." },
            { id: "runtime-availability", label: "Runtime availability", status: runtimeCount ? "ok" : runtimes.status === "fulfilled" ? "degraded" : "down", detail: runtimeCount ? `${runtimeCount} runtime records available.` : "No runtime availability records returned." },
            { id: "syncthing", label: "Syncthing", status: syncthingOk ? "ok" : "degraded", detail: syncthingOk ? "Syncthing status route answered." : "Syncthing status needs attention." },
            { id: "miroshark", label: "MiroShark", status: mirosharkRunning ? "ok" : miroshark.status === "fulfilled" ? "degraded" : "down", detail: mirosharkRunning ? "MiroShark companion is running." : "MiroShark companion is not running or not reachable." },
            { id: "brain-services", label: "Brain services", status: brainOk ? "ok" : "degraded", detail: brainOk ? "Brain services status route answered." : "Brain services status needs attention." },
          ] satisfies SystemCockpitLiveProbe[];
        });
        return Promise.all([
          fetch("/api/system/health").then((response) => response.ok ? response.json() : Promise.reject(new Error("System health unavailable."))),
          fetch("/api/system/smoke-checklist").then((response) => response.ok ? response.json() : Promise.reject(new Error("Smoke checklist unavailable."))),
          fetch("/api/system/troubleshooting?limit=4").then((response) => response.ok ? response.json() : Promise.reject(new Error("Troubleshooting cookbook unavailable."))),
          modelFit,
          liveProbe,
        ]);
      })
      .then(([health, smoke, cookbook, modelFit, liveProbe]) => {
        if (cancelled) return;
        setSystemHealth(health);
        setSystemSmoke(smoke);
        setSystemCookbook(Array.isArray(cookbook?.entries) ? cookbook.entries : []);
        setSystemModelFit(Array.isArray(modelFit?.recommendations) ? modelFit.recommendations : []);
        setSystemLiveProbes(liveProbe);
      })
      .catch((error) => {
        if (!cancelled) setSystemCockpitError(error instanceof Error ? error.message : "System cockpit failed to load.");
      })
      .finally(() => {
        if (!cancelled) setSystemCockpitLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeView]);
  const missingAeonSecrets = (aeonSecretStatus?.keys ?? []).filter((secret) => !secret.isSet);
  const envSearch = envSearchQuery.trim().toLowerCase();
  const envMatches = (...parts: Array<string | number | null | undefined>) => (
    !envSearch || parts.some((part) => String(part ?? "").toLowerCase().includes(envSearch))
  );
  const sharedEnvEntries = Object.entries(sharedEnvSource?.values ?? {})
    .filter(([key]) => envMatches("shared", "hivemind sync", key));
  const selectedRuntimeEnvEntries = selectedRuntimeEnvSource
    ? Object.entries(selectedRuntimeEnvSource.values ?? {})
      .filter(([key]) => envMatches("runtime", selectedRuntimeEnvSource.id, selectedRuntimeEnvSource.label, key))
    : [];
  const selectedRuntimeEnvTotal = Object.keys(selectedRuntimeEnvSource?.values ?? {}).length;
  const visibleMissingAeonSecrets = missingAeonSecrets
    .filter((secret) => envMatches("aeon", secret.key, ...(secret.usedIn ?? [])));
  const visibleRuntimeManagedEnvAgents = runtimeManagedEnvAgents.filter((agent) => {
    const feature = runtimeEnvFeature(agent.runtime);
    const localSources = "localSources" in feature ? feature.localSources.map((source) => `${source.label} ${source.path}`) : [];
    return envMatches("adapter", agent.name, agent.agentId, agent.id, agent.runtime, feature.label, feature.description, ...localSources);
  });
  const agentEnvOverlayCards = agentEnvOverlayAgents
    .map((agent, agentIndex) => {
      const renderKey = renderAgentKey(agent, agentIndex);
      const draft = agentEnvDrafts[agent.id] ?? { key: "", value: "" };
      const agentMatches = envMatches("agent", agent.name, agent.agentId, agent.id, agent.runtime);
      const entries = Object.entries(agent.agentEnv ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .filter(([key]) => agentMatches || envMatches("agent", agent.name, agent.agentId, agent.id, agent.runtime, key));
      return { agent, draft, entries, renderKey };
    })
    .filter(({ agent, entries }) => !envSearch || entries.length || envMatches("agent", agent.name, agent.agentId, agent.id, agent.runtime));
  const filteredAgentSpecificEnvCount = agentEnvOverlayCards.reduce((total, card) => total + card.entries.length, 0);
  const totalEnvSearchableCount = sharedEnvCount + selectedRuntimeEnvTotal + agentSpecificEnvCount + missingAeonSecrets.length;
  const filteredEnvSearchableCount = sharedEnvEntries.length + selectedRuntimeEnvEntries.length + filteredAgentSpecificEnvCount + visibleMissingAeonSecrets.length;
  return (<>
      {activeView === "more" ? (
        <MorePanel
          maintenanceOk={maintenanceReport?.ok}
          runtimeFileRootCount={runtimeFileRoots.length}
          sharedEnvCount={sharedEnvCount}
          notificationUnread={notificationSummary?.unread ?? 0}
          notificationTotal={notificationSummary?.total ?? 0}
          memoryRssMb={memoryTelemetry?.summary.appRssMb}
          pinnedViews={pinnedUtilities}
          onTogglePin={togglePinnedUtility}
          onNavigate={(target) => {
            setActiveView(target);
            if (target === "integrations") return;
            if (target === "maintenance") void refreshMaintenanceReport();
            if (target === "sessions") void searchAllRuntimeSessions("");
            if (target === "memory") void refreshMemoryTelemetry();
            if (target === "files") void refreshRuntimeFileRoots();
            if (target === "notifications") void refreshNotifications();
          }}
        />
      ) : null}

      <MyAppsPanel
        activeView={activeView}
        fleetClass={fleetClass}
        formatRelativeTime={formatRelativeTime}
      />

      <AgentToolsPanel
        activeView={activeView}
        displayAgents={displayAgents}
        fleetClass={fleetClass}
        setActiveView={setActiveView}
        startAgentChat={startAgentChat}
      />

      <MessagingChannelsPanel
        active={activeView === "messaging"}
        displayAgents={displayAgents}
        fleetClass={fleetClass}
        sharedVault={sharedVault}
      />

      {envPanelVisible ? (
        <BrainEnvPanel
          AgentEnvCard={AgentEnvCard}
          Button={Button}
          Check={Check}
          Download={Download}
          FileUp={FileUp}
          LoaderCircle={LoaderCircle}
          Pencil={Pencil}
          Plus={Plus}
          RefreshCcw={RefreshCcw}
          Search={Search}
          ShieldCheck={ShieldCheck}
          Sparkles={Sparkles}
          Upload={Upload}
          addAgentEnvValue={addAgentEnvValue}
          addSharedEnvValue={addSharedEnvValue}
          aeonAgent={aeonAgent}
          agentEnvOverlayAgents={agentEnvOverlayAgents}
          agentEnvOverlayCards={agentEnvOverlayCards}
          agentSpecificEnvCount={agentSpecificEnvCount}
          envSearch={envSearch}
          envSearchQuery={envSearchQuery}
          filteredAgentSpecificEnvCount={filteredAgentSpecificEnvCount}
          filteredEnvSearchableCount={filteredEnvSearchableCount}
          fleetClass={fleetClass}
          generateSharedEnvSecret={generateSharedEnvSecret}
          hiveEnvLoading={hiveEnvLoading}
          hiveEnvRestoring={hiveEnvRestoring}
          hiveEnvSavingKey={hiveEnvSavingKey}
          hiveEnvStatus={hiveEnvStatus}
          hiveEnvSyncing={hiveEnvSyncing}
          importSharedEnvEntries={importSharedEnvEntries}
          portalTarget={portalTarget}
          promoteRuntimeEnvValue={promoteRuntimeEnvValue}
          refreshHiveEnv={refreshHiveEnv}
          renderAgentKey={renderAgentKey}
          restoreSharedEnvBackup={restoreSharedEnvBackup}
          revealedEnvValues={revealedEnvValues}
          runtimeEnvFeature={runtimeEnvFeature}
          runtimeEnvSources={runtimeEnvSources}
          runtimeManagedEnvAgents={runtimeManagedEnvAgents}
          runtimeModelSelectionsByRuntime={runtimeModelSelectionsByRuntime}
          saveAgentEnvValue={saveAgentEnvValue}
          saveSharedEnvValue={saveSharedEnvValue}
          selectedRuntimeEnvEntries={selectedRuntimeEnvEntries}
          selectedRuntimeEnvSource={selectedRuntimeEnvSource}
          selectedRuntimeEnvTotal={selectedRuntimeEnvTotal}
          setActiveView={setActiveView}
          setAgentEnvDrafts={setAgentEnvDrafts}
          setEnvSearchQuery={setEnvSearchQuery}
          setHiveEnvRuntimeSourceId={setHiveEnvRuntimeSourceId}
          setSharedEnvAddMenuOpen={setSharedEnvAddMenuOpen}
          setSharedEnvDraft={setSharedEnvDraft}
          setSharedEnvEditable={setSharedEnvEditable}
          setSharedEnvImportOpen={setSharedEnvImportOpen}
          setSharedEnvImportText={setSharedEnvImportText}
          sharedBackupStatus={sharedBackupStatus}
          sharedEnvAddMenuOpen={sharedEnvAddMenuOpen}
          sharedEnvCount={sharedEnvCount}
          sharedEnvDraft={sharedEnvDraft}
          sharedEnvEditable={sharedEnvEditable}
          sharedEnvEntries={sharedEnvEntries}
          sharedEnvImport={sharedEnvImport}
          sharedEnvImportChangedCount={sharedEnvImportChangedCount}
          sharedEnvImportDiff={sharedEnvImportDiff}
          sharedEnvImportNewCount={sharedEnvImportNewCount}
          sharedEnvImportOpen={sharedEnvImportOpen}
          sharedEnvImportSameCount={sharedEnvImportSameCount}
          sharedEnvImportText={sharedEnvImportText}
          sharedEnvImporting={sharedEnvImporting}
          sharedEnvSource={sharedEnvSource}
          syncSharedEnvMachines={syncSharedEnvMachines}
          toggleEnvValue={toggleEnvValue}
          totalEnvSearchableCount={totalEnvSearchableCount}
          vaultClass={vaultClass}
          visibleMissingAeonSecrets={visibleMissingAeonSecrets}
          visibleRuntimeManagedEnvAgents={visibleRuntimeManagedEnvAgents}
        />
      ) : null}

      {activeView === "maintenance" ? (
      <section className={fleetClass("taskPanel", "tabPanel")}>
        <div className={fleetClass("taskPanelHeader")}>
          <div>
            <p className="eyebrow">Fleet diagnostics</p>
            <h2>Diagnostics</h2>
            <p>Run local checks and conservative repairs for the dashboard, runtime stores, and shared brain.</p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => void refreshMaintenanceReport()} disabled={maintenanceBusy === "check"}>
            {maintenanceBusy === "check" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
            Check
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void runMaintenanceAction("diagnostic-dump")} disabled={Boolean(maintenanceBusy)}>
            {maintenanceBusy === "diagnostic-dump" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <FileText aria-hidden="true" />}
            Dump
          </Button>
        </div>
        {maintenanceMessage ? <p className="mt-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] px-3 py-2 text-xs text-[var(--foreground)]">{maintenanceMessage}</p> : null}
        {maintenanceReport?.error ? <p className="mt-3 text-xs text-[#fecdd3]">{maintenanceReport.error}</p> : null}
        <div className="mt-4 grid gap-3">
          <section className="grid gap-3 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">System cockpit</p>
                <h3 className="m-0 text-base font-bold">Health and first-run smoke</h3>
                <p className="m-0 mt-1 text-xs text-[var(--muted)]">Secret-free readiness checks, setup smoke items, and short repair guidance.</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-bold ${systemHealth?.status === "ok" ? "border-[rgba(34,197,94,0.24)] text-[#bbf7d0]" : "border-[rgba(251,191,36,0.26)] text-[#fde68a]"}`}>
                {systemCockpitLoading ? "loading" : systemHealth?.status ?? "not checked"}
              </span>
            </div>
            {systemCockpitError ? <p className="m-0 text-xs text-[#fecdd3]">{systemCockpitError}</p> : null}
            <div className="grid gap-3 xl:grid-cols-2">
              <div className="grid gap-2">
                {(systemHealth?.checks ?? []).map((check) => (
                  <div key={check.id} className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.48)] p-3">
                    <strong className={check.status === "ok" ? "text-[#bbf7d0]" : check.status === "disabled" ? "text-[var(--muted)]" : "text-[#fde68a]"}>
                      {check.status} · {check.label}
                    </strong>
                    <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">{check.detail}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-2">
                {(systemSmoke?.items ?? []).slice(0, 8).map((smoke) => (
                  <div key={smoke.id} className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.48)] p-3">
                    <strong className={smoke.status === "pass" ? "text-[#bbf7d0]" : smoke.status === "manual" ? "text-[var(--accent-strong)]" : "text-[#fde68a]"}>
                      {smoke.status} · {smoke.label}
                    </strong>
                    <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">{smoke.detail}</p>
                    {smoke.nextAction ? <p className="m-0 mt-1 text-xs text-[var(--foreground)]">{smoke.nextAction}</p> : null}
                  </div>
                ))}
              </div>
            </div>
            {systemLiveProbes.length ? (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                {systemLiveProbes.map((probe) => (
                  <article key={probe.id} className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.48)] p-3">
                    <strong className={probe.status === "ok" ? "text-[#bbf7d0]" : probe.status === "degraded" ? "text-[#fde68a]" : "text-[#fecdd3]"}>
                      {probe.status}
                    </strong>
                    <h4 className="m-0 mt-1 text-sm font-bold">{probe.label}</h4>
                    <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">{probe.detail}</p>
                  </article>
                ))}
              </div>
            ) : null}
            {systemCookbook.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {systemCookbook.map((entry) => (
                  <article key={entry.id} className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.48)] p-3">
                    <p className="eyebrow">{entry.area} · {entry.severity}</p>
                    <h4 className="m-0 text-sm font-bold">{entry.title}</h4>
                    <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">{entry.symptoms[0]}</p>
                    <p className="m-0 mt-1 text-xs text-[var(--foreground)]">{entry.fixes[0]}</p>
                  </article>
                ))}
              </div>
            ) : null}
            {systemModelFit.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {systemModelFit.slice(0, 4).map((fit) => (
                  <article key={fit.machineId} className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.48)] p-3">
                    <p className="eyebrow">{fit.tier}</p>
                    <h4 className="m-0 text-sm font-bold">{fit.machineName}: {fit.label}</h4>
                    <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">{fit.rationale[0]}</p>
                    <p className="m-0 mt-1 text-xs text-[var(--foreground)]">{fit.preferredProviders.slice(0, 3).join(" · ")}</p>
                    {fit.caution ? <p className="m-0 mt-1 text-xs text-[#fde68a]">{fit.caution}</p> : null}
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        </div>
        <div className="mt-4 grid gap-3">
          {(maintenanceReport?.checks ?? []).map((check) => (
            <article key={check.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
              <div className="min-w-0">
                <strong className={check.ok ? "text-[#bbf7d0]" : "text-[#fecdd3]"}>{check.ok ? "OK" : "Needs repair"} · {check.label}</strong>
                <p className="m-0 mt-1 break-words text-xs text-[var(--muted)]">{check.detail}</p>
              </div>
              {check.repairAction ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => void runMaintenanceAction(check.repairAction!)} disabled={Boolean(maintenanceBusy)}>
                  {maintenanceBusy === check.repairAction ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <ShieldCheck aria-hidden="true" />}
                  Repair
                </Button>
              ) : null}
            </article>
          ))}
          {maintenanceReport?.checks?.length ? null : (
            <div className="rounded-md border border-dashed border-[rgba(148,163,184,0.22)] p-6 text-center text-sm text-[var(--muted)]">
              Press Check to run diagnostics.
            </div>
          )}
        </div>
      </section>
      ) : null}

      {activeView === "sessions" ? (
      <section className={fleetClass("taskPanel", "tabPanel")}>
        <div className={fleetClass("taskPanelHeader")}>
          <div>
            <p className="eyebrow">Runtime sessions</p>
            <h2>Session search</h2>
            <p>Search readable local Hermes and OpenClaw history without opening each agent's settings.</p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => void searchAllRuntimeSessions()} disabled={sessionSearchLoading}>
            {sessionSearchLoading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
            Search
          </Button>
        </div>
        <form
          className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void searchAllRuntimeSessions();
          }}
        >
          <input
            className="min-h-9 min-w-[220px] flex-1 rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.34)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
            value={sessionSearchQuery}
            onChange={(event) => setSessionSearchQuery(event.target.value)}
            placeholder="Search sessions by title, prompt, model, or id"
          />
          <Button type="submit" size="sm" disabled={sessionSearchLoading}>
            {sessionSearchLoading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
            Search
          </Button>
        </form>
        {sessionSearchMessage ? <p className="mt-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] px-3 py-2 text-xs text-[var(--foreground)]">{sessionSearchMessage}</p> : null}
        <div className="mt-4 grid gap-3">
          {sessionSearchResults.map((session) => {
            const agent = displayAgents.find((item) => item.runtime === session.runtime);
            const timestamp = session.updatedAt || session.startedAt;
            return (
              <article key={`${session.runtime}-${session.id}`} className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
                <div className="grid gap-1">
                  <strong>{session.title || session.id}</strong>
                  <span className="text-xs font-semibold uppercase text-[var(--muted)]">
                    {[session.runtime, session.source, session.model, timestamp ? new Date(timestamp).toLocaleString() : ""].filter(Boolean).join(" · ")}
                  </span>
                  <p className="m-0 break-words text-xs leading-5 text-[var(--muted)]">{session.excerpt || session.path || "No preview available."}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {agent ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setActiveView("chat");
                        void startAgentChat(agent.id, { fresh: true, runtimeSessionId: session.id });
                      }}
                    >
                      <Activity aria-hidden="true" />
                      Open in chat
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(session.id)}>
                    <FileText aria-hidden="true" />
                    Copy id
                  </Button>
                </div>
              </article>
            );
          })}
          {sessionSearchResults.length || sessionSearchLoading ? null : (
            <div className="rounded-md border border-dashed border-[rgba(148,163,184,0.22)] p-6 text-center text-sm text-[var(--muted)]">
              Search or open this panel to load recent readable sessions.
            </div>
          )}
        </div>
      </section>
      ) : null}

      {activeView === "files" ? (
      <section className={fleetClass("taskPanel", "tabPanel")}>
        <div className={fleetClass("taskPanelHeader")}>
          <div>
            <p className="eyebrow">Scoped file browser</p>
            <h2>Agent files</h2>
            <p>Browse and edit the folders your agents run on — their runtime homes, the shared brain, and HivemindOS state — without exposing the rest of your disk.</p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => void refreshRuntimeFileRoots()}>
            <RefreshCcw aria-hidden="true" />
            Refresh
          </Button>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
          <p className="m-0 text-xs text-[var(--muted)]">These roots are the only folders reachable here — each runtime&apos;s home, the shared brain, and HivemindOS state. Read-only roots can be viewed but not saved; nothing outside them is exposed.</p>
        </div>
        {(() => {
          const selectedRoot = runtimeFileRoots.find((root) => root.key === runtimeFileRootKey);
          const pathSegments = runtimeFilePath ? runtimeFilePath.split("/").filter(Boolean) : [];
          const busy = runtimeFileStatus.endsWith("...");
          return (
        <div className="mt-4 grid gap-4 lg:grid-cols-[264px_minmax(0,1fr)]">
          <aside className="grid min-w-0 content-start gap-2">
            <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">Roots</p>
            <div className="grid gap-2 lg:max-h-[560px] lg:overflow-y-auto lg:pr-1">
              {runtimeFileRoots.map((root) => {
                const selected = root.key === runtimeFileRootKey;
                return (
                  <button
                    type="button"
                    key={root.key}
                    aria-pressed={selected}
                    onClick={() => {
                      setRuntimeFileRootKey(root.key);
                      setRuntimeFilePath("");
                      setRuntimeFileOpen(null);
                      void listRuntimeFiles(root.key, "");
                    }}
                    className={`grid gap-1.5 rounded-md border p-3 text-left transition-colors ${selected ? "border-[var(--accent)] bg-[var(--button-accent)]" : "border-[var(--line)] bg-[var(--surface-soft)] hover:border-[var(--accent-strong)]"}`}
                  >
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <FolderOpen aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                      <strong className="min-w-0 break-words text-sm text-[var(--foreground)]">{root.label}</strong>
                      {root.writable ? (
                        <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] font-medium text-[var(--success)]">
                          <Pencil aria-hidden="true" className="h-3 w-3" />
                          Editable
                        </span>
                      ) : (
                        <span className="ml-auto inline-flex shrink-0 items-center rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted)]">Read-only</span>
                      )}
                    </span>
                    <span className="block text-xs text-[var(--muted)]">{describeRuntimeFileRoot(root)}</span>
                    <span className="block break-all font-mono text-[11px] text-[var(--muted)]">{root.path}</span>
                  </button>
                );
              })}
              {runtimeFileRoots.length ? null : <p className="m-0 text-xs text-[var(--muted)]">No roots loaded yet. Refresh to load them.</p>}
            </div>
          </aside>
          <div className="grid content-start gap-3">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
              {runtimeFilePath ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const parent = runtimeFilePath.split("/").slice(0, -1).join("/");
                    setRuntimeFileOpen(null);
                    void listRuntimeFiles(runtimeFileRootKey, parent);
                  }}
                >
                  <ChevronLeft aria-hidden="true" />
                  Parent
                </Button>
              ) : null}
              <button
                type="button"
                className="rounded px-1 py-0.5 text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                onClick={() => {
                  setRuntimeFileOpen(null);
                  void listRuntimeFiles(runtimeFileRootKey, "");
                }}
              >
                {selectedRoot?.label ?? "Root"}
              </button>
              {pathSegments.map((segment, index) => {
                const target = pathSegments.slice(0, index + 1).join("/");
                const isLast = index === pathSegments.length - 1;
                return (
                  <span key={target} className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="text-[var(--muted)]">/</span>
                    {isLast ? (
                      <span className="font-medium text-[var(--foreground)]">{segment}</span>
                    ) : (
                      <button
                        type="button"
                        className="rounded px-1 py-0.5 text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                        onClick={() => {
                          setRuntimeFileOpen(null);
                          void listRuntimeFiles(runtimeFileRootKey, target);
                        }}
                      >
                        {segment}
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
            {runtimeFileStatus ? (
              <p role="status" className={`m-0 flex items-center gap-1.5 text-xs ${busy ? "text-[var(--muted)]" : runtimeFileStatus === "Saved." ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                {busy ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : null}
                {runtimeFileStatus}
              </p>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
              <div className="max-h-[560px] overflow-auto rounded-md border border-[var(--line)] bg-[var(--surface-soft)]">
                {runtimeFiles.map((file) => {
                  const active = runtimeFileOpen?.relativePath === file.relativePath;
                  return (
                    <button
                      type="button"
                      key={file.relativePath}
                      onClick={() => void openRuntimeFile(file)}
                      className={`flex w-full items-start gap-2 border-b border-[var(--line)] px-3 py-2 text-left text-xs transition-colors last:border-b-0 ${active ? "bg-[var(--button-accent)]" : "hover:bg-[var(--button-accent)]"}`}
                    >
                      {file.type === "dir" ? <FolderOpen aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" /> : <FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)]" />}
                      <span className="min-w-0 flex-1">
                        <strong className="block break-words text-[var(--foreground)]">{file.name}</strong>
                        <small className="text-[var(--muted)]">{file.type === "dir" ? "Folder" : file.size ? `${Math.max(1, Math.round(file.size / 1024))} KB` : "File"}{file.updatedAt ? ` · ${formatRelativeTime(file.updatedAt)}` : ""}</small>
                      </span>
                    </button>
                  );
                })}
                {runtimeFiles.length ? null : <p className="m-0 p-4 text-sm text-[var(--muted)]">{runtimeFileRootKey ? "This folder is empty." : "Pick a root on the left to start browsing."}</p>}
              </div>
              <section className="grid min-h-[440px] grid-rows-[auto_1fr_auto] gap-3 rounded-md border border-[var(--line)] bg-[var(--surface-soft)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                  <strong className="text-[var(--foreground)]">{runtimeFileOpen?.name ?? "No file selected"}</strong>
                  {runtimeFileOpen ? (selectedRoot?.writable ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] font-medium text-[var(--success)]">
                      <Pencil aria-hidden="true" className="h-3 w-3" />
                      Editable
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted)]">Read-only</span>
                  )) : null}
                  <span className="w-full break-words text-xs text-[var(--muted)]">{runtimeFileOpen?.relativePath ?? "Choose a file on the left to preview or edit it here."}</span>
                </div>
                <textarea
                  value={runtimeFileDraft}
                  onChange={(event) => setRuntimeFileDraft(event.target.value)}
                  disabled={!runtimeFileOpen}
                  readOnly={!selectedRoot?.writable}
                  aria-label="File contents"
                  className="min-h-[340px] resize-none rounded-md border border-[var(--line)] bg-[var(--surface-strong)] p-3 font-mono text-xs text-[var(--foreground)] disabled:opacity-60"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--muted)]">Text files up to 500 KB · saved with owner-only (0600) permissions.</span>
                  <span className="flex flex-wrap justify-end gap-2">
                    <Button type="button" size="sm" variant="secondary" disabled={!runtimeFileOpen} onClick={() => setRuntimeFileDraft(runtimeFileOpen?.content ?? "")}>
                      <RotateCcw aria-hidden="true" />
                      Reset
                    </Button>
                    <Button type="button" size="sm" disabled={!runtimeFileOpen || !selectedRoot?.writable} onClick={() => void saveRuntimeFile()}>
                      <Check aria-hidden="true" />
                      Save
                    </Button>
                  </span>
                </div>
              </section>
            </div>
          </div>
        </div>
          );
        })()}
      </section>
      ) : null}

      <AgentNativeInsightsPanel
        Button={Button}
        active={activeView === "memory"}
        fleetClass={fleetClass}
        formatRelativeTime={formatRelativeTime}
        sharedVault={sharedVault}
        vaultClass={vaultClass}
      />

      {activeView === "notifications" ? (
        <NotificationsPanel
          notifications={notifications}
          notificationGroups={notificationGroups}
          notificationSummary={notificationSummary}
          notificationCursor={notificationCursor}
          notificationsLoading={notificationsLoading}
          notificationsStatus={notificationsStatus}
          fallbackFolder={sharedVault.notificationsFolder}
          vaultPath={sharedVault.vaultPath}
          onRefresh={refreshNotifications}
          onMarkAllRead={markAllNotificationsRead}
          onMarkRead={markNotificationRead}
          onOpenNotification={onOpenNotification}
          onNavigateTarget={onNavigateTarget}
          onDiscussInChat={onDiscussInChat}
          schedules={schedules}
          onUpdateSettings={updateNotificationSettings}
        />
      ) : null}

  </>);
}
