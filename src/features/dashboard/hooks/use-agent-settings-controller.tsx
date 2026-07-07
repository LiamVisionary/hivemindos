"use client";

/* eslint-disable react-hooks/purity */

import { type ChangeEvent, type Dispatch, type SetStateAction, useMemo } from "react";
import { renderBeeSoulTemplate, type BeeWorkerPreset } from "@/lib/config/bee-worker-presets";
import { DEFAULT_RESEARCH_METHOD } from "@/lib/config/research-methods";
import { MODEL_PROVIDER_GATEWAYS } from "@/lib/config/model-provider-gateways";
import { PROVIDER_CATALOG } from "@/lib/config/provider-catalog";
import { HIVEMIND_OS_RUNTIME, runtimeSettingsFeature, type AgentProfile, type AgentRuntime, type BeeWorkerClass, type CustomWorkerClassProfile } from "@/lib/types/agent-runtime";
import type { BrainSkillSummary, HivemindLinkClientStatus, MachineGroup, RuntimeIntegrationStatus, WorkerClassDraft } from "@/features/dashboard/dashboard-types";
import type { AgentCreateDraft, AgentWorkerClassView, RuntimeModelDraft } from "@/features/dashboard/agent-settings-types";
import { selectBestRuntimeModel } from "@/features/dashboard/views/chat/runtime-model-registry";
type HetznerServerTypeOption = {
  value: string;
  label: string;
  detail: string;
  monthlyEur: number;
  cores: number;
  memoryGb: number;
  diskGb: number;
  cpu: string;
};
type MachineInitDraft = {
  serverType: string;
};

function runtimeIntegrationTargetKey(agent?: AgentProfile | null) {
  if (!agent) return "";
  const telemetryUrl = agent.telemetryUrl?.trim().replace(/\/+$/, "") || "local";
  const localDataDir = agent.localDataDir?.trim() || "";
  const agentId = agent.agentId?.trim() || "";
  return [agent.runtime, telemetryUrl, localDataDir, agentId].join("|");
}

function localOpenAiProviderName(slug: string) {
  if (slug === "lm-studio") return "Local";
  if (slug === "ollama") return "Ollama";
  if (slug === "vllm") return "vLLM";
  if (slug === "llamacpp") return "llama.cpp";
  return "OpenAI-compatible";
}

// Human label for a provider slug the runtime hasn't enumerated (so we can
// synthesize a tile for the agent's own configured provider). Prefers the known
// gateway/catalog name, else title-cases the slug ("openai-codex" -> "OpenAI Codex").
function configuredProviderDisplayName(slug: string) {
  const gateway = MODEL_PROVIDER_GATEWAYS[slug];
  if (gateway) return gateway.name;
  const catalog = PROVIDER_CATALOG.find((entry) => entry.slug === slug);
  if (catalog) return catalog.name;
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) =>
      part === "openai" ? "OpenAI" : part === "ai" ? "AI" : part === "llm" ? "LLM" : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ") || slug;
}

type UseAgentSettingsControllerProps = {
  HETZNER_SERVER_TYPE_OPTIONS: readonly HetznerServerTypeOption[];
  agentCreateDraft: AgentCreateDraft;
  agentCreateMachine: MachineGroup | null;
  agentSettingsCustomWorkers: CustomWorkerClassProfile[];
  agentSettingsWorkerClass: BeeWorkerClass;
  agentSettingsWorkerPreset: BeeWorkerPreset;
  agents: AgentProfile[];
  beeRoleIconPath: (role?: AgentProfile["beeRole"] | "worker", workerClass?: BeeWorkerClass) => string;
  beeWorkerPreset: (workerClass: BeeWorkerClass) => BeeWorkerPreset;
  createAgentProfile: (runtime: AgentRuntime, index: number) => AgentProfile;
  customWorkerDraft: WorkerClassDraft;
  customWorkerProfileFromDraft: (draft: WorkerClassDraft) => CustomWorkerClassProfile;
  customWorkerSkillSearch: string;
  hivemindLinkBannerDismissed: boolean;
  hivemindLinkConnectedUntil: number;
  hivemindLinkStatus: HivemindLinkClientStatus | null;
  machineInitDraft: MachineInitDraft;
  roleModalAgent: AgentProfile | null;
  runRuntimeIntegrationAction: (action: string, input: Record<string, unknown>, agent: AgentProfile) => void | Promise<{ ok?: boolean; error?: string; message?: string } | void>;
  runtimeCount: (agents: AgentProfile[], runtime: AgentRuntime) => number;
  runtimeIntegrationStatus: RuntimeIntegrationStatus | null;
  runtimeModelDraft: RuntimeModelDraft;
  runtimeModelSelectionsByRuntime: Partial<Record<AgentRuntime, NonNullable<RuntimeIntegrationStatus["modelSelection"]>>>;
  setAgentCreateDraft: Dispatch<SetStateAction<AgentCreateDraft>>;
  setAgentWorkerClassView: Dispatch<SetStateAction<AgentWorkerClassView>>;
  setCustomWorkerDraft: Dispatch<SetStateAction<WorkerClassDraft>>;
  setCustomWorkerImageError: Dispatch<SetStateAction<string>>;
  setCustomWorkerSkillSearch: Dispatch<SetStateAction<string>>;
  setRuntimeModelDraft: Dispatch<SetStateAction<RuntimeModelDraft>>;
  sharedSkillOptions: BrainSkillSummary[];
  updateAgentProfile: (agentId: string, patch: Partial<AgentProfile>) => void;
};

