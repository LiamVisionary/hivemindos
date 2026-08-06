// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ChevronDown, ChevronRight, ChevronUp, KeyRound, Minus, PlugZap, Plus, Search, Sparkles, Upload } from "lucide-react";
import { AgentBrowserModal } from "./AgentBrowserModal";
import { AgentSettingsCallsPanel } from "./AgentSettingsCallsPanel";
import { AgentSettingsMinistryPanel } from "./AgentSettingsMinistryPanel";
import {
  AgentSettingsAeonConnectionPanel,
  AgentSettingsMemoryPanel,
  AgentSettingsSecurityPanel,
} from "./AgentSettingsConnectionPanels";
import { AgentSettingsModalFrame } from "./AgentSettingsModalFrame";
import { AgentSettingsQueenPersonalityPanel } from "./AgentSettingsQueenPersonalityPanel";
import { AgentSettingsCustomInstructionsPanel } from "./AgentSettingsCustomInstructionsPanel";
// AgentSettingsToolsPanel owns the Agent mailbox "Create mailbox" action.
import { AgentSettingsToolsPanel } from "./AgentSettingsToolsPanel";
import { AdaptiveProviderSettings } from "./AdaptiveProviderSettings";
import { BankrLowCreditSetup } from "./BankrLowCreditSetup";
import { GuidedProviderSetup } from "./GuidedProviderSetup";
import { GuidedHivemindosModelsSetup } from "./GuidedHivemindosModelsSetup";
import { GuidedUsePodSetup } from "./GuidedUsePodSetup";
import { GuidedVeniceSetup } from "./GuidedVeniceSetup";
import { LmStudioModelManager } from "./LmStudioModelManager";
import { SieModelManager } from "./SieModelManager";
import { MissingSharedEnvKeySetup } from "./MissingSharedEnvKeySetup";
import { ModelPillSelector } from "./ModelPillSelector";
import { ResearchMethodSettingsPanel } from "./ResearchMethodSettingsPanel";
import { RuntimeInstallSetup } from "./RuntimeInstallSetup";
import { WorkerTaskPreferencesEditor } from "./WorkerTaskPreferencesEditor";
import honeyStyles from "@/features/env/hive-env-honey.module.css";
import { WorkspaceModal } from "@/components/aeon";
import { renderBeeSoulTemplate } from "@/lib/config/bee-worker-presets";
import { normalizeResearchMethod } from "@/lib/config/research-methods";
import { MODEL_PROVIDER_GATEWAYS } from "@/lib/config/model-provider-gateways";
import { LOCAL_MODEL_RUNTIME_CAPABILITIES, SIE_PROVIDER_ID } from "@/lib/config/local-model-runtimes";
import { HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL, HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER } from "@/lib/config/hivemindos-wallet-paid-models";
import { providerCatalogEntry } from "@/lib/config/provider-catalog";
import { openExternalUrl } from "@/lib/native/open-external-url";
import { oauthReturnMode } from "@/lib/native/oauth-return-mode";
import { runtimeHasInstallSetup } from "@/lib/services/runtime-install-catalog";
import { HIVEMIND_OS_RUNTIME, buildAgentCallPreferences, defaultAgentNameForRuntime, runtimeProfileFeature, runtimeSettingsFeature, type AgentRuntime } from "@/lib/types/agent-runtime";
import { rememberMruRuntime } from "@/features/dashboard/agent-mru-runtime";
import { XAI_OAUTH_DEFAULT_MODEL, XAI_PROVIDER_SLUG, modelProviderSelection, providerSortIndex, providerSupportsCredentialMode, runtimeProviderForCredentialMode } from "@/features/dashboard/model-provider-view";
import { gateBankrModelsForCredits, selectBestRuntimeModel } from "./runtime-model-registry";
import { AsOrb, Badge, Btn, Field, GroupLabel, PanelHead, TextArea, TextInput, hasUsePodSetup, hasVeniceSetup, iconMark, isHivemindosModelsSetupReady, isUsePodSetupReady, isVeniceSetupReady, titleCaseId } from "./AgentSettingsModalPrimitives";

const USEPOD_PROVIDER = MODEL_PROVIDER_GATEWAYS.usepod;
const VENICE_PROVIDER = MODEL_PROVIDER_GATEWAYS.venice;
const HIVEMINDOS_MODELS_PROVIDER = MODEL_PROVIDER_GATEWAYS[HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER];
const BANKR_LLM_BASE_URL = "https://llm.bankr.bot";
const BANKR_LLM_CHAT_PATH = "/v1/chat/completions";
const BANKR_LLM_MODELS_PATH = "/v1/models";
const LM_STUDIO_EMPTY_DISCOVERY_GRACE_MS = 12_000;
const SIE_RUNTIME = LOCAL_MODEL_RUNTIME_CAPABILITIES[SIE_PROVIDER_ID];

