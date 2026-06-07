// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  BrainCircuit,
  Check,
  ChevronRight,
  Cpu,
  FolderOpen,
  KanbanSquare,
  MessageSquare,
  Minus,
  Pencil,
  Phone,
  PlugZap,
  Plus,
  Repeat2,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { AgentCallsSettingsPanel } from "./AgentCallsSettingsPanel";
import { AdaptiveProviderSettings } from "./AdaptiveProviderSettings";
import { BankrLowCreditSetup } from "./BankrLowCreditSetup";
import { GuidedProviderSetup } from "./GuidedProviderSetup";
import { GuidedUsePodSetup } from "./GuidedUsePodSetup";
import { MissingSharedEnvKeySetup } from "./MissingSharedEnvKeySetup";
import { ModelPillSelector } from "./ModelPillSelector";
import { selectBestRuntimeModel } from "./runtime-model-registry";
import { AeonOrb, Btn, Eyebrow, Pill, aeonStyles as styles } from "@/components/aeon/parts";
import { WorkspaceModal } from "@/components/aeon";
import { MODEL_PROVIDER_GATEWAYS } from "@/lib/config/model-provider-gateways";
import type { AgentRuntime } from "@/lib/types/agent-runtime";
import { defaultAgentNameForRuntime, runtimeSettingsFeature } from "@/lib/types/agent-runtime";

const USEPOD_PROVIDER = MODEL_PROVIDER_GATEWAYS.usepod;
const BANKR_LLM_BASE_URL = "https://llm.bankr.bot";
const BANKR_LLM_CHAT_PATH = "/v1/chat/completions";
const BANKR_LLM_MODELS_PATH = "/v1/models";

const PANEL_ICONS = {
  role: Sparkles,
  connection: PlugZap,
  memory: BrainCircuit,
  tools: Settings2,
  calls: Phone,
  security: ShieldCheck,
};

const PANEL_LABELS = {
  role: "Role",
  connection: "Connection",
  memory: "Memory",
  tools: "Tools",
  calls: "Calls",
  security: "Security",
};

const PANEL_DETAILS = {
  role: "Runtime & behaviour",
  connection: "AEON setup",
  memory: "Brain & folders",
  tools: "Runtime integrations",
  calls: "Scheduled phone calls",
  security: "Guards & redaction",
};

const inputStyle = {
  width: "100%",
  minWidth: 0,
  border: "1px solid var(--line-2)",
  borderRadius: 9,
  background: "rgba(2,6,23,0.48)",
  color: "var(--fg)",
  fontFamily: "var(--f-body)",
  fontSize: 13,
  outline: "none",
  padding: "9px 12px",
};

function titleCaseId(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function panelTitle(panel: string) {
  return PANEL_LABELS[panel] ?? titleCaseId(panel);
}

function panelDetail(panel: string) {
  return PANEL_DETAILS[panel] ?? "";
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{ display: "grid", gap: 6, ...style }}>
      <span style={{ color: "var(--fg-3)", fontSize: 12, fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />;
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} style={{ ...inputStyle, minHeight: 92, resize: "vertical", lineHeight: 1.5, ...(props.style || {}) }} />;
}

function PanelHead({ eyebrow, title, sub, action }: { eyebrow: string; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
      <div style={{ minWidth: 0 }}>
        <Eyebrow color="var(--cyan-2)">{eyebrow}</Eyebrow>
        <h3 style={{ margin: "4px 0 3px", color: "var(--fg)", fontFamily: "var(--f-display)", fontSize: 17, fontWeight: 700 }}>{title}</h3>
        {sub ? <p style={{ maxWidth: 520, margin: 0, color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.5 }}>{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className={styles.monoCap} style={{ color: "var(--fg-4)", marginBottom: 9 }}>{children}</div>;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      className={styles.interactiveSubtle}
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        width: 38,
        height: 22,
        flex: "0 0 auto",
        border: `1px solid ${checked ? "var(--aeon-line)" : "var(--line-2)"}`,
        borderRadius: 999,
        background: checked ? "rgba(94,234,212,0.34)" : "rgba(2,6,23,0.58)",
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: 999,
          background: checked ? "var(--aeon)" : "var(--fg-4)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          transition: "left 160ms ease",
        }}
      />
    </button>
  );
}

function ToggleRow({ label, sub, checked, onChange, icon: RowIcon }: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon?: React.ComponentType<any>;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 14px",
      borderRadius: 11,
      border: `1px solid ${checked ? "var(--aeon-line)" : "var(--line)"}`,
      background: checked ? "var(--aeon-soft)" : "var(--panel-bg-soft)",
    }}>
      {RowIcon ? <RowIcon size={17} style={{ color: checked ? "var(--cyan-2)" : "var(--fg-4)", flex: "0 0 auto" }} aria-hidden="true" /> : null}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: "var(--fg)", fontSize: 13.5, fontWeight: 700 }}>{label}</div>
        {sub ? <div style={{ marginTop: 2, color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.45 }}>{sub}</div> : null}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function ProviderDiscoverySkeleton({ runtimeLabel }: { runtimeLabel: string }) {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className={styles.sheen}
          role={index === 0 ? "status" : undefined}
          aria-live={index === 0 ? "polite" : undefined}
          aria-label={index === 0 ? `Discovering ${runtimeLabel} providers` : undefined}
          style={{
            display: "grid",
            gap: 6,
            minHeight: 62,
            padding: "9px 10px",
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "var(--panel-bg-soft)",
            overflow: "hidden",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                border: "1px solid var(--aeon-line)",
                background: "linear-gradient(135deg, rgba(94,234,212,0.18), rgba(2,6,23,0.42))",
                flex: "0 0 auto",
              }}
            />
            <span style={{ display: "grid", gap: 5, minWidth: 0, flex: 1 }}>
              <span style={{ width: `${78 - index * 10}%`, height: 9, borderRadius: 999, background: "rgba(198,209,223,0.18)" }} />
              {index === 0 ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg-4)", fontSize: 10.5, lineHeight: 1.2 }}>
                  Discovering
                  <span className={styles.eq} aria-hidden="true" style={{ height: 10 }}><i /><i /><i /><i /></span>
                </span>
              ) : (
                <span style={{ width: `${46 + index * 8}%`, height: 7, borderRadius: 999, background: "rgba(142,155,177,0.14)" }} />
              )}
            </span>
          </span>
          <span style={{ width: `${54 + index * 8}%`, height: 7, borderRadius: 999, background: "rgba(142,155,177,0.12)" }} />
        </div>
      ))}
    </>
  );
}

function iconMark({
  label,
  iconPath,
  iconMode,
  fallback,
  size = 30,
}: {
  label: string;
  iconPath?: string;
  iconMode?: string;
  fallback?: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        border: "1px solid var(--line)",
        borderRadius: 8,
        background: "rgba(2,6,23,0.42)",
        color: "var(--cyan-2)",
        overflow: "hidden",
      }}
    >
      {iconPath ? (
        <span
          style={iconMode === "mask"
            ? { width: size - 10, height: size - 10, background: "currentColor", WebkitMask: `url(${iconPath}) center / contain no-repeat`, mask: `url(${iconPath}) center / contain no-repeat` }
            : { width: size - 6, height: size - 6, borderRadius: 6, background: `url(${iconPath}) center / contain no-repeat` }}
        />
      ) : (
        <b style={{ fontSize: 9, fontWeight: 900, lineHeight: 1 }}>{fallback || label.slice(0, 2).toUpperCase()}</b>
      )}
    </span>
  );
}

function hasUsePodSetup(config = {}) {
  return Boolean(
    config.tokenEnvName
      || config.depositAddress
      || config.depositCode
      || config.dashboardUrl
      || config.lastBalanceRemaining
      || config.lastRoute
      || config.lastCheckedAt
      || typeof config.lastModelCount === "number",
  );
}

function isUsePodSetupReady(config = {}) {
  return config.lastTestStatus === "ready";
}

