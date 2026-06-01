"use client";

import { useEffect, useMemo, useState, type ComponentType, type Dispatch, type ElementType, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { maskedSecretValueClass, secretInputProps } from "@/components/ui/secret-input-props";
import type { AgentProfile, AgentRuntime, SharedVaultConfig } from "@/lib/types/agent-runtime";
import { runtimeEnvFeature, runtimeUsesAgentEnvOverlay } from "@/lib/types/agent-runtime";
import type { AgentNotification, AgentNotificationSettings, AgentNotificationSummary } from "@/lib/types/agent-notifications";
import type { MemoryTelemetryPayload } from "@/lib/types/memory-telemetry";
import type { AgentEnvCardProps, EnvValueRowProps } from "@/features/env/env-components";
import type { MorePanelProps } from "@/features/dashboard/MorePanel";
import type { NotificationGroup, NotificationsPanelProps } from "@/features/notifications/NotificationsPanel";
import { MemoryTelemetryPanel } from "@/features/dashboard/views/MemoryTelemetryPanel";
import { MyAppsPanel } from "@/features/dashboard/views/MyAppsPanel";
import { AgentToolsPanel } from "@/features/dashboard/views/AgentToolsPanel";
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
type IconComponent = ElementType<{
  "aria-hidden"?: boolean | "true" | "false";
  className?: string;
}>;

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
  memoryTelemetryLoading: boolean;
  notificationCursor: string | number | null;
  notificationGroups: NotificationGroup[];
  notificationSummary: AgentNotificationSummary | null;
  notifications: AgentNotification[];
  notificationsLoading: boolean;
  notificationsStatus: string;
  onOpenNotification?: (notification: AgentNotification) => void;
  openRuntimeFile: (file: RuntimeFileEntry) => void | Promise<void>;
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
  vaultPanelMode?: "hive-vault" | "shared-skills" | "brain-services" | "env" | "config";
  walletClass: ClassNameBuilder;
};

