"use client";

import type { Dispatch, SetStateAction } from "react";
import { openNativeDirectory } from "@/lib/native/filesystem";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { NATIVE_SETUP_RERUN_EVENT, readNativeSetupStatus } from "@/lib/native/setup";
import { renderBeeSoulTemplate, type BeeWorkerPreset } from "@/lib/config/bee-worker-presets";
import { DEFAULT_RESEARCH_METHOD } from "@/lib/config/research-methods";
import { isMobileMachineOs } from "@/features/fleet/fleet-identity";
import { saveDashboardStateValue } from "@/lib/services/dashboard-state-client";
import { mruRuntime, rememberMruRuntime } from "@/features/dashboard/agent-mru-runtime";
import { HIVEMIND_OS_RUNTIME, defaultAgentNameForRuntime, runtimeIntegrationFeature, runtimeLocalDataDirPatch, runtimePostCreateAction, runtimeProfileFeature, runtimeSettingsFeature, type AgentProfile, type AgentRuntime, type BeeWorkerClass } from "@/lib/types/agent-runtime";
import { DEFAULT_MOBILE_AGENT_MODEL, mobileAgentMachineKey, mobileAgentProfileFromRecord, type MobileAgentHostRecord, type MobileAgentRecord } from "@/lib/types/mobile-agents";
import type { AgentCreateDraft, AgentSettingsPanel, AgentWorkerClassView, RuntimeModelDraft, RuntimeModelSetupMode } from "@/features/dashboard/agent-settings-types";
import type { DashboardView, DiscoveredMachine, MachineGroup, RuntimeEnvSyncResponse, RuntimeIntegrationStatus, RuntimeModelSelection, RuntimeSessionSearchResult, WorkerClassDraft } from "@/features/dashboard/dashboard-types";

type UseAgentControllerProps = {
  RUNTIME_LABELS: Record<string, string>;
  aeonEnvKeys: string;
  agentCreateDraft: AgentCreateDraft;
  agentCreateMachine: MachineGroup | null;
  agents: AgentProfile[];
  beeWorkerPreset: (workerClass: BeeWorkerClass) => BeeWorkerPreset;
  collectorKey: (collectorUrl: string) => string;
  createAgentProfile: (runtime: AgentRuntime, index: number) => AgentProfile;
  defaultWorkerClassDraft: () => WorkerClassDraft;
  displayAgents: AgentProfile[];
  hermesUpdateDetail: (status: RuntimeIntegrationStatus | null | undefined) => string;
  normalizeAgentProfile: (agent: AgentProfile) => AgentProfile;
  onAgentCreated?: (agent: AgentProfile) => void | Promise<void>;
  openSetupModal: (machine: MachineGroup) => void;
  roleModalAgent: AgentProfile | null;
  runtimeCount: (agents: AgentProfile[], runtime: AgentRuntime) => number;
  runtimeSessionQuery: string;
  selectedAgent: AgentProfile | null;
  setActiveView: Dispatch<SetStateAction<DashboardView>>;
  setAeonEnvSyncStatus: Dispatch<SetStateAction<string>>;
  setAeonEnvSyncing: Dispatch<SetStateAction<boolean>>;
  setAgentCreateDraft: Dispatch<SetStateAction<AgentCreateDraft>>;
  setAgentCreateMachineKey: Dispatch<SetStateAction<string>>;
  setAgentRenameDraft: Dispatch<SetStateAction<string>>;
  setAgentRenameEditing: Dispatch<SetStateAction<boolean>>;
  setAgentRoleModalId: Dispatch<SetStateAction<string>>;
  setAgentRuntimeAdvancedOpen: Dispatch<SetStateAction<boolean>>;
  setAgentRuntimeFolderBrowsing: Dispatch<SetStateAction<boolean>>;
  setAgentRuntimeFolderEditing: Dispatch<SetStateAction<boolean>>;
  setAgentRuntimeFolderStatus: Dispatch<SetStateAction<string>>;
  setAgentSettingsPanel: Dispatch<SetStateAction<AgentSettingsPanel>>;
  setAgentWorkerClassView: Dispatch<SetStateAction<AgentWorkerClassView>>;
  setAgents: Dispatch<SetStateAction<AgentProfile[]>>;
  setCustomWorkerDraft: Dispatch<SetStateAction<WorkerClassDraft>>;
  setCustomWorkerImageError: Dispatch<SetStateAction<string>>;
  setCustomWorkerSkillSearch: Dispatch<SetStateAction<string>>;
  setDiscoveredMachines: Dispatch<SetStateAction<DiscoveredMachine[]>>;
  setHermesUpdateRequiredDetail: Dispatch<SetStateAction<string>>;
  setRuntimeBackgroundPrompt: Dispatch<SetStateAction<string>>;
  setRuntimeIntegrationBusy: Dispatch<SetStateAction<string>>;
  setRuntimeIntegrationMessage: Dispatch<SetStateAction<string>>;
  setRuntimeIntegrationStatus: Dispatch<SetStateAction<RuntimeIntegrationStatus | null>>;
  setRuntimeModelDraft: Dispatch<SetStateAction<RuntimeModelDraft>>;
  setRuntimeModelSelectionsByRuntime: Dispatch<SetStateAction<Partial<Record<AgentRuntime, RuntimeModelSelection>>>>;
  setRuntimeModelSetupMode: Dispatch<SetStateAction<RuntimeModelSetupMode>>;
  setRuntimeSessionQuery: Dispatch<SetStateAction<string>>;
  setRuntimeSessionResults: Dispatch<SetStateAction<RuntimeSessionSearchResult[]>>;
  setSelectedAgentId: Dispatch<SetStateAction<string>>;
};