export function useAgentSettingsController(props: UseAgentSettingsControllerProps) {
  const { HETZNER_SERVER_TYPE_OPTIONS, agentCreateDraft, agentCreateMachine, agentSettingsCustomWorkers, agentSettingsWorkerClass, agentSettingsWorkerPreset, agents, beeRoleIconPath, beeWorkerPreset, createAgentProfile, customWorkerDraft, customWorkerProfileFromDraft, customWorkerSkillSearch, hivemindLinkBannerDismissed, hivemindLinkConnectedUntil, hivemindLinkStatus, machineInitDraft, roleModalAgent, runRuntimeIntegrationAction, runtimeCount, runtimeIntegrationStatus, runtimeModelDraft, runtimeModelSelectionsByRuntime, setAgentCreateDraft, setAgentWorkerClassView, setCustomWorkerDraft, setCustomWorkerImageError, setCustomWorkerSkillSearch, setRuntimeModelDraft, sharedSkillOptions, updateAgentProfile } = props;
  const agentSettingsSelectedCustomWorkerId = agentCreateMachine ? agentCreateDraft.selectedCustomWorkerClassId : roleModalAgent?.selectedCustomWorkerClassId;
  const agentSettingsCustomWorker = agentSettingsCustomWorkers.find((workerClass) => workerClass.id === agentSettingsSelectedCustomWorkerId);
  const settingsAgentIsQueen = !agentCreateMachine && roleModalAgent?.beeRole === "queen";
  const agentSettingsWorkerLabel = settingsAgentIsQueen ? "Queen Bee" : agentSettingsCustomWorker?.label || `${agentSettingsWorkerPreset.label} bee`;
  const agentSettingsWorkerImage = settingsAgentIsQueen ? beeRoleIconPath("queen") : agentSettingsCustomWorker?.imageSrc || beeRoleIconPath("worker", agentSettingsWorkerClass);
  const agentSettingsSoulPrompt = agentCreateMachine
    ? (agentCreateDraft.soulPrompt ?? "")
    : (roleModalAgent?.soulPrompt ?? "");
  const agentSettingsSkillProfile = agentCreateMachine
    ? agentCreateDraft.skillProfilePrompt
    : roleModalAgent?.skillProfilePrompt ?? agentSettingsWorkerPreset.taskProfile;
  const agentSettingsPreferredSkills = agentCreateMachine
    ? agentCreateDraft.preferredSkillSlugs
    : roleModalAgent?.preferredSkillSlugs ?? agentSettingsWorkerPreset.skillSlugs;
  const agentSettingsRuntime = agentCreateMachine ? agentCreateDraft.runtime : roleModalAgent?.runtime ?? "hermes";
  const agentSettingsProvider = agentCreateMachine ? agentCreateDraft.provider ?? "" : roleModalAgent?.provider ?? "";
  const agentSettingsModel = agentCreateMachine ? agentCreateDraft.model ?? "" : roleModalAgent?.model ?? "";
  // Memoized so the target keeps a stable identity across renders — it feeds
  // effect dependency arrays in the settings modal (e.g. the LM Studio status
  // poll), which would otherwise tear down and re-arm on every render.
  const agentSettingsIntegrationTarget = useMemo(
    () =>
      agentCreateMachine
        ? {
          ...createAgentProfile(agentCreateDraft.runtime, runtimeCount(agents, agentCreateDraft.runtime) + 1),
          provider: agentCreateDraft.provider,
          model: agentCreateDraft.model,
          adaptiveOpenRouter: agentCreateDraft.adaptiveOpenRouter,
          adaptiveRouting: agentCreateDraft.adaptiveRouting,
          usePod: agentCreateDraft.usePod,
          venice: agentCreateDraft.venice,
          hivemindosModels: agentCreateDraft.hivemindosModels,
          telemetryUrl: agentCreateMachine.collectorUrl,
          machineName: agentCreateMachine.name,
        }
        : roleModalAgent,
    [
      agentCreateDraft.adaptiveOpenRouter,
      agentCreateDraft.adaptiveRouting,
      agentCreateDraft.model,
      agentCreateDraft.provider,
      agentCreateDraft.runtime,
      agentCreateDraft.usePod,
      agentCreateDraft.venice,
      agentCreateDraft.hivemindosModels,
      agentCreateMachine,
      agents,
      createAgentProfile,
      roleModalAgent,
      runtimeCount,
    ],
  );
  const freshRuntimeModelSelection = runtimeIntegrationStatus?.runtime === agentSettingsRuntime
    && runtimeIntegrationStatus.targetKey === runtimeIntegrationTargetKey(agentSettingsIntegrationTarget)
    ? runtimeIntegrationStatus.modelSelection
    : undefined;
  const runtimeModelSelectionFresh = Boolean(freshRuntimeModelSelection);
  const cachedRuntimeModelSelection = runtimeModelSelectionsByRuntime[agentSettingsRuntime];
  const runtimeModelSelection = agentSettingsRuntime === HIVEMIND_OS_RUNTIME
    ? cachedRuntimeModelSelection ?? freshRuntimeModelSelection
    : freshRuntimeModelSelection ?? cachedRuntimeModelSelection;
  const runtimeModelProviders = useMemo(() => {
    const baseProviders = runtimeModelSelection?.providers ?? [];
    const modelSettings = runtimeSettingsFeature(agentSettingsRuntime);
    if (modelSettings.modelSource !== "runtime" || agentSettingsRuntime === "aeon") return baseProviders;
    const providersBySlug = new Map(baseProviders.map((provider) => [provider.slug, provider]));
    if (agentSettingsRuntime === HIVEMIND_OS_RUNTIME) {
      const localProviderSlug = agentSettingsProvider || modelSettings.defaultProvider || "openai-compatible";
      if (!providersBySlug.has(localProviderSlug)) {
        const models = agentSettingsModel ? [{ id: agentSettingsModel }] : [];
        providersBySlug.set(localProviderSlug, {
          slug: localProviderSlug,
          name: localOpenAiProviderName(localProviderSlug),
          models,
          totalModels: models.length,
          isCurrent: true,
          isUserDefined: true,
          source: "Configured Local provider",
        });
      }
    }
    // OpenRouter's hosted Fusion compound model is a plain OpenRouter slug, so
    // surface it under the OpenRouter provider when that provider is available.
    const openRouterProvider = providersBySlug.get("openrouter");
    if (openRouterProvider && !openRouterProvider.models?.some((model) => model.id === "openrouter/fusion")) {
      const models = [{ id: "openrouter/fusion" }, ...(openRouterProvider.models ?? [])];
      providersBySlug.set("openrouter", { ...openRouterProvider, models, totalModels: models.length });
    }
    for (const gateway of Object.values(MODEL_PROVIDER_GATEWAYS)) {
      if (providersBySlug.has(gateway.slug)) continue;
      const models = gateway.defaultModel ? [{ id: gateway.defaultModel }] : [];
      providersBySlug.set(gateway.slug, {
        slug: gateway.slug,
        name: gateway.name,
        models,
        totalModels: models.length,
        isUserDefined: true,
        source: "HivemindOS provider gateway",
      });
    }
    // Always surface the full first-class provider catalog so unconfigured
    // providers can be discovered and onboarded inline (rather than hidden).
    for (const entry of PROVIDER_CATALOG) {
      if (providersBySlug.has(entry.slug)) continue;
      providersBySlug.set(entry.slug, {
        slug: entry.slug,
        name: entry.name,
        models: [],
        totalModels: 0,
        isUserDefined: true,
        source: "catalog",
      });
    }
    // Always surface the agent's OWN configured provider + model as a selectable,
    // highlightable option — even when the runtime can't enumerate its inventory
    // (slow/failed status fetch, an agent on a remote or unreachable machine, or
    // an older runtime that doesn't report a model list). The tiles above are
    // built only from the runtime-reported list plus the static catalog/gateways,
    // which omit runtime-managed providers like `openai-codex`; without this the
    // modal opens with the agent's set provider/model unhighlighted. Mirrors the
    // HivemindOS local-provider synthesis above, for every runtime-model runtime.
    if (agentSettingsProvider) {
      const existing = providersBySlug.get(agentSettingsProvider);
      if (!existing) {
        const models = agentSettingsModel ? [{ id: agentSettingsModel }] : [];
        providersBySlug.set(agentSettingsProvider, {
          slug: agentSettingsProvider,
          name: configuredProviderDisplayName(agentSettingsProvider),
          models,
          totalModels: models.length,
          isCurrent: true,
          isUserDefined: true,
          source: "Configured on this agent",
        });
      } else if (agentSettingsModel && !existing.models?.some((model) => model.id === agentSettingsModel)) {
        const models = [{ id: agentSettingsModel }, ...(existing.models ?? [])];
        providersBySlug.set(agentSettingsProvider, {
          ...existing,
          models,
          totalModels: Math.max(existing.totalModels || 0, models.length),
        });
      }
    }
    return [...providersBySlug.values()];
  }, [agentSettingsModel, agentSettingsProvider, agentSettingsRuntime, runtimeModelSelection]);
  const selectedRuntimeProvider = agentSettingsProvider
    ? runtimeModelProviders.find((provider) => provider.slug === agentSettingsProvider)
    : runtimeModelProviders.find((provider) => provider.slug === runtimeModelSelection?.provider)
      ?? runtimeModelProviders[0];
  const selectedRuntimeModels = selectedRuntimeProvider?.models ?? [];
  const selectedRuntimeModelId = agentSettingsModel || selectBestRuntimeModel(selectedRuntimeProvider, {
    currentModel: runtimeModelSelection?.model,
    defaultModel: runtimeSettingsFeature(agentSettingsRuntime).defaultModel,
    runtimeSelectedModel: runtimeModelSelection?.model,
    preferAdaptive: true,
  });
  const selectedRuntimeModel = selectedRuntimeModels.find((model) => model.id === selectedRuntimeModelId);
  const updateAgentRuntimeModel = (provider: string, model: string) => {
    const patch = { provider, model };
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, ...patch }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
    const target = agentSettingsIntegrationTarget;
    const virtualRuntimeModel = provider === "adaptive" || provider === "hive-fusion" || (provider === "bankr" && model === "adaptive");
    if (target && !virtualRuntimeModel && (target.runtime === "openclaw" || target.runtime === "hermes")) {
      window.setTimeout(() => {
        void runRuntimeIntegrationAction("set-model", patch, { ...target, ...patch });
      }, 0);
    }
  };
  const addHermesModelFromDraft = async () => {
    const provider = runtimeModelDraft.provider.trim() || selectedRuntimeProvider?.slug || "";
    const model = runtimeModelDraft.model.trim();
    if (!provider || !model || !agentSettingsIntegrationTarget) return;
    await runRuntimeIntegrationAction("add-model", {
      provider,
      model,
      contextLength: runtimeModelDraft.contextLength.trim() ? Number(runtimeModelDraft.contextLength) : undefined,
    }, agentSettingsIntegrationTarget);
    updateAgentRuntimeModel(provider, model);
    setRuntimeModelDraft({ provider: "", model: "", contextLength: "" });
  };
  const selectAgentWorkerClass = (workerClass: BeeWorkerClass) => {
    const preset = beeWorkerPreset(workerClass);
    const patch: Partial<AgentProfile> = {
      workerClass,
      customWorkerClass: undefined,
      selectedCustomWorkerClassId: undefined,
      preferredSkillSlugs: preset.skillSlugs,
      researchMethod: workerClass === "research" ? DEFAULT_RESEARCH_METHOD : undefined,
    };
    if (agentCreateMachine) {
      setAgentCreateDraft((current) => {
        const previousPreset = beeWorkerPreset(current.workerClass);
        const currentSoul = current.soulPrompt?.trim() ?? "";
        const previousSoul = renderBeeSoulTemplate(previousPreset.soulTemplate, current.name).trim();
        const currentSuitedFor = current.skillProfilePrompt?.trim() ?? "";
        const previousSuitedFor = previousPreset.taskProfile.trim();
        return {
          ...current,
          ...patch,
          soulPrompt: !currentSoul || currentSoul === previousSoul
            ? renderBeeSoulTemplate(preset.soulTemplate, current.name)
            : current.soulPrompt,
          skillProfilePrompt: !currentSuitedFor || currentSuitedFor === previousSuitedFor
            ? preset.taskProfile
            : current.skillProfilePrompt,
        };
      });
    } else if (roleModalAgent) {
      const previousPreset = beeWorkerPreset(roleModalAgent.workerClass ?? "general");
      const currentSoul = roleModalAgent.soulPrompt?.trim() ?? "";
      const previousSoul = renderBeeSoulTemplate(previousPreset.soulTemplate, roleModalAgent.name).trim();
      const currentPrompt = roleModalAgent.skillProfilePrompt?.trim() ?? "";
      const previousPrompt = previousPreset.taskProfile.trim();
      updateAgentProfile(roleModalAgent.id, {
        ...patch,
        ...(!currentSoul || currentSoul === previousSoul
          ? { soulPrompt: renderBeeSoulTemplate(preset.soulTemplate, roleModalAgent.name) }
          : {}),
        ...(!currentPrompt || currentPrompt === previousPrompt
          ? { skillProfilePrompt: preset.taskProfile }
          : {}),
      });
    }
  };
  const selectCustomWorkerClass = (customWorkerClass: CustomWorkerClassProfile) => {
    const patch = {
      workerClass: "general" as BeeWorkerClass,
      customWorkerClass,
      selectedCustomWorkerClassId: customWorkerClass.id,
      skillProfilePrompt: customWorkerClass.skillProfilePrompt,
      preferredSkillSlugs: customWorkerClass.preferredSkillSlugs,
      researchMethod: undefined,
    };
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, ...patch }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
  };
  const updateAgentSkillProfile = (skillProfilePrompt: string) => {
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, skillProfilePrompt }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { skillProfilePrompt });
  };
  const updateAgentSoulPrompt = (soulPrompt: string) => {
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, soulPrompt }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { soulPrompt });
  };
  const addAgentPreferredSkill = (slug: string) => {
    const trimmedSlug = slug.trim();
    if (!trimmedSlug || agentSettingsPreferredSkills.includes(trimmedSlug)) return;
    const preferredSkillSlugs = [...agentSettingsPreferredSkills, trimmedSlug];
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, preferredSkillSlugs }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { preferredSkillSlugs });
  };
  const removeAgentPreferredSkill = (slug: string) => {
    const preferredSkillSlugs = agentSettingsPreferredSkills.filter((item) => item !== slug);
    if (preferredSkillSlugs.length === agentSettingsPreferredSkills.length) return;
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, preferredSkillSlugs }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { preferredSkillSlugs });
  };
  const openCustomWorkerClassCreator = () => {
    setCustomWorkerDraft({
      label: "",
      imageSrc: beeRoleIconPath("worker", agentSettingsWorkerClass),
      skillProfilePrompt: "",
      preferredSkillSlugs: agentSettingsPreferredSkills,
    });
    setCustomWorkerSkillSearch("");
    setCustomWorkerImageError("");
    setAgentWorkerClassView("create");
  };
  const applyCustomWorkerClass = () => {
    const customWorkerClass = customWorkerProfileFromDraft(customWorkerDraft);
    const nextCustomWorkerClasses = [
      ...agentSettingsCustomWorkers.filter((workerClass) => workerClass.id !== customWorkerClass.id),
      customWorkerClass,
    ];
    const patch = {
      workerClass: "general" as BeeWorkerClass,
      customWorkerClass,
      customWorkerClasses: nextCustomWorkerClasses,
      selectedCustomWorkerClassId: customWorkerClass.id,
      skillProfilePrompt: customWorkerClass.skillProfilePrompt,
      preferredSkillSlugs: customWorkerClass.preferredSkillSlugs,
    };
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, ...patch }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
    setAgentWorkerClassView("presets");
  };
  // Install an optional packaged agent (from the Browse Agents catalog) as a selectable custom
  // worker class. Mirrors applyCustomWorkerClass but sources the profile from the catalog entry.
  const installPackagedAgent = (agent: { slug: string; label: string; summary: string; soulPrompt?: string }) => {
    const customWorkerClass: CustomWorkerClassProfile = {
      id: agent.slug,
      label: agent.label,
      soulPrompt: agent.soulPrompt,
      skillProfilePrompt: agent.summary,
      preferredSkillSlugs: [],
    };
    const nextCustomWorkerClasses = [
      ...agentSettingsCustomWorkers.filter((workerClass) => workerClass.id !== customWorkerClass.id),
      customWorkerClass,
    ];
    const patch = {
      workerClass: "general" as BeeWorkerClass,
      customWorkerClass,
      customWorkerClasses: nextCustomWorkerClasses,
      selectedCustomWorkerClassId: customWorkerClass.id,
      skillProfilePrompt: customWorkerClass.skillProfilePrompt,
      preferredSkillSlugs: customWorkerClass.preferredSkillSlugs,
    };
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, ...patch }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
    setAgentWorkerClassView("presets");
  };
  const toggleCustomWorkerSkill = (slug: string) => {
    setCustomWorkerDraft((current) => ({
      ...current,
      preferredSkillSlugs: current.preferredSkillSlugs.includes(slug)
        ? current.preferredSkillSlugs.filter((item) => item !== slug)
        : [...current.preferredSkillSlugs, slug],
    }));
  };
  const uploadCustomWorkerImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setCustomWorkerImageError("Choose an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setCustomWorkerDraft((current) => ({ ...current, imageSrc: reader.result as string }));
      setCustomWorkerImageError("");
    };
    reader.onerror = () => setCustomWorkerImageError("Could not read that image.");
    reader.readAsDataURL(file);
  };
  const filteredCustomWorkerSkills = useMemo(() => {
    const query = customWorkerSkillSearch.trim().toLowerCase();
    const options = sharedSkillOptions.map((skill) => ({
      ...skill,
      selected: customWorkerDraft.preferredSkillSlugs.includes(skill.slug),
    }));
    if (!query) return options.sort((a, b) => Number(b.selected) - Number(a.selected) || a.name.localeCompare(b.name));
    return options
      .map((skill) => {
        const nameMatch = skill.name.toLowerCase().includes(query) || skill.slug.toLowerCase().includes(query);
        const keywordMatch = skill.description.toLowerCase().includes(query);
        return { ...skill, rank: nameMatch ? 0 : keywordMatch ? 1 : 2 };
      })
      .filter((skill) => skill.rank < 2)
      .sort((a, b) => a.rank - b.rank || Number(b.selected) - Number(a.selected) || a.name.localeCompare(b.name));
  }, [customWorkerDraft.preferredSkillSlugs, customWorkerSkillSearch, sharedSkillOptions]);
  const selectedHetznerServerType = useMemo(
    () => HETZNER_SERVER_TYPE_OPTIONS.find((option) => option.value === machineInitDraft.serverType) ?? HETZNER_SERVER_TYPE_OPTIONS[0],
    [HETZNER_SERVER_TYPE_OPTIONS, machineInitDraft.serverType],
  );
  const showHivemindLinkConnectedBanner = !hivemindLinkBannerDismissed
    && hivemindLinkStatus?.ok === true
    && hivemindLinkConnectedUntil > Date.now();

  return { agentSettingsSelectedCustomWorkerId, agentSettingsCustomWorker, agentSettingsWorkerLabel, agentSettingsWorkerImage, agentSettingsSoulPrompt, agentSettingsSkillProfile, agentSettingsPreferredSkills, agentSettingsRuntime, agentSettingsProvider, agentSettingsModel, runtimeModelSelection, runtimeModelSelectionFresh, runtimeModelProviders, selectedRuntimeProvider, selectedRuntimeModels, selectedRuntimeModelId, selectedRuntimeModel, updateAgentRuntimeModel, agentSettingsIntegrationTarget, addHermesModelFromDraft, selectAgentWorkerClass, selectCustomWorkerClass, updateAgentSoulPrompt, updateAgentSkillProfile, addAgentPreferredSkill, removeAgentPreferredSkill, openCustomWorkerClassCreator, applyCustomWorkerClass, installPackagedAgent, toggleCustomWorkerSkill, uploadCustomWorkerImage, filteredCustomWorkerSkills, selectedHetznerServerType, showHivemindLinkConnectedBanner };
}
