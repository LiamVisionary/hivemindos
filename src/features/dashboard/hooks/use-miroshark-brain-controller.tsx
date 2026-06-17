// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

/* eslint-disable react-hooks/immutability, react-hooks/purity */

import { useCallback, useEffect, useMemo } from "react";
import { getNativeBrainGraph } from "@/lib/native/brain-graph";
import { getNativeBrainSkillInventory } from "@/lib/native/brain-skills";
import { listNativeLocalDirectories, openNativeDirectory } from "@/lib/native/filesystem";
import { parseRuntimeSsePayload, responseErrorMessage, runtimeErrorMessage } from "./runtime-stream-errors";

function isLoopbackDirectoryCollector(collectorUrl?: string) {
  const trimmed = collectorUrl?.trim();
  if (!trimmed) return false;
  try {
    const hostname = new URL(trimmed).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function directoryCollectorUrl(collectorUrl?: string) {
  const trimmed = collectorUrl?.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const peerPrefix = "/peer/";
    if (isLoopbackDirectoryCollector(trimmed) && parsed.pathname.startsWith(peerPrefix)) {
      const peer = decodeURIComponent(parsed.pathname.slice(peerPrefix.length)).replace(/\/+$/, "");
      return peer ? `http://${peer}` : trimmed;
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function directoryMachineTarget(machine: KanbanMachineTarget) {
  const collectorUrl = directoryCollectorUrl(machine.collectorUrl);
  return collectorUrl === machine.collectorUrl ? machine : { ...machine, collectorUrl };
}

function normalizeBrainSkillInventory(data: any) {
  const providers = Array.isArray(data?.providers) ? data.providers : [];
  const shared = Array.isArray(data?.shared) ? data.shared : [];
  const providerSkills = providers.reduce((total, provider) => total + (Array.isArray(provider?.skills) ? provider.skills.length : 0), 0);
  const importable = providers.reduce((total, provider) => (
    total + (Array.isArray(provider?.skills) ? provider.skills.filter((skill) => !skill?.imported).length : 0)
  ), 0);
  return {
    ...data,
    providers,
    shared,
    totals: {
      ...(data?.totals ?? {}),
      shared: Number.isFinite(data?.totals?.shared) ? data.totals.shared : shared.length,
      providerSkills: Number.isFinite(data?.totals?.providerSkills) ? data.totals.providerSkills : providerSkills,
      importable: Number.isFinite(data?.totals?.importable) ? data.totals.importable : importable,
    },
  };
}

export function useMirosharkBrainController(props: any) {
  const { BRAIN_GRAPH_CLIENT_CACHE_MS, MIROSHARK_TEMPLATE_INPUTS, SWARM_LAUNCH_PRESETS, activeView, agents, appVersion, asRecord, brainGraph, brainGraphLoadedAtRef, brainGraphVaultPathRef, brainSkills, compactValue, composeMirosharkTemplateScenario, createDefaultAgentWallet, defaultMirosharkTemplateInputs, formatRelativeTime, getMiroSharkPosts, getMiroSharkRunStatus, getMiroSharkTemplates, hermesUpdateDetail, hermesUpdateRequiredDetail, honeyLedgerEnabled, isEmptyIntegrationPayload, isLoopbackCollector, isMiroSharkRunTerminal, isUnpublishedSimulationPayload, mirosharkAnalysisAgentId, mirosharkArchiveRuns, mirosharkExperimentEvent, mirosharkHandle, mirosharkMetadata, mirosharkPlatform, mirosharkRounds, mirosharkRun, mirosharkRunPending, mirosharkScenario, mirosharkSelectedTemplateId, mirosharkStat, mirosharkStatus, mirosharkTemplateInputs, mirosharkUserName, mirosharkWorkspaceMode, notificationCountRef, notificationCursorRef, numericRecordValue, payloadArray, payloadCount, payloadData, payloadPreview, selectedAgentId, selectedMirosharkRunId, setBrainGraph, setBrainGraphLoading, setBrainGraphStatus, setBrainSkillAeonSyncing, setBrainSkillImportProvider, setBrainSkillImportSuccess, setBrainSkills, setBrainSkillsLoading, setBrainSkillsStatus, setHermesUpdateRequiredDetail, setMachineDirectoryBrowser, setMirosharkActionPending, setMirosharkAnalysisPending, setMirosharkAnalysisResult, setMirosharkAnalysisStatus, setMirosharkArchiveLoading, setMirosharkArchiveRuns, setMirosharkArchiveStatus, setMirosharkExperimentPending, setMirosharkExperimentStatus, setMirosharkHelperPending, setMirosharkHelperStatus, setMirosharkMetadata, setMirosharkPlatform, setMirosharkRounds, setMirosharkRun, setMirosharkRunPending, setMirosharkScenario, setMirosharkSelectedTemplateId, setMirosharkStatus, setMirosharkTemplateInputs, setMirosharkWorkbenchTab, setMirosharkWorkspaceMode, setNotificationCursor, setNotificationSummary, setNotifications, setNotificationsLoading, setNotificationsStatus, setRecentDirectories, setSelectedBrainNodeId, setSelectedMirosharkRunId, setSkillBrowserGithubInstalling, setSkillBrowserGithubOpen, setSkillBrowserGithubUrl, setSkillBrowserImporting, setSkillBrowserLoading, setSkillBrowserOpen, setSkillBrowserSearch, setSkillBrowserSkills, setSkillBrowserStatus, setSkillBrowserView, setSkillBrowserWriting, setSkillBrowserWrittenContent, sharedVault, skillBrowserGithubUrl, skillBrowserWrittenContent, skillRequiresHermesUpdate, swarmEventItem, swarmMarketEventItem, swarmMarketFromItems, swarmMarketPriceEventItem, swarmRunState, swarmTemplateIdFromMirosharkTemplate, swarmTemplateIdFromSurface, walletsByAgent } = props;
  const refreshMirosharkMetadata = useCallback(async () => {
    const response = await fetch("/api/miroshark/swarm?metadata=1", { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as MiroSharkMetadata | null;
    if (data) setMirosharkMetadata(data);
  }, []);

  useEffect(() => {
    if (activeView !== "swarm" || !mirosharkStatus?.ok) return;
    let inFlight = false;
    const refreshOnce = () => {
      if (inFlight) return;
      inFlight = true;
      void refreshMirosharkMetadata().finally(() => {
        inFlight = false;
      });
    };
    const kickoff = window.setTimeout(() => {
      refreshOnce();
    }, 0);
    const timer = window.setInterval(() => {
      refreshOnce();
    }, 20_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [activeView, mirosharkStatus?.ok, refreshMirosharkMetadata]);

  async function runMirosharkAction(action: "install" | "start" | "open" | "configure-admin") {
    if (action === "open") {
      window.open(mirosharkStatus?.apiDocsUrl ?? mirosharkStatus?.baseUrl ?? "http://127.0.0.1:5101/api/docs", "_blank", "noopener,noreferrer");
      return;
    }
    setMirosharkActionPending(action);
    const response = await fetch("/api/miroshark/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as MiroSharkStatus | null;
    if (data?.baseUrl) setMirosharkStatus(data);
    setMirosharkActionPending("");
  }

  function startNewMirosharkSimulation(templateId?: TemplateId) {
    setMirosharkWorkspaceMode("new");
    setMirosharkRun(null);
    setMirosharkRunPending(false);
    setSelectedMirosharkRunId("");
    setMirosharkArchiveStatus("");
    setMirosharkWorkbenchTab("surface");
    const template = allMirosharkTemplates.find((item) => item.id === templateId) ?? allMirosharkTemplates[0];
    if (template) applyMirosharkTemplate(template);
  }

  function applyMirosharkTemplate(template: MiroSharkTemplate) {
    if (!template.id) return;
    setMirosharkWorkspaceMode("new");
    setMirosharkRun(null);
    setMirosharkRunPending(false);
    setSelectedMirosharkRunId("");
    setMirosharkSelectedTemplateId(template.id);
    const nextInputs = defaultMirosharkTemplateInputs(template.id);
    setMirosharkTemplateInputs(nextInputs);
    const platform = template.platforms && template.platforms.length > 1
      ? "parallel"
      : template.platforms?.includes("polymarket")
        ? "polymarket"
        : template.platforms?.includes("reddit")
          ? "reddit"
          : "twitter";
    setMirosharkPlatform(platform);
    if (template.estimated_rounds) setMirosharkRounds(Math.min(24, Math.max(1, template.estimated_rounds)));
    setMirosharkScenario(composeMirosharkTemplateScenario(template, nextInputs));
  }

  function updateMirosharkTemplateInput(template: MiroSharkTemplate, key: string, value: string) {
    setMirosharkTemplateInputs((current) => {
      const nextInputs = { ...current, [key]: value };
      setMirosharkScenario(composeMirosharkTemplateScenario(template, nextInputs));
      return nextInputs;
    });
  }

  function extractMirosharkHelperText(payload: unknown) {
    const data = payloadData((payload as { payload?: unknown } | null)?.payload ?? payload);
    if (typeof data === "string") return data;
    const record = asRecord(data);
    const direct = record.briefing ?? record.scenario ?? record.text ?? record.answer ?? record.content ?? record.summary;
    if (typeof direct === "string") return direct;
    const suggestions = payloadArray(data);
    const first = suggestions[0];
    if (typeof first === "string") return first;
    const firstRecord = asRecord(first);
    const suggestion = firstRecord.scenario ?? firstRecord.text ?? firstRecord.title ?? firstRecord.summary;
    return typeof suggestion === "string" ? suggestion : "";
  }

  async function runMirosharkScenarioHelper(action: "ask" | "suggest") {
    const draft = mirosharkScenario.trim();
    if (!draft) return;
    setMirosharkHelperPending(action);
    setMirosharkHelperStatus("");
    const response = await fetch("/api/miroshark/swarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "ask"
        ? { action, question: draft }
        : { action, textPreview: draft, question: mirosharkSelectedTemplate?.name }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string; payload?: unknown } | null;
    setMirosharkHelperPending("");
    if (!data?.ok) {
      setMirosharkHelperStatus(data?.error ?? "MiroShark helper failed.");
      return;
    }
    const helperText = extractMirosharkHelperText(data);
    if (helperText) {
      setMirosharkScenario(helperText);
      setMirosharkHelperStatus(action === "ask" ? "Seed brief loaded from MiroShark." : "Suggested scenario loaded from MiroShark.");
    } else {
      setMirosharkHelperStatus("MiroShark returned no helper text.");
    }
  }

  async function launchMirosharkSwarm() {
    setMirosharkRunPending(true);
    setMirosharkWorkspaceMode("run");
    setMirosharkRun(null);
    setSelectedMirosharkRunId("");
    setMirosharkArchiveStatus("");
    const response = await fetch("/api/miroshark/swarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario: mirosharkScenario,
        rounds: mirosharkRounds,
        platform: mirosharkPlatform,
        templateId: mirosharkSelectedTemplate?.id,
        projectName: mirosharkSelectedTemplate?.name ? `${mirosharkSelectedTemplate.name} · HivemindOS` : undefined,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as MiroSharkRunResult | null;
    setMirosharkRun(data ?? { ok: false, error: "MiroShark run request failed" });
    if (!data?.jobId) setMirosharkRunPending(false);
  }

  async function runMirosharkSwarm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await launchMirosharkSwarm();
  }

  async function runMirosharkExperiment(action: "stop" | "inject" | "fork" | "branch" | "publish", selectedSimulationId?: string) {
    const simulationId = selectedSimulationId ?? mirosharkRun?.simulationId;
    if (!simulationId) {
      setMirosharkExperimentStatus("No simulation selected to publish.");
      return;
    }
    setMirosharkExperimentPending(action);
    setMirosharkExperimentStatus("");
    const response = await fetch("/api/miroshark/swarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        simulationId,
        event: mirosharkExperimentEvent,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string; payload?: unknown } | null;
    setMirosharkExperimentPending("");
    if (!data?.ok) {
      setMirosharkExperimentStatus(data?.error ?? "Experiment request failed");
      return;
    }
    setMirosharkExperimentStatus(`${action} sent to MiroShark`);
    if (action === "stop" || action === "inject" || action === "publish") void refreshMirosharkRun();
  }

  async function analyzeMirosharkRun(run: SwarmRun, mode: MiroSharkAnalysisMode) {
    const fallbackSelectedAgent = agents.find((item) => item.id === selectedAgentId) ?? agents[0];
    const agent = agents.find((item) => item.id === (mirosharkAnalysisAgentId || fallbackSelectedAgent?.id)) ?? agents[0];
    setMirosharkAnalysisPending(mode);
    setMirosharkAnalysisStatus(agent ? `Asking ${agent.name} for a ${mode.replace(/-/g, " ")} verdict...` : "");
    setMirosharkAnalysisResult(null);
    let agentVerdict = "";
    if (agent) {
      try {
        const analysisPrompt = [
          `You are ${agent.name}. Analyze this MiroShark simulation result for the "${mode.replace(/-/g, " ")}" view.`,
          "Give a decision-useful verdict. Be specific about what the user should trust, what is weak, what to inspect next, and whether the simulation is ready to publish.",
          "Keep the answer structured and concise: Verdict, Strongest signals, Weak spots, Recommended next action.",
          "Simulation data:",
          JSON.stringify({ run, market: swarmMarket, rawRun: mirosharkRun }, null, 2).slice(0, 24_000),
        ].join("\n\n");
        const agentResponse = await fetch("/api/chat/agent-runtime", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Hivemind-Run-Type": "miroshark-analysis",
          },
          body: JSON.stringify({
            agent,
            sharedVault,
            workingDirectory: appVersion?.appDir ?? agent.localDataDir ?? "",
            wallet: walletsByAgent[agent.id] ?? createDefaultAgentWallet(agent.id),
            honeyLedgerEnabled,
            messages: [{ role: "user", content: analysisPrompt }],
          }),
        }).catch(() => null);
        if (agentResponse?.ok && agentResponse.body) {
          const reader = agentResponse.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split("\n\n");
            buffer = events.pop() ?? "";
            for (const eventText of events) {
              const line = eventText.split("\n").find((entry) => entry.startsWith("data: "));
              if (!line) continue;
              const payload = line.slice(6);
              if (payload === "[DONE]") continue;
              const parsed = parseRuntimeSsePayload(payload) as { choices?: Array<{ delta?: { content?: string } }>; error?: unknown };
              const runtimeError = runtimeErrorMessage(parsed);
              if (runtimeError) throw new Error(runtimeError);
              agentVerdict += parsed.choices?.[0]?.delta?.content ?? "";
            }
          }
        } else if (agentResponse) {
          const message = await responseErrorMessage(agentResponse, "");
          setMirosharkAnalysisStatus(
            message
              ? `${agent.name} could not run (${message}). Saving the local intelligence packet instead.`
              : `Could not run ${agent.name}. Saving the local intelligence packet instead.`,
          );
        }
      } catch (error) {
        setMirosharkAnalysisStatus(
          `${agent.name} could not finish analysis (${error instanceof Error ? error.message : "runtime error"}). Saving the local intelligence packet instead.`,
        );
      }
    }
    const response = await fetch("/api/miroshark/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        mode,
        run,
        rawRun: mirosharkRun,
        market: swarmMarket,
        agent: agent ? {
          id: agent.id,
          name: agent.name,
          runtime: agent.runtime,
        } : undefined,
        agentVerdict: agentVerdict.trim() || undefined,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      message?: string;
      notePath?: string;
      intelligence?: MiroSharkIntelligence;
      error?: string;
    } | null;
    setMirosharkAnalysisPending("");
    if (!data?.ok) {
      setMirosharkAnalysisStatus(data?.error ?? "Could not save MiroShark analysis.");
      return;
    }
    setMirosharkAnalysisResult({
      message: data.message,
      notePath: data.notePath,
      intelligence: data.intelligence,
    });
    setMirosharkAnalysisStatus(data.message ?? "Saved analysis to Obsidian.");
    void refreshMirosharkArchive();
  }

  const refreshMirosharkArchive = useCallback(async () => {
    if (!sharedVault.enabled) {
      setMirosharkArchiveRuns([]);
      setMirosharkArchiveLoading(false);
      return;
    }
    setMirosharkArchiveLoading(true);
    const params = new URLSearchParams();
    if (sharedVault.vaultPath.trim()) params.set("vaultPath", sharedVault.vaultPath.trim());
    const response = await fetch(`/api/miroshark/runs?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; runs?: MiroSharkArchivedRun[]; error?: string } | null;
    setMirosharkArchiveLoading(false);
    if (data?.ok && Array.isArray(data.runs)) {
      setMirosharkArchiveRuns(data.runs);
      setMirosharkArchiveStatus(data.runs.length ? `Loaded ${data.runs.length} saved run${data.runs.length === 1 ? "" : "s"}` : "No saved MiroShark runs yet");
    } else {
      setMirosharkArchiveStatus(data?.error ?? "Could not load saved MiroShark runs");
    }
  }, [sharedVault.enabled, sharedVault.vaultPath]);

  const refreshBrainGraph = useCallback(async (force = false) => {
    if (!sharedVault.enabled) {
      setBrainGraph(null);
      setBrainGraphStatus("Shared brain is off.");
      brainGraphLoadedAtRef.current = 0;
      brainGraphVaultPathRef.current = "";
      return;
    }
    const requestedVaultPath = sharedVault.vaultPath.trim();
    if (
      !force
      && brainGraph
      && brainGraphVaultPathRef.current === requestedVaultPath
      && Date.now() - brainGraphLoadedAtRef.current < BRAIN_GRAPH_CLIENT_CACHE_MS
    ) return;
    setBrainGraphLoading(true);
    const nativeGraph = await getNativeBrainGraph({
      vaultPath: requestedVaultPath || undefined,
      force,
    });
    const nativeGraphIsEmpty = Boolean(nativeGraph && nativeGraph.nodes.length === 0 && nativeGraph.links.length === 0);
    if (nativeGraph && !nativeGraphIsEmpty) {
      setBrainGraphLoading(false);
      setBrainGraph(nativeGraph);
      brainGraphLoadedAtRef.current = Date.now();
      brainGraphVaultPathRef.current = requestedVaultPath;
      setSelectedBrainNodeId((current) => current || nativeGraph.nodes[0]?.id || "");
      const noteCount = nativeGraph.nodes.filter((node) => !node.id.startsWith("unresolved:")).length;
      setBrainGraphStatus(nativeGraph.truncated
        ? `Loaded first ${noteCount} notes, ${nativeGraph.nodes.length} cells, and ${nativeGraph.links.length} links.`
        : `Loaded ${noteCount} notes, ${nativeGraph.nodes.length} cells, and ${nativeGraph.links.length} links.`);
      return;
    }
    const response = await fetch("/api/obsidian/graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vaultPath: requestedVaultPath || undefined, force }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as BrainGraphResponse | null;
    setBrainGraphLoading(false);
    if (!response?.ok || !data?.ok || !data.graph) {
      if (nativeGraphIsEmpty && nativeGraph) {
        setBrainGraph(nativeGraph);
        setBrainGraphStatus(data?.error ?? "Native desktop graph returned 0 notes, and the API fallback is unavailable.");
        return;
      }
      setBrainGraphStatus(data?.error ?? "Could not build brain graph.");
      return;
    }
    setBrainGraph(data.graph);
    brainGraphLoadedAtRef.current = Date.now();
    brainGraphVaultPathRef.current = requestedVaultPath;
    setSelectedBrainNodeId((current) => current || data.graph?.nodes[0]?.id || "");
    const noteCount = data.graph.nodes.filter((node) => !node.id.startsWith("unresolved:")).length;
    setBrainGraphStatus(data.graph.truncated
      ? `Loaded first ${noteCount} notes, ${data.graph.nodes.length} cells, and ${data.graph.links.length} links.`
      : `Loaded ${noteCount} notes, ${data.graph.nodes.length} cells, and ${data.graph.links.length} links.`);
  }, [brainGraph, sharedVault.enabled, sharedVault.vaultPath]);

  const refreshRecentDirectories = useCallback(async () => {
    if (!sharedVault.enabled) {
      setRecentDirectories([]);
      return;
    }
    const params = new URLSearchParams();
    if (sharedVault.vaultPath.trim()) params.set("vaultPath", sharedVault.vaultPath.trim());
    if (sharedVault.kanbanFolder?.trim()) params.set("kanbanFolder", sharedVault.kanbanFolder.trim());
    const response = await fetch(`/api/obsidian/recent-directories?${params.toString()}`).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; directories?: RecentDirectory[] } | null;
    if (response?.ok && data?.ok && Array.isArray(data.directories)) setRecentDirectories(data.directories);
  }, [sharedVault.enabled, sharedVault.kanbanFolder, sharedVault.vaultPath]);

  const recordRecentDirectory = useCallback(async (
    directory: LinkedDirectory,
    context: { machineName?: string; machineKey?: string; source?: RecentDirectory["source"] } = {},
  ) => {
    if (!sharedVault.enabled || !directory.name.trim()) return;
    const response = await fetch("/api/obsidian/recent-directories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        directory,
        machineName: context.machineName,
        machineKey: context.machineKey,
        source: context.source,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; directories?: RecentDirectory[] } | null;
    if (response?.ok && data?.ok && Array.isArray(data.directories)) setRecentDirectories(data.directories);
  }, [sharedVault.enabled, sharedVault.vaultPath]);

  const loadMachineDirectories = useCallback(async (
    machine: KanbanMachineTarget,
    path = "~",
    onChoose?: (directory: LinkedDirectory) => void,
  ) => {
    const directoryMachine = directoryMachineTarget(machine);
    const sameMachineTarget = (left?: KanbanMachineTarget | null, right?: KanbanMachineTarget | null) => (
      Boolean(left && right && left.key === right.key && (left.collectorUrl || "") === (right.collectorUrl || ""))
    );
    setMachineDirectoryBrowser((current) => ({
      open: true,
      machine: directoryMachine,
      path,
      parentPath: sameMachineTarget(current?.machine, directoryMachine) ? current?.parentPath : "",
      directories: sameMachineTarget(current?.machine, directoryMachine) ? current?.directories ?? [] : [],
      selectedDirectory: null,
      loading: true,
      error: "",
      onChoose,
    }));
    const nativeData = await listNativeLocalDirectories({
      path,
      collectorUrl: directoryMachine.collectorUrl,
    });
    if (nativeData?.path) {
      setMachineDirectoryBrowser((current) => {
        if (!current || !sameMachineTarget(current.machine, directoryMachine)) return current;
        return {
          ...current,
          path: nativeData.path,
          parentPath: nativeData.parentPath,
          directories: Array.isArray(nativeData.directories) ? nativeData.directories : [],
          selectedDirectory: null,
          loading: false,
          error: "",
          onChoose,
        };
      });
      return;
    }
    const params = new URLSearchParams({ path });
    if (directoryMachine.collectorUrl) params.set("collectorUrl", directoryMachine.collectorUrl);
    const response = await fetch(`/api/machines/directories?${params.toString()}`).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      path?: string;
      parentPath?: string;
      directories?: MachineDirectoryEntry[];
      error?: string;
    } | null;
    setMachineDirectoryBrowser((current) => {
      if (!current || !sameMachineTarget(current.machine, directoryMachine)) return current;
      if (!response?.ok || !data?.ok) {
        return { ...current, loading: false, error: data?.error ?? "Could not list directories." };
      }
      return {
        ...current,
        path: data.path ?? path,
        parentPath: data.parentPath,
        directories: Array.isArray(data.directories) ? data.directories : [],
        selectedDirectory: null,
        loading: false,
        error: "",
        onChoose,
      };
    });
  }, []);

  async function chooseDirectoryForMachine(
    machine: KanbanMachineTarget | null,
    onChoose: (directory: LinkedDirectory) => void,
  ) {
    if (!machine) return;
    const directoryMachine = directoryMachineTarget(machine);
    const isLocalMachine = isLoopbackCollector(directoryMachine.collectorUrl)
      || (false);
    if (isLocalMachine) {
      const nativeResult = await openNativeDirectory({
        currentPath: "~",
        prompt: "Choose a chat working directory:",
      });
      const nativePath = nativeResult?.path?.trim();
      if (nativePath) {
        const name = nativePath.replace(/\/+$/, "").split("/").filter(Boolean).at(-1) || nativePath;
        onChoose({
          id: `${nativePath}-${crypto.randomUUID()}`,
          name,
          path: nativePath,
          machineName: directoryMachine.name,
          machineKey: directoryMachine.key,
          lastUsedAt: Date.now(),
        });
        return;
      }
      if (nativeResult?.cancelled) return;
      const response = await fetch("/api/agents/browse-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPath: "~", prompt: "Choose a chat working directory:" }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as { path?: string; cancelled?: boolean } | null;
      const path = data?.path?.trim();
      if (!response?.ok || !path) return;
      const name = path.replace(/\/+$/, "").split("/").filter(Boolean).at(-1) || path;
      onChoose({
        id: `${path}-${crypto.randomUUID()}`,
        name,
        path,
        machineName: directoryMachine.name,
        machineKey: directoryMachine.key,
        lastUsedAt: Date.now(),
      });
      return;
    }
    await loadMachineDirectories(directoryMachine, "~", onChoose);
  }

  const refreshHermesUpdateRequirement = useCallback(async () => {
    const hermesAgent = agents.find((agent) => agent.runtime === "hermes");
    const response = await fetch("/api/runtimes/hermes/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hermesAgent ? { agent: hermesAgent } : {}),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; status?: RuntimeIntegrationStatus; error?: string } | null;
    if (!response?.ok || !data?.ok || !data.status) {
      setHermesUpdateRequiredDetail("");
      return "";
    }
    const detail = hermesUpdateDetail(data.status);
    setHermesUpdateRequiredDetail(detail);
    return detail;
  }, [agents]);

  const loadBrainSkillInventory = useCallback(async (options: { sharedOnly?: boolean } = {}) => {
    const vaultPath = sharedVault.vaultPath.trim() || undefined;
    const nativeData = await getNativeBrainSkillInventory({
      vaultPath,
      sharedOnly: options.sharedOnly,
    });
    if (nativeData?.ok) return normalizeBrainSkillInventory(nativeData);

    const params = new URLSearchParams();
    if (vaultPath) params.set("vaultPath", vaultPath);
    if (options.sharedOnly) params.set("shared", "1");
    const query = params.toString();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), options.sharedOnly ? 30_000 : 60_000);
    const response = await fetch(`/api/obsidian/skills${query ? `?${query}` : ""}`, {
      cache: "no-store",
      signal: controller.signal,
    }).catch(() => null).finally(() => window.clearTimeout(timeout));
    const data = await response?.json().catch(() => null) as BrainSkillInventory | null;
    if (!response?.ok || !data?.ok) {
      throw new Error(data?.error ?? "Could not read skill inventory.");
    }
    return normalizeBrainSkillInventory(data);
  }, [sharedVault.vaultPath]);

  const refreshBrainSkills = useCallback(async () => {
    if (!sharedVault.enabled && !sharedVault.vaultPath.trim()) {
      setBrainSkills(null);
      setBrainSkillsStatus("Shared brain is off.");
      return;
    }
    void refreshHermesUpdateRequirement();
    setBrainSkillsLoading(true);
    setBrainSkillsStatus("Reading shared brain skills...");
    let sharedData: BrainSkillInventory | null = null;
    try {
      sharedData = await loadBrainSkillInventory({ sharedOnly: true });
      if (sharedData?.ok) {
        setBrainSkills((current) => ({
          ...sharedData,
          providers: current?.providers ?? sharedData.providers,
          totals: {
            ...sharedData.totals,
            providerSkills: current?.totals?.providerSkills ?? sharedData.totals.providerSkills,
            importable: current?.totals?.importable ?? sharedData.totals.importable,
          },
        }));
        setBrainSkillsStatus(`Loaded ${sharedData.totals.shared} shared skill${sharedData.totals.shared === 1 ? "" : "s"}; scanning provider installs...`);
      }
    } catch {
      // The full inventory below still reports the actionable error if it fails.
    }
    let data: BrainSkillInventory | null = null;
    try {
      data = await loadBrainSkillInventory();
    } catch (error) {
      if (sharedData?.ok) {
        setBrainSkillsStatus(`Loaded ${sharedData.totals.shared} shared skill${sharedData.totals.shared === 1 ? "" : "s"}; provider scan is still unavailable.`);
      } else {
        setBrainSkillsStatus(error instanceof Error ? error.message : "Could not read skill inventory.");
      }
      return;
    } finally {
      setBrainSkillsLoading(false);
    }
    if (!data?.ok) {
      setBrainSkillsStatus(data?.error ?? "Could not read skill inventory.");
      return;
    }
    const sharedCount = Math.max(data.totals.shared, data.shared.length, sharedData?.totals?.shared ?? 0, sharedData?.shared?.length ?? 0);
    const mergedData = {
      ...data,
      shared: data.shared.length ? data.shared : (sharedData?.shared ?? []),
      totals: {
        ...data.totals,
        shared: sharedCount,
      },
    };
    setBrainSkills(mergedData);
    const providerTotal = mergedData.providers.reduce((sum, provider) => sum + provider.skills.length, 0);
    setBrainSkillsStatus(mergedData.totals.shared || providerTotal
      ? `Loaded ${mergedData.totals.shared} shared and ${providerTotal} installed skill${providerTotal === 1 ? "" : "s"}.`
      : "No shared or installed skills found yet.");
  }, [loadBrainSkillInventory, refreshHermesUpdateRequirement, sharedVault.enabled, sharedVault.vaultPath]);

  const importBrainSkills = useCallback(async (provider: BrainSkillProviderId | "all") => {
    if (!sharedVault.enabled) {
      setBrainSkillsStatus("Turn on the shared brain before importing skills.");
      return;
    }
    setBrainSkillImportProvider(provider);
    setBrainSkillImportSuccess("");
    const response = await fetch("/api/obsidian/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        provider,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as BrainSkillInventory | null;
    setBrainSkillImportProvider("");
    if (!response?.ok || !data?.ok) {
      setBrainSkillsStatus(data?.error ?? "Could not import skills.");
      return;
    }
    setBrainSkills(data);
    setBrainSkillImportSuccess(provider);
    setBrainSkillsStatus(`Imported ${data.imported?.length ?? 0} skill${(data.imported?.length ?? 0) === 1 ? "" : "s"} into the shared brain.`);
    void refreshBrainGraph();
    window.setTimeout(() => setBrainSkillImportSuccess(""), 1800);
  }, [refreshBrainGraph, sharedVault.enabled, sharedVault.vaultPath]);

	  const syncBrainSkillsToAeon = useCallback(async () => {
	    if (!sharedVault.enabled) {
	      setBrainSkillsStatus("Turn on the shared brain before syncing skills to Aeon.");
	      return;
	    }
	    const aeonAgent = agents.find((agent) => agent.id === selectedAgentId && agent.runtime === "aeon")
	      ?? agents.find((agent) => agent.runtime === "aeon");
    if (!aeonAgent) {
      setBrainSkillsStatus("Add an Aeon agent before syncing shared skills to Aeon.");
      return;
    }

    setBrainSkillAeonSyncing(true);
    const response = await fetch("/api/runtimes/aeon/skills/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: aeonAgent,
        vaultPath: sharedVault.vaultPath.trim() || undefined,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as BrainSkillAeonSyncResponse | null;
    setBrainSkillAeonSyncing(false);
    if (!response?.ok || !data?.ok) {
      setBrainSkillsStatus(data?.error ?? "Could not sync shared skills to Aeon.");
      return;
    }
	    const synced = data.result?.synced?.length ?? 0;
	    const skipped = data.result?.skipped?.length ?? 0;
	    setBrainSkillsStatus(`Synced ${synced} shared skill${synced === 1 ? "" : "s"} to Aeon${skipped ? `, skipped ${skipped} conflict${skipped === 1 ? "" : "s"}` : ""}.`);
	    void refreshBrainSkills();
	  }, [agents, refreshBrainSkills, selectedAgentId, sharedVault.enabled, sharedVault.vaultPath]);

  const openSkillBrowser = useCallback(async (options: { sharedOnly?: boolean; includeCatalog?: boolean } = {}) => {
    setSkillBrowserOpen(true);
    setSkillBrowserStatus("");
    setSkillBrowserLoading(true);
    const hermesDetailPromise = refreshHermesUpdateRequirement();
    const includeCatalog = options.includeCatalog !== false;
    const inventoryPromise = sharedVault.enabled
      ? loadBrainSkillInventory({ sharedOnly: options.sharedOnly }).catch((error) => ({
        error: error instanceof Error ? error.message : "Could not read skill inventory.",
      }))
      : Promise.resolve({ error: "Turn on the shared brain before adding shared skills." });
    const [inventoryResult, featuredResponse, communityResponse, packResponse] = await Promise.all([
      inventoryPromise,
      includeCatalog
        ? fetch(`/api/skills/catalog?vaultPath=${encodeURIComponent(sharedVault.vaultPath.trim() || "")}`, { cache: "no-store" }).catch(() => null)
        : Promise.resolve(null),
      Promise.resolve(null),
      includeCatalog ? fetch("/api/skills/packs", { cache: "no-store" }).catch(() => null) : Promise.resolve(null),
    ]);
    const freshBrainSkills = "shared" in inventoryResult ? inventoryResult : null;
    if (freshBrainSkills) setBrainSkills(freshBrainSkills);
    const hermesDetail = await hermesDetailPromise;
    const hermesUpdateRequired = Boolean(hermesDetail || hermesUpdateRequiredDetail);
    const featured = await featuredResponse?.json().catch(() => null) as { skills?: Array<Record<string, unknown>> } | null;
    const community = await communityResponse?.json().catch(() => null) as { skills?: Array<Record<string, unknown>> } | null;
    const packs = await packResponse?.json().catch(() => null) as { packs?: Array<Record<string, unknown>> } | null;
    const browserInventory = freshBrainSkills ?? brainSkills;
    const featuredSkills = (featured?.skills ?? []).map((skill) => ({
      id: String(skill.slug ?? skill.id ?? skill.name ?? Math.random()),
      slug: String(skill.slug ?? skill.id ?? skill.name ?? "skill"),
      name: String(skill.name ?? skill.slug ?? "Skill"),
      description: String(skill.description ?? ""),
      source: String(skill.source ?? "Catalog"),
      category: typeof skill.category === "string" ? skill.category : undefined,
      skillMdUrl: typeof skill.skillMdUrl === "string" ? skill.skillMdUrl : undefined,
      githubUrl: typeof skill.githubUrl === "string" ? skill.githubUrl : typeof skill.githubRepoUrl === "string" ? skill.githubRepoUrl : undefined,
      packagedPath: typeof skill.packagedPath === "string" ? skill.packagedPath : undefined,
      sourceRef: typeof skill.sourceRef === "string" ? skill.sourceRef : undefined,
      capabilities: Array.isArray(skill.capabilities) ? skill.capabilities.map(String) : undefined,
      envKeys: Array.isArray(skill.envKeys) ? skill.envKeys.map(String) : undefined,
      auditStatus: typeof skill.auditStatus === "string" ? skill.auditStatus : typeof skill.audit === "object" && skill.audit && "status" in skill ? String((skill.audit as { status?: string }).status) : undefined,
      imported: Boolean(skill.imported),
      requiresHermesUpdate: skillRequiresHermesUpdate({
        slug: String(skill.slug ?? skill.id ?? skill.name ?? "skill"),
        name: String(skill.name ?? skill.slug ?? "Skill"),
        description: String(skill.description ?? ""),
        source: String(skill.source ?? "Catalog"),
      }, hermesUpdateRequired),
    }));
    const communitySkills = (community?.skills ?? []).map((skill) => ({
      id: String(skill.slug ?? skill.id ?? skill.name ?? Math.random()),
      slug: String(skill.slug ?? skill.id ?? skill.name ?? "skill"),
      name: String(skill.name ?? skill.slug ?? "Skill"),
      description: String(skill.description ?? ""),
      source: "Community",
      category: typeof skill.category === "string" ? skill.category : undefined,
      skillMdUrl: typeof skill.skillMdUrl === "string" ? skill.skillMdUrl : undefined,
      githubUrl: typeof skill.githubUrl === "string" ? skill.githubUrl : typeof skill.githubRepoUrl === "string" ? skill.githubRepoUrl : undefined,
      requiresHermesUpdate: skillRequiresHermesUpdate({
        slug: String(skill.slug ?? skill.id ?? skill.name ?? "skill"),
        name: String(skill.name ?? skill.slug ?? "Skill"),
        description: String(skill.description ?? ""),
        source: "Community",
      }, hermesUpdateRequired),
    }));
    const packSkills: SkillBrowserSkill[] = (packs?.packs ?? []).map((pack) => ({
      id: `pack-${String(pack.id ?? pack.name ?? "pack")}`,
      slug: String(pack.id ?? pack.name ?? "pack"),
      name: String(pack.name ?? pack.id ?? "Skill pack"),
      description: String(pack.description ?? ""),
      source: "Skill pack",
      category: typeof pack.category === "string" ? "Pack" : "Pack",
      capabilities: Array.isArray(pack.capabilities) ? pack.capabilities.map(String) : undefined,
      includedSkills: Array.isArray(pack.skills)
        ? pack.skills.map((skill) => ({
          slug: String(skill.slug ?? skill.name ?? "skill"),
          name: String(skill.name ?? skill.slug ?? "Skill"),
          description: String(skill.description ?? ""),
        }))
        : [],
      safety: typeof pack.safety === "string" ? pack.safety : undefined,
      audience: typeof pack.audience === "string" ? pack.audience : undefined,
      envKeys: [],
      imported: false,
    }));
    const installedSkills: SkillBrowserSkill[] = (browserInventory?.providers ?? []).flatMap((provider) => provider.skills.map((skill) => ({
      id: `${provider.id}-${skill.slug}`,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      source: provider.label,
      category: "Installed",
      providerId: provider.id,
      imported: skill.imported,
      capabilities: [],
      envKeys: [],
      requiresHermesUpdate: skillRequiresHermesUpdate({ ...skill, providerId: provider.id, source: provider.label }, hermesUpdateRequired),
    })));
    const sharedSkills: SkillBrowserSkill[] = (browserInventory?.shared ?? []).map((skill) => ({
      id: `shared-${skill.slug}`,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      source: "Shared brain",
      category: "Ready",
      providerId: "shared" as const,
      imported: true,
      capabilities: [],
      envKeys: [],
      requiresHermesUpdate: skillRequiresHermesUpdate({ ...skill, providerId: "shared" as const, source: "Shared brain" }, hermesUpdateRequired),
    }));
    const deduped = new Map<string, SkillBrowserSkill>();
    for (const skill of [...sharedSkills, ...installedSkills, ...packSkills, ...featuredSkills, ...communitySkills]) {
      const key = skill.skillMdUrl || skill.githubUrl || skill.slug;
      if (!deduped.has(key)) deduped.set(key, skill);
    }
    setSkillBrowserSkills([...deduped.values()]);
    setSkillBrowserLoading(false);
    const statusMessages = [];
    if ("error" in inventoryResult) statusMessages.push(inventoryResult.error);
    if (includeCatalog && !featuredResponse?.ok && !communityResponse?.ok) {
      statusMessages.push("Could not reach the skill catalogs. Provider-installed skills can still be imported below.");
    } else if (communityResponse && !communityResponse.ok) {
      statusMessages.push("Featured skills loaded. Community catalog is unavailable on this machine.");
    }
    if (statusMessages.length) setSkillBrowserStatus(statusMessages.join(" "));
  }, [brainSkills, hermesUpdateRequiredDetail, loadBrainSkillInventory, refreshHermesUpdateRequirement, sharedVault.enabled, sharedVault.vaultPath]);

  const importRemoteSkillToBrain = useCallback(async (skill: SkillBrowserSkill) => {
    if (skill.providerId === "shared") {
      setSkillBrowserStatus(`${skill.name} is already in the shared brain.`);
      return;
    }
    if (skill.providerId) {
      await importBrainSkills(skill.providerId);
      setSkillBrowserStatus(`Synced ${skill.name} from ${skill.source} into the shared brain.`);
      return;
    }
    if (skill.source === "Skill pack" || skill.category === "Pack") {
      if (!sharedVault.enabled) {
        setSkillBrowserStatus("Turn on the shared brain before installing skill packs.");
        return;
      }
      setSkillBrowserImporting(skill.id);
      setSkillBrowserStatus("");
      const response = await fetch("/api/skills/packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packId: skill.slug,
          vaultPath: sharedVault.vaultPath.trim() || undefined,
        }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string; inventory?: BrainSkillInventory; installed?: string[]; skipped?: string[] } | null;
      setSkillBrowserImporting("");
      if (!response?.ok || !data?.ok) {
        setSkillBrowserStatus(data?.error ?? "Could not install that skill pack.");
        return;
      }
      if (data.inventory) setBrainSkills(data.inventory);
      setSkillBrowserStatus(`Installed ${data.installed?.length ?? 0} skill${data.installed?.length === 1 ? "" : "s"} from ${skill.name}${data.skipped?.length ? `; skipped ${data.skipped.length} existing` : ""}.`);
      void refreshBrainGraph();
      void refreshBrainSkills();
      return;
    }
    if (!sharedVault.enabled) {
      setSkillBrowserStatus("Turn on the shared brain before adding skills.");
      return;
    }
    setSkillBrowserImporting(skill.id);
    setSkillBrowserStatus("");
    const response = await fetch("/api/obsidian/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "import-remote",
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        skill,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as BrainSkillInventory | { ok?: boolean; error?: string } | null;
    setSkillBrowserImporting("");
    if (!response?.ok || !data?.ok) {
      setSkillBrowserStatus(data?.error ?? "Could not add that skill to the shared brain.");
      return;
    }
    setBrainSkills(data as BrainSkillInventory);
    setSkillBrowserStatus(`Added ${skill.name} to the shared brain.`);
    void refreshBrainGraph();
    void refreshBrainSkills();
  }, [importBrainSkills, refreshBrainGraph, refreshBrainSkills, sharedVault.enabled, sharedVault.vaultPath]);

  const convertSkillToAeon = useCallback(async (skill: SkillBrowserSkill) => {
    const aeonAgent = agents.find((agent) => agent.id === selectedAgentId && agent.runtime === "aeon")
      ?? agents.find((agent) => agent.runtime === "aeon");
    if (!aeonAgent) {
      setSkillBrowserStatus("Add an Aeon agent before converting skills into Aeon workflows.");
      return;
    }
    if (!skill.imported && skill.providerId !== "shared") {
      setSkillBrowserStatus("Add the skill to the shared brain before converting it to an Aeon workflow.");
      return;
    }
    setSkillBrowserImporting(skill.id);
    setSkillBrowserStatus(`Converting ${skill.name} into an Aeon workflow...`);
    const response = await fetch("/api/runtimes/aeon/skills/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: aeonAgent,
        skill: skill.slug,
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        schedule: "manual",
        enabled: false,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string; aeon?: { schedule?: string } } | null;
    setSkillBrowserImporting("");
    if (!response?.ok || !data?.ok) {
      setSkillBrowserStatus(data?.error ?? "Could not convert that skill to Aeon.");
      return;
    }
    setSkillBrowserStatus(`Converted ${skill.name} to an Aeon workflow (${data.aeon?.schedule ?? "manual"}, off duty).`);
  }, [agents, selectedAgentId, setSkillBrowserImporting, setSkillBrowserStatus, sharedVault.vaultPath]);

  const installGithubSkillToBrain = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const githubUrl = skillBrowserGithubUrl.trim();
    if (!githubUrl) {
      setSkillBrowserStatus("Enter a GitHub skill URL first.");
      return;
    }
    if (!sharedVault.enabled) {
      setSkillBrowserStatus("Turn on the shared brain before installing from GitHub.");
      return;
    }

    setSkillBrowserGithubInstalling(true);
    setSkillBrowserStatus("");
    const response = await fetch("/api/obsidian/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "import-github",
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        githubUrl,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as BrainSkillInventory | { ok?: boolean; error?: string } | null;
    setSkillBrowserGithubInstalling(false);
    if (!response?.ok || !data?.ok) {
      setSkillBrowserStatus(data?.error ?? "Could not install that GitHub skill.");
      return;
    }

    setBrainSkills(data as BrainSkillInventory);
    setSkillBrowserGithubUrl("");
    setSkillBrowserGithubOpen(false);
    setSkillBrowserStatus("Installed GitHub skill into the shared brain.");
    void refreshBrainGraph();
    void refreshBrainSkills();
  }, [refreshBrainGraph, refreshBrainSkills, sharedVault.enabled, sharedVault.vaultPath, skillBrowserGithubUrl]);

  const addWrittenSkillToBrain = useCallback(async () => {
    const markdown = skillBrowserWrittenContent.trim();
    if (!markdown) {
      setSkillBrowserStatus("Write the skill content before adding it.");
      return;
    }
    if (!sharedVault.enabled) {
      setSkillBrowserStatus("Turn on the shared brain before adding written skills.");
      return;
    }

    setSkillBrowserWriting(true);
    setSkillBrowserStatus("");
    const response = await fetch("/api/obsidian/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "write-skill",
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        markdown,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as BrainSkillInventory | { ok?: boolean; error?: string } | null;
    setSkillBrowserWriting(false);
    if (!response?.ok || !data?.ok) {
      setSkillBrowserStatus(data?.error ?? "Could not add that written skill.");
      return;
    }

    const inventory = data as BrainSkillInventory;
    const sharedSkills: SkillBrowserSkill[] = (inventory.shared ?? []).map((skill) => ({
      id: `shared-${skill.slug}`,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      source: "Shared brain",
      category: "Ready",
      providerId: "shared" as const,
      imported: true,
      requiresHermesUpdate: skillRequiresHermesUpdate({ ...skill, providerId: "shared" as const, source: "Shared brain" }, Boolean(hermesUpdateRequiredDetail)),
    }));
    setBrainSkills(inventory);
    setSkillBrowserSearch("");
    setSkillBrowserSkills((current: SkillBrowserSkill[]) => {
      const next = new Map(current.map((skill) => [skill.skillMdUrl || skill.githubUrl || skill.slug, skill]));
      for (const skill of sharedSkills) next.set(skill.slug, skill);
      return [...next.values()];
    });
    setSkillBrowserWrittenContent("");
    setSkillBrowserView("catalog");
    setSkillBrowserStatus("Added written skill to the shared brain.");
    void refreshBrainGraph();
    void refreshBrainSkills();
  }, [hermesUpdateRequiredDetail, refreshBrainGraph, refreshBrainSkills, setSkillBrowserSearch, setSkillBrowserSkills, setSkillBrowserView, setSkillBrowserWriting, setSkillBrowserWrittenContent, sharedVault.enabled, sharedVault.vaultPath, skillBrowserWrittenContent, skillRequiresHermesUpdate]);

  const refreshNotifications = useCallback(async (options: { append?: boolean } = {}) => {
    if (!sharedVault.enabled) {
      setNotifications([]);
      setNotificationSummary(null);
      setNotificationCursor(0);
      setNotificationsStatus("Shared vault sync is off.");
      return;
    }
    const cursor = options.append ? notificationCursorRef.current ?? 0 : 0;
    if (options.append && notificationCursorRef.current === null) return;
    setNotificationsLoading(true);
    const params = new URLSearchParams({ cursor: String(cursor), limit: "40" });
    if (sharedVault.vaultPath.trim()) params.set("vaultPath", sharedVault.vaultPath.trim());
    if (sharedVault.notificationsFolder?.trim()) params.set("notificationsFolder", sharedVault.notificationsFolder.trim());
    const response = await fetch(`/api/notifications?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as NotificationsResponse | null;
    setNotificationsLoading(false);
    if (!response?.ok || !data?.ok) {
      setNotificationsStatus(data?.error ?? "Could not load notifications.");
      return;
    }
    setNotifications((current) => {
      const next = options.append ? [...current, ...(data.notifications ?? [])] : data.notifications ?? [];
      const seen = new Set<string>();
      return next.filter((notification) => {
        if (seen.has(notification.id)) return false;
        seen.add(notification.id);
        return true;
      });
    });
    setNotificationSummary({
      total: data.total ?? 0,
      unread: data.unread ?? 0,
      highUnread: data.highUnread ?? 0,
      urgentUnread: data.urgentUnread ?? 0,
      folder: data.folder ?? sharedVault.notificationsFolder ?? DEFAULT_SHARED_VAULT.notificationsFolder,
      settings: data.settings ?? {
        highPriorityMessagingEnabled: false,
        messagingHandledBy: "Configured messaging agent",
        updatedAt: new Date().toISOString(),
      },
    });
    setNotificationCursor(data.nextCursor ?? null);
    setNotificationsStatus(data.total ? `Loaded ${Math.min((options.append ? notificationCountRef.current : 0) + (data.notifications?.length ?? 0), data.total)} of ${data.total}` : "No notifications yet.");
  }, [sharedVault.enabled, sharedVault.notificationsFolder, sharedVault.vaultPath]);

  async function loadMirosharkArchivedRun(simulationId: string) {
    setSelectedMirosharkRunId(simulationId);
    setMirosharkArchiveStatus("Loading saved run...");
    const params = new URLSearchParams({ simulation_id: simulationId });
    if (sharedVault.vaultPath.trim()) params.set("vaultPath", sharedVault.vaultPath.trim());
    const response = await fetch(`/api/miroshark/runs?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      summary?: MiroSharkArchivedRun;
      run?: { scenario?: string; run?: MiroSharkRunResult };
      error?: string;
    } | null;
    if (!data?.ok || !data.run?.run) {
      setMirosharkArchiveStatus(data?.error ?? "Could not load saved run");
      return;
    }
    if (data.run.scenario) setMirosharkScenario(data.run.scenario);
    if (data.summary?.rounds) setMirosharkRounds(data.summary.rounds);
    if (data.summary?.platform === "twitter" || data.summary?.platform === "reddit" || data.summary?.platform === "parallel" || data.summary?.platform === "polymarket") {
      setMirosharkPlatform(data.summary.platform);
    }
    setMirosharkWorkspaceMode("run");
    setMirosharkWorkbenchTab("surface");
    setMirosharkRun({
      ...data.run.run,
      archived: true,
      archivedAt: data.summary?.savedAt,
      archivedSummary: data.summary,
    });
    setMirosharkRunPending(false);
    setMirosharkArchiveStatus(`Loaded ${simulationId}`);
  }

  const refreshMirosharkRun = useCallback(async () => {
    if (mirosharkRun?.archived) return;
    const runParams = new URLSearchParams();
    if (mirosharkRun?.simulationId) {
      runParams.set("simulation_id", mirosharkRun.simulationId);
      runParams.set("platform", mirosharkRun.platform ?? mirosharkPlatform);
      if (mirosharkRun.graphId) runParams.set("graph_id", mirosharkRun.graphId);
      if (mirosharkRun.projectId) runParams.set("project_id", mirosharkRun.projectId);
    }
    const shouldFetchRun = mirosharkRun?.simulationId && mirosharkRun.status === "started";
    const query = shouldFetchRun
      ? runParams.toString()
      : mirosharkRun?.jobId
        ? `job_id=${encodeURIComponent(mirosharkRun.jobId)}`
        : mirosharkRun?.simulationId
          ? runParams.toString()
          : "";
    if (!query) return;
    const response = await fetch(`/api/miroshark/swarm?${query}`, {
      cache: "no-store",
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as MiroSharkRunResult | null;
    if (data) {
      setMirosharkRun((current) => ({ ...(current ?? {}), ...data }));
      if (data.status === "started" || data.status === "failed" || data.simulationId) setMirosharkRunPending(false);
    }
  }, [mirosharkPlatform, mirosharkRun]);

  const mirosharkRunStatus = getMiroSharkRunStatus(mirosharkRun);
  const mirosharkRunIsArchived = Boolean(mirosharkRun?.archived);
  const mirosharkRunnerStatus = mirosharkRunStatus?.runner_status;
  const mirosharkPosts = getMiroSharkPosts(mirosharkRun);
  const mirosharkFeedIsWaiting = mirosharkRun?.status === "started"
    && !mirosharkRunIsArchived
    && !!mirosharkRun.simulationId
    && !isMiroSharkRunTerminal(mirosharkRunnerStatus)
    && mirosharkPosts.count === 0;
  const mirosharkFeedIsLive = mirosharkRun?.status === "started"
    && !mirosharkRunIsArchived
    && !!mirosharkRun.simulationId
    && !isMiroSharkRunTerminal(mirosharkRunnerStatus);
  const mirosharkObservedRound = mirosharkPosts.posts.reduce((max, post) => (
    typeof post.created_at === "number" ? Math.max(max, post.created_at) : max
  ), 0);
  const mirosharkTotalRounds = Math.max(
    0,
    Number(mirosharkRunStatus?.total_rounds ?? mirosharkRun?.rounds ?? 0) || 0,
  );
  const mirosharkCurrentRound = Math.max(
    0,
    Number(mirosharkRunStatus?.current_round ?? 0) || 0,
    Number(mirosharkRunStatus?.twitter_current_round ?? 0) || 0,
    mirosharkObservedRound,
  );
  const mirosharkProgressPercent = mirosharkTotalRounds > 0
    ? Math.min(100, Math.round((mirosharkCurrentRound / mirosharkTotalRounds) * 100))
    : 0;
  const mirosharkRunIsWorking = mirosharkRunPending
    || (!mirosharkRunIsArchived && mirosharkRun?.status === "queued")
    || (!mirosharkRunIsArchived && mirosharkRun?.status === "running")
    || mirosharkFeedIsWaiting;
  const mirosharkDisplayStep = mirosharkRunIsArchived ? "complete" : (mirosharkRun?.step ?? "queued");
  const mirosharkDisplayStatus = mirosharkRunIsArchived
    ? "complete"
    : (mirosharkRunnerStatus ?? mirosharkRun?.status ?? "queued");
  const mirosharkProgressLabel = (() => {
    if (mirosharkFeedIsWaiting) return "Waiting for first posts";
    if (mirosharkRun?.step === "ontology") return "Building scenario ontology";
    if (mirosharkRun?.step === "graph") return "Building interaction graph";
    if (mirosharkRun?.step === "simulation") return "Creating simulation";
    if (mirosharkRun?.step === "prepare") return "Preparing agents";
    if (mirosharkRun?.step === "start") return "Starting swarm";
    if (mirosharkRun?.step === "connect") return "Connecting to MiroShark";
    if (mirosharkRun?.step === "queued") return "Queued";
    return mirosharkRunPending ? "Starting run" : "Working";
  })();
  const mirosharkTemplates = getMiroSharkTemplates(mirosharkMetadata);
  const allMirosharkTemplates = useMemo(() => {
    const seen = new Set<string>();
    return [...SWARM_LAUNCH_PRESETS, ...mirosharkTemplates].filter((template) => {
      const id = template.id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [mirosharkTemplates]);
  const mirosharkSelectedTemplate = allMirosharkTemplates.find((template) => template.id === mirosharkSelectedTemplateId);
  const mirosharkSelectedTemplateFields = MIROSHARK_TEMPLATE_INPUTS[mirosharkSelectedTemplate?.id ?? ""] ?? [];
  const mirosharkMissingTemplateFields = mirosharkSelectedTemplateFields.filter((field) => (
    field.required && !mirosharkTemplateInputs[field.key]?.trim()
  ));
  const mirosharkTelemetryCount = payloadCount(mirosharkRun?.observabilityEvents ?? mirosharkMetadata?.observabilityEvents);
  const mirosharkActionCount = payloadCount(mirosharkRun?.actions);
  const mirosharkMarketCount = payloadCount(mirosharkRun?.markets);
  const mirosharkTimelineItems = payloadArray<Record<string, unknown>>(mirosharkRun?.timeline).slice(0, 24);
  const mirosharkActionItems = payloadArray<Record<string, unknown>>(mirosharkRun?.actions).slice(0, 24);
  const mirosharkProfileItems = payloadArray<Record<string, unknown>>(mirosharkRun?.profiles ?? mirosharkRun?.realtimeProfiles).slice(0, 12);
  const mirosharkMarketItems = payloadArray<Record<string, unknown>>(mirosharkRun?.markets).slice(0, 8);
  const mirosharkObservabilityItems = payloadArray<Record<string, unknown>>(mirosharkRun?.observabilityEvents ?? mirosharkMetadata?.observabilityEvents).slice(0, 18);
  const mirosharkLlmCallItems = payloadArray<Record<string, unknown>>(mirosharkRun?.llmCalls ?? mirosharkMetadata?.llmCalls).slice(0, 10);
  const swarmTemplates = useMemo<SwarmTemplate[]>(() => (
    allMirosharkTemplates.map((template) => ({
      id: swarmTemplateIdFromMirosharkTemplate(template),
      label: template.name ?? template.id ?? "MiroShark template",
      kind: template.category ?? template.platforms?.join(" + ") ?? "simulation",
      agents: template.estimated_agents ?? 0,
      desc: template.description ?? "MiroShark template returned by the companion.",
      platforms: template.platforms,
    }))
  ), [allMirosharkTemplates]);
  const swarmTimelineItems = useMemo(() => (
    [...mirosharkTimelineItems, ...mirosharkActionItems].slice(0, 24).map(swarmEventItem)
  ), [mirosharkActionItems, mirosharkTimelineItems]);
  const swarmObservabilityItems = useMemo(() => (
    mirosharkObservabilityItems.map(swarmEventItem)
  ), [mirosharkObservabilityItems]);
  const swarmAgents = useMemo<SwarmAgent[]>(() => (
    mirosharkProfileItems.map((profile, index) => {
      const roleText = String(profile.role ?? profile.entity_type ?? profile.platform ?? "simulation participant");
      const faction: SwarmAgent["faction"] = /risk|ops|monitor|admin|safety/i.test(roleText)
        ? "OPS"
        : /market|maker|liquidity|trade|polymarket/i.test(roleText)
          ? "MM"
          : /take|buyer|seller|whale/i.test(roleText)
            ? "TKR"
            : "INFO";
      return {
        id: String(profile.user_id ?? profile.id ?? `profile-${index}`),
        name: String(profile.name ?? profile.agent_name ?? profile.username ?? `Agent ${index + 1}`),
        role: roleText,
        faction,
        ledger: String(profile.pnl ?? profile.score ?? profile.status ?? "live"),
        trades: numericRecordValue(profile, ["trades", "actions", "posts"], 0),
        status: "live",
      };
    })
  ), [mirosharkProfileItems]);
  const swarmDecisions = useMemo<SwarmDecision[]>(() => (
    swarmTimelineItems.slice(0, 10).map((item, index) => {
      const agent = swarmAgents[index % Math.max(1, swarmAgents.length)];
      return {
        who: agent?.name ?? "MiroShark",
        role: agent?.faction ?? "INFO",
        action: item.title,
        detail: item.body,
      };
    })
  ), [swarmAgents, swarmTimelineItems]);
  const swarmThreadPosts = useMemo(() => (
    mirosharkPosts.posts.map((post, index) => ({
      id: String(post.post_id ?? index),
      author: mirosharkUserName(post.user_id),
      handle: mirosharkHandle(post.user_id),
      text: post.displayText,
      time: typeof post.created_at === "number" ? `round ${post.created_at}` : "saved",
      replies: index === 0 ? Math.max(0, mirosharkPosts.posts.length - 1) : mirosharkStat(post.post_id, 0, 9),
      reposts: post.num_shares ?? mirosharkStat(post.post_id, 0, 13),
      likes: post.num_likes ?? mirosharkStat(post.post_id, 1, 42),
      views: mirosharkStat(post.post_id, 90, 540),
    }))
  ), [mirosharkPosts.posts]);
  const swarmSocialPosts = useMemo<SwarmSocialPost[]>(() => (
    swarmThreadPosts.slice(0, 8).map((post, index) => {
      const agent = swarmAgents[index % Math.max(1, swarmAgents.length)];
      return {
        id: post.id,
        who: post.author,
        faction: agent?.faction ?? "INFO",
        t: post.time,
        text: post.text,
        reacts: { up: post.likes, down: 0 },
      };
    })
  ), [swarmAgents, swarmThreadPosts]);
  const mirosharkMarketPricePayloads = useMemo(() => (
    Array.isArray(mirosharkRun?.marketPrices) ? mirosharkRun.marketPrices : []
  ), [mirosharkRun?.marketPrices]);
  const swarmMarket = useMemo<SwarmMarket>(() => (
    swarmMarketFromItems(mirosharkMarketItems, swarmTimelineItems, mirosharkMarketPricePayloads)
  ), [mirosharkMarketItems, mirosharkMarketPricePayloads, swarmTimelineItems]);
  const swarmIntegrationItems = useMemo(() => {
    const sections: Array<[string, unknown]> = [
      ["Run detail", mirosharkRun?.runStatusDetail],
      ["Template capabilities", mirosharkMetadata?.templateCapabilities],
      ["Enriched templates", mirosharkMetadata?.templateDetails],
      ["Graph data", mirosharkRun?.graphData],
      ["Entities", mirosharkRun?.entities],
      ["Project", mirosharkRun?.project],
      ["Report", mirosharkRun?.report],
      ["Interviews", mirosharkRun?.interviewHistory],
      ["Embed summary", mirosharkRun?.embedSummary],
      ["Transcript", mirosharkRun?.transcriptJson],
      ["Webhook log", mirosharkRun?.webhookLog],
      ["Surface stats", mirosharkRun?.surfaceStats],
      ["Public gallery", mirosharkMetadata?.publicRuns],
      ["Run list", mirosharkMetadata?.simulationList],
      ["Settings", mirosharkMetadata?.settings],
      ["MCP", mirosharkMetadata?.mcpStatus],
      ["Push", mirosharkMetadata?.pushVapidKey],
    ];
    const surfaceStats = mirosharkRun?.surfaceStats;
    if (isUnpublishedSimulationPayload(surfaceStats)) {
      return [{
        id: "miroshark-integration-draft",
        title: "Review mode",
        body: "The generated posts are ready to inspect. Publish this simulation when you want to make reports, embeds, gallery, and stats available.",
        meta: "Not published yet",
        level: "warn" as const,
      }];
    }
    return sections.filter(([, payload]) => !isEmptyIntegrationPayload(payload)).map(([title, payload], index) => ({
      id: `miroshark-integration-${index}`,
      title,
      body: payloadPreview(payload, 3).map(([key, value]) => `${key}: ${value}`).join(" · ") || compactValue(payload),
      meta: `${payloadCount(payload)} records`,
      level: asRecord(payload).success === false ? "warn" as const : "info" as const,
      raw: payload,
    }));
  }, [
    mirosharkMetadata?.mcpStatus,
    mirosharkMetadata?.publicRuns,
    mirosharkMetadata?.pushVapidKey,
    mirosharkMetadata?.settings,
    mirosharkMetadata?.simulationList,
    mirosharkMetadata?.templateCapabilities,
    mirosharkMetadata?.templateDetails,
    mirosharkRun?.embedSummary,
    mirosharkRun?.entities,
    mirosharkRun?.graphData,
    mirosharkRun?.interviewHistory,
    mirosharkRun?.project,
    mirosharkRun?.report,
    mirosharkRun?.runStatusDetail,
    mirosharkRun?.surfaceStats,
    mirosharkRun?.transcriptJson,
    mirosharkRun?.webhookLog,
  ]);
  const swarmMarketPriceItems = useMemo(() => (
    mirosharkMarketPricePayloads.map(swarmMarketPriceEventItem)
  ), [mirosharkMarketPricePayloads]);
  const swarmExportLinks = useMemo(() => (
    Object.entries(mirosharkRun?.links ?? {})
      .filter(([key]) => /shareCard|replayGif|transcript|trajectory|chartSvg|threadTxt|threadJson|reproduceJson|notebook|embedSummary|webhookLog|dkgCitation|report|export/.test(key))
      .map(([key, href]) => ({
        key,
        label: key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase()),
        href,
      }))
  ), [mirosharkRun?.links]);
  const currentSwarmRun = useMemo<SwarmRun | null>(() => {
    if (!mirosharkRun) return null;
    const archivedSummary = mirosharkRun.archivedSummary
      ?? mirosharkArchiveRuns.find((run) => run.simulationId === mirosharkRun.simulationId);
    const runScenario = (archivedSummary?.scenario ?? mirosharkScenario).trim();
    const totalRounds = mirosharkTotalRounds || mirosharkRun.rounds || mirosharkRounds;
    const title = runScenario.slice(0, 90)
      || mirosharkRun.message
      || (mirosharkRun.simulationId ? `Simulation ${mirosharkRun.simulationId}` : "MiroShark run");
    return {
      id: mirosharkRun.simulationId ?? mirosharkRun.jobId ?? "active-miroshark-run",
      title,
      template: mirosharkRun.templateId ?? swarmTemplateIdFromSurface(mirosharkRun.platform ?? mirosharkPlatform),
      state: swarmRunState(mirosharkRun, mirosharkRunnerStatus),
      rounds: totalRounds,
      currentRound: Math.min(mirosharkCurrentRound || totalRounds, totalRounds || mirosharkCurrentRound),
      sharpe: null,
      pnl: null,
      started: archivedSummary?.savedAt || mirosharkRun.archivedAt
        ? formatRelativeTime(Date.parse(archivedSummary?.savedAt ?? mirosharkRun.archivedAt ?? ""))
        : "active",
      agents: swarmAgents.length || payloadCount(mirosharkRun.profiles ?? mirosharkRun.realtimeProfiles),
      news: swarmTimelineItems.length + swarmObservabilityItems.length,
      posts: Math.max(mirosharkPosts.count, archivedSummary?.postCount ?? 0),
      trades: mirosharkActionCount + mirosharkMarketCount + swarmTimelineItems.length,
      tags: [mirosharkRun.platform ?? mirosharkPlatform, mirosharkDisplayStatus].filter(Boolean),
      summary: mirosharkRun.message ?? mirosharkRun.error ?? runScenario,
      platform: mirosharkRun.platform ?? mirosharkPlatform,
      scenario: runScenario,
      threadPosts: swarmThreadPosts,
      timelineItems: swarmTimelineItems,
      marketItems: mirosharkMarketItems.map(swarmMarketEventItem),
      profileItems: mirosharkProfileItems.map(swarmEventItem),
      observabilityItems: swarmObservabilityItems,
      integrationItems: swarmIntegrationItems,
      exportLinks: swarmExportLinks,
      marketPriceItems: swarmMarketPriceItems,
    };
  }, [
    mirosharkActionCount,
    mirosharkArchiveRuns,
    mirosharkCurrentRound,
    mirosharkDisplayStatus,
    mirosharkMarketCount,
    mirosharkMarketItems,
    mirosharkPlatform,
    mirosharkPosts.count,
    mirosharkProfileItems,
    mirosharkRounds,
    mirosharkRun,
    mirosharkRunnerStatus,
    mirosharkScenario,
    mirosharkTotalRounds,
    swarmAgents.length,
    swarmExportLinks,
    swarmIntegrationItems,
    swarmMarketPriceItems,
    swarmObservabilityItems,
    swarmThreadPosts,
    swarmTimelineItems,
  ]);
  const swarmRuns = useMemo<SwarmRun[]>(() => {
    const archived = mirosharkArchiveRuns.map((run) => ({
      id: run.simulationId,
      title: run.scenario?.trim().slice(0, 90) || `Simulation ${run.simulationId}`,
      template: swarmTemplateIdFromSurface(run.platform),
      state: run.status === "failed" ? "failed" as const : "done" as const,
      rounds: run.rounds ?? 0,
      currentRound: run.rounds ?? 0,
      sharpe: null,
      pnl: null,
      started: formatRelativeTime(Date.parse(run.savedAt)),
      agents: 0,
      news: 0,
      posts: run.postCount,
      trades: 0,
      tags: [run.platform ?? "surface", run.status ?? "saved"],
      summary: run.scenario ?? `Saved MiroShark simulation ${run.simulationId}`,
      platform: run.platform,
      scenario: run.scenario,
    }));

    if (!currentSwarmRun) return archived;

    const selectedArchivedIndex = archived.findIndex((run) => run.id === currentSwarmRun.id);
    if (selectedArchivedIndex === -1) return [currentSwarmRun, ...archived];

    return archived.map((run, index) => (
      index === selectedArchivedIndex
        ? { ...run, ...currentSwarmRun, started: run.started, state: run.state }
        : run
    ));
  }, [currentSwarmRun, mirosharkArchiveRuns]);
  const swarmStatusLabel = mirosharkStatus?.ok ? "connected" : mirosharkStatus?.install.running ? "starting" : "offline";
  const selectedSwarmRunId = selectedMirosharkRunId || currentSwarmRun?.id || (mirosharkWorkspaceMode === "new" ? "" : undefined);

  return { refreshMirosharkMetadata, runMirosharkAction, startNewMirosharkSimulation, applyMirosharkTemplate, updateMirosharkTemplateInput, extractMirosharkHelperText, runMirosharkScenarioHelper, launchMirosharkSwarm, runMirosharkSwarm, runMirosharkExperiment, analyzeMirosharkRun, refreshMirosharkArchive, refreshBrainGraph, refreshRecentDirectories, recordRecentDirectory, loadMachineDirectories, chooseDirectoryForMachine, refreshHermesUpdateRequirement, refreshBrainSkills, importBrainSkills, syncBrainSkillsToAeon, openSkillBrowser, importRemoteSkillToBrain, convertSkillToAeon, installGithubSkillToBrain, addWrittenSkillToBrain, refreshNotifications, loadMirosharkArchivedRun, refreshMirosharkRun, mirosharkRunStatus, mirosharkRunIsArchived, mirosharkRunnerStatus, mirosharkPosts, mirosharkFeedIsWaiting, mirosharkFeedIsLive, mirosharkObservedRound, mirosharkTotalRounds, mirosharkCurrentRound, mirosharkProgressPercent, mirosharkRunIsWorking, mirosharkDisplayStep, mirosharkDisplayStatus, mirosharkProgressLabel, mirosharkTemplates, allMirosharkTemplates, mirosharkSelectedTemplate, mirosharkSelectedTemplateFields, mirosharkMissingTemplateFields, mirosharkTelemetryCount, mirosharkActionCount, mirosharkMarketCount, mirosharkTimelineItems, mirosharkActionItems, mirosharkProfileItems, mirosharkMarketItems, mirosharkObservabilityItems, mirosharkLlmCallItems, swarmTemplates, swarmTimelineItems, swarmObservabilityItems, swarmAgents, swarmDecisions, swarmThreadPosts, swarmSocialPosts, mirosharkMarketPricePayloads, swarmMarket, swarmIntegrationItems, swarmMarketPriceItems, swarmExportLinks, currentSwarmRun, swarmRuns, swarmStatusLabel, selectedSwarmRunId };
}