function runtimeIntegrationTargetKey(agent?: AgentProfile | null) {
  if (!agent) return "";
  const telemetryUrl = agent.telemetryUrl?.trim().replace(/\/+$/, "") || "local";
  const localDataDir = agent.localDataDir?.trim() || "";
  const agentId = agent.agentId?.trim() || "";
  return [agent.runtime, telemetryUrl, localDataDir, agentId].join("|");
}

function mergeRuntimeModelSelections(
  current: RuntimeModelSelection | undefined,
  incoming: RuntimeModelSelection,
): RuntimeModelSelection {
  const providersBySlug = new Map<string, RuntimeModelSelection["providers"][number]>();
  for (const provider of [...(current?.providers ?? []), ...incoming.providers]) {
    const existing = providersBySlug.get(provider.slug);
    if (!existing) {
      providersBySlug.set(provider.slug, provider);
      continue;
    }
    const modelsById = new Map(existing.models.map((model) => [model.id, model]));
    for (const model of provider.models) {
      modelsById.set(model.id, { ...modelsById.get(model.id), ...model });
    }
    providersBySlug.set(provider.slug, {
      ...existing,
      ...provider,
      models: [...modelsById.values()],
      totalModels: Math.max(existing.totalModels, provider.totalModels, modelsById.size),
      isCurrent: Boolean(existing.isCurrent || provider.isCurrent),
      source: existing.source && provider.source && existing.source !== provider.source
        ? "Multiple machines"
        : provider.source ?? existing.source,
    });
  }
  return {
    provider: incoming.provider || current?.provider || "",
    model: incoming.model || current?.model || "",
    providers: [...providersBySlug.values()],
  };
}

