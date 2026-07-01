// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  FolderOpen,
  Minus,
  Pencil,
  PlugZap,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { AgentBrowserModal } from "./AgentBrowserModal";
import { AgentSettingsCallsPanel } from "./AgentSettingsCallsPanel";
import { AgentSettingsModalFrame } from "./AgentSettingsModalFrame";
// AgentSettingsToolsPanel owns the Agent mailbox "Create mailbox" action.
import { AgentSettingsToolsPanel } from "./AgentSettingsToolsPanel";
import { AdaptiveProviderSettings } from "./AdaptiveProviderSettings";
import { BankrLowCreditSetup } from "./BankrLowCreditSetup";
import { GuidedProviderSetup } from "./GuidedProviderSetup";
import { GuidedHivemindosModelsSetup } from "./GuidedHivemindosModelsSetup";
import { GuidedUsePodSetup } from "./GuidedUsePodSetup";
import { GuidedVeniceSetup } from "./GuidedVeniceSetup";
import { LmStudioLoadProgress, LmStudioModelManager } from "./LmStudioModelManager";
import { MissingSharedEnvKeySetup } from "./MissingSharedEnvKeySetup";
import { ModelPillSelector } from "./ModelPillSelector";
import { ResearchMethodSettingsPanel } from "./ResearchMethodSettingsPanel";
import { RuntimeInstallSetup } from "./RuntimeInstallSetup";
import { WorkerTaskPreferencesEditor } from "./WorkerTaskPreferencesEditor";
import { WorkspaceModal } from "@/components/aeon";
import { renderBeeSoulTemplate } from "@/lib/config/bee-worker-presets";
import { normalizeResearchMethod } from "@/lib/config/research-methods";
import { MODEL_PROVIDER_GATEWAYS } from "@/lib/config/model-provider-gateways";
import { HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER } from "@/lib/config/hivemindos-wallet-paid-models";
import { providerCatalogEntry } from "@/lib/config/provider-catalog";
import { runtimeHasInstallSetup } from "@/lib/services/runtime-install-catalog";
import { HIVEMIND_OS_RUNTIME, defaultAgentNameForRuntime, runtimeProfileFeature, runtimeSettingsFeature, type AgentRuntime } from "@/lib/types/agent-runtime";
import { rememberMruRuntime } from "@/features/dashboard/agent-mru-runtime";
import { gateBankrModelsForCredits, selectBestRuntimeModel } from "./runtime-model-registry";
import {
  AsOrb,
  Badge,
  Btn,
  Field,
  GroupLabel,
  PanelHead,
  TextArea,
  TextInput,
  Toggle,
  hasUsePodSetup,
  hasVeniceSetup,
  iconMark,
  isHivemindosModelsSetupReady,
  isUsePodSetupReady,
  isVeniceSetupReady,
  titleCaseId,
} from "./AgentSettingsModalPrimitives";