export function AgentSettingsModal(props: any) {
  const {
    BEE_WORKER_PRESET_LIST = [],
    HERMES_UPDATE_INTEGRATION_KEYS = new Set(),
    RUNTIME_LABELS = {},
    addHermesModelFromDraft,
    agentCreateDraft,
    agentCreateMachine,
    agentRuntimeFolderBrowsing,
    agentRuntimeFolderEditing,
    agentRuntimeFolderStatus,
    agentSettingsCustomWorker,
    agentSettingsCustomWorkers = [],
    agentSettingsDescription,
    agentSettingsIntegrationTarget,
    agentSettingsPanel,
    agentSettingsPreferredSkills = [],
    agentSettingsProvider,
    agentSettingsRuntime,
    agentSettingsSelectedCustomWorkerId,
    agentSettingsSoulPrompt,
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
    displayAgents = [],
    filteredCustomWorkerSkills = [],
    fleetClass,
    hermesUpdateRequired,
    installPackagedAgent,
    machineGroups,
    onAeonWorkspaceCreated,
    onQueenClapWakeEnabledChange,
    notifyAgentVoiceFailure,
    openAgentSkillBrowser,
    openCustomWorkerClassCreator,
    providerIconPath,
    providerIconRenderMode,
    queenClapWakeEnabled,
    refreshRuntimeAvailability,
    refreshRuntimeIntegrations,
    removeAgentPreferredSkill,
    roleModalAgent,
    runRuntimeIntegrationAction,
    runtimeAvailability,
    runtimeCapabilities,
    runtimeIconFallback,
    runtimeIconPath,
    runtimeIconRenderMode,
    runtimeIntegrationBusy,
    runtimeIntegrationMessage,
    runtimeIntegrationStatus,
    runtimeModelDraft,
    runtimeModelSelection,
    runtimeModelProviders = [],
    runtimeModelSelectionsByRuntime,
    runtimeModelSelectionFresh,
    runtimeModelSetupMode,
    runtimeSessionQuery,
    runtimeSessionResults,
    searchRuntimeSessionsForAgent,
    selectAgentWorkerClass,
    selectCustomWorkerClass,
    selectedRuntimeModelId,
    selectedRuntimeModels = [],
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
    updateAgentSoulPrompt,
    updateAgentSkillProfile,
    uploadCustomWorkerImage,
    walletsByAgent,
    workerCapabilityBadges,
  } = props;

  const portalTarget = typeof document === "undefined" ? null : document.body;
  const modalOpen = Boolean(portalTarget && (roleModalAgent || agentCreateMachine));
  const activeRuntime = (agentSettingsRuntime || "hermes") as AgentRuntime;
  const runtimeSettings = runtimeSettingsFeature(activeRuntime);
  const runtimeActivePanels = agentCreateMachine ? runtimeSettings.createPanels : runtimeSettings.editPanels;
  const isQueenSettings = !agentCreateMachine && roleModalAgent?.beeRole === "queen";
  const activePanels = isQueenSettings && runtimeActivePanels.includes("calls") && !runtimeActivePanels.includes("ministry")
    ? runtimeActivePanels.flatMap((panel) => (panel === "calls" ? [panel, "ministry"] : [panel]))
    : runtimeActivePanels;
  const activePanel = activePanels.includes(agentSettingsPanel) ? agentSettingsPanel : activePanels[0];
  const isAutopilotSettings = runtimeSettings.kind === "autopilot";
  const runtimeLabel = RUNTIME_LABELS[activeRuntime] ?? activeRuntime;
  const rawSelectedProviderSlug = agentSettingsProvider || runtimeModelSelection?.provider || selectedRuntimeProvider?.slug || "";
  const selectedProviderView = modelProviderSelection(rawSelectedProviderSlug);
  const selectedProviderSlug = selectedProviderView.displaySlug;
  const selectedRuntimeProviderSlug = selectedProviderView.runtimeSlug || selectedProviderSlug;
  const openRouterSelected = selectedProviderSlug === "openrouter";
  const usePodSelected = selectedProviderSlug === "usepod";
  const hivemindosModelsSelected = selectedProviderSlug === HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER;
  const bankrLlmSelected = selectedProviderSlug === "bankr";
  const lmStudioSelected = selectedProviderSlug === "lm-studio";
  const sieSelected = selectedProviderSlug === SIE_PROVIDER_ID;
  const adaptiveProviderSelected = selectedProviderSlug === "adaptive";
  const selectedCatalogEntry = providerCatalogEntry(selectedProviderSlug);

  const [agentBrowserOpen, setAgentBrowserOpen] = useState(false);
  const [aeonOauthConnecting, setAeonOauthConnecting] = useState(false);
  const [aeonWorkspaceOpen, setAeonWorkspaceOpen] = useState(false);
  const [savedAgentSouls, setSavedAgentSouls] = useState([]);
  const [savedAgentSoulsStatus, setSavedAgentSoulsStatus] = useState("");
  const [soulSaveTitle, setSoulSaveTitle] = useState("");
  const [showAllProviders, setShowAllProviders] = useState(false);
  const [envPresentKeys, setEnvPresentKeys] = useState(() => new Set());
  const [envHermesKeys, setEnvHermesKeys] = useState(() => new Set());
  const [envLoaded, setEnvLoaded] = useState(false);
  const [envRefreshKey, setEnvRefreshKey] = useState(0);
  const [xaiOAuthConnected, setXaiOAuthConnected] = useState(false);
  const [xaiOAuthStatusLoaded, setXaiOAuthStatusLoaded] = useState(false);
  const [fetchedProviderModels, setFetchedProviderModels] = useState(() => ({}));
  const [lmStudioEmptyDiscoveryGraceActive, setLmStudioEmptyDiscoveryGraceActive] = useState(false);
  const [sieEmptyDiscoveryGraceActive, setSieEmptyDiscoveryGraceActive] = useState(false);
  const [lmStudioPendingLoadModelKeys, setLmStudioPendingLoadModelKeys] = useState<string[]>([]);
  const [lmStudioPendingPrimaryAction, setLmStudioPendingPrimaryAction] = useState<"save" | "create" | null>(null);
  const [agentMailboxOverview, setAgentMailboxOverview] = useState(null);
  const [agentMailboxBusy, setAgentMailboxBusy] = useState(false);
  const [agentMailboxError, setAgentMailboxError] = useState("");
  const soulFileInputRef = useRef<HTMLInputElement | null>(null);

  const currentName = agentCreateMachine ? agentCreateDraft.name : roleModalAgent?.name ?? "";
  const defaultNameForRuntime = (runtime: AgentRuntime, provider = "") => defaultAgentNameForRuntime(displayAgents ?? [], runtime, RUNTIME_LABELS, { provider });
  const displayName = currentName || defaultNameForRuntime(activeRuntime, selectedProviderSlug);
  const currentSoulPrompt = agentSettingsSoulPrompt ?? "";
  const defaultSubclassSoul = renderBeeSoulTemplate(agentSettingsWorkerPreset?.soulTemplate, currentName || displayName);
  const adaptiveOpenRouter = agentCreateMachine ? agentCreateDraft.adaptiveOpenRouter ?? {} : roleModalAgent?.adaptiveOpenRouter ?? {};
  const adaptiveRouting = agentCreateMachine ? agentCreateDraft.adaptiveRouting ?? {} : roleModalAgent?.adaptiveRouting ?? {};
  const usePodConfig = agentCreateMachine ? agentCreateDraft.usePod ?? {} : roleModalAgent?.usePod ?? {};
  const veniceConfig = agentCreateMachine ? agentCreateDraft.venice ?? {} : roleModalAgent?.venice ?? {};
  const hivemindosModelsConfig = agentCreateMachine ? agentCreateDraft.hivemindosModels ?? {} : roleModalAgent?.hivemindosModels ?? {};
  const usePodSetupStarted = hasUsePodSetup(usePodConfig);
  const usePodSetupComplete = isUsePodSetupReady(usePodConfig);
  const usePodCreateBlocked = Boolean(agentCreateMachine && usePodSelected && !usePodSetupComplete);
  const veniceSelected = selectedProviderSlug === "venice";
  const veniceSetupComplete = isVeniceSetupReady(veniceConfig);
  const veniceCreateBlocked = Boolean(agentCreateMachine && veniceSelected && !veniceSetupComplete);
  const hivemindosModelsSetupComplete = isHivemindosModelsSetupReady(
    hivemindosModelsConfig,
    agentCreateMachine ? agentCreateDraft.model : roleModalAgent?.model,
  );
  // The HivemindOS panel IS the model selector for this provider — it
  // always renders inline while the provider is selected (no separate setup
  // screen; funding lives in the panel's own modal).
  const shouldShowHivemindosModelsSetup = hivemindosModelsSelected;
  const hivemindosModelsCreateBlocked = Boolean(agentCreateMachine && hivemindosModelsSelected && !hivemindosModelsSetupComplete);
  const agentTaskPreferences = (agentCreateMachine ? agentCreateDraft.taskPreferences : roleModalAgent?.taskPreferences) ?? [];
  const researchSubclassSelected = agentSettingsWorkerClass === "research" && !agentSettingsCustomWorker;
  const selectedResearchMethod = normalizeResearchMethod(agentCreateMachine ? agentCreateDraft.researchMethod : roleModalAgent?.researchMethod);
  const selectedRuntimeModelOption = (selectedRuntimeModels ?? []).find((model) => model.id === selectedRuntimeModelId);
  const bankrSetupDetail = runtimeIntegrationStatus?.diagnostics?.find((item) => /Bankr LLM models unavailable/i.test(item)) ?? "";
  const bankrInvalidKey = /(?:invalid|inactive|unauthorized|401).*api key|api key.*(?:invalid|inactive|unauthorized)/i.test(bankrSetupDetail);
  const bankrNeedsKeySetup = bankrInvalidKey || /BANKR_LLM_KEY.*(not configured|required|missing)|missing.*BANKR_LLM_KEY/i.test(bankrSetupDetail);
  const bankrLowCredits = /insufficient_credits|credits exhausted|402|balance|fund/i.test(bankrSetupDetail);
  const bankrSetupVisible = bankrLlmSelected && Boolean(bankrSetupDetail);
  const bankrCreditStatus = runtimeIntegrationStatus?.providerStatus?.bankr;
  const bankrInitialCredits = bankrCreditStatus ? { ok: true, balanceUsd: bankrCreditStatus.creditsBalanceUsd, balanceLabel: bankrCreditStatus.balanceLabel ?? (bankrCreditStatus.creditsBalanceUsd === null ? "Unknown" : undefined), error: bankrCreditStatus.error } : undefined;
  const lmStudioStatus = runtimeIntegrationStatus?.providerStatus?.lmStudio;
  const sieStatus = runtimeIntegrationStatus?.providerStatus?.sie;
  const lmStudioActiveDownloadCount = (lmStudioStatus?.downloads ?? []).filter((download) => download.state === "queued" || download.state === "downloading").length;
  // Queen voice brain degradation: voice turns are silently bypassing this
  // agent's configured model and falling back to the OpenAI fallback model.
  const queenVoiceBrainAlert = runtimeIntegrationStatus?.queenVoiceBrain?.degraded
    ? runtimeIntegrationStatus.queenVoiceBrain
    : null;
  const fetchedSelectedModels = fetchedProviderModels[selectedProviderSlug] ?? [];
  const effectiveSelectedModels = fetchedSelectedModels.length > (selectedRuntimeModels?.length ?? 0) ? fetchedSelectedModels : (selectedRuntimeModels ?? []);
  const runtimeModelOptions = adaptiveProviderSelected
    ? [{ id: "best-free", name: "Best free" }]
    : openRouterSelected
      ? [{ id: "adaptive", name: "Adaptive" }, ...effectiveSelectedModels.filter((model) => model.id !== "adaptive")]
      : gateBankrModelsForCredits(effectiveSelectedModels, bankrLlmSelected && bankrLowCredits);
  const lmStudioInventoryModelCount = lmStudioStatus?.models?.length ?? 0;
  const lmStudioHasDiscoveredModels = runtimeModelOptions.length > 0 || lmStudioInventoryModelCount > 0;
  const lmStudioDiscoveryPending = Boolean(lmStudioSelected && !lmStudioHasDiscoveredModels && (runtimeIntegrationBusy === "status" || lmStudioEmptyDiscoveryGraceActive));
  const sieHasDiscoveredModels = Boolean(sieStatus?.models?.length);
  const sieDiscoveryPending = Boolean(sieSelected && !sieHasDiscoveredModels && (runtimeIntegrationBusy === "status" || sieEmptyDiscoveryGraceActive));
  const sieActiveLifecycleCount = (sieStatus?.models ?? []).filter((model) => model.state === "loading" || model.state === "unloading").length;
  const selectedLmStudioInventoryModel = lmStudioStatus?.models?.find((model) => model.key === selectedRuntimeModelId && model.type === "llm");
  const lmStudioSelectedModelLoaded = Boolean(selectedLmStudioInventoryModel?.loaded || selectedRuntimeModelOption?.subtitle === "Loaded" || selectedRuntimeModelOption?.badge === "Loaded");
  const lmStudioSelectedModelLoading = Boolean(lmStudioSelected && selectedRuntimeModelId && lmStudioPendingLoadModelKeys.includes(selectedRuntimeModelId) && !lmStudioSelectedModelLoaded);
  const lmStudioSelectedModelNeedsLoad = Boolean(lmStudioSelected && selectedRuntimeModelId && selectedRuntimeModelId !== "adaptive" && (
    selectedLmStudioInventoryModel ? !selectedLmStudioInventoryModel.loaded : selectedRuntimeModelOption?.subtitle === "Downloaded" || selectedRuntimeModelOption?.subtitle === "Available"
  ));
  const modelSelectableRuntime = Boolean(runtimeCapabilities(agentSettingsIntegrationTarget ?? roleModalAgent)?.modelSelection);
  const runtimeModelPanelAvailable = runtimeSettings.modelSource === "runtime" && (
    runtimeModelProviders.length > 0
      || modelSelectableRuntime
      || runtimeIntegrationBusy === "status"
      || Boolean(runtimeIntegrationMessage)
  );
  const runtimeCanAddModels = Boolean(runtimeSettings.canAddModels);
  const runtimeCanAddCustomModel = runtimeCanAddModels && runtimeModelProviders.length > 0;
  const hideRuntimeSection = !agentCreateMachine && Boolean(runtimeSettings.hidesRuntimeSelectorWhenEditing);
  const runtimeSelectorEntries = Object.entries(RUNTIME_LABELS).filter(([runtime]) => runtime !== HIVEMIND_OS_RUNTIME || activeRuntime === HIVEMIND_OS_RUNTIME);
  const showWorkerClassSection = !isAutopilotSettings && !(usePodSelected && !usePodSetupComplete) && !(veniceSelected && !veniceSetupComplete) && !(hivemindosModelsSelected && !hivemindosModelsSetupComplete) && !isQueenSettings;
  const agentStatus = agentCreateMachine ? "New profile" : roleModalAgent?.telemetryUrl ? "Connected" : "Local profile";
  const workerSubtitle = (agentSettingsCustomWorker?.label || agentSettingsWorkerPreset?.label || agentSettingsWorkerLabel || "").replace(/\s+bee$/i, "").trim();
  const aeonSettings = {
    mode: (agentCreateMachine ? agentCreateDraft.aeonMode : roleModalAgent?.aeonMode) === "local" ? "local" : "github",
    repo: agentCreateMachine ? agentCreateDraft.aeonRepo || "" : roleModalAgent?.aeonRepo || "",
    branch: agentCreateMachine ? agentCreateDraft.aeonBranch || "main" : roleModalAgent?.aeonBranch || "main",
    path: agentCreateMachine ? agentCreateDraft.aeonLocalPath || "~/.aeon" : roleModalAgent?.aeonLocalPath || roleModalAgent?.localDataDir || "",
  };
  const runtimeFolderValue = roleModalAgent ? isAutopilotSettings ? roleModalAgent.aeonLocalPath || roleModalAgent.localDataDir || "" : roleModalAgent.localDataDir || "" : "";
  const targetMachineRuntimes = agentCreateMachine?.capabilities?.runtimes ?? [];
  // An explicit [] from a ready collector means "no runtimes installed", not
  // "inventory unknown". Treat it as authoritative so a fresh machine opens
  // the shared in-app downloader instead of falling back to local setup state.
  const targetMachineHasRuntimeInventory = Array.isArray(agentCreateMachine?.capabilities?.runtimes);
  const activeRuntimeNeedsSetup = runtimeNotConfigured(activeRuntime) && runtimeHasInstallSetup(activeRuntime);

  function runtimeNotConfigured(runtime: string) {
    return runtime !== "aeon" && runtime !== HIVEMIND_OS_RUNTIME && (agentCreateMachine && targetMachineHasRuntimeInventory ? !targetMachineRuntimes.includes(runtime) : runtimeAvailability?.[runtime]?.installed === false);
  }

  function providerConfigured(slug: string) {
    const entry = providerCatalogEntry(slug);
    if (!entry) return true;
    if (entry.virtual || entry.keyless) return true;
    return Boolean(entry.keyEnv && envPresentKeys.has(entry.keyEnv));
  }

  function providerNeedsKey(slug: string) {
    if (!envLoaded) return false;
    const entry = providerCatalogEntry(slug);
    return Boolean(entry?.keyEnv) && !entry?.guidedSetup && !providerConfigured(slug);
  }

  const selectedUsesXaiOAuth = selectedProviderSlug === XAI_PROVIDER_SLUG && selectedProviderView.credentialMode === "oauth";
  const selectedNeedsKey = !selectedUsesXaiOAuth && providerNeedsKey(selectedProviderSlug);
  const selectedSupportsXaiOAuth = providerSupportsCredentialMode(selectedProviderSlug, "oauth");
  const selectedNeedsXaiOAuthSetup = selectedSupportsXaiOAuth && selectedUsesXaiOAuth && (!xaiOAuthStatusLoaded || !xaiOAuthConnected);
  const existingUsePodAgents = (displayAgents ?? []).filter((agent) => agent.provider === "usepod" && hasUsePodSetup(agent.usePod));
  const unfinishedUsePodAgent = agentCreateMachine && !usePodSetupStarted ? existingUsePodAgents.find((agent) => !isUsePodSetupReady(agent.usePod)) ?? null : null;
  const completedUsePodWallets = unfinishedUsePodAgent ? [] : existingUsePodAgents.filter((agent) => isUsePodSetupReady(agent.usePod));
  const usePodDraftSetupTarget = agentCreateMachine ? { id: "new-usepod-draft", name: displayName, provider: "usepod", model: agentCreateDraft.model, usePod: agentCreateDraft.usePod } : null;
  const usePodSetupTarget = unfinishedUsePodAgent ?? usePodDraftSetupTarget ?? agentSettingsIntegrationTarget;
  const usePodRequiresCurrentSetup = usePodSetupStarted || Boolean(unfinishedUsePodAgent);
  const existingVeniceAgents = (displayAgents ?? []).filter((agent) => agent.provider === "venice" && hasVeniceSetup(agent.venice));
  const completedVeniceWallets = existingVeniceAgents.filter((agent) => isVeniceSetupReady(agent.venice));
  const veniceDraftSetupTarget = agentCreateMachine ? { id: "new-venice-draft", name: displayName, provider: "venice", model: agentCreateDraft.model, venice: agentCreateDraft.venice } : null;
  const veniceSetupTarget = veniceDraftSetupTarget ?? agentSettingsIntegrationTarget;
  const veniceRequiresCurrentSetup = hasVeniceSetup(veniceConfig);
  const hivemindosModelsDraftSetupTarget = agentCreateMachine ? {
    id: "new-hivemindos-models-draft",
    name: displayName,
    provider: HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
    model: agentCreateDraft.model || HIVEMINDOS_MODELS_PROVIDER?.defaultModel,
    hivemindosModels: agentCreateDraft.hivemindosModels,
  } : null;
  const hivemindosModelsSetupTarget = hivemindosModelsDraftSetupTarget ?? agentSettingsIntegrationTarget;
  function xaiOAuthHermesHomes() {
    const targetAgent = agentSettingsIntegrationTarget ?? roleModalAgent ?? undefined;
    return targetAgent?.runtime === "hermes" && targetAgent.localDataDir
      ? [targetAgent.localDataDir]
      : [];
  }
  function xaiOAuthStatusEndpoint() {
    const params = new URLSearchParams({ sync: "1" });
    for (const home of xaiOAuthHermesHomes()) params.append("hermesHome", home);
    return `/api/xai-oauth?${params.toString()}`;
  }
  async function startXaiOAuthLogin() {
    const response = await fetch("/api/xai-oauth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (!response?.ok || data?.ok === false) {
      return { ok: false, error: data?.error || "Could not start xAI OAuth sign-in." };
    }
    return {
      ok: true,
      authorizeUrl: data?.authorizeUrl || data?.authorizationUrl,
      statusEndpoint: data?.statusEndpoint || "/api/xai-oauth",
      message: data?.message || "xAI sign-in opened in your browser. Finish the OAuth page to connect Grok.",
    };
  }
  async function submitXaiOAuthCode(code: string) {
    const response = await fetch("/api/xai-oauth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit-code", code }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (!response?.ok || data?.ok === false) {
      return { ok: false, error: data?.error || "Could not finish xAI OAuth with that code." };
    }
    return {
      ok: true,
      warnings: Array.isArray(data?.warnings) ? data.warnings : [],
      statusEndpoint: data?.statusEndpoint || "/api/xai-oauth",
      message: data?.message || "xAI OAuth connected. Refreshing models.",
    };
  }
  function preferredXaiModelId() {
    return /^grok[-\w.]+$/i.test(selectedRuntimeModelId || "")
      ? selectedRuntimeModelId
      : XAI_OAUTH_DEFAULT_MODEL;
  }
  function selectXaiCredentialMode(mode: "api-key" | "oauth") {
    updateAgentRuntimeModel(runtimeProviderForCredentialMode(XAI_PROVIDER_SLUG, mode), preferredXaiModelId());
  }
  async function applyXaiOAuthProviderSelection() {
    setXaiOAuthConnected(true);
    setXaiOAuthStatusLoaded(true);
    selectXaiCredentialMode("oauth");
  }
  const xaiOAuthStatusUrl = selectedSupportsXaiOAuth ? xaiOAuthStatusEndpoint() : "";
  const creditProviderBalances = {
    bankr: bankrCreditStatus?.balanceLabel ?? "",
    usepod: (() => {
      const value = runtimeIntegrationStatus?.providerStatus?.usePod?.balanceRemaining || usePodConfig.lastBalanceRemaining || completedUsePodWallets.find((agent) => agent.usePod?.lastBalanceRemaining)?.usePod?.lastBalanceRemaining || "";
      return value && /^[\d\s,.]+$/.test(value) ? `$${value.trim()}` : value;
    })(),
    venice: (() => {
      const value = runtimeIntegrationStatus?.providerStatus?.venice?.balanceUsd || veniceConfig.lastBalanceUsd || completedVeniceWallets.find((agent) => agent.venice?.lastBalanceUsd)?.venice?.lastBalanceUsd || "";
      return value && /^[\d\s,.]+$/.test(value) ? `$${value.trim()}` : value;
    })(),
    [HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER]: hivemindosModelsConfig.lastCreditBalanceLabel || "",
  };

  const refreshSavedAgentSouls = useCallback(async () => {
    try {
      const response = await fetch("/api/agents/souls", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not load saved SOUL.md files.");
      setSavedAgentSouls(Array.isArray(data.souls) ? data.souls : []);
      setSavedAgentSoulsStatus("");
    } catch (error) {
      setSavedAgentSoulsStatus(error instanceof Error ? error.message : "Could not load saved SOUL.md files.");
    }
  }, []);

  const refreshAgentMailboxStatus = useCallback(async () => {
    if (!roleModalAgent?.id) {
      setAgentMailboxOverview(null);
      setAgentMailboxError("");
      return;
    }
    try {
      const response = await fetch(`/api/agents/mailbox?agentId=${encodeURIComponent(roleModalAgent.id)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not load agent mailbox status.");
      setAgentMailboxOverview(data);
      setAgentMailboxError("");
    } catch (error) {
      setAgentMailboxError(error instanceof Error ? error.message : "Could not load agent mailbox status.");
    }
  }, [roleModalAgent]);

  useEffect(() => {
    if (!modalOpen) return;
    const timer = window.setTimeout(() => void refreshSavedAgentSouls(), 0);
    return () => window.clearTimeout(timer);
  }, [modalOpen, refreshSavedAgentSouls]);

  useEffect(() => {
    if (!modalOpen || !roleModalAgent?.id) return;
    const timer = window.setTimeout(() => void refreshAgentMailboxStatus(), 0);
    return () => window.clearTimeout(timer);
  }, [modalOpen, refreshAgentMailboxStatus, roleModalAgent?.id]);

  useEffect(() => {
    if (!modalOpen) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/env", { credentials: "same-origin", headers: { Accept: "application/json" } }).catch(() => null);
      if (!response || !response.ok) return;
      const data = await response.json().catch(() => null);
      if (cancelled || !data) return;
      const present = new Set();
      const hermes = new Set();
      const collect = (source, into) => {
        for (const key of Object.keys(source?.values ?? {})) {
          present.add(key);
          if (into) into.add(key);
        }
      };
      collect(data.sharedSource, null);
      for (const source of data.runtimeSources ?? []) collect(source, source?.runtime === "hermes" ? hermes : null);
      if (cancelled) return;
      setEnvPresentKeys(present);
      setEnvHermesKeys(hermes);
      setEnvLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [modalOpen, envRefreshKey]);

  useEffect(() => {
    if (!modalOpen || !envLoaded) return;
    const liveCapable = (slug) => {
      const entry = providerCatalogEntry(slug);
      if (!entry?.keyEnv || entry.virtual) return false;
      return Boolean(entry.baseUrl) || slug === "usepod";
    };
    const targets = [...new Set(runtimeModelProviders.map((provider) => provider.slug))].filter((slug) => {
      const entry = providerCatalogEntry(slug);
      return liveCapable(slug) && entry?.keyEnv && envPresentKeys.has(entry.keyEnv) && !(slug in fetchedProviderModels);
    });
    if (!targets.length) return;
    let cancelled = false;
    targets.forEach((slug) => {
      void (async () => {
        const response = await fetch(`/api/providers/models?provider=${encodeURIComponent(slug)}`, {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        }).catch(() => null);
        const data = response && response.ok ? await response.json().catch(() => null) : null;
        if (cancelled) return;
        setFetchedProviderModels((current) => (slug in current ? current : { ...current, [slug]: Array.isArray(data?.models) ? data.models : [] }));
      })();
    });
    return () => { cancelled = true; };
  }, [modalOpen, envLoaded, runtimeModelProviders, envPresentKeys, fetchedProviderModels]);

  useEffect(() => {
    if (!modalOpen || !selectedSupportsXaiOAuth || !xaiOAuthStatusUrl) return;
    let cancelled = false;
    const resetTimer = window.setTimeout(() => {
      if (!cancelled) setXaiOAuthStatusLoaded(false);
    }, 0);
    void (async () => {
      const response = await fetch(xaiOAuthStatusUrl, { cache: "no-store" }).catch(() => null);
      const data = response && response.ok ? await response.json().catch(() => null) : null;
      if (cancelled) return;
      setXaiOAuthConnected(Boolean(data?.usable || data?.login?.phase === "connected"));
      setXaiOAuthStatusLoaded(true);
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(resetTimer);
    };
  }, [modalOpen, selectedSupportsXaiOAuth, xaiOAuthStatusUrl, envRefreshKey]);

  useEffect(() => {
    if (!modalOpen || !lmStudioSelected || lmStudioHasDiscoveredModels) {
      const clearGrace = window.setTimeout(() => setLmStudioEmptyDiscoveryGraceActive(false), 0);
      return () => window.clearTimeout(clearGrace);
    }
    const startGrace = window.setTimeout(() => setLmStudioEmptyDiscoveryGraceActive(true), 0);
    const stopGrace = window.setTimeout(() => setLmStudioEmptyDiscoveryGraceActive(false), LM_STUDIO_EMPTY_DISCOVERY_GRACE_MS);
    return () => {
      window.clearTimeout(startGrace);
      window.clearTimeout(stopGrace);
    };
  }, [lmStudioHasDiscoveredModels, lmStudioSelected, modalOpen, runtimeIntegrationBusy, selectedProviderSlug]);

  useEffect(() => {
    if (!modalOpen || !sieSelected || sieHasDiscoveredModels) {
      const clearGrace = window.setTimeout(() => setSieEmptyDiscoveryGraceActive(false), 0);
      return () => window.clearTimeout(clearGrace);
    }
    const startGrace = window.setTimeout(() => setSieEmptyDiscoveryGraceActive(true), 0);
    const stopGrace = window.setTimeout(() => setSieEmptyDiscoveryGraceActive(false), LM_STUDIO_EMPTY_DISCOVERY_GRACE_MS);
    return () => {
      window.clearTimeout(startGrace);
      window.clearTimeout(stopGrace);
    };
  }, [modalOpen, runtimeIntegrationBusy, selectedProviderSlug, sieHasDiscoveredModels, sieSelected]);

  useEffect(() => {
    if (!lmStudioPendingLoadModelKeys.length) return;
    const loadedKeys = new Set((lmStudioStatus?.models ?? []).filter((model) => model.loaded).map((model) => model.key));
    if (!loadedKeys.size) return;
    const clearLoaded = window.setTimeout(() => setLmStudioPendingLoadModelKeys((current) => current.filter((key) => !loadedKeys.has(key))), 0);
    return () => window.clearTimeout(clearLoaded);
  }, [lmStudioPendingLoadModelKeys.length, lmStudioStatus?.models]);

  useEffect(() => {
    if (!modalOpen || !lmStudioSelected || !lmStudioPendingLoadModelKeys.length || !agentSettingsIntegrationTarget) return;
    const refresh = () => { if (runtimeIntegrationBusy !== "status") void refreshRuntimeIntegrations(agentSettingsIntegrationTarget); };
    const initial = window.setTimeout(refresh, 900);
    const interval = window.setInterval(refresh, 2500);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [agentSettingsIntegrationTarget, lmStudioPendingLoadModelKeys, lmStudioSelected, modalOpen, refreshRuntimeIntegrations, runtimeIntegrationBusy]);

  useEffect(() => {
    if (!modalOpen || !lmStudioSelected || !lmStudioActiveDownloadCount || !agentSettingsIntegrationTarget) return;
    const refresh = () => { if (runtimeIntegrationBusy !== "status") void refreshRuntimeIntegrations(agentSettingsIntegrationTarget); };
    const initial = window.setTimeout(refresh, 900);
    const interval = window.setInterval(refresh, 2500);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [agentSettingsIntegrationTarget, lmStudioActiveDownloadCount, lmStudioSelected, modalOpen, refreshRuntimeIntegrations, runtimeIntegrationBusy]);

  useEffect(() => {
    if (!modalOpen || !sieSelected || !sieActiveLifecycleCount || !agentSettingsIntegrationTarget) return;
    const refresh = () => { if (runtimeIntegrationBusy !== "status") void refreshRuntimeIntegrations(agentSettingsIntegrationTarget); };
    const initial = window.setTimeout(refresh, 900);
    const interval = window.setInterval(refresh, 2500);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [agentSettingsIntegrationTarget, modalOpen, refreshRuntimeIntegrations, runtimeIntegrationBusy, sieActiveLifecycleCount, sieSelected]);

  useEffect(() => {
    const configuredModel = agentCreateMachine ? agentCreateDraft.model : roleModalAgent?.model;
    const firstChatModel = (sieStatus?.models ?? []).find((model) => model.chatCompatible);
    if (!modalOpen || !sieSelected || configuredModel || !firstChatModel) return;
    const selectFirstModel = window.setTimeout(() => updateAgentRuntimeModel(SIE_PROVIDER_ID, firstChatModel.key), 0);
    return () => window.clearTimeout(selectFirstModel);
  }, [agentCreateDraft.model, agentCreateMachine, modalOpen, roleModalAgent?.model, sieSelected, sieStatus?.models, updateAgentRuntimeModel]);

  useEffect(() => {
    if (!lmStudioPendingPrimaryAction || !selectedRuntimeModelId || !lmStudioSelectedModelLoaded || lmStudioSelectedModelLoading) return;
    const action = lmStudioPendingPrimaryAction;
    const continueAfterLoad = window.setTimeout(() => {
      setLmStudioPendingPrimaryAction(null);
      if (action === "create" && agentCreateMachine) void createAgentFromModal();
      else closeAgentSettingsModal();
    }, 0);
    return () => window.clearTimeout(continueAfterLoad);
  }, [agentCreateMachine, closeAgentSettingsModal, createAgentFromModal, lmStudioPendingPrimaryAction, lmStudioSelectedModelLoaded, lmStudioSelectedModelLoading, selectedRuntimeModelId]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAgentSettingsModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeAgentSettingsModal, modalOpen]);

  if (!modalOpen) return null;

  async function createMailboxForCurrentAgent() {
    if (!roleModalAgent?.id) return;
    setAgentMailboxBusy(true);
    setAgentMailboxError("");
    try {
      const response = await fetch("/api/agents/mailbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", agentId: roleModalAgent.id, agentName: roleModalAgent.name }),
      });
      const data = await response.json().catch(() => ({}));
      setAgentMailboxOverview(data.ok ? { ok: true, mailboxes: data.mailbox ? [data.mailbox] : [], providerStatus: data.providerStatus } : { ok: false, mailboxes: [], providerStatus: data.providerStatus });
      if (!response.ok || data.ok === false) throw new Error(data.error || data.providerStatus?.detail || "Could not create this agent mailbox.");
    } catch (error) {
      setAgentMailboxError(error instanceof Error ? error.message : "Could not create this agent mailbox.");
    } finally {
      setAgentMailboxBusy(false);
    }
  }

  async function importSoulFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const content = (await file.text()).trim();
      if (!content) throw new Error("That SOUL.md is empty.");
      updateAgentSoulPrompt(content);
      setSavedAgentSoulsStatus(`Imported ${file.name}.`);
    } catch (error) {
      setSavedAgentSoulsStatus(error instanceof Error ? error.message : "Could not import that SOUL.md.");
    }
  }

  async function saveCurrentSoulAsNew() {
    const title = soulSaveTitle.trim();
    const content = currentSoulPrompt.trim();
    if (!title || !content) return;
    try {
      const response = await fetch("/api/agents/souls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not save SOUL.md.");
      setSoulSaveTitle("");
      setSavedAgentSoulsStatus("Saved as a new SOUL.md.");
      await refreshSavedAgentSouls();
    } catch (error) {
      setSavedAgentSoulsStatus(error instanceof Error ? error.message : "Could not save SOUL.md.");
    }
  }

  function loadSavedSoul(id: string) {
    const savedSoul = savedAgentSouls.find((soul) => soul.id === id);
    if (!savedSoul?.content) return;
    updateAgentSoulPrompt(savedSoul.content);
    setSavedAgentSoulsStatus(`Loaded ${savedSoul.title}.`);
  }

  function updateName(name: string) {
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, name }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { name });
  }

  function updateAeonSettings(patch: Record<string, unknown>) {
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => ({ ...current, ...patch }));
      return;
    }
    if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
  }

  async function loadLmStudioModel(modelKey: string, modelType?: string, pendingPrimaryAction: "save" | "create" | null = null) {
    if (!agentSettingsIntegrationTarget || !modelKey) return false;
    setLmStudioPendingLoadModelKeys((current) => current.includes(modelKey) ? current : [...current, modelKey]);
    setLmStudioPendingPrimaryAction(pendingPrimaryAction);
    const result = await runRuntimeIntegrationAction("load-model", {
      model: modelKey,
    }, {
      ...agentSettingsIntegrationTarget,
      provider: selectedProviderSlug,
      model: modelKey,
    });
    if (result?.ok === false) {
      setLmStudioPendingLoadModelKeys((current) => current.filter((key) => key !== modelKey));
      setLmStudioPendingPrimaryAction((current) => current === pendingPrimaryAction ? null : current);
    }
    return result?.ok !== false;
  }

  function selectLocalModel(modelKey: string, model?: { source?: string; baseUrl?: string; chatPath?: string; statusPath?: string }) {
    const baseUrl = model?.source === "openai-server" ? model.baseUrl?.trim().replace(/\/+$/, "") : "";
    if (activeRuntime === HIVEMIND_OS_RUNTIME && baseUrl) {
      const patch = {
        provider: selectedProviderSlug,
        model: modelKey,
        gatewayUrl: baseUrl,
        chatPath: model?.chatPath || "/v1/chat/completions",
        statusPath: model?.statusPath || "/v1/models",
      };
      if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, ...patch }));
      else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
      return;
    }
    updateAgentRuntimeModel(selectedProviderSlug, modelKey);
  }

  function patchSieProfile(patch: Record<string, unknown>) {
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, ...patch }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
  }

  function selectSieProvider() {
    const availableModels = (sieStatus?.models ?? []).filter((model) => model.chatCompatible);
    const currentModel = agentCreateMachine ? agentCreateDraft.model : roleModalAgent?.model;
    const model = currentModel && availableModels.some((entry) => entry.key === currentModel)
      ? currentModel
      : availableModels[0]?.key || "";
    const currentProvider = agentCreateMachine ? agentCreateDraft.provider : roleModalAgent?.provider;
    const currentBaseUrl = agentCreateMachine ? agentCreateDraft.gatewayUrl : roleModalAgent?.gatewayUrl;
    const patch = {
      provider: SIE_PROVIDER_ID,
      model,
      gatewayUrl: currentProvider === SIE_PROVIDER_ID && currentBaseUrl?.trim() ? currentBaseUrl : SIE_RUNTIME.defaultBaseUrl,
      chatPath: SIE_RUNTIME.chatPath,
      statusPath: SIE_RUNTIME.modelsPath,
    };
    patchSieProfile(patch);
    if (model) updateAgentRuntimeModel(SIE_PROVIDER_ID, model);
    void refreshRuntimeIntegrations({ ...(agentSettingsIntegrationTarget ?? {}), ...patch });
  }

  function selectSieModel(modelKey: string) {
    if (!modelKey) return;
    const patch = {
      provider: SIE_PROVIDER_ID,
      model: modelKey,
      gatewayUrl: sieStatus?.baseUrl || SIE_RUNTIME.defaultBaseUrl,
      chatPath: SIE_RUNTIME.chatPath,
      statusPath: SIE_RUNTIME.modelsPath,
    };
    patchSieProfile(patch);
    updateAgentRuntimeModel(SIE_PROVIDER_ID, modelKey);
  }

  async function updateSieEndpoint(baseUrl: string) {
    const patch = {
      provider: SIE_PROVIDER_ID,
      gatewayUrl: baseUrl,
      chatPath: SIE_RUNTIME.chatPath,
      statusPath: SIE_RUNTIME.modelsPath,
    };
    patchSieProfile(patch);
    await refreshRuntimeIntegrations({ ...(agentSettingsIntegrationTarget ?? {}), ...patch });
  }

  async function runPrimarySettingsAction() {
    if (lmStudioSelectedModelNeedsLoad) {
      if (!lmStudioSelectedModelLoading && selectedRuntimeModelId) {
        await loadLmStudioModel(selectedRuntimeModelId, selectedLmStudioInventoryModel?.type, agentCreateMachine ? "create" : "save");
      }
      return;
    }
    if (agentCreateMachine) {
      await createAgentFromModal();
      return;
    }
    closeAgentSettingsModal();
  }

  function updateResearchMethod(researchMethod) {
    const next = normalizeResearchMethod(researchMethod);
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, researchMethod: next }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { researchMethod: next });
  }

  function updateAgentTaskPreferences(next) {
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, taskPreferences: next }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { taskPreferences: next });
  }

  function updateAdaptiveOpenRouter(patch: Record<string, unknown>) {
    const next = { ...adaptiveOpenRouter, ...patch };
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, adaptiveOpenRouter: next }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { adaptiveOpenRouter: next });
  }

  function updateAdaptiveRouting(patch: Record<string, unknown>) {
    const next = { ...adaptiveRouting, ...patch };
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, adaptiveRouting: next }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { adaptiveRouting: next });
  }

  async function applyUsePodProfile(patch: Record<string, unknown>) {
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, ...patch }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
    await refreshRuntimeIntegrations({ ...(agentSettingsIntegrationTarget ?? {}), ...patch });
  }

  async function applyUsePodSetupProfile(patch: Record<string, unknown>) {
    if (agentCreateMachine && unfinishedUsePodAgent) {
      updateAgentProfile(unfinishedUsePodAgent.id, patch);
      await refreshRuntimeIntegrations({ ...unfinishedUsePodAgent, ...patch });
      return;
    }
    await applyUsePodProfile(patch);
  }

  async function applyVeniceSetupProfile(patch: Record<string, unknown>) {
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, ...patch }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
    void refreshRuntimeIntegrations({ ...(agentSettingsIntegrationTarget ?? {}), ...patch });
  }

  async function applyHivemindosModelsSetupProfile(patch: Record<string, unknown>) {
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, ...patch }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
    void refreshRuntimeIntegrations({ ...(agentSettingsIntegrationTarget ?? {}), ...patch });
  }

  async function openAeonGithubOauth() {
    if (aeonOauthConnecting) return;
    setAeonOauthConnecting(true);
    updateAeonSettings({ aeonMode: "github" });
    try {
      // External-browser pattern: fetch the ABSOLUTE GitHub authorization URL
      // (source=aeon rides in the signed state, steering the callback's return
      // URL back to the Aeon panel) and open it OUTSIDE the app window — the
      // external browser has no dashboard session, so the old same-origin GET
      // navigation would 401 at the proxy out there.
      const response = await fetch("/api/integrations/github/oauth/start?source=aeon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Desktop flows: the callback deep-links back to the AEON panel via
        // hivemindos://, carried in the signed state.
        body: JSON.stringify(oauthReturnMode() ? { returnMode: oauthReturnMode() } : {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok === false || !data?.authorizationUrl) {
        throw new Error(data?.error || "GitHub sign-in could not start.");
      }
      await openExternalUrl(data.authorizationUrl);
    } catch {
      // The Connect button re-enables so the user can retry.
    } finally {
      setAeonOauthConnecting(false);
    }
  }

  function updateSettingsRuntime(runtime: AgentRuntime) {
    const notConfigured = runtimeNotConfigured(runtime);
    if (notConfigured && !runtimeHasInstallSetup(runtime)) return;
    setRuntimeModelSetupMode(null);
    const sameRuntime = runtime === activeRuntime;
    const currentProvider = agentCreateMachine ? agentCreateDraft.provider : roleModalAgent?.provider;
    const currentModel = agentCreateMachine ? agentCreateDraft.model : roleModalAgent?.model;
    const aeonWorkerPreset = BEE_WORKER_PRESET_LIST.find((preset) => preset.id === "ops");
    const nextSettings = runtimeSettingsFeature(runtime);
    const providerModels = runtime === activeRuntime ? runtimeModelProviders : runtimeModelSelectionsByRuntime?.[runtime]?.providers ?? [];
    const provider = sameRuntime ? currentProvider || nextSettings.defaultProvider || "" : nextSettings.defaultProvider || "";
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
      rememberMruRuntime(runtime);
      setAgentCreateDraft((current) => ({
        ...current,
        runtime,
        provider,
        model,
        workerClass: !current.selectedCustomWorkerClassId && current.workerClass === (runtimeProfileFeature(current.runtime).defaultWorkerClass ?? "general") ? runtimeProfileFeature(runtime).defaultWorkerClass ?? "general" : current.workerClass,
        name: current.name.trim()
          && current.name !== `${RUNTIME_LABELS[current.runtime] ?? current.runtime} on ${agentCreateMachine.name}`
          && current.name !== defaultNameForRuntime(current.runtime, current.provider)
          ? current.name
          : defaultNameForRuntime(runtime, provider),
        ...(nextSettings.kind === "autopilot" && aeonWorkerPreset ? {
          workerClass: aeonWorkerPreset.id,
          soulPrompt: renderBeeSoulTemplate(aeonWorkerPreset.soulTemplate, current.name),
          skillProfilePrompt: aeonWorkerPreset.taskProfile,
          preferredSkillSlugs: aeonWorkerPreset.skillSlugs,
          aeonLocalPath: current.aeonLocalPath || "~/.aeon",
          aeonRepo: current.aeonRepo || "",
          aeonBranch: current.aeonBranch || "main",
          aeonMode: current.aeonMode || "github",
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
        } : {}),
      });
    }
  }

  function selectUsePodProvider() {
    const currentModel = agentCreateMachine ? agentCreateDraft.model : roleModalAgent?.model;
    const model = currentModel && currentModel !== "adaptive" ? currentModel : USEPOD_PROVIDER.defaultModel;
    const usePodStatus = runtimeIntegrationStatus?.providerStatus?.usePod ?? {};
    const patch = {
      provider: "usepod",
      model,
      ...(activeRuntime === HIVEMIND_OS_RUNTIME ? {
        gatewayUrl: "https://api.usepod.ai",
        chatPath: "/v1/chat/completions",
        statusPath: "/v1/models",
      } : {}),
      usePod: {
        tokenEnvName: usePodConfig.tokenEnvName || usePodStatus.tokenEnvName || "USEPOD_TOKEN",
        depositAddress: usePodConfig.depositAddress || usePodStatus.depositAddress || "",
        depositCode: usePodConfig.depositCode || usePodStatus.depositCode || "",
        dashboardUrl: usePodConfig.dashboardUrl || usePodStatus.dashboardUrl || "",
        maxPriceInputMicrounits: usePodConfig.maxPriceInputMicrounits || "2000",
        maxPriceOutputMicrounits: usePodConfig.maxPriceOutputMicrounits || "8000",
        spendPreset: usePodConfig.spendPreset || "balanced",
        lastBalanceRemaining: usePodConfig.lastBalanceRemaining || usePodStatus.balanceRemaining || "",
        lastRoute: usePodConfig.lastRoute || usePodStatus.route || "",
        lastCheckedAt: usePodConfig.lastCheckedAt || usePodStatus.checkedAt || "",
        lastTestStatus: usePodConfig.lastTestStatus || usePodStatus.status || "",
        lastModelCount: usePodConfig.lastModelCount ?? usePodStatus.modelCount,
        lastTokenPresent: usePodConfig.lastTokenPresent ?? usePodStatus.tokenPresent,
        lastTokenSource: usePodConfig.lastTokenSource || usePodStatus.tokenSource || "",
      },
    };
    updateAgentRuntimeModel("usepod", model);
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => ({ ...current, ...patch, name: current.name.trim() ? current.name : defaultNameForRuntime(current.runtime, "usepod") }));
      setRuntimeModelSetupMode(null);
      return;
    }
    if (roleModalAgent) {
      updateAgentProfile(roleModalAgent.id, patch);
      setRuntimeModelSetupMode(null);
    }
  }

  function selectVeniceProvider() {
    const currentModel = agentCreateMachine ? agentCreateDraft.model : roleModalAgent?.model;
    const model = currentModel && currentModel !== "adaptive" ? currentModel : VENICE_PROVIDER.defaultModel;
    const veniceStatus = runtimeIntegrationStatus?.providerStatus?.venice ?? {};
    const patch = {
      provider: "venice",
      model,
      ...(activeRuntime === HIVEMIND_OS_RUNTIME ? {
        gatewayUrl: "https://api.venice.ai/api/v1",
        chatPath: "/chat/completions",
        statusPath: "/models",
        token: "",
      } : {}),
      venice: {
        authMode: veniceConfig.authMode || veniceStatus.authMode || undefined,
        apiKeyEnvName: veniceConfig.apiKeyEnvName || veniceStatus.apiKeyEnvName || "VENICE_API_KEY",
        walletVaultId: veniceConfig.walletVaultId || veniceStatus.walletVaultId || "",
        walletAddress: veniceConfig.walletAddress || veniceStatus.walletAddress || "",
        walletNetwork: veniceConfig.walletNetwork || veniceStatus.walletNetwork || "",
        lastBalanceUsd: veniceConfig.lastBalanceUsd || veniceStatus.balanceUsd || "",
        lastDiemBalanceUsd: veniceConfig.lastDiemBalanceUsd || veniceStatus.diemBalanceUsd || "",
        lastCheckedAt: veniceConfig.lastCheckedAt || veniceStatus.checkedAt || "",
        lastTestStatus: veniceConfig.lastTestStatus || veniceStatus.status || "",
        lastModelCount: veniceConfig.lastModelCount ?? veniceStatus.modelCount,
        lastKeyPresent: veniceConfig.lastKeyPresent ?? veniceStatus.keyPresent,
      },
    };
    updateAgentRuntimeModel("venice", model);
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => ({ ...current, ...patch, name: current.name.trim() ? current.name : defaultNameForRuntime(current.runtime, "venice") }));
      setRuntimeModelSetupMode(null);
      return;
    }
    if (roleModalAgent) {
      updateAgentProfile(roleModalAgent.id, patch);
      setRuntimeModelSetupMode(null);
    }
  }

  function selectHivemindosModelsProvider() {
    const currentModel = agentCreateMachine ? agentCreateDraft.model : roleModalAgent?.model;
    const availableModels = runtimeModelProviders.find((provider) => provider.slug === HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER)?.models?.map((modelOption) => modelOption.id) ?? [];
    const model = currentModel && availableModels.includes(currentModel) ? currentModel : HIVEMINDOS_MODELS_PROVIDER?.defaultModel || HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL;
    const patch = {
      provider: HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
      model,
      token: "",
      hivemindosModels: {
        fundingMode: hivemindosModelsConfig.fundingMode || "",
        creditAccountId: hivemindosModelsConfig.creditAccountId || "",
        walletVaultId: hivemindosModelsConfig.walletVaultId || "",
        walletAddress: hivemindosModelsConfig.walletAddress || "",
        walletNetwork: hivemindosModelsConfig.walletNetwork || "",
        fundingWalletKind: hivemindosModelsConfig.fundingWalletKind || "",
        fundingWalletLabel: hivemindosModelsConfig.fundingWalletLabel || "",
        lastCheckoutSessionId: hivemindosModelsConfig.lastCheckoutSessionId || "",
        lastCreditBalanceUsd: hivemindosModelsConfig.lastCreditBalanceUsd || "",
        lastCreditBalanceLabel: hivemindosModelsConfig.lastCreditBalanceLabel || "",
        lastCreditCheckedAt: hivemindosModelsConfig.lastCreditCheckedAt || "",
        lastCheckedAt: hivemindosModelsConfig.lastCheckedAt || "",
        lastTestStatus: hivemindosModelsConfig.lastTestStatus || "",
        lastStatusMessage: hivemindosModelsConfig.lastStatusMessage || "",
      },
    };
    updateAgentRuntimeModel(HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER, model);
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => ({ ...current, ...patch, name: current.name.trim() ? current.name : defaultNameForRuntime(current.runtime, HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER) }));
      setRuntimeModelSetupMode(null);
      return;
    }
    if (roleModalAgent) {
      updateAgentProfile(roleModalAgent.id, patch);
      setRuntimeModelSetupMode(null);
    }
  }

  function selectBankrLlmProvider() {
    const currentModel = agentCreateMachine ? agentCreateDraft.model : roleModalAgent?.model;
    const bankrProvider = runtimeModelProviders.find((provider) => provider.slug === "bankr");
    const bankrModels = bankrProvider?.models.map((modelOption) => modelOption.id) ?? [];
    const model = currentModel && bankrModels.includes(currentModel) ? currentModel : bankrModels[0] || "";
    const patch = {
      provider: "bankr",
      model,
      ...(activeRuntime === HIVEMIND_OS_RUNTIME ? {
        gatewayUrl: BANKR_LLM_BASE_URL,
        chatPath: BANKR_LLM_CHAT_PATH,
        statusPath: BANKR_LLM_MODELS_PATH,
        token: "",
      } : {}),
    };
    updateAgentRuntimeModel("bankr", model);
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => ({ ...current, ...patch, name: current.name.trim() ? current.name : defaultNameForRuntime(current.runtime, "bankr") }));
      setRuntimeModelSetupMode(null);
      void refreshRuntimeIntegrations({ ...(agentSettingsIntegrationTarget ?? {}), ...patch });
      return;
    }
    if (roleModalAgent) {
      updateAgentProfile(roleModalAgent.id, patch);
      setRuntimeModelSetupMode(null);
      void refreshRuntimeIntegrations({ ...roleModalAgent, ...patch });
    }
  }

  function selectAdaptiveProvider() {
    const patch = {
      provider: "adaptive",
      model: "best-free",
      adaptiveRouting: {
        mode: adaptiveRouting.mode || "best-free",
        useCase: adaptiveRouting.useCase || "auto",
        enabledRuntimes: adaptiveRouting.enabledRuntimes?.length ? adaptiveRouting.enabledRuntimes : ["hermes", HIVEMIND_OS_RUNTIME],
        disabledProviders: adaptiveRouting.disabledProviders ?? [],
      },
    };
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => ({ ...current, ...patch, name: current.name.trim() ? current.name : defaultNameForRuntime(current.runtime, "adaptive") }));
      return;
    }
    if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
  }

  function renderRuntimeCard(runtime: string, label: string) {
    const selected = runtime === activeRuntime;
    const runtimeFeature = runtimeSettingsFeature(runtime as AgentRuntime);
    const availableOnTargetMachine = targetMachineRuntimes.includes(runtime);
    const unavailable = agentCreateMachine && targetMachineHasRuntimeInventory ? !availableOnTargetMachine : runtimeAvailability?.[runtime]?.installed === false;
    const notConfigured = unavailable && runtimeFeature.kind !== "autopilot" && runtime !== HIVEMIND_OS_RUNTIME;
    const setupAvailable = runtimeHasInstallSetup(runtime);
    const disabled = notConfigured && !setupAvailable;
    const detail = runtimeFeature.kind === "autopilot"
      ? runtimeFeature.runtimeSegmentSubcopy || runtimeAvailability?.[runtime]?.detail || "Autopilot"
      : unavailable
        ? runtime === HIVEMIND_OS_RUNTIME ? "Configurable provider" : setupAvailable ? "Tap to set up" : "Not configured"
        : availableOnTargetMachine ? "Available on machine" : "Configured";
    const iconPath = runtimeIconPath(runtime);
    return (
      <button
        key={runtime}
        type="button"
        className="as-choice"
        data-active={selected || undefined}
        data-bee={`agent-runtime-${runtime}`}
        aria-pressed={selected}
        disabled={disabled}
        title={runtimeAvailability?.[runtime]?.detail}
        onClick={() => updateSettingsRuntime(runtime as AgentRuntime)}
      >
        <span className="t">
          {iconMark({ label, iconPath, iconMode: runtimeIconRenderMode(runtime), fallback: runtimeIconFallback(runtime, label) })}
          <span>{label}</span>
          {notConfigured && setupAvailable ? <Badge tone="honey">Set up</Badge> : null}
        </span>
        <span className="s">{detail}</span>
      </button>
    );
  }

  function renderProviderModelPanel() {
    if (!runtimeModelPanelAvailable && !usePodSelected && !veniceSelected && !hivemindosModelsSelected) return null;
    const PROVIDER_TILE_LIMIT = 8;
    const sortedProviders = [...runtimeModelProviders].sort((a, b) => {
      const selectedDelta = (a.slug === selectedProviderSlug ? 0 : 1) - (b.slug === selectedProviderSlug ? 0 : 1);
      const orderDelta = providerSortIndex(a.slug) - providerSortIndex(b.slug);
      return selectedDelta || orderDelta || String(a.slug).localeCompare(String(b.slug));
    });
    const visibleProviders = showAllProviders ? sortedProviders : sortedProviders.slice(0, PROVIDER_TILE_LIMIT);
    const hiddenProviderCount = Math.max(0, sortedProviders.length - PROVIDER_TILE_LIMIT);

    return (
      <div className="as-panel-section">
        {runtimeModelPanelAvailable ? (
          <div>
            <GroupLabel>Provider</GroupLabel>
            <div className="as-provider-grid">
              <button type="button" className="as-choice" data-active={adaptiveProviderSelected || undefined} data-bee="agent-provider-adaptive" aria-pressed={adaptiveProviderSelected} onClick={selectAdaptiveProvider}>
                <span className="t">{iconMark({ label: "Adaptive", fallback: "AD" })}<span>Adaptive</span></span>
                <span className="s">Best free route</span>
              </button>
              {visibleProviders.map((provider) => {
                const selected = provider.slug === selectedProviderSlug;
                const providerCreditBadge = creditProviderBalances[provider.slug] || "";
                const providerInventoryPlaceholder = provider.source === "HivemindOS provider gateway" && provider.slug !== "hive-fusion";
                const providerLoading = (provider.totalModels === 0 && (runtimeIntegrationBusy === "status" || (provider.slug === "bankr" && !runtimeModelSelectionFresh && !runtimeIntegrationStatus?.providerStatus?.bankr?.checkedAt)))
                  || (providerInventoryPlaceholder && runtimeIntegrationBusy === "status");
                const providerCatalog = providerCatalogEntry(provider.slug);
                const liveModelCount = fetchedProviderModels[provider.slug]?.length ?? 0;
                const effectiveTotalModels = Math.max(provider.totalModels || 0, liveModelCount);
                const providerKeyMissing = providerNeedsKey(provider.slug);
                const lmStudioProviderModels = provider.slug === "lm-studio" ? (lmStudioStatus?.models?.filter((model) => model.type === "llm") ?? []) : [];
                const lmStudioLoadedCount = lmStudioProviderModels.filter((model) => model.loaded).length;
                const sieProviderModels = provider.slug === SIE_PROVIDER_ID ? (sieStatus?.models ?? []) : [];
                const sieWarmCount = sieProviderModels.filter((model) => model.loaded).length;
                const providerModelDetail = providerLoading
                  ? "Loading models"
                  : provider.slug === "lm-studio" && lmStudioDiscoveryPending
                    ? "Discovering models"
                    : provider.slug === "lm-studio" && lmStudioProviderModels.length
                      ? `${lmStudioProviderModels.length} model${lmStudioProviderModels.length === 1 ? "" : "s"} - ${lmStudioLoadedCount} loaded`
                      : provider.slug === SIE_PROVIDER_ID && sieDiscoveryPending
                        ? "Discovering models"
                        : provider.slug === SIE_PROVIDER_ID && sieProviderModels.length
                          ? `${sieProviderModels.length} model${sieProviderModels.length === 1 ? "" : "s"} - ${sieWarmCount} warm`
                      : `${effectiveTotalModels} model${effectiveTotalModels === 1 ? "" : "s"}`;
                const bestProviderModel = selectBestRuntimeModel(provider, {
                  defaultModel: runtimeSettings.defaultModel,
                  runtimeSelectedModel: runtimeModelSelectionsByRuntime?.[activeRuntime]?.model,
                  preferAdaptive: true,
                });
                const selectProvider = provider.slug === "usepod"
                  ? selectUsePodProvider
                  : provider.slug === "venice"
                    ? selectVeniceProvider
                    : provider.slug === HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER
                      ? selectHivemindosModelsProvider
                      : provider.slug === "bankr"
                        ? selectBankrLlmProvider
                        : provider.slug === SIE_PROVIDER_ID
                          ? selectSieProvider
                        : () => updateAgentRuntimeModel(bestProviderModel === "adaptive" ? "openrouter" : provider.slug, bestProviderModel);
                return (
                  <button key={provider.slug} type="button" className="as-choice" data-active={selected || undefined} data-bee={`agent-provider-${provider.slug}`} aria-pressed={selected} onClick={selectProvider}>
                    <span className="t">
                      {iconMark({
                        label: provider.name,
                        iconPath: MODEL_PROVIDER_GATEWAYS[provider.slug]?.iconPath ?? providerCatalog?.iconPath ?? providerIconPath(provider),
                        iconMode: MODEL_PROVIDER_GATEWAYS[provider.slug]?.iconMode ?? providerCatalog?.iconMode ?? providerIconRenderMode(provider),
                        fallback: MODEL_PROVIDER_GATEWAYS[provider.slug]?.fallback ?? providerCatalog?.fallback,
                      })}
                      <span>{provider.name}</span>
                    </span>
                    <span className="s">
                      {providerKeyMissing ? "Add key" : providerModelDetail}
                      {providerCreditBadge ? ` - ${providerCreditBadge}` : ""}
                    </span>
                  </button>
                );
              })}
              {runtimeCanAddModels ? (
                <button type="button" className="as-dashed" onClick={() => setRuntimeModelSetupMode((current) => current === "provider" ? null : "provider")}>
                  <Plus size={14} aria-hidden="true" /> Add provider
                </button>
              ) : null}
            </div>
            {hiddenProviderCount > 0 ? (
              <button type="button" className="as-link-btn" onClick={() => setShowAllProviders((current) => !current)}>
                {showAllProviders ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                {showAllProviders ? "View less" : `View all ${sortedProviders.length} providers`}
              </button>
            ) : null}
          </div>
        ) : null}

        {selectedSupportsXaiOAuth && !selectedNeedsKey && !selectedNeedsXaiOAuthSetup ? (
          <section className={`${honeyStyles.scope} ${honeyStyles.card}`}>
            <div className={honeyStyles.header}>
              <div>
                <p className="eyebrow">xAI connection</p>
                <h3 className={honeyStyles.heading}>Choose how Grok connects</h3>
                <p className={honeyStyles.subtext}>API key and OAuth stay available. Model picks use the selected connection.</p>
              </div>
              <span className={honeyStyles.pill}>{selectedUsesXaiOAuth ? "OAuth" : "API key"}</span>
            </div>
            <div className={honeyStyles.authMode} role="group" aria-label="xAI credential method">
              <button type="button" className={honeyStyles.authModeButton} data-active={!selectedUsesXaiOAuth ? "" : undefined} aria-pressed={!selectedUsesXaiOAuth} onClick={() => selectXaiCredentialMode("api-key")}>
                <KeyRound aria-hidden="true" />
                API key
              </button>
              <button type="button" className={honeyStyles.authModeButton} data-active={selectedUsesXaiOAuth ? "" : undefined} aria-pressed={selectedUsesXaiOAuth} onClick={() => selectXaiCredentialMode("oauth")}>
                <PlugZap aria-hidden="true" />
                OAuth
              </button>
            </div>
            <p className={honeyStyles.hint}>
              {selectedUsesXaiOAuth
                ? xaiOAuthStatusLoaded ? xaiOAuthConnected ? "Signed in with xAI OAuth." : "OAuth is selected. Connect your xAI account to use OAuth models." : "Checking xAI OAuth status."
                : envLoaded && envPresentKeys.has("XAI_API_KEY") ? "Using XAI_API_KEY from the shared hive env." : "API key is selected. Add XAI_API_KEY to use API-key models."}
            </p>
          </section>
        ) : null}

        {veniceSelected ? (
          <div className="as-block">
            <GroupLabel>Venice setup</GroupLabel>
            <GuidedVeniceSetup
              key={veniceSetupTarget?.id ?? "new-venice"}
              agent={veniceSetupTarget}
              busy={runtimeIntegrationBusy}
              existingWallets={completedVeniceWallets}
              fleetClass={fleetClass}
              requireCurrentSetup={veniceRequiresCurrentSetup}
              onCancel={() => setRuntimeModelSetupMode(null)}
              onComplete={applyVeniceSetupProfile}
            />
          </div>
        ) : usePodSelected ? (
          <div className="as-block">
            <GroupLabel>UsePod setup</GroupLabel>
            <GuidedUsePodSetup
              key={usePodSetupTarget?.id ?? "new-usepod"}
              agent={usePodSetupTarget}
              busy={runtimeIntegrationBusy}
              existingWallets={completedUsePodWallets}
              fleetClass={fleetClass}
              requireCurrentSetup={usePodRequiresCurrentSetup}
              onComplete={applyUsePodSetupProfile}
            />
          </div>
        ) : shouldShowHivemindosModelsSetup ? (
          <div className="as-block">
            <GuidedHivemindosModelsSetup
              key={hivemindosModelsSetupTarget?.id ?? "new-hivemindos-models"}
              agent={hivemindosModelsSetupTarget}
              busy={runtimeIntegrationBusy}
              displayAgents={displayAgents}
              walletsByAgent={walletsByAgent}
              sharedVault={sharedVault}
              onComplete={applyHivemindosModelsSetupProfile}
            />
          </div>
        ) : bankrSetupVisible && bankrNeedsKeySetup ? (
          <MissingSharedEnvKeySetup
            apiKeyName="BANKR_LLM_KEY"
            providerLabel="Bankr LLM"
            detail={bankrSetupDetail}
            issue={bankrInvalidKey ? "invalid" : "missing"}
            onSaved={() => refreshRuntimeIntegrations(agentSettingsIntegrationTarget ?? undefined)}
          />
        ) : bankrSetupVisible && bankrLowCredits && !selectedRuntimeModels.length ? (
          <BankrLowCreditSetup diagnostic={bankrSetupDetail} initialCredits={bankrInitialCredits} onFunded={() => refreshRuntimeIntegrations(agentSettingsIntegrationTarget ?? undefined)} />
        ) : selectedNeedsKey || selectedNeedsXaiOAuthSetup ? (
          <MissingSharedEnvKeySetup
            apiKeyName={selectedCatalogEntry.keyEnv}
            providerLabel={selectedCatalogEntry?.name}
            hermesProvider={selectedCatalogEntry?.slug}
            hermesKeyPresent={envHermesKeys.has(selectedCatalogEntry?.keyEnv)}
            oauthLabel={selectedSupportsXaiOAuth ? "xAI OAuth" : undefined}
            oauthDetail={selectedSupportsXaiOAuth ? "Use your xAI/Grok account with browser OAuth instead of storing XAI_API_KEY." : undefined}
            oauthStatusEndpoint={selectedSupportsXaiOAuth ? xaiOAuthStatusEndpoint() : undefined}
            initialAuthMode={selectedNeedsXaiOAuthSetup ? "oauth" : "api-key"}
            onAuthModeChange={selectedSupportsXaiOAuth ? selectXaiCredentialMode : undefined}
            onOAuthConnect={selectedSupportsXaiOAuth ? startXaiOAuthLogin : undefined}
            onOAuthCodeSubmit={selectedSupportsXaiOAuth ? submitXaiOAuthCode : undefined}
            onOAuthConnected={selectedSupportsXaiOAuth ? applyXaiOAuthProviderSelection : undefined}
            onSaved={async () => {
              await refreshRuntimeIntegrations(agentSettingsIntegrationTarget ?? undefined);
              setEnvRefreshKey((current) => current + 1);
            }}
          />
        ) : !adaptiveProviderSelected ? (
          <div>
            {!lmStudioSelected && !sieSelected ? (
              <>
                <GroupLabel>Model</GroupLabel>
                {bankrLlmSelected && bankrLowCredits && selectedRuntimeModels.length ? (
                  <BankrLowCreditSetup diagnostic={bankrSetupDetail} variant="compact" initialCredits={bankrInitialCredits} onFunded={() => refreshRuntimeIntegrations(agentSettingsIntegrationTarget ?? undefined)} />
                ) : null}
                <ModelPillSelector
                  models={runtimeModelOptions}
                  selectedModelId={selectedRuntimeModelId}
                  addModelDisabled={Boolean(runtimeIntegrationBusy)}
                  canAddModel={runtimeCanAddCustomModel}
                  emptyLabel={runtimeModelProviders.length ? "No models configured." : "Add a provider first. Models appear after a provider is connected."}
                  onSelectModel={(modelId) => updateAgentRuntimeModel(modelId === "adaptive" && selectedProviderSlug === "openrouter" ? "openrouter" : selectedRuntimeProviderSlug, modelId)}
                  onAddModel={() => setRuntimeModelSetupMode((current) => current === "model" ? null : "model")}
                />
              </>
            ) : null}
            {queenVoiceBrainAlert ? (
              <div className="as-info">
                <span className="ic"><AlertTriangle size={15} aria-hidden="true" /></span>
                <p>
                  <strong>Voice turns are not using this model.</strong>{" "}
                  {queenVoiceBrainAlert.lastError || "The runtime turn keeps failing."}{" "}
                  Queen Bee is answering with the fallback model ({queenVoiceBrainAlert.fallbackModel || "gpt-4o-mini"}) until this is fixed
                  {typeof queenVoiceBrainAlert.consecutiveFailures === "number" && queenVoiceBrainAlert.consecutiveFailures > 1 ? ` — ${queenVoiceBrainAlert.consecutiveFailures} failures in a row` : ""}.
                </p>
              </div>
            ) : null}
            {lmStudioSelected ? (
              <LmStudioModelManager
                agent={agentSettingsIntegrationTarget}
                busy={runtimeIntegrationBusy}
                discoveryPending={lmStudioDiscoveryPending}
                lmStudioStatus={lmStudioStatus}
                modelOptions={selectedRuntimeModels}
                onLoadModel={loadLmStudioModel}
                onSelectModel={selectLocalModel}
                pendingLoadModelKeys={lmStudioPendingLoadModelKeys}
                refreshRuntimeIntegrations={refreshRuntimeIntegrations}
                runRuntimeIntegrationAction={runRuntimeIntegrationAction}
                selectedModelId={selectedRuntimeModelId}
              />
            ) : null}
            {sieSelected ? (
              <SieModelManager
                agent={agentSettingsIntegrationTarget}
                busy={runtimeIntegrationBusy}
                status={sieStatus}
                selectedModelId={selectedRuntimeModelId}
                onSelectModel={selectSieModel}
                onEndpointChange={updateSieEndpoint}
                refreshRuntimeIntegrations={refreshRuntimeIntegrations}
                runRuntimeIntegrationAction={runRuntimeIntegrationAction}
              />
            ) : null}
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
        ) : openRouterSelected && selectedRuntimeModelId === "adaptive" ? (
          <details className="fb-disc">
            <summary>Adaptive OpenRouter</summary>
            <div className="as-2col">
              <Field label="Agent type">
                <select className="fb-select" value={adaptiveOpenRouter.useCase || "auto"} onChange={(event) => updateAdaptiveOpenRouter({ useCase: event.target.value })}>
                  {["auto", "coding", "writing", "vision", "image", "research", "tool-use"].map((option) => <option value={option} key={option}>{titleCaseId(option)}</option>)}
                </select>
              </Field>
              <Field label="Paid fallback">
                <select className="fb-select" value={adaptiveOpenRouter.fallbackModel || ""} onChange={(event) => updateAdaptiveOpenRouter({ fallbackModel: event.target.value })}>
                  <option value="">No paid fallback</option>
                  {selectedRuntimeModels.filter((model) => model.id !== "adaptive").map((model) => <option value={model.id} key={model.id}>{model.name || model.id}</option>)}
                </select>
              </Field>
            </div>
          </details>
        ) : null}

        {runtimeModelSetupMode === "provider" && runtimeCanAddModels ? (
          <div className="as-block accent">
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
          <details className="fb-disc" open>
            <summary>Advanced custom model</summary>
            <div className="as-advanced-model">
              <Field label="Provider">
                <select className="fb-select" value={runtimeModelDraft.provider || selectedRuntimeProvider?.slug || ""} onChange={(event) => setRuntimeModelDraft((current) => ({ ...current, provider: event.target.value }))}>
                  {runtimeModelProviders.map((provider) => <option value={provider.slug} key={provider.slug}>{provider.name}</option>)}
                </select>
              </Field>
              <Field label="Custom model ID">
                <TextInput className="fb-mono" value={runtimeModelDraft.model} onChange={(event) => setRuntimeModelDraft((current) => ({ ...current, model: event.target.value }))} placeholder="Paste exact model ID" />
              </Field>
              <Btn variant="primary" disabled={!runtimeModelDraft.model.trim() || runtimeIntegrationBusy === "add-model"} onClick={() => void addHermesModelFromDraft()}>
                {runtimeIntegrationBusy === "add-model" ? "Adding..." : "Add"}
              </Btn>
            </div>
          </details>
        ) : null}
      </div>
    );
  }

  function renderWorkerPanel() {
    if (isQueenSettings) {
      return (
        <>
          <AgentSettingsQueenPersonalityPanel
            iconSrc={agentSettingsWorkerImage}
            personality={currentSoulPrompt}
            onChange={updateAgentSoulPrompt}
          />
          <AgentSettingsCustomInstructionsPanel />
        </>
      );
    }
    if (!showWorkerClassSection) return null;
    if (agentWorkerClassView !== "presets") {
      return (
        <div className="as-block accent">
          <div className="as-wc-head">
            <button type="button" className="as-wc-back" onClick={() => setAgentWorkerClassView("presets")}><ChevronRight size={13} aria-hidden="true" /> Back</button>
            <strong>Custom worker class</strong>
          </div>
          <Field label="Role name"><TextInput value={customWorkerDraft.label} onChange={(event) => setCustomWorkerDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Data scout, Social analyst, Build fixer" /></Field>
          <div>
            <GroupLabel>Bee image</GroupLabel>
            <div className="as-wc-imgs">
              {BEE_WORKER_PRESET_LIST.map((preset) => {
                const imageSrc = beeRoleIconPath("worker", preset.id);
                const selected = customWorkerDraft.imageSrc === imageSrc;
                return (
                  <button type="button" key={preset.id} className="as-wc-img" data-on={selected || undefined} onClick={() => setCustomWorkerDraft((current) => ({ ...current, imageSrc }))} aria-label={`Use ${preset.label} image`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageSrc} alt="" />
                  </button>
                );
              })}
              <button type="button" className="as-wc-img dashed" onClick={() => customWorkerImageInputRef.current?.click()} aria-label="Upload custom worker image">
                <Upload size={18} aria-hidden="true" />
              </button>
            </div>
            <input ref={customWorkerImageInputRef} type="file" accept="image/*" onChange={uploadCustomWorkerImage} hidden />
            {customWorkerImageError ? <p className="as-error">{customWorkerImageError}</p> : null}
          </div>
          <Field label="Suited for"><TextArea value={customWorkerDraft.skillProfilePrompt} onChange={(event) => setCustomWorkerDraft((current) => ({ ...current, skillProfilePrompt: event.target.value }))} rows={3} /></Field>
          <Field label="Shared brain skills"><TextInput value={customWorkerSkillSearch} onChange={(event) => setCustomWorkerSkillSearch(event.target.value)} placeholder="Search by skill name or keyword" /></Field>
          <div className="as-skills">
            {filteredCustomWorkerSkills.length ? filteredCustomWorkerSkills.map((skill) => (
              <button type="button" key={skill.slug} className="as-skill" data-on={skill.selected || undefined} onClick={() => toggleCustomWorkerSkill(skill.slug)}>{skill.name}</button>
            )) : <p className="as-empty">No matching shared-brain skills.</p>}
          </div>
          <div className="as-actions-end">
            <Btn sm onClick={() => setAgentWorkerClassView("presets")}>Cancel</Btn>
            <Btn variant="primary" sm disabled={!customWorkerDraft.label.trim() || !customWorkerDraft.skillProfilePrompt.trim()} onClick={applyCustomWorkerClass}><Check size={13} aria-hidden="true" />Use class</Btn>
          </div>
        </div>
      );
    }
    return (
      <div>
        <GroupLabel>Worker class</GroupLabel>
        <div className="as-workers">
          {BEE_WORKER_PRESET_LIST.map((preset) => {
            const selected = preset.id === agentSettingsWorkerClass && !agentSettingsCustomWorker;
            return (
              <button type="button" key={preset.id} className="as-worker" data-active={selected || undefined} onClick={() => selectAgentWorkerClass(preset.id)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={beeRoleIconPath("worker", preset.id)} alt="" />
                <span>{preset.label}</span>
              </button>
            );
          })}
          {agentSettingsCustomWorkers.map((customWorkerClass) => {
            const selected = agentSettingsSelectedCustomWorkerId === customWorkerClass.id;
            return (
              <button type="button" key={customWorkerClass.id} className="as-worker" data-active={selected || undefined} onClick={() => selectCustomWorkerClass(customWorkerClass)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={customWorkerClass.imageSrc || beeRoleIconPath("worker", "general")} alt="" />
                <span>{customWorkerClass.label}</span>
              </button>
            );
          })}
          <button type="button" className="as-worker dashed" onClick={openCustomWorkerClassCreator}><Plus size={16} aria-hidden="true" /><span>Custom</span></button>
          <button type="button" className="as-worker dashed" onClick={() => setAgentBrowserOpen(true)}><Search size={16} aria-hidden="true" /><span>Browse</span></button>
        </div>
        <AgentBrowserModal open={agentBrowserOpen} onClose={() => setAgentBrowserOpen(false)} onInstall={installPackagedAgent} installedIds={agentSettingsCustomWorkers.map((workerClass) => workerClass.id)} />
        <div className="as-block accent as-worker-detail">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={agentSettingsWorkerImage} alt="" />
          <div>
            <strong>{agentSettingsWorkerLabel}</strong>
            <div className="as-cap-list">
              {(agentSettingsCustomWorker ? workerCapabilityBadges(agentSettingsSkillProfile) : workerCapabilityBadges(agentSettingsWorkerPreset.summary)).map((capability) => <Badge key={capability}>{capability}</Badge>)}
            </div>
          </div>
          <Field label="Soul">
            <TextArea value={currentSoulPrompt} onChange={(event) => updateAgentSoulPrompt(event.target.value)} rows={4} />
          </Field>
          <div className="as-soul-actions">
            <select className="fb-select" value="" onChange={(event) => { loadSavedSoul(event.target.value); event.target.value = ""; }}>
              <option value="">Load saved SOUL.md...</option>
              {savedAgentSouls.map((soul) => <option key={soul.id} value={soul.id}>{soul.title}</option>)}
            </select>
            <Btn sm onClick={() => soulFileInputRef.current?.click()}>Import SOUL.md</Btn>
            <Btn sm onClick={() => updateAgentSoulPrompt(defaultSubclassSoul)}>Reset soul</Btn>
            <Btn sm disabled={!currentSoulPrompt.trim()} onClick={() => setSoulSaveTitle((current) => current || `${displayName || agentSettingsWorkerLabel} soul`)}>Name to save</Btn>
          </div>
          {soulSaveTitle ? (
            <div className="as-save-soul">
              <TextInput value={soulSaveTitle} onChange={(event) => setSoulSaveTitle(event.target.value)} placeholder="Saved soul name" />
              <Btn variant="primary" sm disabled={!soulSaveTitle.trim() || !currentSoulPrompt.trim()} onClick={() => void saveCurrentSoulAsNew()}>Save as new SOUL.md</Btn>
            </div>
          ) : null}
          <input ref={soulFileInputRef} type="file" accept=".md,text/markdown,text/plain" onChange={(event) => void importSoulFile(event)} hidden />
          {savedAgentSoulsStatus ? <p className={savedAgentSoulsStatus.toLowerCase().startsWith("could not") ? "as-error" : "as-status"}>{savedAgentSoulsStatus}</p> : null}
          <Field label="Suited for"><TextArea value={agentSettingsSkillProfile} onChange={(event) => updateAgentSkillProfile(event.target.value)} rows={4} /></Field>
          {researchSubclassSelected ? <ResearchMethodSettingsPanel value={selectedResearchMethod} onChange={updateResearchMethod} /> : null}
          <div>
            <GroupLabel>Seeded shared-brain skills</GroupLabel>
            <div className="as-skills">
              {agentSettingsPreferredSkills.map((slug) => (
                <button className="as-skill" key={slug} type="button" onClick={() => removeAgentPreferredSkill(slug)}>
                  {slug}<Minus size={12} aria-hidden="true" />
                </button>
              ))}
              <button className="as-skill add" type="button" onClick={() => void openAgentSkillBrowser()}><Plus size={12} aria-hidden="true" />Add skill</button>
            </div>
          </div>
          <div>
            <GroupLabel>App and model preferences by task</GroupLabel>
            <p className="as-muted">Route this class to specific connected apps and models per task type. Agents read these before picking a capability.</p>
            <WorkerTaskPreferencesEditor value={agentTaskPreferences} onChange={updateAgentTaskPreferences} />
          </div>
        </div>
      </div>
    );
  }

  function renderAeonConnection() {
    return (
      <AgentSettingsAeonConnectionPanel
        aeonOauthConnecting={aeonOauthConnecting}
        aeonSettings={aeonSettings}
        browseAgentRuntimeFolder={browseAgentRuntimeFolder}
        openAeonGithubOauth={openAeonGithubOauth}
        updateAeonSettings={updateAeonSettings}
      />
    );
  }

  function renderRole() {
    return (
      <div className="as-panel">
        <PanelHead eyebrow="Role" title="Runtime and behaviour" sub="Pick the engine that runs this agent. Each runtime brings its own setup." />
        {!hideRuntimeSection ? (
          <div>
            <GroupLabel>Runtime</GroupLabel>
            <div className="as-choice-grid as-runtimes">
              {runtimeSelectorEntries.map(([runtime, label]) => renderRuntimeCard(runtime, label))}
            </div>
          </div>
        ) : null}
        {isAutopilotSettings ? (
          <div className="as-block accent as-aeon-hero">
            <AsOrb state="duty" iconSrc={agentSettingsWorkerImage} />
            <div>
              <strong>Aeon Autopilot</strong>
              <p>AEON uses skill-selected models, so provider/model and worker class controls live in the AEON workspace.</p>
              <div className="as-aeon-check">
                {["Background runtime", "Schedules and runs", "Shared skills sync", "GitHub secret sync"].map((label) => <Badge key={label} tone="honey">{label}</Badge>)}
              </div>
            </div>
            <Btn variant="primary" sm onClick={() => setAeonWorkspaceOpen(true)}><Sparkles size={13} aria-hidden="true" />Create AEON Agent</Btn>
            <div className="as-aeon-full">{renderAeonConnection()}</div>
          </div>
        ) : activeRuntimeNeedsSetup ? (
          <RuntimeInstallSetup
            key={activeRuntime}
            agent={agentSettingsIntegrationTarget}
            busy={runtimeIntegrationBusy}
            fleetClass={fleetClass}
            runtime={activeRuntime}
            installed={agentCreateMachine && targetMachineHasRuntimeInventory ? targetMachineRuntimes.includes(activeRuntime) : runtimeAvailability?.[activeRuntime]?.installed === true}
            targetOs={agentCreateMachine?.os}
            targetLabel={agentCreateMachine ? (agentCreateMachine.label || agentCreateMachine.name || "the selected machine") : "this machine"}
            runRuntimeIntegrationAction={runRuntimeIntegrationAction}
            refreshAvailability={refreshRuntimeAvailability}
            onCancel={closeAgentSettingsModal}
            onComplete={async () => {
              refreshRuntimeAvailability?.();
              await refreshRuntimeIntegrations(agentSettingsIntegrationTarget ?? undefined);
            }}
          />
        ) : (
          <>
            {renderProviderModelPanel()}
            {renderWorkerPanel()}
          </>
        )}
      </div>
    );
  }

  function renderMemory() {
    return (
      <AgentSettingsMemoryPanel
        agentCreateDraft={agentCreateDraft}
        agentCreateMachine={agentCreateMachine}
        agentRuntimeFolderBrowsing={agentRuntimeFolderBrowsing}
        agentRuntimeFolderEditing={agentRuntimeFolderEditing}
        agentRuntimeFolderStatus={agentRuntimeFolderStatus}
        browseAgentRuntimeFolder={browseAgentRuntimeFolder}
        isAutopilotSettings={isAutopilotSettings}
        roleModalAgent={roleModalAgent}
        runtimeFolderValue={runtimeFolderValue}
        setAgentCreateDraft={setAgentCreateDraft}
        setAgentRuntimeFolderEditing={setAgentRuntimeFolderEditing}
        setAgentRuntimeFolderStatus={setAgentRuntimeFolderStatus}
        sharedVault={sharedVault}
        updateAgentProfile={updateAgentProfile}
      />
    );
  }

  const agentCallSettings = buildAgentCallPreferences(agentCreateMachine ? agentCreateDraft.calls : roleModalAgent?.calls);
  const updateAgentCalls = (patch) => {
    const next = buildAgentCallPreferences({ ...agentCallSettings, ...patch });
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, calls: next }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { calls: next });
  };

  function renderSecurity() {
    return <AgentSettingsSecurityPanel />;
  }

  const panelContent = activePanel === "role"
    ? renderRole()
    : activePanel === "connection"
      ? <div className="as-panel"><PanelHead eyebrow="Connection" title="AEON connection" sub="Where Autopilot reads its repo and runs scheduled skills." />{renderAeonConnection()}</div>
      : activePanel === "memory"
        ? renderMemory()
        : activePanel === "tools"
          ? <AgentSettingsToolsPanel {...{ HERMES_UPDATE_INTEGRATION_KEYS, agentMailboxBusy, agentMailboxError, agentMailboxOverview, createMailboxForCurrentAgent, hermesUpdateRequired, refreshRuntimeIntegrations, roleModalAgent, runtimeCapabilities, runtimeIntegrationBusy, runtimeIntegrationStatus, runtimeSessionQuery, runtimeSessionResults, searchRuntimeSessionsForAgent, setRuntimeSessionQuery }} />
          : activePanel === "calls"
            ? <AgentSettingsCallsPanel {...{ agentCreateDraft, agentCreateMachine, onQueenClapWakeEnabledChange, queenClapWakeEnabled, roleModalAgent, setAgentCreateDraft, updateAgentProfile }} onVoiceFailure={notifyAgentVoiceFailure} />
            : activePanel === "ministry"
              ? <AgentSettingsMinistryPanel {...{ agentCallSettings, displayAgents, roleModalAgent, updateAgentCalls }} />
              : renderSecurity();

  const primaryActionBusy = runtimeIntegrationBusy === "create-agent" || runtimeIntegrationBusy === "load-model" || lmStudioSelectedModelLoading;
  const primaryActionLabel = (runtimeIntegrationBusy === "load-model" || lmStudioSelectedModelLoading) && lmStudioSelectedModelNeedsLoad
    ? "Loading model"
    : agentCreateMachine
      ? runtimeIntegrationBusy === "create-agent"
        ? "Creating agent"
        : lmStudioSelectedModelNeedsLoad
          ? "Load & Add Agent"
          : runtimeSettingsFeature(agentCreateDraft.runtime).createActionLabel || "Add agent"
      : lmStudioSelectedModelNeedsLoad
        ? "Load & Save"
        : isAutopilotSettings
          ? "Connect AEON"
          : "Done";

  return createPortal((
    <>
      <AgentSettingsModalFrame
        activePanel={activePanel}
        activePanels={activePanels}
        agentCreateMachine={agentCreateMachine}
        agentSettingsTitle={agentSettingsTitle}
        agentSettingsWorkerImage={agentSettingsWorkerImage}
        agentStatus={agentStatus}
        closeAgentSettingsModal={closeAgentSettingsModal}
        currentName={currentName}
        description={agentSettingsDescription || roleModalAgent?.description || runtimeSettings.runtimeSegmentSubcopy || "Configure identity, runtime, memory, tools, calls, and safety."}
        displayName={displayName}
        footNote={isAutopilotSettings ? "AEON workspace setup uses the shared Autopilot route." : "Provider, model and worker changes save to this profile."}
        isAutopilotSettings={isAutopilotSettings}
        onPrimaryAction={runPrimarySettingsAction}
        panelContent={panelContent}
        primaryActionBusy={primaryActionBusy}
        primaryActionDisabled={usePodCreateBlocked || veniceCreateBlocked || hivemindosModelsCreateBlocked || Boolean(agentCreateMachine && activeRuntimeNeedsSetup)}
        primaryActionLabel={primaryActionLabel}
        roleModalAgent={roleModalAgent}
        runtimeLabel={runtimeLabel}
        setAgentSettingsPanel={setAgentSettingsPanel}
        updateName={updateName}
        workerSubtitle={workerSubtitle}
      />
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