export function useAgentController(props: UseAgentControllerProps) {
  const { RUNTIME_LABELS, aeonEnvKeys, agentCreateDraft, agentCreateMachine, agents, beeWorkerPreset, collectorKey, createAgentProfile, defaultWorkerClassDraft, displayAgents, hermesUpdateDetail, normalizeAgentProfile, onAgentCreated, openSetupModal, roleModalAgent, runtimeCount, runtimeSessionQuery, selectedAgent, setActiveView, setAeonEnvSyncStatus, setAeonEnvSyncing, setAgentCreateDraft, setAgentCreateMachineKey, setAgentRenameDraft, setAgentRenameEditing, setAgentRoleModalId, setAgentRuntimeAdvancedOpen, setAgentRuntimeFolderBrowsing, setAgentRuntimeFolderEditing, setAgentRuntimeFolderStatus, setAgentSettingsPanel, setAgentWorkerClassView, setAgents, setCustomWorkerDraft, setCustomWorkerImageError, setCustomWorkerSkillSearch, setDiscoveredMachines, setHermesUpdateRequiredDetail, setRuntimeBackgroundPrompt, setRuntimeIntegrationBusy, setRuntimeIntegrationMessage, setRuntimeIntegrationStatus, setRuntimeModelDraft, setRuntimeModelSelectionsByRuntime, setRuntimeModelSetupMode, setRuntimeSessionQuery, setRuntimeSessionResults, setSelectedAgentId } = props;
  function updateAgent(patch: Partial<AgentProfile>) {
    if (!selectedAgent) return;
    updateAgentProfile(selectedAgent.id, patch);
  }

  function updateAgentProfile(agentId: string, patch: Partial<AgentProfile>) {
    setAgents((current) => {
      const existing = current.find((agent) => agent.id === agentId);
      if (existing) {
        return current.map((agent) => (
          agent.id === agentId ? { ...agent, ...patch } : agent
        ));
      }
      const discovered = displayAgents.find((agent) => agent.id === agentId);
      return discovered ? [...current, { ...discovered, ...patch }] : current;
    });
  }

  async function syncAeonEnvToGitHub() {
    if (!selectedAgent || selectedAgent.runtime !== "aeon") return;
    const keys = aeonEnvKeys
      .split(/[\n,]/)
      .map((key) => key.trim())
      .filter(Boolean);
    if (!keys.length) {
      setAeonEnvSyncStatus("Add at least one env key to sync.");
      return;
    }
    if (!selectedAgent.aeonRepo?.trim()) {
      setAeonEnvSyncStatus("Set Aeon Repo before syncing env to GitHub secrets.");
      return;
    }
    setAeonEnvSyncing(true);
    setAeonEnvSyncStatus("");
    const response = await fetch("/api/runtimes/aeon/env/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: selectedAgent, keys }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as RuntimeEnvSyncResponse | null;
    setAeonEnvSyncing(false);
    if (!response?.ok || !data?.ok) {
      setAeonEnvSyncStatus(data?.error ?? "Could not sync Aeon env to GitHub secrets.");
      return;
    }
    const synced = data.result?.synced?.length ?? 0;
    const skipped = data.result?.skipped?.length ?? 0;
    setAeonEnvSyncStatus(`Synced ${synced} secret${synced === 1 ? "" : "s"} to ${data.result?.repo ?? selectedAgent.aeonRepo}${skipped ? `, skipped ${skipped}` : ""}.`);
  }

  // Phones have no collector: their agents are stored on the hub and run
  // on-device through the /api/phone job queue, keyed by the tailnet name.
  function mobileMachineTailnetName(machine: MachineGroup) {
    return (machine.dnsName?.split(".")[0] || machine.key || machine.name).trim();
  }

  function prefillMobileAgentModel(machine: MachineGroup) {
    void fetch("/api/agents/mobile", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { ok?: boolean; hosts?: Record<string, MobileAgentHostRecord> } | null) => {
        const hosts = data?.hosts ?? {};
        const machineKeys = [mobileAgentMachineKey(mobileMachineTailnetName(machine)), mobileAgentMachineKey(machine.name)];
        const host = machineKeys.map((key) => hosts[key]).find((entry) => entry?.models?.length)
          ?? Object.values(hosts).find((entry) => entry.models?.length);
        const hostModel = host?.models?.[0]?.id;
        if (!hostModel) return;
        setAgentCreateDraft((current) => (
          current.model === DEFAULT_MOBILE_AGENT_MODEL ? { ...current, model: hostModel } : current
        ));
      })
      .catch(() => undefined);
  }

  async function openAgentCreationModal(machine: MachineGroup, runtime?: AgentRuntime, name = "") {
    const mobileMachine = isMobileMachineOs(machine.os);
    if (!mobileMachine && (machine.collector !== "ready" || !machine.collectorUrl)) {
      // The self machine is already running this app, so the remote "Connect
      // machine" wizard (git clone + setup on another computer) makes no sense
      // for it. In the Tauri desktop, re-open the native first-run setup wizard
      // instead — it has the real per-OS install path (incl. Windows setup.ps1)
      // and is the same flow the "Re-run Setup..." desktop menu emits, so the
      // persistently-mounted NativeFirstRunOnboarding is listening. Off-desktop
      // (dev/browser) the native event has no listener, so fall back to the
      // setup modal (now Windows/self-aware).
      if (machine.self && isTauriDesktopRuntime()) {
        // The Fleet's collector status comes from an HTTP probe of the local
        // bridge (server-side, in the bundled dashboard server). On Windows
        // that can read "not ready" while the bridge is actually running —
        // stale (probed before the bridge came up), or because the HTTP probe
        // path differs from a raw TCP connect. Before bouncing back to setup,
        // consult the SAME native local-bridge check onboarding uses to decide
        // setup finished (a direct TCP connect to the collector port via
        // native_setup_status). If the bridge is up, the Fleet status is just
        // stale: fall through to the real add-agent flow. Only re-open setup
        // when the bridge is genuinely down.
        const bridgeUp = machine.collectorUrl
          ? await readNativeSetupStatus()
              .then((status) =>
                Boolean(
                  status?.checks?.find((check) => check.id === "collector")
                    ?.installed,
                ),
              )
              .catch(() => false)
          : false;
        if (!bridgeUp) {
          void import("@tauri-apps/api/event")
            .then(({ emit }) => emit(NATIVE_SETUP_RERUN_EVENT))
            .catch(() => openSetupModal(machine));
          return;
        }
        // Bridge is up — fall through and open the real add-agent modal.
      } else {
        openSetupModal(machine);
        return;
      }
    }
    // Adding an agent (not editing): prefer the runtime the user reached for
    // most recently, falling back to the selected agent's runtime, then Hermes.
    const selectedRuntime = mobileMachine ? HIVEMIND_OS_RUNTIME : runtime ?? mruRuntime() ?? selectedAgent?.runtime ?? "hermes";
    setAgentRoleModalId("");
    setAgentRenameEditing(false);
    setAgentRuntimeFolderEditing(false);
    setAgentRuntimeFolderStatus("");
    setAgentRuntimeAdvancedOpen(false);
    setRuntimeIntegrationStatus(null);
    setRuntimeIntegrationBusy("");
    setRuntimeIntegrationMessage("");
    setRuntimeSessionQuery("");
    setRuntimeSessionResults([]);
    setRuntimeBackgroundPrompt("");
    setRuntimeModelSetupMode(null);
    setRuntimeModelDraft({ provider: "", model: "", contextLength: "" });
    setAgentWorkerClassView("presets");
    setCustomWorkerDraft(defaultWorkerClassDraft());
    setCustomWorkerSkillSearch("");
    setCustomWorkerImageError("");
    setAgentSettingsPanel("role");
    setAgentCreateMachineKey(machine.key);
    const baseAgent = createAgentProfile(selectedRuntime, runtimeCount(agents, selectedRuntime) + 1);
    const runtimeSettings = runtimeSettingsFeature(selectedRuntime);
    const runtimeProfile = runtimeProfileFeature(selectedRuntime);
    const autopilotDefaults = runtimeProfile.aeonDefaults;
    const defaultProvider = mobileMachine ? "on-device" : runtimeSettings.defaultProvider || "";
    const defaultName = name || defaultAgentNameForRuntime(displayAgents.length ? displayAgents : agents, selectedRuntime, RUNTIME_LABELS, { provider: defaultProvider });
    const defaultWorkerClass = baseAgent.workerClass ?? "general";
    const defaultWorkerPreset = beeWorkerPreset(defaultWorkerClass);
    setAgentCreateDraft({
      name: defaultName,
      runtime: selectedRuntime,
      provider: defaultProvider,
      model: mobileMachine ? DEFAULT_MOBILE_AGENT_MODEL : runtimeSettings.defaultModel || "",
      hivemindosModels: undefined,
      calls: baseAgent.calls,
      workerClass: defaultWorkerClass,
      customWorkerClass: undefined,
      customWorkerClasses: [],
      selectedCustomWorkerClassId: undefined,
      soulPrompt: renderBeeSoulTemplate(defaultWorkerPreset.soulTemplate, defaultName),
      skillProfilePrompt: defaultWorkerPreset.taskProfile,
      preferredSkillSlugs: defaultWorkerPreset.skillSlugs,
      researchMethod: defaultWorkerClass === "research" ? DEFAULT_RESEARCH_METHOD : undefined,
      useSharedVault: true,
      aeonLocalPath: autopilotDefaults ? baseAgent.aeonLocalPath || autopilotDefaults.localPathFallback : undefined,
      aeonRepo: autopilotDefaults ? baseAgent.aeonRepo || "" : undefined,
      aeonBranch: autopilotDefaults ? baseAgent.aeonBranch || autopilotDefaults.branch : undefined,
      aeonMode: autopilotDefaults ? baseAgent.aeonMode || autopilotDefaults.mode : undefined,
      a2aUrl: autopilotDefaults ? baseAgent.a2aUrl || autopilotDefaults.a2aUrlFallback : undefined,
    });
    if (mobileMachine) prefillMobileAgentModel(machine);
  }

  function closeAgentSettingsModal() {
    setAgentRoleModalId("");
    setAgentCreateMachineKey("");
    setAgentSettingsPanel("role");
    setAgentRenameDraft("");
    setAgentRenameEditing(false);
    setAgentRuntimeFolderEditing(false);
    setAgentRuntimeFolderBrowsing(false);
    setAgentRuntimeFolderStatus("");
    setAgentRuntimeAdvancedOpen(false);
    setRuntimeModelSetupMode(null);
    setRuntimeModelDraft({ provider: "", model: "", contextLength: "" });
    setAgentWorkerClassView("presets");
    setCustomWorkerDraft(defaultWorkerClassDraft());
    setCustomWorkerSkillSearch("");
    setCustomWorkerImageError("");
  }

  async function browseAgentRuntimeFolder() {
    if (!roleModalAgent) return;
    setAgentRuntimeFolderBrowsing(true);
    setAgentRuntimeFolderStatus("");
    try {
      const nativeResult = await openNativeDirectory({
        currentPath: roleModalAgent.localDataDir,
        prompt: "Choose this agent's runtime folder:",
      });
      if (nativeResult?.path) {
        updateAgentProfile(roleModalAgent.id, runtimeLocalDataDirPatch(roleModalAgent.runtime, nativeResult.path));
        setAgentRuntimeFolderEditing(false);
        return;
      }
      if (nativeResult?.cancelled) return;
      const response = await fetch("/api/agents/browse-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPath: roleModalAgent.localDataDir }),
      });
      const data = await response.json().catch(() => null) as { path?: string; cancelled?: boolean; error?: string } | null;
      if (data?.path) {
        updateAgentProfile(roleModalAgent.id, runtimeLocalDataDirPatch(roleModalAgent.runtime, data.path));
        setAgentRuntimeFolderEditing(false);
      } else if (!data?.cancelled) {
        setAgentRuntimeFolderEditing(true);
        setAgentRuntimeFolderStatus(data?.error ?? "Choose a folder manually.");
      }
    } catch {
      setAgentRuntimeFolderEditing(true);
      setAgentRuntimeFolderStatus("Choose a folder manually.");
    } finally {
      setAgentRuntimeFolderBrowsing(false);
    }
  }

  async function refreshRuntimeIntegrations(agent = roleModalAgent) {
    if (!agent) return;
    const targetKey = runtimeIntegrationTargetKey(agent);
    setRuntimeIntegrationBusy("status");
    setRuntimeIntegrationMessage("");
    const response = await fetch(`/api/runtimes/${agent.runtime}/integrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; status?: RuntimeIntegrationStatus; error?: string } | null;
    if (!response?.ok || !data?.ok || !data.status) {
      setRuntimeIntegrationBusy("");
      setRuntimeIntegrationMessage(data?.error ?? "Could not read runtime integrations.");
      return;
    }
    const status = { ...data.status, targetKey };
    setRuntimeIntegrationStatus(status);
    if (data.status.modelSelection) {
      setRuntimeModelSelectionsByRuntime((current) => ({
        ...current,
        [data.status!.runtime]: data.status!.runtime === HIVEMIND_OS_RUNTIME
          ? mergeRuntimeModelSelections(current[data.status!.runtime], data.status!.modelSelection!)
          : data.status!.modelSelection,
      }));
    }
    setRuntimeIntegrationBusy("");
    const usePodStatus = data.status.providerStatus?.usePod;
    if (agent.id && agent.provider === "usepod" && usePodStatus) {
      updateAgentProfile(agent.id, {
        usePod: {
          ...(agent.usePod ?? {}),
          depositAddress: usePodStatus.depositAddress || agent.usePod?.depositAddress || "",
          depositCode: usePodStatus.depositCode || agent.usePod?.depositCode || "",
          dashboardUrl: usePodStatus.dashboardUrl || agent.usePod?.dashboardUrl || "",
          lastBalanceRemaining: usePodStatus.balanceRemaining || agent.usePod?.lastBalanceRemaining || "",
          lastRoute: usePodStatus.route || agent.usePod?.lastRoute || "",
          lastCheckedAt: usePodStatus.checkedAt || agent.usePod?.lastCheckedAt || "",
          lastTestStatus: usePodStatus.status || agent.usePod?.lastTestStatus || "",
          lastStatusMessage: usePodStatus.message ?? "",
          lastHttpStatus: usePodStatus.httpStatus ?? agent.usePod?.lastHttpStatus,
          lastModelCount: usePodStatus.modelCount ?? agent.usePod?.lastModelCount,
          lastTokenPresent: usePodStatus.tokenPresent ?? agent.usePod?.lastTokenPresent,
          lastTokenSource: usePodStatus.tokenSource || agent.usePod?.lastTokenSource || "",
        },
      });
    }
    const veniceStatus = data.status.providerStatus?.venice;
    if (agent.id && agent.provider === "venice" && veniceStatus) {
      updateAgentProfile(agent.id, {
        venice: {
          ...(agent.venice ?? {}),
          walletVaultId: veniceStatus.walletVaultId || agent.venice?.walletVaultId || "",
          walletAddress: veniceStatus.walletAddress || agent.venice?.walletAddress || "",
          walletNetwork: veniceStatus.walletNetwork || agent.venice?.walletNetwork || "",
          apiKeyEnvName: veniceStatus.apiKeyEnvName || agent.venice?.apiKeyEnvName || "",
          lastBalanceUsd: veniceStatus.balanceUsd || agent.venice?.lastBalanceUsd || "",
          lastDiemBalanceUsd: veniceStatus.diemBalanceUsd || agent.venice?.lastDiemBalanceUsd || "",
          lastMinimumTopUpUsd: veniceStatus.minimumTopUpUsd || agent.venice?.lastMinimumTopUpUsd || "",
          lastSuggestedTopUpUsd: veniceStatus.suggestedTopUpUsd || agent.venice?.lastSuggestedTopUpUsd || "",
          lastCheckedAt: veniceStatus.checkedAt || agent.venice?.lastCheckedAt || "",
          lastTestStatus: veniceStatus.status || agent.venice?.lastTestStatus || "",
          lastStatusMessage: veniceStatus.message ?? "",
          lastHttpStatus: veniceStatus.httpStatus ?? agent.venice?.lastHttpStatus,
          lastModelCount: veniceStatus.modelCount ?? agent.venice?.lastModelCount,
          lastKeyPresent: veniceStatus.keyPresent ?? agent.venice?.lastKeyPresent,
        },
      });
    }
    if (runtimeIntegrationFeature(data.status.runtime).updateRequirementDetail === "hermes") {
      setHermesUpdateRequiredDetail(hermesUpdateDetail(data.status));
    }
  }

  async function runRuntimeIntegrationAction(action: string, input: Record<string, unknown> = {}, agentOverride?: AgentProfile) {
    const targetAgent = agentOverride ?? roleModalAgent;
    if (!targetAgent) return { ok: false, error: "Agent profile is required." };
    setRuntimeIntegrationBusy(action);
    setRuntimeIntegrationMessage("");
    const response = await fetch(`/api/runtimes/${targetAgent.runtime}/integrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: targetAgent, action, input }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; message?: string; error?: string; logPath?: string; output?: string } | null;
    setRuntimeIntegrationBusy("");
    if (!response?.ok || !data?.ok) {
      setRuntimeIntegrationMessage(data?.error ?? "Runtime action failed.");
      return { ok: false, error: data?.error ?? "Runtime action failed." };
    }
    setRuntimeIntegrationMessage(data.message ?? data.output ?? "Runtime action completed.");
    await refreshRuntimeIntegrations(targetAgent);
    return data;
  }

  async function searchRuntimeSessionsForAgent() {
    if (!roleModalAgent) return;
    setRuntimeIntegrationBusy("session-search");
    setRuntimeIntegrationMessage("");
    const params = new URLSearchParams({ q: runtimeSessionQuery, limit: "12" });
    const response = await fetch(`/api/runtimes/${roleModalAgent.runtime}/sessions/search?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; sessions?: RuntimeSessionSearchResult[]; error?: string } | null;
    setRuntimeIntegrationBusy("");
    if (!response?.ok || !data?.ok) {
      setRuntimeIntegrationMessage(data?.error ?? "Session search failed.");
      return;
    }
    setRuntimeSessionResults(data.sessions ?? []);
  }

  async function createMobileAgentFromModal(machine: MachineGroup) {
    const draftName = agentCreateDraft.name.trim()
      || defaultAgentNameForRuntime(displayAgents.length ? displayAgents : agents, HIVEMIND_OS_RUNTIME, RUNTIME_LABELS, { provider: "on-device" });
    setRuntimeIntegrationBusy("create-agent");
    setRuntimeIntegrationMessage("");
    const response = await fetch("/api/agents/mobile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machineName: mobileMachineTailnetName(machine),
        name: draftName,
        model: agentCreateDraft.model?.trim() || DEFAULT_MOBILE_AGENT_MODEL,
        systemPrompt: [
          agentCreateDraft.soulPrompt?.trim(),
          agentCreateDraft.skillProfilePrompt?.trim()
            ? `Suited for: ${agentCreateDraft.skillProfilePrompt.trim()}`
            : "",
        ].filter(Boolean).join("\n\n") || undefined,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; agent?: MobileAgentRecord; error?: string } | null;
    setRuntimeIntegrationBusy("");
    if (!response?.ok || !data?.ok || !data.agent) {
      setRuntimeIntegrationMessage(data?.error ?? "Could not create the phone-hosted agent on that machine.");
      return;
    }
    const next = normalizeAgentProfile({
      ...mobileAgentProfileFromRecord(data.agent, {
        machineName: machine.name,
        // Phones expose no collector URL; the machine key (the raw fleet device
        // name) is what the dashboard groups agents onto machines with.
        telemetryUrl: machine.collectorUrl || machine.key,
      }),
      soulPrompt: agentCreateDraft.soulPrompt,
      skillProfilePrompt: agentCreateDraft.skillProfilePrompt,
      preferredSkillSlugs: agentCreateDraft.preferredSkillSlugs,
      researchMethod: agentCreateDraft.researchMethod,
    });
    setAgents((current) => [...current.filter((agent) => agent.id !== next.id), next]);
    setDiscoveredMachines((current) => current.map((discovered) => (
      discovered.device.name === machine.key || discovered.device.name === machine.name
        ? {
          ...discovered,
          agents: [...discovered.agents.filter((agent) => agent.id !== next.id), next],
          lastSeenAt: Date.now(),
        }
        : discovered
    )));
    setSelectedAgentId(next.id);
    closeAgentSettingsModal();
    void onAgentCreated?.(next);
  }

  async function createAgentFromModal() {
    if (agentCreateMachine && isMobileMachineOs(agentCreateMachine.os)) {
      await createMobileAgentFromModal(agentCreateMachine);
      return;
    }
    if (!agentCreateMachine?.collectorUrl) return;
    const runtime = agentCreateDraft.runtime;
    const runtimeSettings = runtimeSettingsFeature(runtime);
    const runtimeProfile = runtimeProfileFeature(runtime);
    const autopilotDefaults = runtimeProfile.aeonDefaults;
    const autopilotRuntime = runtimeSettings.kind === "autopilot";
    const baseAgent = createAgentProfile(runtime, runtimeCount(agents, runtime) + 1);
    const autopilotLocalPath = autopilotDefaults ? agentCreateDraft.aeonLocalPath || autopilotDefaults.localPathFallback : "";
    const autopilotGatewayUrl = autopilotDefaults ? agentCreateDraft.a2aUrl || baseAgent.a2aUrl || autopilotDefaults.a2aUrlFallback : baseAgent.gatewayUrl;
    const draft: AgentProfile = {
      ...baseAgent,
      name: agentCreateDraft.name.trim() || defaultAgentNameForRuntime(displayAgents.length ? displayAgents : agents, runtime, RUNTIME_LABELS, { provider: agentCreateDraft.provider }),
      telemetryUrl: agentCreateMachine.collectorUrl,
      machineName: agentCreateMachine.name,
      agentId: runtimeSettings.defaultAgentId || "",
      provider: agentCreateDraft.provider,
      model: agentCreateDraft.model,
      adaptiveOpenRouter: agentCreateDraft.adaptiveOpenRouter,
      adaptiveRouting: agentCreateDraft.adaptiveRouting,
      usePod: agentCreateDraft.usePod,
      venice: agentCreateDraft.venice,
      hivemindosModels: agentCreateDraft.hivemindosModels,
      calls: agentCreateDraft.calls,
      localDataDir: autopilotRuntime ? autopilotLocalPath : baseAgent.localDataDir || "",
      aeonLocalPath: autopilotRuntime ? autopilotLocalPath : undefined,
      aeonRepo: autopilotRuntime ? agentCreateDraft.aeonRepo || baseAgent.aeonRepo || "" : undefined,
      aeonBranch: autopilotRuntime ? agentCreateDraft.aeonBranch || autopilotDefaults?.branch : undefined,
      aeonMode: autopilotRuntime ? agentCreateDraft.aeonMode || autopilotDefaults?.mode : undefined,
      a2aUrl: autopilotRuntime ? autopilotGatewayUrl : undefined,
      gatewayUrl: autopilotRuntime ? autopilotGatewayUrl : baseAgent.gatewayUrl,
      beeRole: "worker",
      workerClass: agentCreateDraft.workerClass,
      customWorkerClass: agentCreateDraft.customWorkerClass,
      customWorkerClasses: agentCreateDraft.customWorkerClasses,
      selectedCustomWorkerClassId: agentCreateDraft.selectedCustomWorkerClassId,
      soulPrompt: agentCreateDraft.soulPrompt,
      skillProfilePrompt: agentCreateDraft.skillProfilePrompt,
      preferredSkillSlugs: agentCreateDraft.preferredSkillSlugs,
      taskPreferences: agentCreateDraft.taskPreferences,
      researchMethod: agentCreateDraft.researchMethod,
      useSharedVault: agentCreateDraft.useSharedVault,
    };
    setRuntimeIntegrationBusy("create-agent");
    setRuntimeIntegrationMessage("");
    const response = await fetch("/api/agents/runtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collectorUrl: agentCreateMachine.collectorUrl,
        agent: draft,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; agent?: AgentProfile; error?: string } | null;
    setRuntimeIntegrationBusy("");
    if (!response?.ok || !data?.ok || !data.agent) {
      setRuntimeIntegrationMessage(data?.error ?? "Could not create the runtime-backed agent on that machine.");
      return;
    }
    const next = normalizeAgentProfile({
      ...draft,
      ...data.agent,
      telemetryUrl: data.agent.telemetryUrl || agentCreateMachine.collectorUrl,
      machineName: data.agent.machineName || agentCreateMachine.name,
      collectorCapabilities: data.agent.collectorCapabilities ?? agentCreateMachine.capabilities,
    });
    setAgents((current) => [...current.filter((agent) => agent.id !== next.id), next]);
    setDiscoveredMachines((current) => current.map((machine) => (
      collectorKey(machine.device.collectorUrl) === collectorKey(agentCreateMachine.collectorUrl)
        ? {
          ...machine,
          agents: [...machine.agents.filter((agent) => agent.id !== next.id), next],
          lastSeenAt: Date.now(),
        }
        : machine
    )));
    setSelectedAgentId(next.id);
    rememberMruRuntime(runtime);
    closeAgentSettingsModal();
    void onAgentCreated?.(next);
    const postCreateAction = runtimePostCreateAction(runtime);
    if (postCreateAction) {
      if (postCreateAction.dashboardStateAgentIdKey) {
        void saveDashboardStateValue(postCreateAction.dashboardStateAgentIdKey, next.id);
      }
      setActiveView(postCreateAction.view as DashboardView);
    }
  }


  return { updateAgent, updateAgentProfile, syncAeonEnvToGitHub, openAgentCreationModal, closeAgentSettingsModal, browseAgentRuntimeFolder, refreshRuntimeIntegrations, runRuntimeIntegrationAction, searchRuntimeSessionsForAgent, createAgentFromModal };
}