export function UtilityPanels(props: UtilityPanelsProps) {
  const { AgentEnvCard, Activity, Button, Check, ChevronDown, ChevronLeft, Download, EnvValueRow, FileText, FileUp, FolderOpen, LoaderCircle, MorePanel, NotificationsPanel, Pencil, Plus, RefreshCcw, RotateCcw, ShieldCheck, Sparkles, URL, Upload, activeView, addAgentEnvValue, addSharedEnvValue, agentEnvDrafts, agentSpecificEnvCount, displayAgents, fleetClass, formatRelativeTime, generateSharedEnvSecret, hiveEnvLoading, hiveEnvRestoring, hiveEnvSavingKey, hiveEnvStatus, hiveEnvSyncing, importSharedEnvEntries, listRuntimeFiles, maintenanceBusy, maintenanceMessage, maintenanceReport, markAllNotificationsRead, markNotificationRead, memoryTelemetry, memoryTelemetryLoading, notificationCursor, notificationGroups, notificationSummary, notifications, notificationsLoading, notificationsStatus, onOpenNotification, openRuntimeFile, promoteRuntimeEnvValue, refreshHiveEnv, refreshMaintenanceReport, refreshMemoryTelemetry, refreshNotifications, refreshRuntimeFileRoots, renderAgentKey, restoreSharedEnvBackup, revealedEnvValues, runMaintenanceAction, runtimeEnvSources, runtimeFileDraft, runtimeFileOpen, runtimeFilePath, runtimeFileRootKey, runtimeFileRoots, runtimeFileStatus, runtimeFiles, runtimeModelSelectionsByRuntime, saveAgentEnvValue, saveRuntimeFile, saveSharedEnvValue, searchAllRuntimeSessions, selectedRuntimeEnvSource, sessionSearchLoading, sessionSearchMessage, sessionSearchQuery, sessionSearchResults, setActiveView, setAgentEnvDrafts, setHiveEnvRuntimeSourceId, setRuntimeFileDraft, setRuntimeFileOpen, setRuntimeFilePath, setRuntimeFileRootKey, setSessionSearchQuery, setSharedEnvAddMenuOpen, setSharedEnvDraft, setSharedEnvEditable, setSharedEnvImportOpen, setSharedEnvImportText, sharedBackupStatus, sharedEnvAddMenuOpen, sharedEnvCount, sharedEnvDraft, sharedEnvEditable, sharedEnvImport, sharedEnvImportChangedCount, sharedEnvImportDiff, sharedEnvImportNewCount, sharedEnvImportOpen, sharedEnvImportSameCount, sharedEnvImportText, sharedEnvImporting, sharedEnvSource, sharedVault, startAgentChat, syncSharedEnvMachines, toggleEnvValue, updateNotificationSettings, vaultClass, vaultPanelMode, walletClass } = props;
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
  const missingAeonSecrets = (aeonSecretStatus?.keys ?? []).filter((secret) => !secret.isSet);
  return (<>
      {activeView === "more" ? (
        <MorePanel
          maintenanceOk={maintenanceReport?.ok}
          runtimeFileRootCount={runtimeFileRoots.length}
          notificationUnread={notificationSummary?.unread ?? 0}
          notificationTotal={notificationSummary?.total ?? 0}
          memoryRssMb={memoryTelemetry?.summary.appRssMb}
          memoryGrowthMb={memoryTelemetry?.summary.topGrowerGrowthMb}
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

      {envPanelVisible ? (
      <section className={fleetClass("taskPanel", "tabPanel")}>
        <div className={fleetClass("taskPanelHeader")}>
          <div>
            <p className="eyebrow">Shared env</p>
            <h2>Environment variables</h2>
            <p>One shared sync store first. Runtime-specific keys only appear below when they are not already shared.</p>
          </div>
		          <div className="flex flex-wrap gap-2">
		            <Button type="button" size="sm" variant="secondary" onClick={() => void syncSharedEnvMachines()} disabled={hiveEnvSyncing || sharedEnvCount === 0}>
		              {hiveEnvSyncing ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
		              Sync machines
		            </Button>
		            <Button type="button" size="sm" variant="secondary" onClick={() => void restoreSharedEnvBackup()} disabled={hiveEnvRestoring || !sharedBackupStatus?.backupExists || !sharedBackupStatus?.gpgAvailable}>
	              {hiveEnvRestoring ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />}
	              Restore backup
	            </Button>
	            <Button type="button" size="sm" variant="secondary" onClick={() => void refreshHiveEnv()} disabled={hiveEnvLoading}>
	              {hiveEnvLoading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
	              Refresh
	            </Button>
	          </div>
	        </div>

        {hiveEnvStatus ? <p className="mt-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] px-3 py-2 text-xs text-[var(--foreground)]">{hiveEnvStatus}</p> : null}

        <div className="mt-4 grid gap-4">
	          <section className="relative grid gap-3 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] p-4">
	            <div className="flex flex-wrap items-end justify-between gap-3">
		              <div>
		                <p className="eyebrow">hive-env-add</p>
		                <h3 className="m-0 text-base font-bold">Shared sync store</h3>
	                <p className="m-0 mt-1 text-xs text-[var(--muted)]">
	                  {sharedBackupStatus?.backupExists
	                    ? "Encrypted backup ready. Saves use hive-env-add sync."
	                    : "Saves use hive-env-add sync. Encrypted backup will appear after the next successful save."}
	                </p>
	              </div>
	              <div className="flex flex-wrap items-center gap-2">
	                <span className="rounded-full border border-[rgba(94,234,212,0.22)] bg-[rgba(20,184,166,0.08)] px-3 py-1 text-xs font-bold text-[var(--accent-strong)]">
	                  {sharedEnvCount} variables
	                </span>
	                <Button
	                  type="button"
	                  size="sm"
	                  variant="secondary"
	                  onClick={() => {
	                    const body = Object.entries(sharedEnvSource?.values ?? {}).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n");
	                    const blob = new Blob([body ? `${body}\n` : ""], { type: "text/plain" });
	                    const url = URL.createObjectURL(blob);
	                    const anchor = document.createElement("a");
	                    anchor.href = url;
	                    anchor.download = "hive.env";
	                    anchor.click();
	                    URL.revokeObjectURL(url);
	                  }}
		                  disabled={!sharedEnvSource || sharedEnvCount === 0}
	                >
	                  <Download aria-hidden="true" />
	                  Export
	                </Button>
	                <Button type="button" size="sm" variant={sharedEnvEditable ? "default" : "secondary"} onClick={() => setSharedEnvEditable((editable) => !editable)}>
	                  <Pencil aria-hidden="true" />
	                  {sharedEnvEditable ? "Done" : "Edit"}
	                </Button>
	              </div>
	            </div>
	            {sharedEnvEditable ? (
	              <div className="grid gap-2">
	                <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto] gap-2">
	                  <input
	                    value={sharedEnvDraft.key}
	                    onChange={(event) => setSharedEnvDraft((current) => ({ ...current, key: event.target.value }))}
	                    placeholder="KEY"
	                    className="min-w-0 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.72)] px-2 py-2 font-mono text-xs text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
	                  />
	                  <input
	                    {...secretInputProps}
	                    value={sharedEnvDraft.value}
	                    onChange={(event) => setSharedEnvDraft((current) => ({ ...current, value: event.target.value }))}
	                    onKeyDown={(event) => {
	                      if (event.key === "Enter") void addSharedEnvValue();
	                    }}
	                    placeholder="value"
	                    className={`min-w-0 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.72)] px-2 py-2 font-mono text-xs text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)] ${maskedSecretValueClass}`}
	                  />
		                  <div className="relative flex">
			                    <Button type="button" size="sm" variant="secondary" className="h-full min-h-[2.5rem] rounded-r-none px-4 py-2" title="Stage a single env variable, then save it with hive-env-add." onClick={() => void addSharedEnvValue()}>
			                      <Plus aria-hidden="true" />
			                      Add variable
			                    </Button>
		                    <Button type="button" size="icon" variant="secondary" className="h-full min-h-[2.5rem] rounded-l-none border-l border-[rgba(148,163,184,0.22)] px-3 py-2" aria-label="More add variable options" aria-expanded={sharedEnvAddMenuOpen} onClick={() => setSharedEnvAddMenuOpen((open) => !open)}>
	                      <ChevronDown aria-hidden="true" />
	                    </Button>
	                    {sharedEnvAddMenuOpen ? (
	                      <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 grid min-w-64 gap-1 rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(5,8,13,0.98)] p-2 shadow-2xl" role="menu">
	                        <button type="button" className="flex items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-[var(--foreground)] hover:bg-[rgba(94,234,212,0.10)]" onClick={generateSharedEnvSecret}>
	                          <Sparkles aria-hidden="true" className="h-4 w-4" />
	                          Generate secret
	                        </button>
	                        <button type="button" className="flex items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-[var(--foreground)] hover:bg-[rgba(94,234,212,0.10)]" onClick={() => { setSharedEnvImportOpen(true); setSharedEnvAddMenuOpen(false); }}>
	                          <FileText aria-hidden="true" className="h-4 w-4" />
	                          Import from .env
	                        </button>
	                      </div>
	                    ) : null}
	                  </div>
	                </div>
	              </div>
	            ) : null}
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {Object.entries(sharedEnvSource?.values ?? {}).map(([key, value]) => {
                const revealKey = `shared:${sharedEnvSource?.id ?? "shared"}:${key}`;
                return (
                  <EnvValueRow
                    key={key}
                    name={key}
                    value={value}
	                    revealKey={revealKey}
	                    revealed={Boolean(revealedEnvValues[revealKey])}
	                    saving={hiveEnvSavingKey === revealKey}
	                    editable={sharedEnvEditable}
	                    onToggleReveal={toggleEnvValue}
	                    onSave={(nextValue) => void saveSharedEnvValue(sharedEnvSource!, key, nextValue, value)}
	                    onRemove={() => void saveSharedEnvValue(sharedEnvSource!, key, "", value)}
                  />
                );
              })}
              {!sharedEnvSource ? (
                <div className="rounded-md border border-dashed border-[rgba(148,163,184,0.22)] p-6 text-center text-sm text-[var(--muted)]">
                  Press Refresh to read hive-env-add variables.
                </div>
              ) : sharedEnvCount === 0 ? (
                <div className="rounded-md border border-dashed border-[rgba(148,163,184,0.22)] p-6 text-center text-sm text-[var(--muted)]">
                  No shared env variables yet.
                </div>
	              ) : null}
	            </div>
	          </section>

	          {aeonAgent && missingAeonSecrets.length ? (
	            <section className="relative grid gap-3 rounded-md border border-[rgba(251,191,36,0.20)] bg-[rgba(251,191,36,0.06)] p-4">
	              <div className="flex flex-wrap items-start justify-between gap-3">
	                <div>
	                  <p className="eyebrow">Detected unset secrets</p>
	                  <h3 className="m-0 text-base font-bold">AEON keys to reconcile</h3>
	                  <p className="m-0 mt-1 text-xs text-[var(--muted)]">
	                    These keys are referenced by AEON skills or channels but are not set in the AEON GitHub repo yet.
	                  </p>
	                </div>
	                <Button
	                  type="button"
	                  size="sm"
	                  variant="secondary"
	                  onClick={() => {
	                    const keys = missingAeonSecrets
	                      .filter((secret) => sharedEnvSource?.values?.[secret.key])
	                      .map((secret) => secret.key);
	                    if (keys.length) {
	                      void fetch("/api/runtimes/aeon/env/sync", {
	                        method: "POST",
	                        headers: { "Content-Type": "application/json" },
	                        body: JSON.stringify({ agent: aeonAgent, keys }),
	                      });
	                    }
	                    setActiveView("aeon");
	                  }}
	                >
	                  <Upload aria-hidden="true" />
	                  Import matching keys in AEON
	                </Button>
	              </div>
	              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
	                {missingAeonSecrets.map((secret) => (
	                  <div key={secret.key} className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.48)] p-3">
	                    <div className="flex flex-wrap items-center justify-between gap-2">
	                      <code className="text-xs text-[var(--foreground)]">{secret.key}</code>
	                      <span className="rounded-full border border-[rgba(148,163,184,0.18)] px-2 py-1 text-[10px] text-[var(--muted)]">
	                        {sharedEnvSource?.values?.[secret.key] ? "shared env has value" : "needs setup"}
	                      </span>
	                    </div>
	                    <p className="m-0 mt-2 text-xs leading-5 text-[var(--muted)]">
	                      Used in the following skills: {secret.usedIn.length ? secret.usedIn.slice(0, 4).join(", ") : "AEON core or notification channel"}.
	                    </p>
	                    {sharedEnvSource?.values?.[secret.key] ? (
	                      <Button
	                        type="button"
	                        size="sm"
	                        variant="secondary"
	                        className="mt-3"
	                        onClick={() => {
	                          void fetch("/api/runtimes/aeon/env/sync", {
	                            method: "POST",
	                            headers: { "Content-Type": "application/json" },
	                            body: JSON.stringify({ agent: aeonAgent, keys: [secret.key] }),
	                          });
	                          setActiveView("aeon");
	                        }}
	                      >
	                        <Upload aria-hidden="true" />
	                        Copy from shared env
	                      </Button>
	                    ) : (
	                      <Button
	                        type="button"
	                        size="sm"
	                        variant="ghost"
	                        className="mt-3"
	                        onClick={() => {
	                          setSharedEnvEditable(true);
	                          setSharedEnvDraft({ key: secret.key, value: "" });
	                        }}
	                      >
	                        <Plus aria-hidden="true" />
	                        Add here
	                      </Button>
	                    )}
	                  </div>
	                ))}
	              </div>
	            </section>
	          ) : null}

	          {sharedEnvImportOpen && portalTarget ? createPortal((
	            <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 py-8" role="dialog" aria-modal="true" aria-label="Add from .env">
	              <div className="grid max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-md border border-[rgba(148,163,184,0.20)] bg-[rgba(5,8,13,0.98)] shadow-2xl">
	                <div className="flex items-start justify-between gap-4 border-b border-[rgba(148,163,184,0.14)] p-6">
	                  <div>
	                    <p className="eyebrow">Bulk import</p>
	                    <h3 className="m-0 text-3xl font-bold">Add from .env</h3>
	                    <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
	                      Paste `.env` contents or choose a file. Values are parsed locally first; only new and changed keys are sent through hive-env-add.
	                    </p>
	                  </div>
	                  <CloseIconButton aria-label="Close import dialog" onClick={() => setSharedEnvImportOpen(false)} />
	                </div>
	                <div className="grid gap-4 overflow-auto p-6">
	                  <textarea
	                    value={sharedEnvImportText}
	                    onChange={(event) => setSharedEnvImportText(event.target.value)}
	                    placeholder={"KEY_1=VALUE_1\nKEY_2=VALUE_2\nKEY_3=VALUE_3"}
	                    spellCheck={false}
	                    className="min-h-72 resize-y rounded-md border border-[rgba(94,234,212,0.34)] bg-[rgba(2,6,23,0.66)] p-4 font-mono text-sm text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.72)]"
	                  />
	                  <div className="flex flex-wrap items-center justify-between gap-3">
	                    <p className="m-0 text-xs text-[var(--muted)]">
	                      {sharedEnvImport.entries.length
	                        ? `${sharedEnvImportDiff.length} to set · ${sharedEnvImportNewCount} new · ${sharedEnvImportChangedCount} changed · ${sharedEnvImportSameCount} unchanged`
	                        : "Paste KEY=value lines to preview changes."}
	                      {sharedEnvImport.error ? ` ${sharedEnvImport.error}` : ""}
	                    </p>
	                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-[var(--accent-strong)] hover:bg-[rgba(94,234,212,0.10)]">
	                      Choose a file
	                      <FileUp aria-hidden="true" className="h-4 w-4" />
	                      <input
	                        type="file"
	                        accept=".env,text/plain"
	                        className="sr-only"
	                        onChange={async (event) => {
	                          const file = event.currentTarget.files?.[0];
	                          if (!file) return;
	                          setSharedEnvImportText(await file.text());
	                          event.currentTarget.value = "";
	                        }}
	                      />
	                    </label>
	                  </div>
	                  {sharedEnvImport.entries.length ? (
	                    <div className="max-h-48 overflow-auto rounded-md border border-[rgba(148,163,184,0.14)]">
	                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-[rgba(148,163,184,0.14)] px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
	                        <span>Key</span>
	                        <span>Status</span>
	                      </div>
	                      {sharedEnvImport.entries.map((entry) => (
	                        <div key={entry.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-xs">
	                          <code className="break-all text-[var(--foreground)]">{entry.key}</code>
	                          <span className={`rounded-full border px-2 py-1 font-bold ${entry.status === "same" ? "border-[rgba(148,163,184,0.18)] text-[var(--muted)]" : "border-[rgba(94,234,212,0.28)] text-[var(--accent-strong)]"}`}>
	                            {entry.status}
	                          </span>
	                        </div>
	                      ))}
	                    </div>
	                  ) : null}
	                </div>
		                <div className="flex flex-wrap items-center gap-3 border-t border-[rgba(148,163,184,0.14)] px-6 pb-12 pt-5">
		                  <Button type="button" size="sm" className="h-9 px-4 text-sm" onClick={() => void importSharedEnvEntries()} disabled={sharedEnvImporting || sharedEnvImportDiff.length === 0}>
		                    {sharedEnvImporting ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Check aria-hidden="true" />}
		                    Set variables
		                  </Button>
		                  <Button type="button" size="sm" variant="secondary" className="h-9 px-4 text-sm" onClick={() => setSharedEnvImportOpen(false)}>
		                    Cancel
		                  </Button>
	                </div>
	              </div>
	            </div>
	          ), portalTarget) : null}

	          <section className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="eyebrow">Not shared yet</p>
                <h3 className="m-0 text-base font-bold">Runtime-specific env</h3>
              </div>
              <div className={walletClass("walletSegmented")} role="tablist" aria-label="Runtime env source">
                {runtimeEnvSources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    role="tab"
                    aria-selected={selectedRuntimeEnvSource?.id === source.id}
                    className={walletClass("walletSegment", selectedRuntimeEnvSource?.id === source.id && "walletSegmentActive")}
                    onClick={() => setHiveEnvRuntimeSourceId(source.id)}
                  >
                    {source.label}
                  </button>
                ))}
              </div>
            </div>
            {selectedRuntimeEnvSource ? (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {Object.entries(selectedRuntimeEnvSource.values ?? {}).map(([key, value]) => {
                  const revealKey = `runtime:${selectedRuntimeEnvSource.id}:${key}`;
                  const saving = hiveEnvSavingKey === revealKey || hiveEnvSavingKey === `promote:${selectedRuntimeEnvSource.id}:${key}`;
                  return (
                    <EnvValueRow
                      key={key}
                      name={key}
                      value={value}
                      revealKey={revealKey}
                      revealed={Boolean(revealedEnvValues[revealKey])}
                      saving={saving}
                      onToggleReveal={toggleEnvValue}
                      onSave={(nextValue) => void saveSharedEnvValue(selectedRuntimeEnvSource, key, nextValue, value)}
                      onRemove={() => void saveSharedEnvValue(selectedRuntimeEnvSource, key, "", value)}
                      extraAction={(
                        <Button type="button" size="icon" variant="secondary" aria-label={`Add ${key} to shared env`} title="Add to shared env" onClick={() => void promoteRuntimeEnvValue(selectedRuntimeEnvSource, key, value)}>
                          <Upload aria-hidden="true" />
                        </Button>
                      )}
                    />
                  );
                })}
                {Object.keys(selectedRuntimeEnvSource.values ?? {}).length === 0 ? (
                  <p className="m-0 rounded-md border border-dashed border-[rgba(148,163,184,0.18)] p-3 text-xs text-[var(--muted)]">
                    No {selectedRuntimeEnvSource.label} env variables are outside the shared store.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="m-0 rounded-md border border-dashed border-[rgba(148,163,184,0.18)] p-3 text-xs text-[var(--muted)]">
                Press Refresh to inspect runtime-specific env.
              </p>
            )}
          </section>

          {runtimeManagedEnvAgents.length ? (
            <section className="grid gap-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="eyebrow">Runtime-managed env</p>
                  <h3 className="m-0 text-base font-bold">Secrets handled by adapter</h3>
                </div>
                <span className="rounded-full border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.55)] px-3 py-1 text-xs font-bold text-[var(--muted)]">
                  {runtimeManagedEnvAgents.length} agent{runtimeManagedEnvAgents.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
	                {runtimeManagedEnvAgents.map((agent, agentIndex) => {
	                  const feature = runtimeEnvFeature(agent.runtime);
	                  const manageAction = "manageAction" in feature ? feature.manageAction : undefined;
	                  const renderKey = renderAgentKey(agent, agentIndex);
	                  return (
                    <article key={renderKey} className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="eyebrow">{feature.label}</p>
                          <h4 className="m-0 text-sm font-bold text-[var(--foreground)]">{agent.name}</h4>
                        </div>
                        <span className="rounded-full border border-[rgba(94,234,212,0.20)] bg-[rgba(20,184,166,0.08)] px-3 py-1 text-xs font-bold text-[var(--accent-strong)]">
                          {agent.runtime}
                        </span>
                      </div>
                      <p className="m-0 text-xs leading-5 text-[var(--muted)]">{feature.description}</p>
                      {"localSources" in feature && feature.localSources.length ? (
                        <div className="grid gap-1">
                          {feature.localSources.map((source) => (
                            <div key={`${agent.id}:${source.path}`} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-[rgba(148,163,184,0.12)] bg-[rgba(2,6,23,0.36)] px-3 py-2">
                              <span className="text-xs text-[var(--muted)]">{source.label}</span>
                              <code className="break-all text-xs text-[var(--foreground)]">{source.path}</code>
                            </div>
                          ))}
                        </div>
                      ) : null}
	                      {manageAction ? (
	                        <Button type="button" size="sm" variant="secondary" className="w-fit" onClick={() => setActiveView(manageAction.view as DashboardView)}>
	                          <ShieldCheck aria-hidden="true" />
	                          {manageAction.label}
	                        </Button>
	                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="grid gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="eyebrow">Agent overlays</p>
                <h3 className="m-0 text-base font-bold">Specific to each agent</h3>
              </div>
              <span className="rounded-full border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.55)] px-3 py-1 text-xs font-bold text-[var(--muted)]">
                {agentSpecificEnvCount} variables
              </span>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {agentEnvOverlayAgents.map((agent, agentIndex) => {
                const renderKey = renderAgentKey(agent, agentIndex);
                const draft = agentEnvDrafts[agent.id] ?? { key: "", value: "" };
                const entries = Object.entries(agent.agentEnv ?? {}).sort(([left], [right]) => left.localeCompare(right));
                return (
                  <AgentEnvCard
                    key={renderKey}
                    agent={agent}
                    renderKey={renderKey}
                    entries={entries}
                    draft={draft}
                    runtimeModelSelection={runtimeModelSelectionsByRuntime[agent.runtime]}
                    revealedEnvValues={revealedEnvValues}
                    onToggleReveal={toggleEnvValue}
                    onSave={(key, value, previousValue) => saveAgentEnvValue(agent, key, value, previousValue)}
                    onRemove={(key, previousValue) => saveAgentEnvValue(agent, key, "", previousValue)}
                    onDraftChange={(nextDraft) => setAgentEnvDrafts((current) => ({ ...current, [agent.id]: nextDraft }))}
                    onAdd={() => addAgentEnvValue(agent)}
                  />
                );
              })}
              {!agentEnvOverlayAgents.length ? (
                <p className="m-0 rounded-md border border-dashed border-[rgba(148,163,184,0.18)] p-3 text-xs text-[var(--muted)]">
                  No runtime currently exposes profile env overlays.
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </section>
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
            <p className="eyebrow">Brain files</p>
            <h2>Scoped files</h2>
            <p>Browse allowlisted runtime roots, shared brain files, and HivemindOS state without exposing the whole filesystem.</p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => void refreshRuntimeFileRoots()}>
            <RefreshCcw aria-hidden="true" />
            Refresh
          </Button>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="grid content-start gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-3">
            <label className="grid gap-1 text-xs text-[var(--muted)]">
              Root
              <select
                value={runtimeFileRootKey}
                onChange={(event) => {
                  setRuntimeFileRootKey(event.target.value);
                  setRuntimeFilePath("");
                  setRuntimeFileOpen(null);
                  void listRuntimeFiles(event.target.value, "");
                }}
                className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] px-2 py-2 text-[var(--foreground)]"
              >
                {runtimeFileRoots.map((root) => <option value={root.key} key={root.key}>{root.label}</option>)}
              </select>
            </label>
            <div className="grid gap-2">
              {runtimeFilePath ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => {
                  const parent = runtimeFilePath.split("/").slice(0, -1).join("/");
                  void listRuntimeFiles(runtimeFileRootKey, parent);
                  setRuntimeFileOpen(null);
                }}>
                  <ChevronLeft aria-hidden="true" />
                  Parent
                </Button>
              ) : null}
              <small className="break-words text-[var(--muted)]">
                {runtimeFileRoots.find((root) => root.key === runtimeFileRootKey)?.path ?? "No root selected"}
              </small>
            </div>
            {runtimeFileStatus ? <p className="m-0 text-xs text-[var(--muted)]">{runtimeFileStatus}</p> : null}
          </aside>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            <div className="max-h-[620px] overflow-auto rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)]">
              {runtimeFiles.map((file) => (
                <button
                  type="button"
                  key={file.relativePath}
                  onClick={() => void openRuntimeFile(file)}
                  className="flex w-full items-start gap-2 border-b border-[rgba(148,163,184,0.08)] px-3 py-2 text-left text-xs hover:bg-[rgba(45,212,191,0.08)]"
                >
                  {file.type === "dir" ? <FolderOpen aria-hidden="true" className="mt-0.5 h-4 w-4 text-[var(--accent)]" /> : <FileText aria-hidden="true" className="mt-0.5 h-4 w-4 text-[var(--muted)]" />}
                  <span className="min-w-0">
                    <strong className="block break-words text-[var(--foreground)]">{file.name}</strong>
                    <small className="break-words text-[var(--muted)]">{file.type}{file.size ? ` · ${Math.round(file.size / 1024)} KB` : ""}</small>
                  </span>
                </button>
              ))}
              {runtimeFiles.length ? null : <p className="m-0 p-4 text-sm text-[var(--muted)]">No files loaded.</p>}
            </div>
            <section className="grid min-h-[460px] grid-rows-[auto_1fr_auto] gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-3">
              <div>
                <strong>{runtimeFileOpen?.name ?? "No file selected"}</strong>
                <p className="m-0 mt-1 break-words text-xs text-[var(--muted)]">{runtimeFileOpen?.relativePath ?? "Choose a text file to preview or edit."}</p>
              </div>
              <textarea
                value={runtimeFileDraft}
                onChange={(event) => setRuntimeFileDraft(event.target.value)}
                disabled={!runtimeFileOpen}
                className="min-h-[360px] resize-none rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.65)] p-3 font-mono text-xs text-[var(--foreground)]"
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={!runtimeFileOpen} onClick={() => setRuntimeFileDraft(runtimeFileOpen?.content ?? "")}>
                  <RotateCcw aria-hidden="true" />
                  Reset
                </Button>
                <Button type="button" size="sm" disabled={!runtimeFileOpen || !runtimeFileRoots.find((root) => root.key === runtimeFileRootKey)?.writable} onClick={() => void saveRuntimeFile()}>
                  <Check aria-hidden="true" />
                  Save
                </Button>
              </div>
            </section>
          </div>
        </div>
      </section>
      ) : null}

      <MemoryTelemetryPanel
        Activity={Activity}
        Button={Button}
        LoaderCircle={LoaderCircle}
        RefreshCcw={RefreshCcw}
        active={activeView === "memory"}
        fleetClass={fleetClass}
        formatRelativeTime={formatRelativeTime}
        memoryTelemetry={memoryTelemetry}
        memoryTelemetryLoading={memoryTelemetryLoading}
        refreshMemoryTelemetry={refreshMemoryTelemetry}
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
          onRefresh={refreshNotifications}
          onMarkAllRead={markAllNotificationsRead}
          onMarkRead={markNotificationRead}
          onOpenNotification={onOpenNotification}
          onUpdateSettings={updateNotificationSettings}
        />
      ) : null}

  </>);
}
