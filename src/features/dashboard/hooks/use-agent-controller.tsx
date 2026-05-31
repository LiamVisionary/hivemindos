"use client";

/* eslint-disable react-hooks/immutability, react-hooks/purity */

import type { Dispatch, SetStateAction } from "react";
import type { BeeWorkerPreset } from "@/lib/config/bee-worker-presets";
import type { AgentProfile, AgentRuntime } from "@/lib/types/agent-runtime";
import type { AgentCreateDraft, AgentSettingsPanel, AgentWorkerClassView, RuntimeModelDraft, RuntimeModelSetupMode } from "@/features/dashboard/agent-settings-types";
import type { DashboardView, DiscoveredMachine, MachineGroup, RuntimeEnvSyncResponse, RuntimeIntegrationStatus, RuntimeModelSelection, RuntimeSessionSearchResult, WorkerClassDraft } from "@/features/dashboard/dashboard-types";

type UseAgentControllerProps = {
  RUNTIME_LABELS: Record<string, string>;
  aeonEnvKeys: string;
  agentCreateDraft: AgentCreateDraft;
  agentCreateMachine: MachineGroup | null;
  agents: AgentProfile[];
  beeWorkerPreset: (workerClass: "general") => BeeWorkerPreset;
  collectorKey: (collectorUrl: string) => string;
  createAgentProfile: (runtime: AgentRuntime, index: number) => AgentProfile;
  defaultWorkerClassDraft: () => WorkerClassDraft;
  displayAgents: AgentProfile[];
  hermesUpdateDetail: (status: RuntimeIntegrationStatus | null | undefined) => string;
  normalizeAgentProfile: (agent: AgentProfile) => AgentProfile;
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

export function useAgentController(props: UseAgentControllerProps) {
  const { RUNTIME_LABELS, aeonEnvKeys, agentCreateDraft, agentCreateMachine, agents, beeWorkerPreset, collectorKey, createAgentProfile, defaultWorkerClassDraft, displayAgents, hermesUpdateDetail, normalizeAgentProfile, openSetupModal, roleModalAgent, runtimeCount, runtimeSessionQuery, selectedAgent, setActiveView, setAeonEnvSyncStatus, setAeonEnvSyncing, setAgentCreateDraft, setAgentCreateMachineKey, setAgentRenameDraft, setAgentRenameEditing, setAgentRoleModalId, setAgentRuntimeAdvancedOpen, setAgentRuntimeFolderBrowsing, setAgentRuntimeFolderEditing, setAgentRuntimeFolderStatus, setAgentSettingsPanel, setAgentWorkerClassView, setAgents, setCustomWorkerDraft, setCustomWorkerImageError, setCustomWorkerSkillSearch, setDiscoveredMachines, setHermesUpdateRequiredDetail, setRuntimeBackgroundPrompt, setRuntimeIntegrationBusy, setRuntimeIntegrationMessage, setRuntimeIntegrationStatus, setRuntimeModelDraft, setRuntimeModelSelectionsByRuntime, setRuntimeModelSetupMode, setRuntimeSessionQuery, setRuntimeSessionResults, setSelectedAgentId } = props;
  function updateAgent(patch: Partial<AgentProfile>) {
    if (!selectedAgent) return;
    setAgents((current) => current.map((agent) => (
      agent.id === selectedAgent.id ? { ...agent, ...patch } : agent
    )));
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

  function openAgentCreationModal(machine: MachineGroup, runtime: AgentRuntime = "hermes", name = "") {
    if (machine.collector !== "ready" || !machine.collectorUrl) {
      openSetupModal(machine);
      return;
    }
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
    const baseAgent = createAgentProfile(runtime, runtimeCount(agents, runtime) + 1);
    setAgentCreateDraft({
      name,
      runtime,
      provider: runtime === "hermes" ? "openai-codex" : runtime === "openai-compatible" ? "lm-studio" : "",
      model: "",
      calls: baseAgent.calls,
      workerClass: "general",
      customWorkerClass: undefined,
      customWorkerClasses: [],
      selectedCustomWorkerClassId: undefined,
      skillProfilePrompt: beeWorkerPreset("general").taskProfile,
      preferredSkillSlugs: beeWorkerPreset("general").skillSlugs,
      useSharedVault: true,
      aeonLocalPath: runtime === "aeon" ? "~/.aeon" : undefined,
      aeonRepo: runtime === "aeon" ? "" : undefined,
      aeonBranch: runtime === "aeon" ? "main" : undefined,
      aeonMode: runtime === "aeon" ? "github" : undefined,
      a2aUrl: runtime === "aeon" ? "http://127.0.0.1:41241" : undefined,
    });
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
      const response = await fetch("/api/agents/browse-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPath: roleModalAgent.localDataDir }),
      });
      const data = await response.json().catch(() => null) as { path?: string; cancelled?: boolean; error?: string } | null;
      if (data?.path) {
        updateAgentProfile(roleModalAgent.id, roleModalAgent.runtime === "aeon"
          ? { localDataDir: data.path, aeonLocalPath: data.path }
          : { localDataDir: data.path });
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
    setRuntimeIntegrationBusy("");
    if (!response?.ok || !data?.ok || !data.status) {
      setRuntimeIntegrationMessage(data?.error ?? "Could not read runtime integrations.");
      return;
    }
    const status = { ...data.status, targetKey };
    setRuntimeIntegrationStatus(status);
    if (data.status.modelSelection) {
      setRuntimeModelSelectionsByRuntime((current) => ({
        ...current,
        [data.status!.runtime]: data.status!.modelSelection,
      }));
    }
    if (data.status.runtime === "hermes") {
      setHermesUpdateRequiredDetail(hermesUpdateDetail(data.status));
    }
  }

  async function runRuntimeIntegrationAction(action: string, input: Record<string, unknown> = {}, agentOverride?: AgentProfile) {
    const targetAgent = agentOverride ?? roleModalAgent;
    if (!targetAgent) return;
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
      return;
    }
    setRuntimeIntegrationMessage(data.message ?? data.output ?? "Runtime action completed.");
    await refreshRuntimeIntegrations(targetAgent);
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

  async function createAgentFromModal() {
    if (!agentCreateMachine?.collectorUrl) return;
    const runtime = agentCreateDraft.runtime;
    const baseAgent = createAgentProfile(runtime, runtimeCount(agents, runtime) + 1);
    const draft: AgentProfile = {
      ...baseAgent,
      name: agentCreateDraft.name.trim() || `${RUNTIME_LABELS[runtime] ?? runtime} on ${agentCreateMachine.name}`,
      telemetryUrl: agentCreateMachine.collectorUrl,
      machineName: agentCreateMachine.name,
      agentId: runtime === "openclaw" ? "main" : runtime === "aeon" ? "local-aeon" : "",
      provider: agentCreateDraft.provider,
      model: agentCreateDraft.model,
      adaptiveOpenRouter: agentCreateDraft.adaptiveOpenRouter,
      usePod: agentCreateDraft.usePod,
      calls: agentCreateDraft.calls,
      localDataDir: runtime === "aeon" ? agentCreateDraft.aeonLocalPath || "~/.aeon" : "",
      aeonLocalPath: runtime === "aeon" ? agentCreateDraft.aeonLocalPath || "~/.aeon" : undefined,
      aeonRepo: runtime === "aeon" ? agentCreateDraft.aeonRepo || "" : undefined,
      aeonBranch: runtime === "aeon" ? agentCreateDraft.aeonBranch || "main" : undefined,
      aeonMode: runtime === "aeon" ? agentCreateDraft.aeonMode || "github" : undefined,
      a2aUrl: runtime === "aeon" ? agentCreateDraft.a2aUrl || "http://127.0.0.1:41241" : undefined,
      gatewayUrl: runtime === "aeon" ? agentCreateDraft.a2aUrl || "http://127.0.0.1:41241" : baseAgent.gatewayUrl,
      beeRole: "worker",
      workerClass: agentCreateDraft.workerClass,
      customWorkerClass: agentCreateDraft.customWorkerClass,
      customWorkerClasses: agentCreateDraft.customWorkerClasses,
      selectedCustomWorkerClassId: agentCreateDraft.selectedCustomWorkerClassId,
      skillProfilePrompt: agentCreateDraft.skillProfilePrompt,
      preferredSkillSlugs: agentCreateDraft.preferredSkillSlugs,
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
    closeAgentSettingsModal();
    if (runtime === "aeon") {
      window.sessionStorage.setItem("hivemindos.aeon.openDetailAgentId", next.id);
      setActiveView("aeon");
    }
  }


  return { updateAgent, updateAgentProfile, syncAeonEnvToGitHub, openAgentCreationModal, closeAgentSettingsModal, browseAgentRuntimeFolder, refreshRuntimeIntegrations, runRuntimeIntegrationAction, searchRuntimeSessionsForAgent, createAgentFromModal };
}
