"use client";

/* eslint-disable react-hooks/immutability, react-hooks/purity */

import { type ChangeEvent, type Dispatch, type SetStateAction, useMemo } from "react";
import type { BeeWorkerPreset } from "@/lib/config/bee-worker-presets";
import type { AgentProfile, AgentRuntime, BeeWorkerClass, CustomWorkerClassProfile } from "@/lib/types/agent-runtime";
import type { BrainSkillSummary, HivemindLinkClientStatus, MachineGroup, RuntimeIntegrationStatus, WorkerClassDraft } from "@/features/dashboard/dashboard-types";
import type { AgentCreateDraft, AgentWorkerClassView, RuntimeModelDraft } from "@/features/dashboard/agent-settings-types";
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
  runRuntimeIntegrationAction: (action: string, input: Record<string, unknown>, agent: AgentProfile) => void | Promise<void>;
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
  const agentSettingsWorkerLabel = agentSettingsCustomWorker?.label || `${agentSettingsWorkerPreset.label} bee`;
  const agentSettingsWorkerImage = agentSettingsCustomWorker?.imageSrc || beeRoleIconPath("worker", agentSettingsWorkerClass);
  const agentSettingsSkillProfile = agentCreateMachine
    ? agentCreateDraft.skillProfilePrompt
    : roleModalAgent?.skillProfilePrompt ?? agentSettingsWorkerPreset.taskProfile;
  const agentSettingsPreferredSkills = agentCreateMachine
    ? agentCreateDraft.preferredSkillSlugs
    : roleModalAgent?.preferredSkillSlugs ?? agentSettingsWorkerPreset.skillSlugs;
  const agentSettingsRuntime = agentCreateMachine ? agentCreateDraft.runtime : roleModalAgent?.runtime ?? "hermes";
  const agentSettingsProvider = agentCreateMachine ? agentCreateDraft.provider ?? "" : roleModalAgent?.provider ?? "";
  const agentSettingsModel = agentCreateMachine ? agentCreateDraft.model ?? "" : roleModalAgent?.model ?? "";
  const agentSettingsIntegrationTarget = agentCreateMachine
    ? {
      ...createAgentProfile(agentCreateDraft.runtime, runtimeCount(agents, agentCreateDraft.runtime) + 1),
      provider: agentCreateDraft.provider,
      model: agentCreateDraft.model,
      adaptiveOpenRouter: agentCreateDraft.adaptiveOpenRouter,
      usePod: agentCreateDraft.usePod,
      telemetryUrl: agentCreateMachine.collectorUrl,
      machineName: agentCreateMachine.name,
    }
    : roleModalAgent;
  const freshRuntimeModelSelection = runtimeIntegrationStatus?.runtime === agentSettingsRuntime
    && runtimeIntegrationStatus.targetKey === runtimeIntegrationTargetKey(agentSettingsIntegrationTarget)
    ? runtimeIntegrationStatus.modelSelection
    : undefined;
  const runtimeModelSelectionFresh = Boolean(freshRuntimeModelSelection);
  const runtimeModelSelection = freshRuntimeModelSelection ?? runtimeModelSelectionsByRuntime[agentSettingsRuntime];
  const runtimeModelProviders = runtimeModelSelection?.providers ?? [];
  const selectedRuntimeProvider = runtimeModelProviders.find((provider) => provider.slug === agentSettingsProvider)
    ?? runtimeModelProviders.find((provider) => provider.slug === runtimeModelSelection?.provider)
    ?? runtimeModelProviders[0];
  const selectedRuntimeModels = selectedRuntimeProvider?.models ?? [];
  const selectedRuntimeModelId = agentSettingsModel || runtimeModelSelection?.model || selectedRuntimeModels[0]?.id || "";
  const selectedRuntimeModel = selectedRuntimeModels.find((model) => model.id === selectedRuntimeModelId);
  const updateAgentRuntimeModel = (provider: string, model: string) => {
    const patch = { provider, model };
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, ...patch }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
    const target = agentSettingsIntegrationTarget;
    if (target && (target.runtime === "openclaw" || target.runtime === "hermes")) {
      void runRuntimeIntegrationAction("set-model", patch, { ...target, ...patch });
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
    const patch = {
      workerClass,
      customWorkerClass: undefined,
      selectedCustomWorkerClassId: undefined,
      skillProfilePrompt: preset.taskProfile,
      preferredSkillSlugs: preset.skillSlugs,
    };
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, ...patch }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
  };
  const selectCustomWorkerClass = (customWorkerClass: CustomWorkerClassProfile) => {
    const patch = {
      workerClass: "general" as BeeWorkerClass,
      customWorkerClass,
      selectedCustomWorkerClassId: customWorkerClass.id,
      skillProfilePrompt: customWorkerClass.skillProfilePrompt,
      preferredSkillSlugs: customWorkerClass.preferredSkillSlugs,
    };
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, ...patch }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, patch);
  };
  const updateAgentSkillProfile = (skillProfilePrompt: string) => {
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, skillProfilePrompt }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { skillProfilePrompt });
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
    [machineInitDraft.serverType],
  );
  const showHivemindLinkConnectedBanner = !hivemindLinkBannerDismissed
    && hivemindLinkStatus?.ok === true
    && hivemindLinkConnectedUntil > Date.now();

  return { agentSettingsSelectedCustomWorkerId, agentSettingsCustomWorker, agentSettingsWorkerLabel, agentSettingsWorkerImage, agentSettingsSkillProfile, agentSettingsPreferredSkills, agentSettingsRuntime, agentSettingsProvider, agentSettingsModel, runtimeModelSelection, runtimeModelSelectionFresh, runtimeModelProviders, selectedRuntimeProvider, selectedRuntimeModels, selectedRuntimeModelId, selectedRuntimeModel, updateAgentRuntimeModel, agentSettingsIntegrationTarget, addHermesModelFromDraft, selectAgentWorkerClass, selectCustomWorkerClass, updateAgentSkillProfile, addAgentPreferredSkill, removeAgentPreferredSkill, openCustomWorkerClassCreator, applyCustomWorkerClass, toggleCustomWorkerSkill, uploadCustomWorkerImage, filteredCustomWorkerSkills, selectedHetznerServerType, showHivemindLinkConnectedBanner };
}