const USEPOD_PROVIDER = MODEL_PROVIDER_GATEWAYS.usepod;
const VENICE_PROVIDER = MODEL_PROVIDER_GATEWAYS.venice;
const HIVEMINDOS_MODELS_PROVIDER = MODEL_PROVIDER_GATEWAYS[HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER];
const BANKR_LLM_BASE_URL = "https://llm.bankr.bot";
const BANKR_LLM_CHAT_PATH = "/v1/chat/completions";
const BANKR_LLM_MODELS_PATH = "/v1/models";
const LM_STUDIO_EMPTY_DISCOVERY_GRACE_MS = 12_000;

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
  const activePanels = agentCreateMachine ? runtimeSettings.createPanels : runtimeSettings.editPanels;
  const activePanel = activePanels.includes(agentSettingsPanel) ? agentSettingsPanel : activePanels[0];
  const isAutopilotSettings = runtimeSettings.kind === "autopilot";
  const runtimeLabel = RUNTIME_LABELS[activeRuntime] ?? activeRuntime;
  const selectedProviderSlug = agentSettingsProvider || selectedRuntimeProvider?.slug || "";
  const openRouterSelected = selectedProviderSlug === "openrouter";
  const usePodSelected = selectedProviderSlug === "usepod";
  const hivemindosModelsSelected = selectedProviderSlug === HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER;
  const bankrLlmSelected = selectedProviderSlug === "bankr";
  const lmStudioSelected = selectedProviderSlug === "lm-studio";
  const adaptiveProviderSelected = selectedProviderSlug === "adaptive";
  const selectedCatalogEntry = providerCatalogEntry(selectedProviderSlug);

  const [agentBrowserOpen, setAgentBrowserOpen] = useState(false);
  const [aeonOauthConnecting, setAeonOauthConnecting] = useState(false);
  const [aeonWorkspaceOpen, setAeonWorkspaceOpen] = useState(false);
  const [savedAgentSouls, setSavedAgentSouls] = useState([]);
  const [savedAgentSoulsStatus, setSavedAgentSoulsStatus] = useState("");
  const [soulSaveTitle, setSoulSaveTitle] = useState("");
  const [showAllProviders, setShowAllProviders] = useState(false);
  const [hivemindosModelsSetupOpen, setHivemindosModelsSetupOpen] = useState(false);
  const [envPresentKeys, setEnvPresentKeys] = useState(() => new Set());
  const [envHermesKeys, setEnvHermesKeys] = useState(() => new Set());
  const [envLoaded, setEnvLoaded] = useState(false);
  const [envRefreshKey, setEnvRefreshKey] = useState(0);
  const [fetchedProviderModels, setFetchedProviderModels] = useState(() => ({}));
  const [lmStudioEmptyDiscoveryGraceActive, setLmStudioEmptyDiscoveryGraceActive] = useState(false);
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
  const hivemindosModelsSetupComplete = isHivemindosModelsSetupReady(hivemindosModelsConfig);
  const shouldShowHivemindosModelsSetup = hivemindosModelsSelected && (!hivemindosModelsSetupComplete || hivemindosModelsSetupOpen);
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
  const selectedLmStudioInventoryModel = lmStudioStatus?.models?.find((model) => model.key === selectedRuntimeModelId && model.type === "llm");
  const lmStudioSelectedModelLoaded = Boolean(selectedLmStudioInventoryModel?.loaded || selectedRuntimeModelOption?.subtitle === "Loaded" || selectedRuntimeModelOption?.badge === "Loaded");
  const lmStudioSelectedModelLoading = Boolean(lmStudioSelected && selectedRuntimeModelId && lmStudioPendingLoadModelKeys.includes(selectedRuntimeModelId) && !lmStudioSelectedModelLoaded);
  const lmStudioSelectedModelNeedsLoad = Boolean(lmStudioSelected && selectedRuntimeModelId && selectedRuntimeModelId !== "adaptive" && (
    selectedLmStudioInventoryModel ? !selectedLmStudioInventoryModel.loaded && !selectedLmStudioInventoryModel.remote : selectedRuntimeModelOption?.subtitle === "Downloaded" || selectedRuntimeModelOption?.subtitle === "Available"
  ));
  const selectedLmStudioModelLabel = selectedLmStudioInventoryModel?.displayName || selectedRuntimeModelOption?.name || selectedRuntimeModelId;
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
  const isQueenSettings = !agentCreateMachine && roleModalAgent?.beeRole === "queen";
  const showWorkerClassSection = !isAutopilotSettings && !(usePodSelected && !usePodSetupComplete) && !(veniceSelected && !veniceSetupComplete) && !(hivemindosModelsSelected && !hivemindosModelsSetupComplete) && !isQueenSettings;
  const agentStatus = agentCreateMachine ? "New profile" : roleModalAgent?.telemetryUrl ? "Connected" : "Local profile";
  const workerSubtitle = (agentSettingsCustomWorker?.label || agentSettingsWorkerPreset?.label || agentSettingsWorkerLabel || "").replace(/\s+bee$/i, "").trim();
  const aeonSettings = {
    mode: agentCreateMachine ? agentCreateDraft.aeonMode || "github" : roleModalAgent?.aeonMode || "github",
    repo: agentCreateMachine ? agentCreateDraft.aeonRepo || "" : roleModalAgent?.aeonRepo || "",
    branch: agentCreateMachine ? agentCreateDraft.aeonBranch || "main" : roleModalAgent?.aeonBranch || "main",
    path: agentCreateMachine ? agentCreateDraft.aeonLocalPath || "~/.aeon" : roleModalAgent?.aeonLocalPath || roleModalAgent?.localDataDir || "",
    a2aUrl: agentCreateMachine ? agentCreateDraft.a2aUrl || "http://127.0.0.1:41241" : roleModalAgent?.a2aUrl || roleModalAgent?.gatewayUrl || "http://127.0.0.1:41241",
  };
  const runtimeFolderValue = roleModalAgent ? isAutopilotSettings ? roleModalAgent.aeonLocalPath || roleModalAgent.localDataDir || "" : roleModalAgent.localDataDir || "" : "";
  const targetMachineRuntimes = agentCreateMachine?.capabilities?.runtimes ?? [];
  const targetMachineHasRuntimeInventory = targetMachineRuntimes.length > 0;
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

  const selectedNeedsKey = providerNeedsKey(selectedProviderSlug);
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
      if (!entry?.keyEnv || entry.virtual || slug === "openrouter") return false;
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
    const contextLength = runtimeModelDraft.contextLength.trim();
    setLmStudioPendingLoadModelKeys((current) => current.includes(modelKey) ? current : [...current, modelKey]);
    setLmStudioPendingPrimaryAction(pendingPrimaryAction);
    const result = await runRuntimeIntegrationAction("load-model", {
      model: modelKey,
      contextLength: modelType === "embedding" || !contextLength ? undefined : Number(contextLength),
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

  function closeHivemindosModelsSetup() {
    setHivemindosModelsSetupOpen(false);
    setRuntimeModelSetupMode(null);
  }

  function openAeonGithubOauth() {
    if (aeonOauthConnecting) return;
    setAeonOauthConnecting(true);
    updateAeonSettings({ aeonMode: "github" });
    requestAnimationFrame(() => {
      window.location.assign("/api/integrations/github/oauth/start?source=aeon");
    });
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
    const model = currentModel && availableModels.includes(currentModel) ? currentModel : HIVEMINDOS_MODELS_PROVIDER?.defaultModel || "hivemindos/auto";
    const patch = {
      provider: HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
      model,
      token: "",
      hivemindosModels: {
        walletVaultId: hivemindosModelsConfig.walletVaultId || "",
        walletAddress: hivemindosModelsConfig.walletAddress || "",
        walletNetwork: hivemindosModelsConfig.walletNetwork || "",
        fundingWalletKind: hivemindosModelsConfig.fundingWalletKind || "",
        fundingWalletLabel: hivemindosModelsConfig.fundingWalletLabel || "",
        lastCreditBalanceUsd: hivemindosModelsConfig.lastCreditBalanceUsd || "",
        lastCreditBalanceLabel: hivemindosModelsConfig.lastCreditBalanceLabel || "",
        lastCreditCheckedAt: hivemindosModelsConfig.lastCreditCheckedAt || "",
        lastCheckedAt: hivemindosModelsConfig.lastCheckedAt || "",
        lastTestStatus: hivemindosModelsConfig.lastTestStatus || "",
        lastStatusMessage: hivemindosModelsConfig.lastStatusMessage || "",
      },
    };
    setHivemindosModelsSetupOpen(true);
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
    const providerReady = (provider) => providerConfigured(provider.slug) || (provider.source !== "catalog" && provider.source !== "HivemindOS provider gateway" && (provider.totalModels || 0) > 0);
    const sortedProviders = [...runtimeModelProviders].sort((a, b) => {
      const readyDelta = (providerReady(a) ? 0 : 1) - (providerReady(b) ? 0 : 1);
      return readyDelta || String(a.name).localeCompare(String(b.name));
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
                const providerModelDetail = providerLoading
                  ? "Loading models"
                  : provider.slug === "lm-studio" && lmStudioDiscoveryPending
                    ? "Discovering models"
                    : provider.slug === "lm-studio" && lmStudioProviderModels.length
                      ? `${lmStudioProviderModels.length} model${lmStudioProviderModels.length === 1 ? "" : "s"} - ${lmStudioLoadedCount} loaded`
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
              onCancel={() => setRuntimeModelSetupMode(null)}
              onComplete={applyUsePodSetupProfile}
            />
          </div>
        ) : shouldShowHivemindosModelsSetup ? (
          <div className="as-block">
            <GroupLabel>HivemindOS Models setup</GroupLabel>
            <GuidedHivemindosModelsSetup
              key={hivemindosModelsSetupTarget?.id ?? "new-hivemindos-models"}
              agent={hivemindosModelsSetupTarget}
              busy={runtimeIntegrationBusy}
              displayAgents={displayAgents}
              walletsByAgent={walletsByAgent}
              sharedVault={sharedVault}
              onCancel={closeHivemindosModelsSetup}
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
        ) : selectedNeedsKey ? (
          <MissingSharedEnvKeySetup
            apiKeyName={selectedCatalogEntry.keyEnv}
            providerLabel={selectedCatalogEntry?.name}
            hermesProvider={selectedCatalogEntry?.slug}
            hermesKeyPresent={envHermesKeys.has(selectedCatalogEntry?.keyEnv)}
            onSaved={async () => {
              await refreshRuntimeIntegrations(agentSettingsIntegrationTarget ?? undefined);
              setEnvRefreshKey((current) => current + 1);
            }}
          />
        ) : !adaptiveProviderSelected ? (
          <div>
            <GroupLabel>Model</GroupLabel>
            {bankrLlmSelected && bankrLowCredits && selectedRuntimeModels.length ? (
              <BankrLowCreditSetup diagnostic={bankrSetupDetail} variant="compact" initialCredits={bankrInitialCredits} onFunded={() => refreshRuntimeIntegrations(agentSettingsIntegrationTarget ?? undefined)} />
            ) : null}
            <ModelPillSelector
              models={runtimeModelOptions}
              selectedModelId={selectedRuntimeModelId}
              addModelDisabled={Boolean(runtimeIntegrationBusy)}
              canAddModel={runtimeCanAddCustomModel}
              emptyLabel={lmStudioDiscoveryPending ? "Loading LM Studio models..." : runtimeModelProviders.length ? "No models configured." : "Add a provider first. Models appear after a provider is connected."}
              onSelectModel={(modelId) => updateAgentRuntimeModel(modelId === "adaptive" && selectedProviderSlug === "openrouter" ? "openrouter" : selectedProviderSlug, modelId)}
              onAddModel={() => setRuntimeModelSetupMode((current) => current === "model" ? null : "model")}
            />
            {lmStudioSelectedModelNeedsLoad ? (
              <div className="as-info">
                <span className="ic"><Download size={15} aria-hidden="true" /></span>
                <p><strong>{selectedLmStudioModelLabel}</strong> {lmStudioSelectedModelLoading ? "is loading on the target machine." : "is downloaded. It will load before saving."}</p>
                {lmStudioSelectedModelLoading ? <LmStudioLoadProgress label="Loading in LM Studio" /> : null}
                <Btn sm disabled={runtimeIntegrationBusy === "load-model" || lmStudioSelectedModelLoading} onClick={() => selectedRuntimeModelId && void loadLmStudioModel(selectedRuntimeModelId, selectedLmStudioInventoryModel?.type)}>
                  {runtimeIntegrationBusy === "load-model" || lmStudioSelectedModelLoading ? "Loading..." : "Load now"}
                </Btn>
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
                pendingLoadModelKeys={lmStudioPendingLoadModelKeys}
                refreshRuntimeIntegrations={refreshRuntimeIntegrations}
                runRuntimeIntegrationAction={runRuntimeIntegrationAction}
                runtimeModelDraft={runtimeModelDraft}
                setRuntimeModelDraft={setRuntimeModelDraft}
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
      <div className="as-panel-section">
        <div>
          <GroupLabel>Connection mode</GroupLabel>
          <div className="as-mode-seg" role="tablist" aria-label="Connection mode">
            {[
              { id: "local", label: "Local repo", sub: "Use files on this Mac", Icon: FolderOpen },
              { id: "github", label: "GitHub", sub: "Use repo and branch", Icon: Upload },
              { id: "a2a", label: "A2A", sub: "Use gateway URL", Icon: PlugZap },
            ].map((mode) => {
              const active = aeonSettings.mode === mode.id;
              return (
                <button key={mode.id} type="button" data-active={active || undefined} onClick={() => updateAeonSettings({ aeonMode: mode.id })}>
                  <mode.Icon size={15} aria-hidden="true" />
                  <span>{mode.label}</span>
                  <small>{mode.sub}</small>
                </button>
              );
            })}
          </div>
        </div>
        {aeonSettings.mode === "github" ? (
          <div className="as-block accent">
            <div className="as-github-connect">
              <Upload size={17} aria-hidden="true" />
              <div>
                <strong>Connect with GitHub OAuth</strong>
                <p>Saves GH_GLOBAL with repo, workflow, hook, org, and email access.</p>
              </div>
              <Btn variant="primary" sm disabled={aeonOauthConnecting} onClick={openAeonGithubOauth}>{aeonOauthConnecting ? "Opening..." : "Connect GitHub"}</Btn>
            </div>
            <details className="fb-disc" open={Boolean(aeonSettings.repo)}>
              <summary>Advanced repo values</summary>
              <div className="as-2col">
                <Field label="GitHub repo"><TextInput className="fb-mono" value={aeonSettings.repo} onChange={(event) => updateAeonSettings({ aeonRepo: event.target.value })} placeholder="owner/repo" /></Field>
                <Field label="Branch"><TextInput className="fb-mono" value={aeonSettings.branch} onChange={(event) => updateAeonSettings({ aeonBranch: event.target.value })} placeholder="main" /></Field>
              </div>
            </details>
          </div>
        ) : null}
        {aeonSettings.mode === "a2a" ? (
          <details className="fb-disc" open>
            <summary>Advanced gateway URL</summary>
            <Field label="A2A gateway URL"><TextInput className="fb-mono" value={aeonSettings.a2aUrl} onChange={(event) => updateAeonSettings({ a2aUrl: event.target.value, gatewayUrl: event.target.value })} placeholder="http://127.0.0.1:41241" /></Field>
          </details>
        ) : null}
        {aeonSettings.mode === "local" ? (
          <div className="as-block">
            <div className="as-folder">
              <span className="tile"><FolderOpen size={19} aria-hidden="true" /></span>
              <div className="grow">
                <span className="fb-eyebrow">AEON repo folder</span>
                <code className="path">{aeonSettings.path || "Choose a folder"}</code>
              </div>
              <Btn sm onClick={() => void browseAgentRuntimeFolder?.()}><FolderOpen size={14} aria-hidden="true" />Browse</Btn>
            </div>
          </div>
        ) : null}
      </div>
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
    const shared = agentCreateMachine ? agentCreateDraft.useSharedVault : roleModalAgent?.useSharedVault !== false;
    return (
      <div className="as-panel">
        <PanelHead eyebrow="Memory" title="Brain and workspace" sub="Where this agent remembers, and the local folder it reads and writes." />
        <div className="as-mem-card" data-on={shared || undefined}>
          <div className="as-mem-head">
            <span className="tile"><BrainCircuit size={19} aria-hidden="true" /></span>
            <div className="grow">
              <div className="t">Shared Obsidian brain</div>
              <div className="s">{shared ? "One vault backs this agent's memory, tasks, and context." : "Off - this agent keeps its own isolated memory."}</div>
            </div>
            <Toggle on={shared} onChange={() => {
              if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, useSharedVault: !shared }));
              else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { useSharedVault: !shared });
            }} />
          </div>
          {shared ? (
            <div className="as-mem-detail">
              <div className="as-mem-path">
                <FolderOpen size={15} aria-hidden="true" />
                <code>{sharedVault?.enabled ? sharedVault.vaultPath || "Auto-detected vault" : "Shared brain is off in Vault settings"}</code>
              </div>
              <div className="as-mem-chips">
                {["Memory", "Kanban", "Notifications", "Context"].map((label) => <span key={label} className="as-mem-chip"><Check size={11} aria-hidden="true" />{label}</span>)}
              </div>
            </div>
          ) : null}
        </div>
        {!agentCreateMachine && roleModalAgent ? (
          <div className="as-folder">
            <span className="tile"><FolderOpen size={19} aria-hidden="true" /></span>
            <div className="grow">
              <span className="fb-eyebrow">{isAutopilotSettings ? "AEON repo folder" : "Runtime folder"}</span>
              <code className="path">{runtimeFolderValue.trim() || "Managed by runtime"}</code>
              <div className="desc">{isAutopilotSettings ? "The local AEON repo the dashboard reads and mirrors into Obsidian." : "Used as this agent's local memory and workspace folder."}</div>
            </div>
            <div className="acts">
              <button type="button" className="fb-iconbtn" disabled={agentRuntimeFolderBrowsing} onClick={() => void browseAgentRuntimeFolder()} aria-label="Browse runtime folder"><FolderOpen size={15} aria-hidden="true" /></button>
              <button type="button" className="fb-iconbtn" onClick={() => setAgentRuntimeFolderEditing((current) => !current)} aria-label="Edit runtime folder path"><Pencil size={15} aria-hidden="true" /></button>
            </div>
          </div>
        ) : null}
        {agentRuntimeFolderEditing && roleModalAgent ? (
          <details className="fb-disc" open>
            <summary>Advanced folder path</summary>
            <div className="as-row">
              <TextInput
                className="fb-mono"
                value={runtimeFolderValue}
                onChange={(event) => {
                  updateAgentProfile(roleModalAgent.id, isAutopilotSettings ? { aeonLocalPath: event.target.value, localDataDir: event.target.value } : { localDataDir: event.target.value });
                  setAgentRuntimeFolderStatus("");
                }}
                placeholder={isAutopilotSettings ? "~/.aeon or ~/my-aeon-repo" : "Leave blank to use the runtime default"}
              />
              <Btn variant="primary" sm onClick={() => setAgentRuntimeFolderEditing(false)}><Check size={13} aria-hidden="true" />Done</Btn>
            </div>
          </details>
        ) : null}
        {agentRuntimeFolderStatus ? <p className="as-status">{agentRuntimeFolderStatus}</p> : null}
      </div>
    );
  }

  function renderSecurity() {
    return (
      <div className="as-panel">
        <PanelHead eyebrow="Security" title="Guards and redaction" sub="Always-on protections that run locally before anything reaches a runtime." />
        {[
          ["Secret redaction", "Sensitive env values stay masked in runtime-facing prompts.", ShieldCheck],
          ["Local-first paths", "Machine and directory access keeps collector boundaries intact.", FolderOpen],
          ["Scoped tools", "Runtime actions appear only for capabilities the current adapter exposes.", Settings2],
        ].map(([title, body, SecurityIcon]) => (
          <article key={title} className="as-sec">
            <span className="tile"><SecurityIcon size={19} aria-hidden="true" /></span>
            <div><h5>{title}</h5><p>{body}</p></div>
            <Badge tone="live"><Check size={11} aria-hidden="true" />Active</Badge>
          </article>
        ))}
      </div>
    );
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
            ? <AgentSettingsCallsPanel {...{ agentCreateDraft, agentCreateMachine, onQueenClapWakeEnabledChange, queenClapWakeEnabled, roleModalAgent, setAgentCreateDraft, updateAgentProfile }} />
            : renderSecurity();

  const primaryActionBusy = runtimeIntegrationBusy === "create-agent" || runtimeIntegrationBusy === "load-model" || lmStudioSelectedModelLoading;
  const primaryActionLabel = (runtimeIntegrationBusy === "load-model" || lmStudioSelectedModelLoading) && lmStudioSelectedModelNeedsLoad
    ? "Loading..."
    : agentCreateMachine
      ? runtimeIntegrationBusy === "create-agent"
        ? "Creating..."
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