export function AgentSettingsModal(props: any) {
  const {
    BEE_WORKER_PRESET_LIST,
    Button,
    HERMES_UPDATE_INTEGRATION_KEYS,
    LoaderCircle: LoaderCircleIcon,
    PlugZap: PlugZapIcon,
    RUNTIME_LABELS,
    RefreshCcw: RefreshCcwIcon,
    Send: SendIcon,
    addHermesModelFromDraft,
    agentCreateDraft,
    agentCreateMachine,
    agentRuntimeFolderBrowsing,
    agentRuntimeFolderEditing,
    agentRuntimeFolderStatus,
    agentSettingsCustomWorker,
    agentSettingsCustomWorkers,
    agentSettingsIntegrationTarget,
    agentSettingsPanel,
    agentSettingsPreferredSkills,
    agentSettingsProvider,
    agentSettingsRuntime,
    agentSettingsSelectedCustomWorkerId,
    agentSettingsSkillProfile,
    agentSettingsTitle,
    agentSettingsWorkerClass,
    agentSettingsWorkerImage,
    agentSettingsWorkerLabel,
    agentSettingsWorkerPreset,
    agentWorkerClassView,
    applyCustomWorkerClass,
    beeRoleIconPath,
    browseAgentRuntimeFolder,
    chooseDirectoryForMachine,
    closeAgentSettingsModal,
    createAgentFromModal,
    customWorkerDraft,
    customWorkerImageError,
    customWorkerImageInputRef,
    customWorkerSkillSearch,
    displayAgents,
    filteredCustomWorkerSkills,
    fleetClass,
    hermesUpdateRequired,
    machineGroups,
    onAeonWorkspaceCreated,
    openAgentSkillBrowser,
    openCustomWorkerClassCreator,
    providerIconPath,
    providerIconRenderMode,
    refreshRuntimeIntegrations,
    removeAgentPreferredSkill,
    roleModalAgent,
    runtimeAvailability,
    runtimeCapabilities,
    runtimeIconFallback,
    runtimeIconPath,
    runtimeIconRenderMode,
    runtimeIntegrationBusy,
    runtimeIntegrationMessage,
    runtimeIntegrationStatus,
    runtimeModelDraft,
    runtimeModelProviders,
    runtimeModelSelectionsByRuntime,
    runtimeModelSelectionFresh,
    runtimeModelSetupMode,
    runtimeSessionQuery,
    runtimeSessionResults,
    searchRuntimeSessionsForAgent,
    selectAgentWorkerClass,
    selectCustomWorkerClass,
    selectedRuntimeModelId,
    selectedRuntimeModels,
    selectedRuntimeProvider,
    setAgentCreateDraft,
    setAgentRuntimeFolderEditing,
    setAgentRuntimeFolderStatus,
    setAgentSettingsPanel,
    setAgentWorkerClassView,
    setCustomWorkerDraft,
    setCustomWorkerSkillSearch,
    setRuntimeModelDraft,
    setRuntimeModelSetupMode,
    setRuntimeSessionQuery,
    sharedVault,
    toggleCustomWorkerSkill,
    updateAgentProfile,
    updateAgentRuntimeModel,
    updateAgentSkillProfile,
    uploadCustomWorkerImage,
    workerCapabilityBadges,
  } = props;

  const [aeonOauthConnecting, setAeonOauthConnecting] = useState(false);
  const [aeonWorkspaceOpen, setAeonWorkspaceOpen] = useState(false);
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const modalOpen = Boolean(portalTarget && (roleModalAgent || agentCreateMachine));

  const activeRuntime = (agentSettingsRuntime || "hermes") as AgentRuntime;
  const runtimeSettings = runtimeSettingsFeature(activeRuntime);
  const activePanels = agentCreateMachine ? runtimeSettings.createPanels : runtimeSettings.editPanels;
  const activePanel = activePanels.includes(agentSettingsPanel) ? agentSettingsPanel : activePanels[0];
  const isAutopilotSettings = runtimeSettings.kind === "autopilot";
  const runtimeLabel = RUNTIME_LABELS[activeRuntime] ?? activeRuntime;
  const selectedProviderSlug = agentSettingsProvider || selectedRuntimeProvider?.slug || "";
  const openRouterSelected = selectedProviderSlug === "openrouter";
  const usePodSelected = selectedProviderSlug === "usepod";
  const bankrLlmSelected = selectedProviderSlug === "bankr";
  const adaptiveProviderSelected = selectedProviderSlug === "adaptive";
  const defaultNameForRuntime = (runtime: AgentRuntime, provider = "") => defaultAgentNameForRuntime(displayAgents ?? [], runtime, RUNTIME_LABELS, { provider });
  const currentName = agentCreateMachine ? agentCreateDraft.name : roleModalAgent?.name ?? "";
  const displayName = currentName || defaultNameForRuntime(activeRuntime, selectedProviderSlug);
  const adaptiveOpenRouterSelected = openRouterSelected && selectedRuntimeModelId === "adaptive";
  const adaptiveOpenRouter = agentCreateMachine ? agentCreateDraft.adaptiveOpenRouter ?? {} : roleModalAgent?.adaptiveOpenRouter ?? {};
  const adaptiveRouting = agentCreateMachine ? agentCreateDraft.adaptiveRouting ?? {} : roleModalAgent?.adaptiveRouting ?? {};
  const usePodConfig = agentCreateMachine ? agentCreateDraft.usePod ?? {} : roleModalAgent?.usePod ?? {};
  const usePodSetupStarted = hasUsePodSetup(usePodConfig);
  const usePodSetupComplete = isUsePodSetupReady(usePodConfig);
  const usePodCreateBlocked = Boolean(agentCreateMachine && usePodSelected && !usePodSetupComplete);
  const existingUsePodAgents = (displayAgents ?? []).filter((agent) => agent.provider === "usepod" && hasUsePodSetup(agent.usePod));
  const unfinishedUsePodAgent = agentCreateMachine && !usePodSetupStarted
    ? existingUsePodAgents.find((agent) => !isUsePodSetupReady(agent.usePod)) ?? null
    : null;
  const completedUsePodWallets = unfinishedUsePodAgent
    ? []
    : existingUsePodAgents.filter((agent) => isUsePodSetupReady(agent.usePod));
  const usePodDraftSetupTarget = agentCreateMachine
    ? {
      id: "new-usepod-draft",
      name: displayName,
      provider: "usepod",
      model: agentCreateDraft.model,
      usePod: agentCreateDraft.usePod,
    }
    : null;
  const usePodSetupTarget = unfinishedUsePodAgent ?? usePodDraftSetupTarget ?? agentSettingsIntegrationTarget;
  const usePodRequiresCurrentSetup = usePodSetupStarted || Boolean(unfinishedUsePodAgent);
  const modelSelectableRuntime = Boolean(runtimeCapabilities(agentSettingsIntegrationTarget ?? roleModalAgent)?.modelSelection);
  const hasRuntimeProviders = runtimeModelProviders.length > 0;
  const runtimeCanAddModels = Boolean(runtimeSettings.canAddModels);
  const runtimeCanAddGatewayProviders = runtimeSettings.modelSource === "runtime" && modelSelectableRuntime && activeRuntime !== "aeon";
  const runtimeCanAddCustomModel = runtimeCanAddModels && hasRuntimeProviders;
  const runtimeModelOptions = adaptiveProviderSelected
    ? [{ id: "best-free", name: "Best free" }]
    : openRouterSelected
    ? [{ id: "adaptive", name: "Adaptive" }, ...selectedRuntimeModels.filter((model) => model.id !== "adaptive")]
    : selectedRuntimeModels;
  const runtimeModelProviderSlug = selectedProviderSlug;
  const bankrSetupRequired = bankrLlmSelected && selectedRuntimeModels.length === 0;
  const bankrSetupDetail = runtimeIntegrationStatus?.diagnostics?.find((item) => /Bankr LLM models unavailable/i.test(item)) ?? "";
  const bankrMissingKey = /BANKR_LLM_KEY.*(not configured|required|missing)|missing.*BANKR_LLM_KEY/i.test(bankrSetupDetail);
  const bankrLowCredits = /insufficient_credits|credits exhausted|402|balance|fund/i.test(bankrSetupDetail);
  const runtimeModelPanelAvailable = runtimeSettings.modelSource === "runtime" && (
    runtimeModelProviders.length > 0
      || modelSelectableRuntime
      || runtimeIntegrationBusy === "status"
      || Boolean(runtimeIntegrationMessage)
  );
  const showProviderDiscovery = !runtimeModelProviders.length && !runtimeCanAddGatewayProviders && modelSelectableRuntime && !usePodSelected && !bankrLlmSelected && !adaptiveProviderSelected && !runtimeModelSelectionFresh && !runtimeIntegrationMessage;
  const hideRuntimeSection = !agentCreateMachine && Boolean(runtimeSettings.hidesRuntimeSelectorWhenEditing);
  const showWorkerClassSection = !isAutopilotSettings && !(usePodSelected && !usePodSetupComplete);
  const agentStatus = agentCreateMachine ? "New profile" : roleModalAgent?.telemetryUrl ? "Connected" : "Local profile";
  const workerSubtitle = (agentSettingsCustomWorker?.label || agentSettingsWorkerPreset?.label || agentSettingsWorkerLabel || "")
    .replace(/\s+bee$/i, "")
    .trim();
  const aeonSettings = {
    mode: agentCreateMachine ? agentCreateDraft.aeonMode || "github" : roleModalAgent?.aeonMode || "github",
    repo: agentCreateMachine ? agentCreateDraft.aeonRepo || "" : roleModalAgent?.aeonRepo || "",
    branch: agentCreateMachine ? agentCreateDraft.aeonBranch || "main" : roleModalAgent?.aeonBranch || "main",
    path: agentCreateMachine ? agentCreateDraft.aeonLocalPath || "~/.aeon" : roleModalAgent?.aeonLocalPath || roleModalAgent?.localDataDir || "",
    a2aUrl: agentCreateMachine ? agentCreateDraft.a2aUrl || "http://127.0.0.1:41241" : roleModalAgent?.a2aUrl || roleModalAgent?.gatewayUrl || "http://127.0.0.1:41241",
  };

  useEffect(() => {
    if (!modalOpen || !runtimeModelPanelAvailable || !selectedRuntimeProvider || usePodSelected || bankrLlmSelected || adaptiveProviderSelected || runtimeIntegrationBusy) return;
    const currentModel = agentCreateMachine ? agentCreateDraft.model : roleModalAgent?.model;
    const currentModelValid = currentModel === "adaptive" && selectedRuntimeProvider.slug === "openrouter"
      || selectedRuntimeModels.some((model) => model.id === currentModel);
    if (currentModelValid) return;
    const bestModel = selectBestRuntimeModel(selectedRuntimeProvider, {
      defaultModel: runtimeSettings.defaultModel,
      runtimeSelectedModel: runtimeModelSelectionsByRuntime?.[activeRuntime]?.model,
      preferAdaptive: true,
    });
    if (!bestModel) return;
    updateAgentRuntimeModel(bestModel === "adaptive" ? "openrouter" : selectedRuntimeProvider.slug, bestModel);
  }, [
    activeRuntime,
    agentCreateDraft.model,
    agentCreateMachine,
    modalOpen,
    roleModalAgent?.model,
    runtimeIntegrationBusy,
    runtimeModelPanelAvailable,
    runtimeModelSelectionsByRuntime,
    runtimeSettings.defaultModel,
    selectedRuntimeModels,
    selectedRuntimeProvider,
    updateAgentRuntimeModel,
    adaptiveProviderSelected,
    bankrLlmSelected,
    usePodSelected,
  ]);

  if (!modalOpen) return null;

  const runtimeFolderValue = roleModalAgent
    ? isAutopilotSettings
      ? roleModalAgent.aeonLocalPath || roleModalAgent.localDataDir || ""
      : roleModalAgent.localDataDir || ""
    : "";

  const updateName = (name: string) => {
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, name }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { name });
  };

  const updateAeonSettings = (patch: Record<string, unknown>) => {
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => ({ ...current, ...patch }));
      return;
    }
    if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
  };

  const updateAdaptiveOpenRouter = (patch: Record<string, unknown>) => {
    const next = { ...adaptiveOpenRouter, ...patch };
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, adaptiveOpenRouter: next }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { adaptiveOpenRouter: next });
  };

  const updateAdaptiveRouting = (patch: Record<string, unknown>) => {
    const next = { ...adaptiveRouting, ...patch };
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, adaptiveRouting: next }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { adaptiveRouting: next });
  };

  const applyUsePodProfile = async (patch: Record<string, unknown>) => {
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, ...patch }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
    await refreshRuntimeIntegrations({ ...(agentSettingsIntegrationTarget ?? {}), ...patch });
  };

  const applyUsePodSetupProfile = async (patch: Record<string, unknown>) => {
    if (agentCreateMachine && unfinishedUsePodAgent) {
      updateAgentProfile(unfinishedUsePodAgent.id, patch);
      await refreshRuntimeIntegrations({ ...unfinishedUsePodAgent, ...patch });
      return;
    }
    await applyUsePodProfile(patch);
  };

  const openAeonGithubOauth = () => {
    if (aeonOauthConnecting) return;
    setAeonOauthConnecting(true);
    updateAeonSettings({ aeonMode: "github" });
    requestAnimationFrame(() => {
      window.location.assign("/api/integrations/github/oauth/start?source=aeon");
    });
  };

  const updateSettingsRuntime = (runtime: AgentRuntime) => {
    if (runtime !== "aeon" && runtimeAvailability?.[runtime]?.installed === false) return;
    setRuntimeModelSetupMode(null);
    const sameRuntime = runtime === activeRuntime;
    const currentProvider = agentCreateMachine ? agentCreateDraft.provider : roleModalAgent?.provider;
    const currentModel = agentCreateMachine ? agentCreateDraft.model : roleModalAgent?.model;
    const aeonWorkerPreset = BEE_WORKER_PRESET_LIST.find((preset) => preset.id === "ops");
    const nextSettings = runtimeSettingsFeature(runtime);
    const providerModels = runtime === activeRuntime ? runtimeModelProviders : runtimeModelSelectionsByRuntime?.[runtime]?.providers ?? [];
    const provider = sameRuntime
      ? currentProvider || nextSettings.defaultProvider || ""
      : nextSettings.defaultProvider || "";
    const runtimeProvider = providerModels.find((modelProvider) => modelProvider.slug === provider)
      ?? providerModels.find((modelProvider) => modelProvider.slug === nextSettings.defaultProvider)
      ?? providerModels[0];
    const model = selectBestRuntimeModel(runtimeProvider, {
      currentModel: sameRuntime ? currentModel : undefined,
      defaultModel: nextSettings.defaultModel,
      runtimeSelectedModel: runtimeModelSelectionsByRuntime?.[runtime]?.model,
      preferAdaptive: true,
    });
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => ({
        ...current,
        runtime,
        provider,
        model,
        name: current.name.trim()
          && current.name !== `${RUNTIME_LABELS[current.runtime] ?? current.runtime} on ${agentCreateMachine.name}`
          && current.name !== defaultNameForRuntime(current.runtime, current.provider)
          ? current.name
          : defaultNameForRuntime(runtime, provider),
        ...(nextSettings.kind === "autopilot" && aeonWorkerPreset ? {
          workerClass: aeonWorkerPreset.id,
          skillProfilePrompt: aeonWorkerPreset.taskProfile,
          preferredSkillSlugs: aeonWorkerPreset.skillSlugs,
          aeonLocalPath: current.aeonLocalPath || "~/.aeon",
          aeonRepo: current.aeonRepo || "",
          aeonBranch: current.aeonBranch || "main",
          aeonMode: current.aeonMode || "github",
          a2aUrl: current.a2aUrl || "http://127.0.0.1:41241",
        } : {}),
      }));
      return;
    }
    if (roleModalAgent) {
      updateAgentProfile(roleModalAgent.id, {
        runtime,
        provider,
        model,
        ...(nextSettings.kind === "autopilot" ? {
          agentId: roleModalAgent.agentId || nextSettings.defaultAgentId || "",
          localDataDir: roleModalAgent.localDataDir || "~/.aeon",
          aeonLocalPath: roleModalAgent.aeonLocalPath || roleModalAgent.localDataDir || "~/.aeon",
          aeonBranch: roleModalAgent.aeonBranch || "main",
          aeonMode: roleModalAgent.aeonMode || "github",
          a2aUrl: roleModalAgent.a2aUrl || "http://127.0.0.1:41241",
        } : {}),
      });
    }
  };

  const selectUsePodProvider = () => {
    const currentModel = agentCreateMachine ? agentCreateDraft.model : roleModalAgent?.model;
    const model = currentModel && currentModel !== "adaptive" ? currentModel : USEPOD_PROVIDER.defaultModel;
    const nextUsePod = {
      tokenEnvName: usePodConfig.tokenEnvName || "USEPOD_TOKEN",
      depositAddress: usePodConfig.depositAddress || "",
      depositCode: usePodConfig.depositCode || "",
      dashboardUrl: usePodConfig.dashboardUrl || "",
      maxPriceInputMicrounits: usePodConfig.maxPriceInputMicrounits || "2000",
      maxPriceOutputMicrounits: usePodConfig.maxPriceOutputMicrounits || "8000",
      spendPreset: usePodConfig.spendPreset || "balanced",
      lastBalanceRemaining: usePodConfig.lastBalanceRemaining || "",
      lastRoute: usePodConfig.lastRoute || "",
      lastCheckedAt: usePodConfig.lastCheckedAt || "",
      lastTestStatus: usePodConfig.lastTestStatus || "",
      lastModelCount: usePodConfig.lastModelCount,
    };
    const patch = {
      provider: "usepod",
      model,
      ...(activeRuntime === "openai-compatible" ? {
        gatewayUrl: "https://api.usepod.ai",
        chatPath: "/v1/chat/completions",
        statusPath: "/v1/models",
      } : {}),
      usePod: nextUsePod,
    };
    updateAgentRuntimeModel("usepod", model);
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => ({
        ...current,
        ...patch,
        name: current.name.trim()
          && current.name !== `${RUNTIME_LABELS[current.runtime] ?? current.runtime} on ${agentCreateMachine.name}`
          && current.name !== defaultNameForRuntime(current.runtime, current.provider)
          ? current.name
          : defaultNameForRuntime(current.runtime, "usepod"),
      }));
      setRuntimeModelSetupMode(null);
      return;
    }
    if (roleModalAgent) {
      updateAgentProfile(roleModalAgent.id, patch);
      setRuntimeModelSetupMode(null);
    }
  };

  const selectBankrLlmProvider = () => {
    const currentModel = agentCreateMachine ? agentCreateDraft.model : roleModalAgent?.model;
    const bankrProvider = runtimeModelProviders.find((provider) => provider.slug === "bankr");
    const bankrModels = bankrProvider?.models.map((modelOption) => modelOption.id) ?? [];
    const model = currentModel && bankrModels.includes(currentModel) ? currentModel : bankrModels[0] || "";
    const patch = {
      provider: "bankr",
      model,
      ...(activeRuntime === "openai-compatible" ? {
        gatewayUrl: BANKR_LLM_BASE_URL,
        chatPath: BANKR_LLM_CHAT_PATH,
        statusPath: BANKR_LLM_MODELS_PATH,
        token: "",
      } : {}),
    };
    updateAgentRuntimeModel("bankr", model);
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => ({
        ...current,
        ...patch,
        name: current.name.trim()
          && current.name !== `${RUNTIME_LABELS[current.runtime] ?? current.runtime} on ${agentCreateMachine.name}`
          && current.name !== defaultNameForRuntime(current.runtime, current.provider)
          ? current.name
          : defaultNameForRuntime(current.runtime, "bankr"),
      }));
      setRuntimeModelSetupMode(null);
      void refreshRuntimeIntegrations({ ...(agentSettingsIntegrationTarget ?? {}), ...patch });
      return;
    }
    if (roleModalAgent) {
      updateAgentProfile(roleModalAgent.id, patch);
      setRuntimeModelSetupMode(null);
      void refreshRuntimeIntegrations({ ...roleModalAgent, ...patch });
    }
  };

  const selectAdaptiveProvider = () => {
    const patch = {
      provider: "adaptive",
      model: "best-free",
      adaptiveRouting: {
        mode: adaptiveRouting.mode || "best-free",
        useCase: adaptiveRouting.useCase || "auto",
        enabledRuntimes: adaptiveRouting.enabledRuntimes?.length ? adaptiveRouting.enabledRuntimes : ["hermes", "openai-compatible"],
        disabledProviders: adaptiveRouting.disabledProviders ?? [],
      },
    };
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => ({
        ...current,
        ...patch,
        name: current.name.trim()
          && current.name !== `${RUNTIME_LABELS[current.runtime] ?? current.runtime} on ${agentCreateMachine.name}`
          && current.name !== defaultNameForRuntime(current.runtime, current.provider)
          ? current.name
          : defaultNameForRuntime(current.runtime, "adaptive"),
      }));
      return;
    }
    if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
  };

  const renderRuntimeCard = (runtime: string, label: string) => {
    const selected = runtime === activeRuntime;
    const runtimeFeature = runtimeSettingsFeature(runtime as AgentRuntime);
    const unavailable = runtimeAvailability?.[runtime]?.installed === false;
    const disabled = unavailable && runtimeFeature.kind !== "autopilot";
    const detail = runtimeFeature.kind === "autopilot"
      ? runtimeFeature.runtimeSegmentSubcopy || runtimeAvailability?.[runtime]?.detail || "Autopilot"
      : unavailable ? "Not configured" : "Configured";
    const iconPath = runtimeIconPath(runtime);
    return (
      <button
        className={styles.interactive}
        type="button"
        key={runtime}
        aria-pressed={selected}
        disabled={disabled}
        title={runtimeAvailability?.[runtime]?.detail}
        onClick={() => updateSettingsRuntime(runtime as AgentRuntime)}
        style={{
          display: "grid",
          gap: 5,
          minHeight: 62,
          alignContent: "start",
          textAlign: "left",
          padding: "9px 10px",
          borderRadius: 10,
          opacity: disabled ? 0.52 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
          border: `1px solid ${selected ? "var(--aeon-line)" : "var(--line)"}`,
          background: selected ? "var(--aeon-soft)" : "var(--panel-bg-soft)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {iconMark({ label, iconPath, iconMode: runtimeIconRenderMode(runtime), fallback: runtimeIconFallback(runtime, label), size: 26 })}
          <strong style={{ color: selected ? "var(--cyan-3)" : "var(--fg)", fontSize: 13, lineHeight: 1.2, overflowWrap: "anywhere" }}>{label}</strong>
        </span>
        <small style={{ color: "var(--fg-4)", fontSize: 10.5, lineHeight: 1.3, overflowWrap: "anywhere" }}>{detail}</small>
      </button>
    );
  };

  const renderProviderModelPanel = () => {
    if (usePodSelected) {
      return (
        <div style={{ display: "grid", gap: 12 }}>
          <GroupLabel>UsePod setup</GroupLabel>
          <div className={fleetClass("agentRuntimeModelSetup", "agentRuntimeModelSetupProvider")}>
            <GuidedUsePodSetup
              key={usePodSetupTarget?.id ?? "new-usepod"}
              agent={usePodSetupTarget}
              busy={runtimeIntegrationBusy}
              existingWallets={completedUsePodWallets}
              fleetClass={fleetClass}
              requireCurrentSetup={usePodRequiresCurrentSetup}
              recoverSavedSetup={!agentCreateMachine}
              onCancel={() => setRuntimeModelSetupMode(null)}
              onComplete={applyUsePodSetupProfile}
            />
          </div>
        </div>
      );
    }
    if (!runtimeModelPanelAvailable) return null;
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <GroupLabel>Provider</GroupLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 168px))", gap: 7, alignItems: "stretch" }}>
            <button
              className={styles.interactive}
              type="button"
              aria-pressed={adaptiveProviderSelected}
              onClick={selectAdaptiveProvider}
              style={{
                display: "grid",
                gap: 5,
                padding: "9px 10px",
                minHeight: 62,
                borderRadius: 10,
                border: `1px solid ${adaptiveProviderSelected ? "var(--aeon-line)" : "var(--line)"}`,
                background: adaptiveProviderSelected ? "var(--aeon-soft)" : "var(--panel-bg-soft)",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {iconMark({ label: "Adaptive", fallback: "AD", size: 26 })}
                <strong style={{ color: adaptiveProviderSelected ? "var(--cyan-3)" : "var(--fg)", fontSize: 13, lineHeight: 1.2 }}>Adaptive</strong>
              </span>
              <small style={{ color: "var(--fg-4)", fontSize: 10.5, lineHeight: 1.3 }}>Best free route</small>
            </button>
            {runtimeModelProviders.map((provider) => {
              const selected = provider.slug === selectedProviderSlug;
              const bestProviderModel = selectBestRuntimeModel(provider, {
                defaultModel: runtimeSettings.defaultModel,
                runtimeSelectedModel: runtimeModelSelectionsByRuntime?.[activeRuntime]?.model,
                preferAdaptive: true,
              });
              const selectProvider = provider.slug === "usepod"
                ? selectUsePodProvider
                : provider.slug === "bankr"
                  ? selectBankrLlmProvider
                  : () => updateAgentRuntimeModel(bestProviderModel === "adaptive" ? "openrouter" : provider.slug, bestProviderModel);
              return (
                <button
                  className={styles.interactive}
                  type="button"
                  key={provider.slug}
                  aria-pressed={selected}
                  onClick={selectProvider}
                  style={{
                    display: "grid",
                    gap: 5,
                    padding: "9px 10px",
                    minHeight: 62,
                    borderRadius: 10,
                    border: `1px solid ${selected ? "var(--aeon-line)" : "var(--line)"}`,
                    background: selected ? "var(--aeon-soft)" : "var(--panel-bg-soft)",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    {iconMark({
                      label: provider.name,
                      iconPath: MODEL_PROVIDER_GATEWAYS[provider.slug]?.iconPath ?? providerIconPath(provider),
                      iconMode: MODEL_PROVIDER_GATEWAYS[provider.slug]?.iconMode ?? providerIconRenderMode(provider),
                      fallback: MODEL_PROVIDER_GATEWAYS[provider.slug]?.fallback,
                      size: 26,
                    })}
                    <strong style={{ color: selected ? "var(--cyan-3)" : "var(--fg)", fontSize: 13, lineHeight: 1.2, overflowWrap: "anywhere" }}>{provider.name}</strong>
                  </span>
                  <small style={{ color: "var(--fg-4)", fontSize: 10.5, lineHeight: 1.3 }}>{provider.totalModels} model{provider.totalModels === 1 ? "" : "s"}</small>
                </button>
              );
            })}
            {showProviderDiscovery ? (
              <ProviderDiscoverySkeleton runtimeLabel={runtimeLabel} />
            ) : !runtimeModelProviders.length ? (
              <div style={{ display: "grid", alignContent: "center", minHeight: 62, padding: "9px 10px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel-bg-soft)", color: "var(--fg-3)", fontSize: 11.5, lineHeight: 1.35 }}>
                {runtimeIntegrationMessage || `Add a provider, or refresh ${runtimeLabel} models from this machine.`}
              </div>
            ) : null}
            {runtimeCanAddModels ? (
              <button
                className={styles.interactive}
                type="button"
                onClick={() => setRuntimeModelSetupMode((current) => current === "provider" ? null : "provider")}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 62, padding: "9px 10px", borderRadius: 10, border: "1px dashed var(--aeon-line)", background: "transparent", color: "var(--cyan-3)", cursor: "pointer", fontSize: 13, fontWeight: 700 }}
              >
                <Plus size={15} aria-hidden="true" /> Add provider
              </button>
            ) : null}
          </div>
        </div>
        {bankrSetupRequired && bankrMissingKey ? (
          <MissingSharedEnvKeySetup
            apiKeyName="BANKR_LLM_KEY"
            providerLabel="Bankr LLM"
            detail={bankrSetupDetail}
            onSaved={() => refreshRuntimeIntegrations(agentSettingsIntegrationTarget ?? undefined)}
          />
        ) : bankrSetupRequired && bankrLowCredits ? (
          <BankrLowCreditSetup
            diagnostic={bankrSetupDetail}
            onFunded={() => refreshRuntimeIntegrations(agentSettingsIntegrationTarget ?? undefined)}
          />
        ) : bankrSetupRequired ? (
          <div style={{ display: "grid", gap: 10, border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel-bg-soft)", padding: 13 }}>
            <GroupLabel>Bankr setup</GroupLabel>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.45 }}>
              <ShieldCheck size={18} color="var(--cyan-3)" aria-hidden="true" />
              <div>
                <strong style={{ display: "block", color: "var(--fg)", fontSize: 13 }}>No live Bankr models found</strong>
                <span>Configure `BANKR_LLM_KEY` with funded Bankr LLM access, then reload providers.</span>
                {bankrSetupDetail ? <span style={{ display: "block", marginTop: 5 }}>{bankrSetupDetail}</span> : null}
              </div>
            </div>
            <Btn variant="ghost" disabled={Boolean(runtimeIntegrationBusy)} onClick={() => void refreshRuntimeIntegrations(agentSettingsIntegrationTarget ?? undefined)}>
              <Repeat2 size={14} aria-hidden="true" /> Reload providers
            </Btn>
          </div>
        ) : !adaptiveProviderSelected ? (
          <div>
            <GroupLabel>Model</GroupLabel>
            <ModelPillSelector
              models={runtimeModelOptions}
              selectedModelId={selectedRuntimeModelId}
              addModelDisabled={Boolean(runtimeIntegrationBusy)}
              canAddModel={runtimeCanAddCustomModel}
              emptyLabel={hasRuntimeProviders ? "No models configured." : "Add a provider first. Models appear after a provider is connected."}
              onSelectModel={(modelId) => updateAgentRuntimeModel(modelId === "adaptive" ? "openrouter" : runtimeModelProviderSlug, modelId)}
              onAddModel={() => setRuntimeModelSetupMode((current) => current === "model" ? null : "model")}
            />
          </div>
        ) : null}
        {adaptiveProviderSelected ? (
          <AdaptiveProviderSettings
            activeRuntime={activeRuntime}
            adaptiveRouting={adaptiveRouting}
            runtimeModelProviders={runtimeModelProviders}
            usePodSetupComplete={usePodSetupComplete}
            bankrLlmSelected={bankrLlmSelected}
            onUpdate={updateAdaptiveRouting}
          />
        ) : adaptiveOpenRouterSelected ? (
          <details style={{ border: "1px solid var(--line)", borderRadius: 11, background: "var(--panel-bg-soft)", padding: 12 }}>
            <summary style={{ color: "var(--fg)", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Adaptive OpenRouter</summary>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              <Field label="Agent type">
                <select value={adaptiveOpenRouter.useCase || "auto"} onChange={(event) => updateAdaptiveOpenRouter({ useCase: event.target.value })} style={inputStyle}>
                  {["auto", "coding", "writing", "vision", "image", "research", "tool-use"].map((option) => <option value={option} key={option}>{titleCaseId(option)}</option>)}
                </select>
              </Field>
              <Field label="Paid fallback">
                <select value={adaptiveOpenRouter.fallbackModel || ""} onChange={(event) => updateAdaptiveOpenRouter({ fallbackModel: event.target.value })} style={inputStyle}>
                  <option value="">No paid fallback</option>
                  {selectedRuntimeModels.filter((model) => model.id !== "adaptive").map((model) => <option value={model.id} key={model.id}>{model.name || model.id}</option>)}
                </select>
              </Field>
            </div>
          </details>
        ) : null}
        {runtimeModelSetupMode === "provider" && runtimeCanAddModels ? (
          <div className={fleetClass("agentRuntimeModelSetup", "agentRuntimeModelSetupProvider")}>
            <GuidedProviderSetup
              agent={agentSettingsIntegrationTarget}
              busy={runtimeIntegrationBusy}
              fleetClass={fleetClass}
              runtime={activeRuntime}
              onCancel={() => setRuntimeModelSetupMode(null)}
              onComplete={async () => {
                await refreshRuntimeIntegrations(agentSettingsIntegrationTarget ?? undefined);
                setRuntimeModelSetupMode(null);
              }}
            />
          </div>
        ) : null}
        {runtimeModelSetupMode === "model" && runtimeCanAddCustomModel ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end", border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel-bg-soft)", padding: 13 }}>
            <Field label="Provider">
              <select value={runtimeModelDraft.provider || selectedRuntimeProvider?.slug || ""} onChange={(event) => setRuntimeModelDraft((current) => ({ ...current, provider: event.target.value }))} style={inputStyle}>
                {runtimeModelProviders.map((provider) => <option value={provider.slug} key={provider.slug}>{provider.name}</option>)}
              </select>
            </Field>
            <Field label="Custom model ID">
              <TextInput value={runtimeModelDraft.model} onChange={(event) => setRuntimeModelDraft((current) => ({ ...current, model: event.target.value }))} placeholder="Paste exact model ID" />
            </Field>
            <Btn variant="primary" disabled={!runtimeModelDraft.model.trim() || runtimeIntegrationBusy === "add-model"} onClick={() => void addHermesModelFromDraft()}>
              {runtimeIntegrationBusy === "add-model" ? "Adding..." : "Add"}
            </Btn>
          </div>
        ) : null}
      </div>
    );
  };

  const renderWorkerPanel = () => {
    if (!showWorkerClassSection) return null;
    if (agentWorkerClassView !== "presets") {
      return (
        <div style={{ display: "grid", gap: 13, border: "1px solid var(--aeon-line)", borderRadius: 12, background: "rgba(20,184,166,0.05)", padding: 15 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Btn variant="ghost" size="sm" onClick={() => setAgentWorkerClassView("presets")}><ChevronRight size={14} aria-hidden="true" /> Back</Btn>
            <strong style={{ color: "var(--fg)", fontSize: 14 }}>Custom worker class</strong>
          </div>
          <Field label="Role name"><TextInput value={customWorkerDraft.label} onChange={(event) => setCustomWorkerDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Data scout, Social analyst, Build fixer" /></Field>
          <div>
            <GroupLabel>Bee image</GroupLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {BEE_WORKER_PRESET_LIST.map((preset) => {
                const imageSrc = beeRoleIconPath("worker", preset.id);
                const selected = customWorkerDraft.imageSrc === imageSrc;
                return (
                  <button className={styles.interactive} type="button" key={preset.id} onClick={() => setCustomWorkerDraft((current) => ({ ...current, imageSrc }))} aria-pressed={selected} style={{ display: "grid", placeItems: "center", width: 50, height: 50, borderRadius: 10, border: `1px solid ${selected ? "var(--aeon-line)" : "var(--line)"}`, background: selected ? "var(--aeon-soft)" : "var(--panel-bg-soft)", cursor: "pointer" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageSrc} alt="" style={{ width: 38, height: 38, objectFit: "contain" }} />
                  </button>
                );
              })}
              <button className={styles.interactive} type="button" onClick={() => customWorkerImageInputRef.current?.click()} style={{ display: "grid", placeItems: "center", width: 50, height: 50, borderRadius: 10, border: "1px dashed var(--aeon-line)", background: "transparent", color: "var(--cyan-3)", cursor: "pointer" }}>
                <Upload size={18} aria-hidden="true" />
              </button>
            </div>
            <input ref={customWorkerImageInputRef} type="file" accept="image/*" onChange={uploadCustomWorkerImage} hidden />
            {customWorkerImageError ? <p style={{ margin: "7px 0 0", color: "var(--danger-2)", fontSize: 12 }}>{customWorkerImageError}</p> : null}
          </div>
          <Field label="Suited-for prompt"><TextArea value={customWorkerDraft.skillProfilePrompt} onChange={(event) => setCustomWorkerDraft((current) => ({ ...current, skillProfilePrompt: event.target.value }))} /></Field>
          <Field label="Shared brain skills">
            <TextInput value={customWorkerSkillSearch} onChange={(event) => setCustomWorkerSkillSearch(event.target.value)} placeholder="Search by skill name or keyword" />
          </Field>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {filteredCustomWorkerSkills.length ? filteredCustomWorkerSkills.map((skill) => (
              <button className={styles.interactiveChip} type="button" key={skill.slug} onClick={() => toggleCustomWorkerSkill(skill.slug)} style={{ padding: "6px 10px", borderRadius: 999, border: `1px solid ${skill.selected ? "var(--aeon-line)" : "var(--line)"}`, background: skill.selected ? "var(--aeon-soft)" : "var(--panel-bg-soft)", color: skill.selected ? "var(--cyan-3)" : "var(--fg-2)", cursor: "pointer", fontSize: 12 }}>{skill.name}</button>
            )) : <p style={{ margin: 0, color: "var(--fg-4)", fontSize: 12 }}>No matching shared-brain skills.</p>}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn variant="ghost" onClick={() => setAgentWorkerClassView("presets")}>Cancel</Btn>
            <Btn variant="primary" disabled={!customWorkerDraft.label.trim() || !customWorkerDraft.skillProfilePrompt.trim()} onClick={applyCustomWorkerClass}>Use class</Btn>
          </div>
        </div>
      );
    }
    return (
      <div>
        <GroupLabel>Worker class</GroupLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(88px, 112px))", gap: 7 }}>
          {BEE_WORKER_PRESET_LIST.map((preset) => {
            const selected = preset.id === agentSettingsWorkerClass && !agentSettingsCustomWorker;
            return (
              <button className={styles.interactive} type="button" key={preset.id} aria-pressed={selected} onClick={() => selectAgentWorkerClass(preset.id)} style={{ display: "grid", justifyItems: "center", alignContent: "center", gap: 5, minHeight: 74, padding: "8px 6px", borderRadius: 10, border: `1px solid ${selected ? "var(--aeon-line)" : "var(--line)"}`, background: selected ? "var(--aeon-soft)" : "var(--panel-bg-soft)", color: selected ? "var(--cyan-3)" : "var(--fg-2)", cursor: "pointer" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={beeRoleIconPath("worker", preset.id)} alt="" style={{ width: 38, height: 38, objectFit: "contain" }} />
                <span style={{ fontSize: 10.5, lineHeight: 1.15, fontWeight: 700, textAlign: "center" }}>{preset.label}</span>
              </button>
            );
          })}
          {agentSettingsCustomWorkers.map((customWorkerClass) => {
            const selected = agentSettingsSelectedCustomWorkerId === customWorkerClass.id;
            return (
              <button className={styles.interactive} type="button" key={customWorkerClass.id} aria-pressed={selected} onClick={() => selectCustomWorkerClass(customWorkerClass)} style={{ display: "grid", justifyItems: "center", alignContent: "center", gap: 5, minHeight: 74, padding: "8px 6px", borderRadius: 10, border: `1px solid ${selected ? "var(--aeon-line)" : "var(--line)"}`, background: selected ? "var(--aeon-soft)" : "var(--panel-bg-soft)", color: selected ? "var(--cyan-3)" : "var(--fg-2)", cursor: "pointer" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={customWorkerClass.imageSrc || beeRoleIconPath("worker", "general")} alt="" style={{ width: 38, height: 38, objectFit: "contain" }} />
                <span style={{ fontSize: 10.5, lineHeight: 1.15, fontWeight: 700, textAlign: "center" }}>{customWorkerClass.label}</span>
              </button>
            );
          })}
          <button className={styles.interactive} type="button" onClick={openCustomWorkerClassCreator} style={{ display: "grid", justifyItems: "center", alignContent: "center", gap: 5, minHeight: 74, padding: "8px 6px", borderRadius: 10, border: "1px dashed var(--aeon-line)", background: "transparent", color: "var(--cyan-3)", cursor: "pointer" }}>
            <Plus size={16} aria-hidden="true" />
            <span style={{ fontSize: 10.5, lineHeight: 1.15, fontWeight: 700 }}>Custom</span>
          </button>
        </div>
        <div style={{ display: "grid", gap: 12, marginTop: 10, padding: 15, borderRadius: 12, border: "1px solid var(--aeon-line)", background: "rgba(20,184,166,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={agentSettingsWorkerImage} alt="" style={{ width: 58, height: 58, objectFit: "contain" }} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <strong style={{ display: "block", color: "var(--fg)", fontSize: 14.5 }}>{agentSettingsWorkerLabel}</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                {(agentSettingsCustomWorker ? workerCapabilityBadges(agentSettingsSkillProfile) : workerCapabilityBadges(agentSettingsWorkerPreset.summary)).map((capability) => <Pill key={capability} tone="muted">{capability}</Pill>)}
              </div>
            </div>
          </div>
          <Field label="Suited-for prompt"><TextArea value={agentSettingsSkillProfile} onChange={(event) => updateAgentSkillProfile(event.target.value)} /></Field>
          <div>
            <GroupLabel>Seeded shared-brain skills</GroupLabel>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {agentSettingsPreferredSkills.map((slug) => (
                <button className={styles.interactiveChip} key={slug} type="button" onClick={() => removeAgentPreferredSkill(slug)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, border: "1px solid var(--line-2)", background: "var(--panel-bg-soft)", color: "var(--fg-2)", cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 11.5 }}>
                  {slug}<Minus size={12} aria-hidden="true" />
                </button>
              ))}
              <button className={styles.interactiveChip} type="button" onClick={() => void openAgentSkillBrowser()} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 999, border: "1px dashed var(--aeon-line)", background: "transparent", color: "var(--cyan-3)", cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>
                <Plus size={12} aria-hidden="true" /> Add skill
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderRole = () => (
    <div style={{ display: "grid", gap: 22 }}>
      <PanelHead eyebrow="Role" title="Runtime and behaviour" sub="Pick the engine that runs this agent. Each runtime brings its own setup." />
      {!hideRuntimeSection ? (
        <div>
          <GroupLabel>Runtime</GroupLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 168px))", gap: 7, alignItems: "stretch" }}>
            {Object.entries(RUNTIME_LABELS).map(([runtime, label]) => renderRuntimeCard(runtime, label))}
          </div>
        </div>
      ) : null}
      {isAutopilotSettings ? (
        <div style={{ display: "grid", gap: 15 }}>
          <div style={{ display: "flex", gap: 13, alignItems: "center", padding: "14px 16px", borderRadius: 13, border: "1px solid var(--aeon-line)", background: "radial-gradient(circle at 12% 20%, var(--aeon-soft), transparent 60%), var(--panel-bg-soft)" }}>
            <AeonOrb size={56} state="duty" iconSrc={agentSettingsWorkerImage} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ color: "var(--fg)", fontFamily: "var(--f-display)", fontSize: 14.5 }}>Autopilot connection</strong>
                <Pill tone="cyan">{aeonSettings.mode === "github" ? "GitHub Actions" : aeonSettings.mode === "a2a" ? "A2A gateway" : "Local repo"}</Pill>
              </div>
              <p style={{ margin: "3px 0 0", color: "var(--fg-3)", fontSize: 12, lineHeight: 1.5 }}>AEON uses skill-selected models, so provider/model and worker class controls live in the AEON workspace.</p>
            </div>
            <Btn variant="primary" size="sm" icon="sparkles" style={{ marginLeft: "auto" }} onClick={() => setAeonWorkspaceOpen(true)}>Create AEON Agent</Btn>
          </div>
          {renderAeonConnection()}
        </div>
      ) : (
        <>
          {renderProviderModelPanel()}
          {renderWorkerPanel()}
        </>
      )}
    </div>
  );

  const renderAeonConnection = () => (
    <div style={{ display: "grid", gap: 15 }}>
      <div>
        <GroupLabel>Connection mode</GroupLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[
            { id: "local", label: "Local repo", sub: "Use files on this Mac", Icon: FolderOpen },
            { id: "github", label: "GitHub", sub: "Use repo and branch", Icon: Upload },
            { id: "a2a", label: "A2A", sub: "Use gateway URL", Icon: PlugZap },
          ].map((mode) => {
            const active = aeonSettings.mode === mode.id;
            return (
              <button className={styles.interactive} key={mode.id} type="button" aria-pressed={active} onClick={() => updateAeonSettings({ aeonMode: mode.id })} style={{ display: "grid", justifyItems: "center", gap: 6, padding: "14px 10px", borderRadius: 12, border: `1px solid ${active ? "var(--aeon-line)" : "var(--line)"}`, background: active ? "var(--aeon-soft)" : "var(--panel-bg-soft)", color: active ? "var(--cyan-2)" : "var(--fg-3)", cursor: "pointer", textAlign: "center" }}>
                <mode.Icon size={19} aria-hidden="true" />
                <span style={{ color: active ? "var(--cyan-3)" : "var(--fg)", fontSize: 12.5, fontWeight: 800 }}>{mode.label}</span>
                <span style={{ color: "var(--fg-4)", fontSize: 10.5 }}>{mode.sub}</span>
              </button>
            );
          })}
        </div>
      </div>
      {aeonSettings.mode === "github" ? (
        <div style={{ display: "grid", gap: 11, padding: 15, borderRadius: 12, border: "1px solid var(--aeon-line)", background: "rgba(20,184,166,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel-bg-soft)" }}>
            <Upload size={17} aria-hidden="true" style={{ color: "var(--cyan-2)" }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <strong style={{ display: "block", color: "var(--fg)", fontSize: 13.5 }}>Connect with GitHub OAuth</strong>
              <p style={{ margin: "2px 0 0", color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.45 }}>Saves GH_GLOBAL with repo, workflow, hook, org, and email access.</p>
            </div>
            <Btn variant="primary" size="sm" disabled={aeonOauthConnecting} onClick={openAeonGithubOauth}>{aeonOauthConnecting ? "Opening..." : "Connect GitHub"}</Btn>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 10 }}>
            <Field label="GitHub repo"><TextInput value={aeonSettings.repo} onChange={(event) => updateAeonSettings({ aeonRepo: event.target.value })} placeholder="owner/repo" /></Field>
            <Field label="Branch"><TextInput value={aeonSettings.branch} onChange={(event) => updateAeonSettings({ aeonBranch: event.target.value })} placeholder="main" /></Field>
          </div>
        </div>
      ) : null}
      {aeonSettings.mode === "a2a" ? <Field label="A2A / gateway URL"><TextInput value={aeonSettings.a2aUrl} onChange={(event) => updateAeonSettings({ a2aUrl: event.target.value, gatewayUrl: event.target.value })} placeholder="http://127.0.0.1:41241" /></Field> : null}
      {aeonSettings.mode === "local" ? (
        <Field label="AEON repo folder">
          <div style={{ display: "flex", gap: 8 }}>
            <TextInput value={aeonSettings.path} onChange={(event) => updateAeonSettings({ aeonLocalPath: event.target.value, localDataDir: event.target.value })} placeholder="~/.aeon or ~/my-aeon-repo" style={{ flex: 1 }} />
            <Btn variant="secondary" icon="folder" onClick={() => void browseAgentRuntimeFolder?.()}>Browse</Btn>
          </div>
        </Field>
      ) : null}
    </div>
  );

  const renderMemory = () => {
    const shared = agentCreateMachine ? agentCreateDraft.useSharedVault : roleModalAgent?.useSharedVault !== false;
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <PanelHead eyebrow="Memory" title="Brain and workspace" sub="Where this agent remembers, and the local folder it reads and writes." />
        <ToggleRow
          label="Use shared Obsidian brain"
          sub="Memory, Kanban, notifications and HivemindOS context come from one vault."
          checked={shared}
          icon={BrainCircuit}
          onChange={(checked) => {
            if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, useSharedVault: checked }));
            else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { useSharedVault: checked });
          }}
        />
        {shared ? (
          <div style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: 13, borderRadius: 11, background: "var(--aeon-soft)", border: "1px solid rgba(94,234,212,0.14)" }}>
            <BrainCircuit size={16} aria-hidden="true" style={{ color: "var(--cyan-2)", marginTop: 1 }} />
            <p style={{ margin: 0, color: "var(--fg-2)", fontSize: 12.5, lineHeight: 1.55 }}>
              {sharedVault?.enabled ? `Shared brain: ${sharedVault.vaultPath || "auto-detected vault"}. Memory, Kanban, notifications, and HivemindOS context are shared from there.` : "Shared brain is off. Turn it on from the Vault view to give agents one common memory space."}
            </p>
          </div>
        ) : null}
        {agentCreateMachine && isAutopilotSettings ? <Field label="AEON repo folder"><TextInput value={aeonSettings.path} onChange={(event) => updateAeonSettings({ aeonLocalPath: event.target.value })} placeholder="~/.aeon or ~/my-aeon-repo" /></Field> : null}
        {!agentCreateMachine && roleModalAgent ? (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "13px 14px", borderRadius: 11, background: "var(--panel-bg-soft)", border: "1px solid var(--line)" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--fg-3)", fontSize: 12 }}>{isAutopilotSettings ? "AEON repo folder" : "Runtime folder"}</div>
              <code style={{ display: "block", marginTop: 3, color: "var(--fg)", fontFamily: "var(--f-mono)", fontSize: 12.5, overflowWrap: "anywhere" }}>{runtimeFolderValue.trim() || "Managed by runtime"}</code>
              <p style={{ margin: "5px 0 0", color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.5 }}>{isAutopilotSettings ? "The local AEON repo the dashboard reads and mirrors into Obsidian." : "Used as this agent's local memory and workspace folder."}</p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <Btn size="icon" variant="secondary" disabled={agentRuntimeFolderBrowsing} onClick={() => void browseAgentRuntimeFolder()}><FolderOpen size={15} aria-hidden="true" /></Btn>
              <Btn size="icon" variant="secondary" onClick={() => setAgentRuntimeFolderEditing((current) => !current)}><Pencil size={15} aria-hidden="true" /></Btn>
            </div>
          </div>
        ) : null}
        {agentRuntimeFolderEditing && roleModalAgent ? (
          <Field label={isAutopilotSettings ? "AEON repo path" : "Runtime folder path"}>
            <div style={{ display: "flex", gap: 8 }}>
              <TextInput
                value={runtimeFolderValue}
                onChange={(event) => {
                  updateAgentProfile(roleModalAgent.id, isAutopilotSettings ? { aeonLocalPath: event.target.value, localDataDir: event.target.value } : { localDataDir: event.target.value });
                  setAgentRuntimeFolderStatus("");
                }}
                placeholder={isAutopilotSettings ? "~/.aeon or ~/my-aeon-repo" : "Leave blank to use the runtime default"}
                style={{ flex: 1 }}
              />
              <Btn size="icon" variant="primary" onClick={() => setAgentRuntimeFolderEditing(false)}><Check size={15} aria-hidden="true" /></Btn>
            </div>
          </Field>
        ) : null}
        {agentRuntimeFolderStatus ? <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 12 }}>{agentRuntimeFolderStatus}</p> : null}
      </div>
    );
  };

  const renderTools = () => {
    if (!roleModalAgent) {
      return <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 13 }}>Create the agent first; runtime tools appear after the profile exists.</p>;
    }
    const tools = [
      ["sessionSearch", "Session search", "Search prior work across this runtime.", Search],
      ["backgroundTasks", "Background tasks", "Run work without blocking chat.", Repeat2],
      ["xSearch", "X search", "Fetch X posts through runtime auth.", MessageSquare],
      ["socialPosting", "X posting", "Publish through installed social skills.", Send],
      ["videoGeneration", "AI video", "Generate videos through runtime tools.", Sparkles],
      ["codexRuntime", "Codex runtime", "Delegate coding to Codex paths.", Cpu],
      ["kanbanDecompose", "Kanban decomposition", "Break triage goals into child work.", KanbanSquare],
    ];
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <PanelHead
          eyebrow="Tools"
          title="Runtime integrations"
          sub="Adapter-neutral capabilities. Each one appears only when this runtime actually exposes it."
          action={<Btn size="sm" variant="secondary" disabled={runtimeIntegrationBusy === "status"} onClick={() => void refreshRuntimeIntegrations(roleModalAgent)}>{runtimeIntegrationBusy === "status" ? "Refreshing..." : "Refresh"}</Btn>}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 9 }}>
          {tools.map(([key, label, detail, ToolIcon]) => {
            const item = runtimeIntegrationStatus?.integrations?.[key];
            const supported = item?.supported ?? Boolean(runtimeCapabilities(roleModalAgent)[key]);
            const enabled = item?.enabled ?? supported;
            const needsHermesUpdate = roleModalAgent.runtime === "hermes" && supported && hermesUpdateRequired && HERMES_UPDATE_INTEGRATION_KEYS.has(key);
            const statusLabel = needsHermesUpdate ? "Needs Hermes update" : supported ? enabled ? "Ready" : "Needs setup" : "Not exposed";
            return (
              <article key={key} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 11, padding: 13, borderRadius: 11, opacity: supported ? 1 : 0.58, border: `1px solid ${supported && enabled ? "var(--aeon-line)" : "var(--line)"}`, background: supported && enabled ? "var(--aeon-soft)" : "var(--panel-bg-soft)" }}>
                <span style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 8, color: supported && enabled ? "var(--cyan-2)" : "var(--fg-4)", background: "rgba(2,6,23,0.35)", border: "1px solid var(--line)" }}><ToolIcon size={16} aria-hidden="true" /></span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <strong style={{ color: "var(--fg)", fontSize: 13 }}>{label}</strong>
                    <Pill tone={supported && enabled ? "green" : supported ? "honey" : "muted"}>{statusLabel}</Pill>
                  </div>
                  <p style={{ margin: "4px 0 0", color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.45 }}>{detail}</p>
                </div>
              </article>
            );
          })}
        </div>
        <div style={{ display: "grid", gap: 9, padding: 15, borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel-bg-soft)" }}>
          <div><strong style={{ color: "var(--fg)", fontSize: 13 }}>Search sessions</strong><p style={{ margin: "3px 0 0", color: "var(--fg-4)", fontSize: 11.5 }}>Search readable local session history for this runtime.</p></div>
          <div style={{ display: "flex", gap: 8 }}>
            <TextInput value={runtimeSessionQuery} onChange={(event) => setRuntimeSessionQuery(event.target.value)} placeholder="April 15, Codex, Kanban, auth..." style={{ flex: 1 }} />
            <Btn variant="primary" onClick={() => void searchRuntimeSessionsForAgent(roleModalAgent)} disabled={runtimeIntegrationBusy === "session-search"}>{runtimeIntegrationBusy === "session-search" ? "Searching..." : "Search"}</Btn>
          </div>
          {runtimeSessionResults?.length ? (
            <div style={{ display: "grid", gap: 7 }}>
              {runtimeSessionResults.slice(0, 5).map((result, index) => <p key={result.id ?? index} style={{ margin: 0, color: "var(--fg-3)", fontSize: 12, lineHeight: 1.45 }}>{result.title || result.path || JSON.stringify(result)}</p>)}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderSecurity = () => (
    <div style={{ display: "grid", gap: 16 }}>
      <PanelHead eyebrow="Security" title="Guards and redaction" sub="Always-on protections that run locally in the dashboard before anything reaches a runtime." />
      {[
        ["Secret redaction", "Sensitive env values stay masked in runtime-facing prompts.", ShieldCheck],
        ["Local-first paths", "Machine and directory access keeps collector boundaries intact.", FolderOpen],
        ["Scoped tools", "Runtime actions appear only for capabilities the current adapter exposes.", Settings2],
      ].map(([title, body, SecurityIcon]) => (
        <article key={title} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 13, alignItems: "center", padding: 15, borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel-bg-soft)" }}>
          <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 10, color: "var(--cyan-2)", background: "var(--aeon-soft)", border: "1px solid var(--aeon-line)" }}><SecurityIcon size={19} aria-hidden="true" /></span>
          <div><strong style={{ color: "var(--fg)", fontSize: 13.5 }}>{title}</strong><p style={{ margin: "4px 0 0", color: "var(--fg-3)", fontSize: 12, lineHeight: 1.55 }}>{body}</p></div>
          <Pill tone="green" dot>Active</Pill>
        </article>
      ))}
    </div>
  );

  const panelContent = activePanel === "role"
    ? renderRole()
    : activePanel === "connection"
      ? <div style={{ display: "grid", gap: 16 }}><PanelHead eyebrow="Connection" title="AEON connection" sub="Where Autopilot reads its repo and runs its scheduled skills." />{renderAeonConnection()}</div>
      : activePanel === "memory"
        ? renderMemory()
        : activePanel === "tools"
          ? renderTools()
          : activePanel === "calls"
            ? <AgentCallsSettingsPanel {...{ Button, LoaderCircle: LoaderCircleIcon, PlugZap: PlugZapIcon, RefreshCcw: RefreshCcwIcon, Send: SendIcon, agentCreateDraft, agentCreateMachine, fleetClass, roleModalAgent, setAgentCreateDraft, updateAgentProfile }} />
            : renderSecurity();

  return createPortal((
    <>
      <div
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeAgentSettingsModal();
        }}
        className={styles.root}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 80,
          display: "grid",
          placeItems: "center",
          padding: 20,
          background: "rgba(2,6,23,0.72)",
          backdropFilter: "blur(18px)",
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="agent-settings-title"
          style={{
            width: "min(960px, 100%)",
            height: "min(660px, 100%)",
            minHeight: 0,
            display: "grid",
            gridTemplateRows: "auto 1fr auto",
            overflow: "hidden",
            border: "1px solid var(--line-2)",
            borderRadius: 18,
            background: "linear-gradient(180deg, rgba(16,20,29,0.96), rgba(6,8,13,0.94))",
            boxShadow: "0 34px 90px rgba(0,0,0,0.45)",
            color: "var(--fg)",
          }}
        >
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "16px 18px 14px", borderBottom: "1px solid var(--line)" }}>
            <div>
              <Eyebrow color="var(--fg-4)">{agentSettingsTitle || (agentCreateMachine ? "Add agent" : "Agent settings")}</Eyebrow>
              <h2 id="agent-settings-title" style={{ margin: "4px 0 0", color: "var(--fg)", fontFamily: "var(--f-display)", fontSize: 18, lineHeight: 1.15 }}>{displayName}</h2>
            </div>
            <button className={styles.interactiveSubtle} type="button" aria-label="Close agent settings" onClick={closeAgentSettingsModal} style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 10, border: "1px solid var(--line-2)", background: "rgba(148,163,184,0.07)", color: "var(--fg-3)", cursor: "pointer" }}>
              <X size={17} aria-hidden="true" />
            </button>
          </header>
          <div style={{ display: "grid", gridTemplateColumns: "248px minmax(0, 1fr)", minHeight: 0 }}>
            <aside style={{ display: "grid", gridTemplateRows: "auto 1fr", gap: 18, minHeight: 0, padding: "22px 18px", borderRight: "1px solid var(--line)", background: "var(--panel-bg-soft)", overflow: "hidden" }}>
              <div style={{ display: "grid", justifyItems: "center", gap: 12, textAlign: "center" }}>
                <AeonOrb size={92} state={isAutopilotSettings ? "duty" : "idle"} iconSrc={agentSettingsWorkerImage} />
                <div style={{ display: "grid", gap: 8, width: "100%" }}>
                  <input
                    value={currentName}
                    onChange={(event) => updateName(event.target.value)}
                    placeholder={displayName}
                    aria-label="Agent name"
                    autoFocus={Boolean(agentCreateMachine)}
                    style={{
                      width: "100%",
                      border: "1px solid transparent",
                      borderRadius: 9,
                      background: "transparent",
                      color: "var(--fg)",
                      fontFamily: "var(--f-display)",
                      fontSize: 19,
                      fontWeight: 700,
                      lineHeight: 1.15,
                      textAlign: "center",
                      outline: "none",
                      padding: "4px 8px",
                    }}
                  />
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                    <Pill tone="cyan" icon="bot">{runtimeLabel}</Pill>
                    <Pill tone={agentCreateMachine ? "muted" : "honey"} dot>{workerSubtitle || agentStatus}</Pill>
                  </div>
                  <div style={{ display: "inline-flex", justifyContent: "center", alignItems: "center", gap: 6, color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 11, lineHeight: 1.35 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: agentCreateMachine ? "var(--aeon)" : "var(--honey-2)", flex: "0 0 auto" }} />
                    <span>{agentCreateMachine ? agentCreateMachine.name : roleModalAgent?.machineName || roleModalAgent?.machineId || "This Mac"} · {agentStatus}</span>
                  </div>
                </div>
              </div>
              <nav className={styles.scroll} aria-label="Agent settings sections" style={{ display: "grid", alignContent: "start", gap: 3, minHeight: 0, overflow: "auto", marginTop: 4 }}>
                {activePanels.map((panel) => {
                  const NavIcon = PANEL_ICONS[panel] ?? Settings2;
                  const active = panel === activePanel;
                  return (
                    <button
                      className={styles.interactiveSubtle}
                      type="button"
                      key={panel}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setAgentSettingsPanel(panel)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto minmax(0, 1fr)",
                        alignItems: "center",
                        gap: 11,
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: `1px solid ${active ? "var(--aeon-line)" : "transparent"}`,
                        background: active ? "var(--aeon-soft)" : "transparent",
                        color: active ? "var(--cyan-2)" : "var(--fg-4)",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "all 130ms ease",
                      }}
                    >
                      <NavIcon size={16} aria-hidden="true" />
                      <span style={{ minWidth: 0, display: "grid", gap: 2 }}>
                        <span style={{ color: active ? "var(--fg)" : "var(--fg-2)", fontSize: 13.5, fontWeight: 600, lineHeight: 1.15 }}>{panelTitle(panel)}</span>
                        <span style={{ color: "var(--fg-4)", fontSize: 10.5, lineHeight: 1.25 }}>{panelDetail(panel)}</span>
                      </span>
                    </button>
                  );
                })}
              </nav>
            </aside>
            <main className={styles.scroll} style={{ minHeight: 0, overflow: "auto", padding: "22px 24px" }}>
              {panelContent}
            </main>
          </div>
          <footer style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "13px 18px", borderTop: "1px solid var(--line)", background: "rgba(8,12,19,0.55)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, color: "var(--fg-4)", fontSize: 12 }}>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: isAutopilotSettings ? "var(--honey-2)" : "var(--aeon)" }} />
              <span>{isAutopilotSettings ? "AEON workspace setup uses the shared Autopilot route." : "Provider, model and worker changes save to this profile."}</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="ghost" onClick={closeAgentSettingsModal}>Cancel</Btn>
              <Btn
                variant="primary"
                sheen
                disabled={runtimeIntegrationBusy === "create-agent" || usePodCreateBlocked}
                onClick={agentCreateMachine ? () => void createAgentFromModal() : closeAgentSettingsModal}
              >
                {agentCreateMachine ? runtimeIntegrationBusy === "create-agent" ? "Creating..." : runtimeSettingsFeature(agentCreateDraft.runtime).createActionLabel || "Add agent" : "Done"}
              </Btn>
            </div>
          </footer>
        </section>
      </div>
      {aeonWorkspaceOpen ? (
        <WorkspaceModal
          existingAgents={(displayAgents ?? []).filter((agent) => agent.runtime === "aeon")}
          machineGroups={machineGroups}
          sharedVault={sharedVault}
          chooseDirectoryForMachine={chooseDirectoryForMachine}
          onClose={() => setAeonWorkspaceOpen(false)}
          onCreated={(agent, options) => {
            onAeonWorkspaceCreated?.(agent, options);
            if (options?.close !== false) setAeonWorkspaceOpen(false);
          }}
        />
      ) : null}
    </>
  ), portalTarget);
}
