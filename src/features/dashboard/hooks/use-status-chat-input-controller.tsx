// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";
/* eslint-disable react-hooks/immutability */
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveDashboardSlashCommand } from "@/features/chat/dashboard-slash-commands";
import { createFileReferenceAttachments } from "@/features/chat/chat-file-references";
import { runtimeChatFeature } from "@/lib/types/agent-runtime";
import { parseRuntimeSsePayload, responseErrorMessage, runtimeErrorMessage } from "./runtime-stream-errors";
import { handleStatusChatDashboardCommand } from "./status-chat-dashboard-command-router";
import { compactRepeatedAssistantText, extractGeneratedKanbanTask, kanbanBodyWithFullSource, nextChatTextDelta, processLabelFromComment, processLabelFromRuntimeEvent, processLabelFromSessionMessage, runtimePromptFromPayload, yieldChatPaint } from "./status-chat-input-helpers";
import { handleNativeImageGenerationCommand } from "./status-chat-image-generation";
import { appendPreviewMessagesForActiveChat, applicationGenerationSignature, buildActiveImageGenerationCard, cloneApplicationGenerationCard, findLatestAssistantIndexAfterLastUser, imageGenerationCardContent, imageGenerationCompletionPatchFromText, processEventSignature, shouldStartImageGenerationCard } from "./status-chat-process-image-generation";
import { appendChatProcessState, finishChatStreamState, markChatStreamChunkState, startChatStreamState } from "./status-chat-stream-state";

export function useStatusChatInputController(props: any) {
  const { AbortController, CHAT_RESPONSE_STALL_TIMEOUT_MS, Uint8Array, agents, appendMessage, attachmentSummary, brainDragMovedRef, brainDragRef, brainGraph, brainPan, busy, chatAttachments, chatAutoScrollRef, chatDirectories, chatMessageStorageKey, chatRuntimeSessionIdsByKey, chatSetupIssue, chooseDirectoryForMachine, clearActiveChatRun, collectorKey, createDefaultAgentWallet, discoveredMachines, honeyLedgerEnabled, hydrated, isManualAgentChatMessage, kanbanBoardSlug, kanbanReadyPickupInFlightRef, kanbanStorageBody, linkedDirectoryLabel, localKanbanMachineTarget, machineGroups, messageContentParts, messages, orchestrateReadyKanbanTask, quickAddMachineTarget, quickAddMachineTargets, readComposerFiles, recordActiveChatRun, recordRecentDirectory, recording, refreshHoneyLedger, refreshKanbanOnce, refreshMaintenanceReport, refreshNotifications, refreshRuntimeUsage, searchAllRuntimeSessions, selectedAgent, selectedBrainNodeId, selectedChatDirectoryPath, selectedChatLeafKey, selectedChatRuntimeSessionId, selectedChatTargetRef, selectedKanbanAgent, selectedKanbanTask, setActiveView, setAttachmentError, setAttachmentMenuOpen, setBrainGraph, setBrainGraphStatus, setBrainPan, setChatAttachments, setChatDirectories, setChatProcessByKey, setControlRoomStatus, setChatRuntimeSessionIdsByKey, setChatStreamingByKey, setKanbanBoard, setKanbanError, setKanbanSteerAttachmentError, setKanbanSteerAttachmentMenuOpen, setKanbanSteerAttachments, setKanbanSteerDirectories, setKanbanSteerDraft, setKanbanStorage, setMessagesByAgent, setQuickAddAttachmentError, setQuickAddAttachmentMenuOpen, setQuickAddAttachments, setQuickAddDirectories, setQuickAddDrafts, setRecentDirectoriesExpanded, setRecording, setSelectedBrainNodeId, setSelectedChatPreview, setSelectedChatRuntimeSessionId, setStatus, setStatusAgentId, setText, setVaultStatus, setVaultSyncPending, setVaultSyncStatus, setVoiceBands, setVoiceTarget, setVoiceTranscript, sharedVault, speechRecognitionConstructor, syncthingAutoPairRef, tailscaleDevices, text, updateAgentProfile, updateSharedVault, updateTask, upsertTask, voiceAnimationRef, voiceAudioContextRef, voiceRecognitionRef, voiceStreamRef, voiceTarget, voiceTranscriptRef, walletsByAgent } = props;
  const [chatKanbanGeneration, setChatKanbanGeneration] = useState(null);
  const [chatQueue, setChatQueue] = useState([]);
  const [flushingChatQueueId, setFlushingChatQueueId] = useState("");
  const chatSubmitGuardRef = useRef({ signature: "", at: 0 });
  const queuedChatMessages = selectedAgent
    ? chatQueue.filter((item: any) => item.agentId === selectedAgent.id && item.leafKey === selectedChatLeafKey)
    : [];

  function startChatStream(storageKey: string, agentId: string, leafKey: string, requestLabel?: string, runId?: string, startedAt = Date.now()) {
    startChatStreamState({ agentId, leafKey, recordActiveChatRun, requestLabel, runId, setChatProcessByKey, setChatStreamingByKey, startedAt, storageKey });
  }
  function markChatStreamChunk(storageKey: string) {
    markChatStreamChunkState(setChatStreamingByKey, storageKey);
  }
  function finishChatStream(storageKey: string) {
    finishChatStreamState(setChatStreamingByKey, storageKey);
  }
  function appendChatProcess(storageKey: string, label: string, detail?: string, status?: string, runId?: string) {
    appendChatProcessState({ detail, label, runId, setChatProcessByKey, status, storageKey });
  }

  function chatQueueLabel(prompt: string, attachments: any[], directories: any[]) {
    if (prompt) return prompt;
    if (attachments.length) return attachmentSummary(attachments);
    if (directories.length) return `Linked ${directories.length} director${directories.length === 1 ? "y" : "ies"}`;
    return "Queued message";
  }

  function clearChatComposerDraft() {
    setText("");
    setChatAttachments([]);
    setChatDirectories([]);
    setAttachmentError("");
    setAttachmentMenuOpen(false);
  }

  function queueChatMessage(item: any) {
    setChatQueue((current: any[]) => [...current, item]);
    clearChatComposerDraft();
    setStatus("Message queued for after the current task finishes.");
    setStatusAgentId(item.agentId);
  }

  function removeQueuedChatMessage(id: string) {
    setChatQueue((current: any[]) => current.filter((item) => item.id !== id));
  }

  function sendQueuedChatMessageNow(id: string) {
    if (busy || flushingChatQueueId) return;
    const queuedMessage = chatQueue.find((item: any) => item.id === id);
    if (!queuedMessage) return;
    setFlushingChatQueueId(id);
    setChatQueue((current: any[]) => current.filter((item) => item.id !== id));
    void runChatMessage(queuedMessage).finally(() => setFlushingChatQueueId(""));
  }

  useEffect(() => {
    if (busy || flushingChatQueueId || !selectedAgent) return;
    const nextQueuedMessage = chatQueue.find((item: any) => item.agentId === selectedAgent.id && item.leafKey === selectedChatLeafKey);
    if (!nextQueuedMessage) return;
    const flushTimer = window.setTimeout(() => {
      setFlushingChatQueueId(nextQueuedMessage.id);
      setChatQueue((current: any[]) => current.filter((item) => item.id !== nextQueuedMessage.id));
      void runChatMessage(nextQueuedMessage).finally(() => setFlushingChatQueueId(""));
    }, 0);
    return () => window.clearTimeout(flushTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, chatQueue, flushingChatQueueId, selectedAgent?.id, selectedChatLeafKey]);

  async function checkStatus() {
    if (!selectedAgent) return;
    setStatus(null);
    setStatusAgentId(selectedAgent.id);
    const response = await fetch("/api/agents/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: selectedAgent }),
    });
    const data = (await response.json().catch(() => ({}))) as GatewayStatus;
    setStatus(data);
  }

  async function checkVaultStatus() {
    setVaultStatus(null);
    const response = await fetch("/api/obsidian/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vaultPath: sharedVault.vaultPath.trim() || undefined }),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    setVaultStatus(data);
    if (data.ok && typeof data.vaultPath === "string" && data.vaultPath.trim()) {
      updateSharedVault({ vaultPath: data.vaultPath });
    }
  }

  async function checkControlRoomStatus() {
    setControlRoomStatus(null);
    const response = await fetch("/api/control-room/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ controlRoomPath: sharedVault.controlRoomPath }),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    setControlRoomStatus(data);
  }

  const runVaultTailnetSync = useCallback(async (dryRun: boolean, quiet = false) => {
    setVaultSyncPending(dryRun ? "dry-run" : "sync");
    if (!quiet) setVaultSyncStatus(null);
    const response = await fetch("/api/obsidian/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath.trim() || undefined,
        remoteHost: sharedVault.tailnetSyncHost,
        remotePath: sharedVault.tailnetSyncPath,
        direction: sharedVault.tailnetSyncDirection,
        dryRun,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as VaultSyncStatus | null;
    setVaultSyncPending("");
    setVaultSyncStatus(data ?? { ok: false, error: "Hivemind Sync repair request failed." });
  }, [
    sharedVault.tailnetSyncDirection,
    sharedVault.tailnetSyncHost,
    sharedVault.tailnetSyncPath,
    sharedVault.vaultPath,
  ]);

  const pairSyncthingCollector = useCallback(async (target: {
    remoteCollectorUrl: string;
    remoteName?: string;
    remotePath?: string;
    remoteTailscaleIp?: string;
    remoteAddressHost?: string;
  }) => {
    const localTailscaleIp = tailscaleDevices.find((device) => device.self)?.ip;
    const response = await fetch("/api/syncthing/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        localPath: sharedVault.vaultPath.trim() || undefined,
        remotePath: target.remotePath?.trim() || undefined,
        remoteCollectorUrl: target.remoteCollectorUrl,
        remoteName: target.remoteName,
        localTailscaleIp,
        remoteTailscaleIp: target.remoteTailscaleIp,
        remoteAddressHost: target.remoteAddressHost,
        folderId: "hivemindos-vault",
        label: "hivemindos-vault",
      }),
    }).catch(() => null);
    return response?.json().catch(() => null) as Promise<VaultSyncStatus | null>;
  }, [sharedVault.vaultPath, tailscaleDevices]);

  const pairSyncthingVaultSync = useCallback(async () => {
    const remoteHost = sharedVault.tailnetSyncHost.trim();
    const remotePath = sharedVault.tailnetSyncPath.trim();
    if (!remoteHost) {
      setVaultSyncStatus({ ok: false, method: "syncthing", error: "Choose a Tailnet machine first. The remote folder can be left blank for the agent bridge default." });
      return;
    }
    setVaultSyncPending("syncthing");
    setVaultSyncStatus(null);
    const cleanHost = remoteHost.replace(/^.+@/, "").replace(/\.$/, "");
    const hostKey = cleanHost.toLowerCase();
    const remoteDevice = tailscaleDevices.find((device) => (
      device.ip === cleanHost
      || device.name.toLowerCase() === hostKey
      || device.dnsName.toLowerCase().replace(/\.$/, "") === hostKey
      || device.collectorUrl.toLowerCase().includes(hostKey)
    ));
    const remoteCollectorUrl = /^https?:\/\//.test(cleanHost) ? cleanHost : remoteDevice?.collectorUrl;
    if (!remoteCollectorUrl) {
      setVaultSyncPending("");
      setVaultSyncStatus({
        ok: false,
        method: "syncthing",
        error: "No verified agent bridge URL is available for that machine. Refresh Fleet after its collector reports ready, or enter the full collector URL.",
      });
      return;
    }
    const data = await pairSyncthingCollector({
      remoteCollectorUrl,
      remoteName: cleanHost,
      remotePath,
      remoteTailscaleIp: remoteDevice?.ip || (cleanHost.startsWith("100.") ? cleanHost : undefined),
      remoteAddressHost: /^https?:\/\//.test(cleanHost) ? undefined : cleanHost,
    }).catch(() => null);
    setVaultSyncPending("");
    setVaultSyncStatus(data?.ok
      ? { ...data, method: "syncthing", message: `Syncthing paired ${data.folderId ?? "vault"} for realtime sync.` }
      : { ok: false, method: "syncthing", error: data?.error ?? "Syncthing pairing failed." });
  }, [
    pairSyncthingCollector,
    sharedVault.tailnetSyncHost,
    sharedVault.tailnetSyncPath,
    tailscaleDevices,
  ]);

  useEffect(() => {
    if (
      !hydrated
      || !sharedVault.enabled
      || sharedVault.syncProvider !== "syncthing"
      || !sharedVault.syncthingAutoPairEnabled
      || !sharedVault.vaultPath.trim()
    ) return;
    const candidates = discoveredMachines.filter((machine) => (
      machine.collector === "ready"
      && machine.device.online
      && !machine.device.self
      && Boolean(machine.device.collectorUrl)
      && machine.capabilities?.syncthing === true
    ));
    candidates.forEach((machine) => {
      const key = collectorKey(machine.device.collectorUrl);
      if (!key || syncthingAutoPairRef.current.has(key)) return;
      syncthingAutoPairRef.current.add(key);
      void pairSyncthingCollector({
        remoteCollectorUrl: machine.device.collectorUrl,
        remoteName: machine.device.name,
        remoteTailscaleIp: machine.device.ip,
        remoteAddressHost: machine.device.ip || machine.device.dnsName,
        remotePath: sharedVault.tailnetSyncPath,
      }).then((data) => {
        if (!data?.ok) {
          syncthingAutoPairRef.current.delete(key);
          setVaultSyncStatus({ ok: false, method: "syncthing", error: data?.error ?? `Auto-pair failed for ${machine.device.name}.` });
          return;
        }
        setVaultSyncStatus({
          ...data,
          method: "syncthing",
          message: `Realtime sync auto-paired with ${machine.device.name}.`,
        });
      }).catch((error) => {
        syncthingAutoPairRef.current.delete(key);
        setVaultSyncStatus({
          ok: false,
          method: "syncthing",
          error: error instanceof Error ? error.message : `Auto-pair failed for ${machine.device.name}.`,
        });
      });
    });
  }, [
    discoveredMachines,
    hydrated,
    pairSyncthingCollector,
    sharedVault.enabled,
    sharedVault.syncthingAutoPairEnabled,
    sharedVault.tailnetSyncPath,
    sharedVault.syncProvider,
    sharedVault.vaultPath,
  ]);

  async function inspectBrainNode(node: BrainGraphNode) {
    if (brainDragMovedRef.current) {
      brainDragMovedRef.current = false;
      return;
    }
    if (selectedBrainNodeId === node.id) {
      if (node.id.startsWith("unresolved:")) {
        setBrainGraphStatus("That cell is an unresolved link, so there is no note file to open yet.");
        return;
      }
      const response = await fetch("/api/obsidian/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vaultPath: sharedVault.vaultPath, notePath: node.id, newtab: true }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      setBrainGraphStatus(data?.ok ? `Opened ${node.label} in Obsidian.` : data?.error ?? "Could not open note in Obsidian.");
      return;
    }
    setSelectedBrainNodeId(node.id);
    if (node.id.startsWith("unresolved:")) return;
    const response = await fetch("/api/obsidian/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPath: sharedVault.vaultPath,
        notePath: node.id,
        agentName: selectedAgent?.name ?? "Dashboard",
        agentId: selectedAgent?.agentId || selectedAgent?.id,
        runtime: selectedAgent?.runtime,
        machineName: selectedAgent?.machineName || "local",
        action: "inspect",
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; event?: BrainAccessEvent; error?: string } | null;
    if (!data?.ok || !data.event) {
      setBrainGraphStatus(data?.error ?? "Could not record access.");
      return;
    }
    setBrainGraph((current) => {
      if (!current) return current;
      return {
        ...current,
        recentAccesses: [data.event!, ...current.recentAccesses].slice(0, 24),
        nodes: current.nodes.map((item) => item.id === node.id
          ? {
            ...item,
            accessCount: item.accessCount + 1,
            lastAccessedAt: data.event!.accessedAt,
            recentAccesses: [data.event!, ...item.recentAccesses].slice(0, 6),
          }
          : item),
      };
    });
    setBrainGraphStatus(`Recorded ${selectedAgent?.name ?? "Dashboard"} inspecting ${node.label}.`);
  }

  function startBrainPan(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    globalThis.getSelection?.()?.removeAllRanges();
    const ElementCtor = globalThis.Element;
    const target = ElementCtor && event.target instanceof ElementCtor
      ? event.target.closest("[data-brain-node-id]") as HTMLElement | null
      : null;
    const rect = event.currentTarget.getBoundingClientRect();
    const viewBox = event.currentTarget.viewBox.baseVal;
    brainDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: brainPan.x,
      panY: brainPan.y,
      scale: brainPan.scale ?? 1,
      unitX: rect.width ? viewBox.width / rect.width : 1,
      unitY: rect.height ? viewBox.height / rect.height : 1,
      moved: false,
      nodeId: target?.dataset.brainNodeId ?? "",
    };
    brainDragMovedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveBrainPan(event: PointerEvent<SVGSVGElement>) {
    const drag = brainDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    brainDragMovedRef.current = true;
    setBrainPan({
      x: drag.panX + dx * (drag.unitX ?? 1),
      y: drag.panY + dy * (drag.unitY ?? 1),
      scale: drag.scale ?? brainPan.scale ?? 1,
    });
  }

  function endBrainPan(event: PointerEvent<SVGSVGElement>) {
    const drag = brainDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      brainDragMovedRef.current = drag.moved;
      brainDragRef.current = null;
      if (!drag.moved && drag.nodeId) {
        const node = brainGraph?.nodes.find((item) => item.id === drag.nodeId);
        if (node) void inspectBrainNode(node);
      }
      if (drag.moved) window.setTimeout(() => {
        brainDragMovedRef.current = false;
      }, 0);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function addChatFiles(files: FileList | File[], kind: "image" | "file") {
    try {
      const next = await readComposerFiles(files, kind);
      setChatAttachments((current) => [...current, ...next]);
      setAttachmentError("");
      setAttachmentMenuOpen(false);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Could not attach that file.");
    }
  }

  function addChatFileReferences(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (!incoming.length) {
      setAttachmentError("Drop at least one file.");
      return;
    }
    setChatAttachments((current) => [...current, ...createFileReferenceAttachments(incoming)]);
    setAttachmentError("");
    setAttachmentMenuOpen(false);
  }

  function handleChatFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void addChatFiles(event.target.files, "file");
    event.target.value = "";
  }

  function handleChatFileReferenceDrop(files: FileList | File[]) {
    addChatFileReferences(files);
  }

  function handleChatImageChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void addChatFiles(event.target.files, "image");
    event.target.value = "";
  }

  function removeChatAttachment(id: string) {
    setChatAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function attachChatDirectory() {
    try {
      const machine = selectedAgent
        ? machineGroups.find((group) => group.agents.some((agent) => agent.id === selectedAgent.id))
        : null;
      const target = machine ? { key: machine.key, name: machine.name, collectorUrl: machine.collectorUrl } : localKanbanMachineTarget;
      await chooseDirectoryForMachine(target, (directory) => {
        setChatDirectories((current) => [...current, directory]);
        setAttachmentError("");
        setAttachmentMenuOpen(false);
        void recordRecentDirectory(directory, {
          machineName: target?.name ?? selectedAgent?.machineName,
          machineKey: target?.key ?? (selectedAgent ? collectorKey(selectedAgent.telemetryUrl) || selectedAgent.id : undefined),
          source: "chat",
        });
      });
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Could not link that directory.");
    }
  }

  function attachChatRecentDirectory(directory: LinkedDirectory) {
    setChatDirectories((current) => [...current, directory]);
    setAttachmentError("");
    setAttachmentMenuOpen(false);
    setRecentDirectoriesExpanded(false);
    void recordRecentDirectory(directory, {
      machineName: selectedAgent?.machineName ?? directory.machineName,
      machineKey: selectedAgent ? collectorKey(selectedAgent.telemetryUrl) || selectedAgent.id : directory.machineKey,
      source: "recent",
    });
  }

  function removeChatDirectory(id: string) {
    setChatDirectories((current) => current.filter((directory) => directory.id !== id));
  }

  async function addQuickAddFiles(status: KanbanStatus, files: FileList | File[], kind: "image" | "file") {
    try {
      const next = await readComposerFiles(files, kind);
      setQuickAddAttachments((current) => ({
        ...current,
        [status]: [...(current[status] ?? []), ...next],
      }));
      setQuickAddAttachmentError("");
      setQuickAddAttachmentMenuOpen(false);
    } catch (error) {
      setQuickAddAttachmentError(error instanceof Error ? error.message : "Could not attach that file.");
    }
  }

  function handleQuickAddFileChange(status: KanbanStatus, event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void addQuickAddFiles(status, event.target.files, "file");
    event.target.value = "";
  }

  function handleQuickAddImageChange(status: KanbanStatus, event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void addQuickAddFiles(status, event.target.files, "image");
    event.target.value = "";
  }

  function removeQuickAddAttachment(status: KanbanStatus, id: string) {
    setQuickAddAttachments((current) => ({ ...current, [status]: (current[status] ?? []).filter((attachment) => attachment.id !== id) }));
  }

  async function attachQuickAddDirectory(status: KanbanStatus) {
    try {
      const targetMachine = quickAddMachineTarget(status);
      await chooseDirectoryForMachine(targetMachine, (directory) => {
        setQuickAddDirectories((current) => ({
          ...current,
          [status]: [...(current[status] ?? []), directory],
        }));
        setQuickAddAttachmentError("");
        setQuickAddAttachmentMenuOpen(false);
        void recordRecentDirectory(directory, {
          machineName: targetMachine?.name,
          machineKey: targetMachine?.key,
          source: "kanban",
        });
      });
    } catch (error) {
      setQuickAddAttachmentError(error instanceof Error ? error.message : "Could not link that directory.");
    }
  }

  function attachQuickAddRecentDirectory(status: KanbanStatus, directory: LinkedDirectory) {
    setQuickAddDirectories((current) => ({
      ...current,
      [status]: [...(current[status] ?? []), directory],
    }));
    setQuickAddAttachmentError("");
    setQuickAddAttachmentMenuOpen(false);
    setRecentDirectoriesExpanded(false);
    const targetMachine = quickAddMachineTargets[status] ?? null;
    void recordRecentDirectory(directory, {
      machineName: targetMachine?.name ?? directory.machineName,
      machineKey: targetMachine?.key ?? directory.machineKey,
      source: "recent",
    });
  }

  function removeQuickAddDirectory(status: KanbanStatus, id: string) {
    setQuickAddDirectories((current) => ({ ...current, [status]: (current[status] ?? []).filter((directory) => directory.id !== id) }));
  }

  async function addKanbanSteerFiles(files: FileList | File[], kind: "image" | "file") {
    try {
      const next = await readComposerFiles(files, kind);
      setKanbanSteerAttachments((current) => [...current, ...next]);
      setKanbanSteerAttachmentError("");
      setKanbanSteerAttachmentMenuOpen(false);
    } catch (error) {
      setKanbanSteerAttachmentError(error instanceof Error ? error.message : "Could not attach that file.");
    }
  }

  function handleKanbanSteerFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void addKanbanSteerFiles(event.target.files, "file");
    event.target.value = "";
  }

  function handleKanbanSteerImageChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void addKanbanSteerFiles(event.target.files, "image");
    event.target.value = "";
  }

  function removeKanbanSteerAttachment(id: string) {
    setKanbanSteerAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function attachKanbanSteerDirectory() {
    try {
      const agentMachine = selectedKanbanAgent
        ? machineGroups.find((group) => group.agents.some((agent) => agent.id === selectedKanbanAgent.id))
        : null;
      const target = selectedKanbanTask?.targetMachine
        ?? (agentMachine ? { key: agentMachine.key, name: agentMachine.name, collectorUrl: agentMachine.collectorUrl } : localKanbanMachineTarget);
      await chooseDirectoryForMachine(target, (directory) => {
        setKanbanSteerDirectories((current) => [...current, directory]);
        setKanbanSteerAttachmentError("");
        setKanbanSteerAttachmentMenuOpen(false);
        void recordRecentDirectory(directory, {
          machineName: target?.name ?? selectedKanbanAgent?.machineName,
          machineKey: target?.key ?? (selectedKanbanAgent ? collectorKey(selectedKanbanAgent.telemetryUrl) || selectedKanbanAgent.id : undefined),
          source: "kanban",
        });
      });
    } catch (error) {
      setKanbanSteerAttachmentError(error instanceof Error ? error.message : "Could not link that directory.");
    }
  }

  function attachKanbanSteerRecentDirectory(directory: LinkedDirectory) {
    setKanbanSteerDirectories((current) => [...current, directory]);
    setKanbanSteerAttachmentError("");
    setKanbanSteerAttachmentMenuOpen(false);
    setRecentDirectoriesExpanded(false);
    void recordRecentDirectory(directory, {
      machineName: selectedKanbanTask?.targetMachine?.name ?? selectedKanbanAgent?.machineName ?? directory.machineName,
      machineKey: selectedKanbanTask?.targetMachine?.key ?? (selectedKanbanAgent ? collectorKey(selectedKanbanAgent.telemetryUrl) || selectedKanbanAgent.id : directory.machineKey),
      source: "recent",
    });
  }

  function removeKanbanSteerDirectory(id: string) {
    setKanbanSteerDirectories((current) => current.filter((directory) => directory.id !== id));
  }

  function updateVoiceTranscript(value: string) {
    voiceTranscriptRef.current = value;
    setVoiceTranscript(value);
  }

  function appendVoiceTranscriptToInput() {
    const transcript = voiceTranscriptRef.current.trim();
    if (!transcript) return;
    if (voiceTarget === "chat") {
      setText((current) => [current.trim(), transcript].filter(Boolean).join(current.trim() ? " " : ""));
    } else if (voiceTarget === "kanban-steer") {
      setKanbanSteerDraft((current) => [current.trim(), transcript].filter(Boolean).join(current.trim() ? " " : ""));
    } else {
      setQuickAddDrafts((current) => {
        const existing = current[voiceTarget]?.trim() ?? "";
        return { ...current, [voiceTarget]: [existing, transcript].filter(Boolean).join(existing ? " " : "") };
      });
    }
    updateVoiceTranscript("");
  }

  function cleanupVoiceCapture(commitTranscript: boolean) {
    if (voiceAnimationRef.current !== null) {
      window.cancelAnimationFrame(voiceAnimationRef.current);
      voiceAnimationRef.current = null;
    }
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
    void voiceAudioContextRef.current?.close().catch(() => undefined);
    voiceAudioContextRef.current = null;
    voiceRecognitionRef.current = null;
    setVoiceBands(Array(18).fill(0));
    setRecording(false);
    if (commitTranscript) appendVoiceTranscriptToInput();
  }

  function startVoiceWaveform(stream: MediaStream) {
    const audioWindow = window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const AudioContextClass = audioWindow.AudioContext || audioWindow.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioContext = new AudioContextClass();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    voiceAudioContextRef.current = audioContext;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const bands = 18;
    // Throttle waveform state updates. The analyser ticks at ~60fps, but
    // pushing setVoiceBands every frame re-renders DashboardApp (and every
    // unmemoized view panel) 60x/second for the whole recording. Sampling every
    // 5th frame (~12fps) is visually indistinguishable for a level meter and
    // cuts the recording-time re-render load by 5x.
    let frame = 0;
    const tick = () => {
      voiceAnimationRef.current = window.requestAnimationFrame(tick);
      frame = (frame + 1) % 5;
      if (frame !== 0) return;
      analyser.getByteFrequencyData(data);
      const binSize = Math.max(1, Math.floor(data.length / bands));
      const next = Array.from({ length: bands }, (_, index) => {
        const start = index * binSize;
        const slice = data.slice(start, start + binSize);
        const average = slice.reduce((total, value) => total + value, 0) / Math.max(1, slice.length);
        return Math.min(1, average / 180);
      });
      setVoiceBands(next);
    };
    tick();
  }

  async function startAudioRecording(target: "chat" | "kanban-steer" | KanbanStatus = "chat") {
    if (recording || busy) return;
    const setTargetAttachmentError = (message: string) => {
      if (target === "chat") setAttachmentError(message);
      else if (target === "kanban-steer") setKanbanSteerAttachmentError(message);
      else setQuickAddAttachmentError(message);
    };
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      setTargetAttachmentError("Speech transcription is not available in this browser.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setTargetAttachmentError("Microphone access is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recognition = new Recognition();
      let committedTranscript = "";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognition.onresult = (event) => {
        let interimTranscript = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = Array.from({ length: result.length }, (_, partIndex) => result[partIndex]?.transcript ?? "").join("");
          if (result.isFinal) committedTranscript = `${committedTranscript} ${transcript}`.trim();
          else interimTranscript = `${interimTranscript} ${transcript}`.trim();
        }
        updateVoiceTranscript(`${committedTranscript} ${interimTranscript}`.trim());
      };
      recognition.onerror = (event) => {
        setTargetAttachmentError(event.error ? `Speech transcription failed: ${event.error}` : "Speech transcription failed.");
      };
      recognition.onend = () => cleanupVoiceCapture(true);
      voiceStreamRef.current = stream;
      voiceRecognitionRef.current = recognition;
      setVoiceTarget(target);
      updateVoiceTranscript("");
      startVoiceWaveform(stream);
      recognition.start();
      setRecording(true);
      setTargetAttachmentError("");
    } catch (error) {
      cleanupVoiceCapture(false);
      setTargetAttachmentError(error instanceof Error ? error.message : "Could not start audio recording.");
    }
  }

  function stopAudioRecording() {
    const recognition = voiceRecognitionRef.current;
    if (!recognition) {
      cleanupVoiceCapture(true);
      return;
    }
    recognition.stop();
  }

  async function submitChatPrompt(input: {
    agentMode?: "act" | "plan";
    attachments?: any[];
    clearComposer?: boolean;
    directories?: any[];
    prompt: string;
  }) {
    const prompt = input.prompt.trim();
    const agentMode = input.agentMode === "plan" ? "plan" : "act";
    const outgoingAttachments = input.attachments ?? [];
    const outgoingDirectories = input.directories ?? [];
    if (!selectedAgent || (!prompt && outgoingAttachments.length === 0 && outgoingDirectories.length === 0)) return;
    const submitSignature = [
      selectedAgent.id,
      selectedChatLeafKey,
      agentMode,
      prompt,
      outgoingAttachments.map((attachment: any) => `${attachment.name ?? ""}:${attachment.size ?? ""}:${attachment.kind ?? ""}`).join("|"),
      outgoingDirectories.map((directory: any) => directory.path ?? directory.id ?? linkedDirectoryLabel(directory)).join("|"),
    ].join("\n");
    const now = Date.now();
    if (chatSubmitGuardRef.current.signature === submitSignature && now - chatSubmitGuardRef.current.at < 2_000) {
      return;
    }
    chatSubmitGuardRef.current = { signature: submitSignature, at: now };
    const queuedMessage = {
      id: `chat-queue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      agent: selectedAgent,
      agentId: selectedAgent.id,
      agentMode,
      attachments: outgoingAttachments,
      directories: outgoingDirectories,
      directoryPath: selectedChatDirectoryPath,
      label: chatQueueLabel(prompt, outgoingAttachments, outgoingDirectories),
      leafKey: selectedChatLeafKey,
      prompt,
      clearComposer: input.clearComposer !== false,
      queuedAt: Date.now(),
    };
    if (busy) {
      queueChatMessage(queuedMessage);
      return;
    }
    await runChatMessage(queuedMessage);
  }

  async function sendPromptMessage(prompt: string) {
    await submitChatPrompt({
      prompt,
      agentMode: "act",
      attachments: [],
      directories: [],
      clearComposer: false,
    });
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (recording) {
      stopAudioRecording();
      return;
    }
    const form = event.currentTarget as HTMLFormElement | null;
    const submittedAgentMode = String(form ? new FormData(form).get("agentMode") ?? "" : "");
    await submitChatPrompt({
      prompt: text ?? "",
      agentMode: submittedAgentMode === "plan" ? "plan" : "act",
      attachments: chatAttachments,
      directories: chatDirectories,
      clearComposer: true,
    });
  }

  async function runChatMessage(queuedMessage: any) {
    const selectedAgent = queuedMessage.agent;
    const selectedChatLeafKey = queuedMessage.leafKey;
    const selectedChatDirectoryPath = queuedMessage.directoryPath;
    const prompt = queuedMessage.prompt;
    const agentMode = queuedMessage.agentMode === "plan" ? "plan" : "act";
    const outgoingAttachments = queuedMessage.attachments ?? [];
    const outgoingDirectories = queuedMessage.directories ?? [];
    let activeRunProcessEvents: Array<{ at: number; label: string; detail?: string; status?: string; runId?: string }> = [];
    let activeApplicationGenerationCard: any = null;
    const appendPreviewMessages = (agentId: string, leafKey: string, appendedMessages: ChatMessage[]) => {
      setSelectedChatPreview((current) => appendPreviewMessagesForActiveChat(current, agentId, leafKey, appendedMessages));
    };
    const findActiveAssistantIndex = findLatestAssistantIndexAfterLastUser;
    const activeProcessEventsForMessage = () => activeRunProcessEvents.map((event) => ({ ...event }));
    const activeApplicationGenerationForMessage = () => cloneApplicationGenerationCard(activeApplicationGenerationCard);
    const withActiveProcessEvents = (message: ChatMessage): ChatMessage => {
      let next = activeRunProcessEvents.length
        ? { ...message, processEvents: activeProcessEventsForMessage() }
        : message;
      const applicationGeneration = activeApplicationGenerationForMessage();
      if (applicationGeneration) next = { ...next, applicationGeneration };
      return next;
    };
    const attachActiveProcessEventsToAssistant = (items: ChatMessage[]) => {
      if (!activeRunProcessEvents.length && !activeApplicationGenerationCard) return items;
      const assistantIndex = findActiveAssistantIndex(items);
      if (assistantIndex < 0) return items;
      const nextEvents = activeProcessEventsForMessage();
      const nextApplicationGeneration = activeApplicationGenerationForMessage();
      const assistant = items[assistantIndex];
      if (
        processEventSignature(assistant.processEvents ?? []) === processEventSignature(nextEvents)
        && applicationGenerationSignature(assistant.applicationGeneration) === applicationGenerationSignature(nextApplicationGeneration)
      ) return items;
      const next = [...items];
      next[assistantIndex] = { ...assistant, processEvents: nextEvents, applicationGeneration: nextApplicationGeneration };
      return next;
    };
    const replaceActiveAssistantMessage = (items: ChatMessage[], message: ChatMessage) => {
      const next = [...items];
      const assistantIndex = findActiveAssistantIndex(next);
      if (assistantIndex >= 0) next[assistantIndex] = withActiveProcessEvents(message);
      else next.push(withActiveProcessEvents(message));
      return next;
    };
    const appendActiveAssistantText = (items: ChatMessage[], fullText: string) => {
      const next = [...items];
      const assistantIndex = findActiveAssistantIndex(next);
      if (assistantIndex < 0) {
        const content = compactRepeatedAssistantText(fullText);
        return {
          changed: Boolean(content.trim()),
          messages: content.trim() ? [...next, withActiveProcessEvents({ role: "assistant" as const, content, surface: "chat" as const })] : next,
          text: content,
        };
      }
      const assistant = next[assistantIndex];
      const existingText = assistant.content ?? "";
      const localDelta = nextChatTextDelta(fullText, existingText);
      if (!localDelta) return { changed: false, messages: items, text: existingText };
      const content = compactRepeatedAssistantText(existingText + localDelta);
      next[assistantIndex] = withActiveProcessEvents({ ...assistant, role: "assistant", content, surface: "chat" });
      return { changed: true, messages: next, text: content };
    };
    const dashboardCommand = outgoingAttachments.length === 0 && outgoingDirectories.length === 0
      ? resolveDashboardSlashCommand(prompt)
      : null;
    if (outgoingAttachments.length === 0 && outgoingDirectories.length === 0 && await handleNativeImageGenerationCommand({ rawPrompt: prompt, prompt, selectedAgent, selectedChatLeafKey, selectedStorageKey: chatMessageStorageKey(selectedAgent.id, selectedChatLeafKey), chatAutoScrollRef, clearChatComposerDraft, appendMessage, appendPreviewMessages, setMessagesByAgent, setSelectedChatPreview })) return;
    if (dashboardCommand) {
      const selectedStorageKey = chatMessageStorageKey(selectedAgent.id, selectedChatLeafKey);
      await handleStatusChatDashboardCommand({ dashboardCommand, prompt, selectedAgent, selectedChatLeafKey, selectedStorageKey, appendMessage, appendPreviewMessages, setText, setAttachmentError, setAttachmentMenuOpen, setMessagesByAgent, setSelectedChatPreview, agents, chatSetupIssue, sharedVault, selectedChatDirectoryPath, walletsByAgent, createDefaultAgentWallet, honeyLedgerEnabled, queuedMessage, setActiveView, refreshMaintenanceReport, searchAllRuntimeSessions, refreshRuntimeUsage, refreshNotifications });
      return;
    }
    const outgoingDirectorySummary = outgoingDirectories.length
      ? `Linked directories:\n${outgoingDirectories.map((directory) => `- ${linkedDirectoryLabel(directory)}`).join("\n")}`
      : "";
    const outgoingLabel = prompt || attachmentSummary(outgoingAttachments) || (outgoingDirectories.length ? `Linked ${outgoingDirectories.length} director${outgoingDirectories.length === 1 ? "y" : "ies"}` : "Media message");
    const setupIssue = chatSetupIssue(selectedAgent);
    if (setupIssue) {
      appendMessage(selectedAgent.id, { role: "user", content: outgoingLabel, attachments: outgoingAttachments, surface: "chat" });
      appendMessage(selectedAgent.id, { role: "assistant", content: `Error: ${setupIssue}`, surface: "chat" });
      return;
    }

    chatAutoScrollRef.current = true;
    if (queuedMessage.clearComposer !== false) {
      setText("");
      setChatAttachments([]);
      setChatDirectories([]);
      setAttachmentError("");
      setAttachmentMenuOpen(false);
    }
    const requestStartedAt = Date.now();
    const taskId = `${selectedAgent.id}-${requestStartedAt}`;
    const workingDirectory = selectedChatDirectoryPath || selectedAgent.localDataDir || "";
    const selectedStorageKey = chatMessageStorageKey(selectedAgent.id, selectedChatLeafKey);
    const requestRuntimeSessionId = chatRuntimeSessionIdsByKey?.[selectedStorageKey] || selectedChatRuntimeSessionId;
    activeRunProcessEvents = [];
    startChatStream(selectedStorageKey, selectedAgent.id, selectedChatLeafKey, outgoingLabel, taskId, requestStartedAt);
    const requestAgentId = selectedAgent.id;
    const requestLeafKey = selectedChatLeafKey;
    const requestStillSelected = () => {
      const current = selectedChatTargetRef?.current;
      return current?.agentId === requestAgentId && current?.leafKey === requestLeafKey;
    };
    const contextMessages = messages
      .filter((message) => (
        message.role !== "system"
        && isManualAgentChatMessage(message)
        && (message.content.trim() || message.attachments?.length)
      ))
      .slice(-5);
    const outgoingContent = messageContentParts([prompt, outgoingDirectorySummary].filter(Boolean).join("\n\n"), outgoingAttachments);
    const sessionMessageCreatedMs = (message: any) => {
      const raw = Number(message?.createdAt ?? message?.timestamp ?? 0);
      if (!Number.isFinite(raw) || raw <= 0) return 0;
      return raw < 10_000_000_000 ? raw * 1000 : raw;
    };
    const normalizeSessionTurnText = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const currentRequestTexts = new Set(
      [outgoingContent, outgoingLabel, prompt]
        .map(normalizeSessionTurnText)
        .filter(Boolean),
    );
    const findCurrentRequestSessionUserIndex = (sessionMessages: any[]) => {
      let fallbackRecentUserIndex = -1;
      for (let index = 0; index < sessionMessages.length; index += 1) {
        const sessionMessage = sessionMessages[index];
        if (String(sessionMessage?.role ?? "").toLowerCase() !== "user") continue;
        const text = normalizeSessionTurnText(sessionMessage?.content);
        const createdAt = sessionMessageCreatedMs(sessionMessage);
        const isRecent = createdAt >= requestStartedAt - 2_000;
        if (text && currentRequestTexts.has(text) && (!createdAt || isRecent)) fallbackRecentUserIndex = index;
        else if (isRecent) fallbackRecentUserIndex = index;
      }
      return fallbackRecentUserIndex;
    };
    const sessionMessageBelongsToCurrentTurn = (sessionMessage: any, index: number, currentUserIndex: number) => {
      if (currentUserIndex >= 0) return index > currentUserIndex;
      const createdAt = sessionMessageCreatedMs(sessionMessage);
      return createdAt >= requestStartedAt - 2_000;
    };
    upsertTask({
      id: taskId,
      agentId: selectedAgent.id,
      title: outgoingLabel,
      lastMessage: "Starting...",
      status: "active",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      workingDirectory,
    });
    const outgoingUserMessage: ChatMessage = { role: "user", content: outgoingLabel, attachments: outgoingAttachments, surface: "chat" };
    const pendingAssistantMessage: ChatMessage = withActiveProcessEvents({ role: "assistant", content: "", surface: "chat" });
    appendMessage(selectedAgent.id, outgoingUserMessage, selectedStorageKey);
    appendMessage(selectedAgent.id, pendingAssistantMessage, selectedStorageKey);
    appendPreviewMessages(selectedAgent.id, selectedChatLeafKey, [outgoingUserMessage, pendingAssistantMessage]);

    const persistActiveProcessEventsToAssistant = () => {
      setMessagesByAgent((current) => {
        const existing = current[selectedStorageKey] ?? [];
        const next = attachActiveProcessEventsToAssistant(existing);
        return next === existing ? current : { ...current, [selectedStorageKey]: next };
      });
      setSelectedChatPreview((current) => {
        if (!current || current.agentId !== selectedAgent.id || current.leafKey !== selectedChatLeafKey) return current;
        const next = attachActiveProcessEventsToAssistant(current.messages);
        return next === current.messages ? current : { ...current, messages: next };
      });
    };
    const appendRunChatProcess = (label: string, detail?: string, status?: string) => {
      const cleanLabel = label.trim();
      if (!cleanLabel) return;
      const last = activeRunProcessEvents[activeRunProcessEvents.length - 1];
      if (last?.label === cleanLabel && last?.detail === detail) {
        activeRunProcessEvents = [
          ...activeRunProcessEvents.slice(0, -1),
          { ...last, at: Date.now(), status, runId: taskId },
        ];
      } else {
        activeRunProcessEvents = [
          ...activeRunProcessEvents,
          { at: Date.now(), label: cleanLabel, detail, status, runId: taskId },
        ].slice(-80);
      }
      appendChatProcess(selectedStorageKey, cleanLabel, detail, status, taskId);
      persistActiveProcessEventsToAssistant();
    };
    const updateActiveImageGenerationCard = (patch: Record<string, unknown> = {}) => {
      activeApplicationGenerationCard = buildActiveImageGenerationCard({
        current: activeApplicationGenerationCard,
        taskId,
        prompt,
        outgoingLabel,
        agentName: selectedAgent.name,
        appId: selectedAgent.id,
        serviceKind: selectedAgent.runtime,
        modelName: selectedAgent.model,
        machineName: selectedAgent.machineName,
        patch,
      });
      persistActiveProcessEventsToAssistant();
    };
    const maybeStartImageGenerationCard = (label: string, detail?: string) => {
      if (!shouldStartImageGenerationCard(prompt, label, detail)) return;
      updateActiveImageGenerationCard({ status: "running" });
    };
    const maybeCompleteImageGenerationCardFromText = (text: string, completedAt = Date.now()) => {
      const patch = imageGenerationCompletionPatchFromText(text, activeApplicationGenerationCard, prompt, completedAt);
      if (!patch) return false;
      updateActiveImageGenerationCard(patch);
      return true;
    };
    const replacePendingAssistant = (message: ChatMessage) => {
      setMessagesByAgent((current) => {
        const existing = current[selectedStorageKey] ?? [];
        return { ...current, [selectedStorageKey]: replaceActiveAssistantMessage(existing, message) };
      });
      setSelectedChatPreview((current) => {
        if (!current || current.agentId !== selectedAgent.id || current.leafKey !== selectedChatLeafKey) return current;
        return { ...current, messages: replaceActiveAssistantMessage(current.messages, message) };
      });
    };
    const renderAssistantText = (content: string) => {
      const nextText = compactRepeatedAssistantText(content).trim();
      if (!nextText) return;
      if (sawAssistantContent && nextText === streamedAssistantText.trim()) return;
      maybeCompleteImageGenerationCardFromText(nextText);
      streamedAssistantText = nextText;
      sawAssistantContent = true;
      markChatStreamChunk(selectedStorageKey);
      replacePendingAssistant({ role: "assistant", content: nextText, surface: "chat" });
      updateTask(taskId, { lastMessage: nextText });
    };
    const abortController = new AbortController();
    let stallTimer = window.setTimeout(() => abortController.abort("chat-response-stall"), CHAT_RESPONSE_STALL_TIMEOUT_MS);
    const refreshStallTimer = () => {
      window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => abortController.abort("chat-response-stall"), CHAT_RESPONSE_STALL_TIMEOUT_MS);
    };
    let sawAssistantContent = false;
    let sawAgentPrompt = false;
    let sawDone = false;
    let contentEventsSincePaint = 0;
    let currentRuntimeSessionId = requestRuntimeSessionId || "";
    let attachedRuntimeSessionId = "";
    let recoveredAssistantText = "";
    let streamedAssistantText = "";
    let latestSessionSummary = "";
    const seenSessionMessageKeys = new Set<string>();
    const runtimeLabel = runtimeChatFeature(selectedAgent.runtime).label || selectedAgent.runtime || "runtime";

    const ingestRuntimeSession = (session: any) => {
      if (!session || typeof session !== "object") return;
      const sessionId = String(session.sessionId ?? session.id ?? "").trim();
      if (sessionId) {
        currentRuntimeSessionId = sessionId;
        setChatRuntimeSessionIdsByKey((current) => ({ ...current, [selectedStorageKey]: sessionId }));
        if (requestStillSelected()) setSelectedChatRuntimeSessionId(sessionId);
        recordActiveChatRun?.({
          storageKey: selectedStorageKey,
          agentId: selectedAgent.id,
          leafKey: selectedChatLeafKey,
          startedAt: requestStartedAt,
          updatedAt: Date.now(),
          requestLabel: outgoingLabel,
          sessionId,
          runId: taskId,
          status: "active",
        });
        if (attachedRuntimeSessionId !== sessionId) {
          attachedRuntimeSessionId = sessionId;
          appendRunChatProcess(`Attached ${runtimeLabel} session`, sessionId);
        }
      }
      const sessionMessages = Array.isArray(session.messages) ? session.messages : [];
      const currentUserIndex = findCurrentRequestSessionUserIndex(sessionMessages);
      for (let index = 0; index < sessionMessages.length; index += 1) {
        const sessionMessage = sessionMessages[index];
        if (!sessionMessageBelongsToCurrentTurn(sessionMessage, index, currentUserIndex)) continue;
        const key = [
          sessionId,
          sessionMessage?.index ?? "",
          sessionMessage?.createdAt ?? "",
          sessionMessage?.role ?? "",
          String(sessionMessage?.content ?? "").slice(0, 48),
        ].join(":");
        if (seenSessionMessageKeys.has(key)) continue;
        seenSessionMessageKeys.add(key);
        const processEvent = processLabelFromSessionMessage(sessionMessage);
        if (processEvent) {
          latestSessionSummary = processEvent.detail || processEvent.label;
          appendRunChatProcess(processEvent.label, processEvent.detail);
          maybeStartImageGenerationCard(processEvent.label, processEvent.detail);
        }
        maybeCompleteImageGenerationCardFromText(String(sessionMessage?.content ?? ""));
        if (String(sessionMessage?.role ?? "").toLowerCase() === "assistant") {
          const assistantText = String(sessionMessage?.content ?? "");
          recoveredAssistantText += assistantText;
          renderAssistantText(assistantText);
        }
      }
    };

    const pollRuntimeSession = async () => {
      const fetchSession = (body: Record<string, unknown>) => fetch("/api/chat/agent-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      let response = await fetchSession({
        agent: selectedAgent,
        sessionId: currentRuntimeSessionId || undefined,
        sinceMs: requestStartedAt - 2_000,
        chatStorageKey: selectedStorageKey,
      });
      if (!response?.ok && currentRuntimeSessionId) {
        response = await fetchSession({ agent: selectedAgent, sinceMs: requestStartedAt - 2_000, chatStorageKey: selectedStorageKey });
      }
      if (!response?.ok) return;
      const data = await response.json().catch(() => null);
      if (data?.ok && data.session) ingestRuntimeSession(data.session);
    };

    try {
      const response = await fetch("/api/chat/agent-runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          agent: selectedAgent,
          sharedVault,
          workingDirectory,
          runtimeSessionId: requestRuntimeSessionId || undefined,
          hermesSessionId: requestRuntimeSessionId || undefined,
          chatStorageKey: selectedStorageKey,
          clientRunId: taskId,
          wallet: walletsByAgent[selectedAgent.id] ?? createDefaultAgentWallet(selectedAgent.id),
          honeyLedgerEnabled,
          agentMode,
          messages: [
            ...contextMessages.map((message) => ({
              role: message.role,
              content: messageContentParts(message.content, message.attachments ?? []),
            })),
            { role: "user", content: outgoingContent },
          ],
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(await responseErrorMessage(response, `Request failed with ${response.status}`));
      }

      // Prepaid inference providers report the remaining balance on the
      // response, so the stored wallet balance stays fresh after every chat
      // instead of waiting for a settings refresh.
      const providerBalanceRemaining = response.headers.get("X-Provider-Balance-Remaining")?.trim() ?? "";
      if (providerBalanceRemaining && selectedAgent.id && typeof updateAgentProfile === "function") {
        const checkedAt = new Date().toISOString();
        if (selectedAgent.provider === "venice") {
          const numeric = providerBalanceRemaining.replace(/[^0-9.]/g, "");
          if (numeric) {
            updateAgentProfile(selectedAgent.id, {
              venice: { ...(selectedAgent.venice ?? {}), lastBalanceUsd: numeric, lastCheckedAt: checkedAt },
            });
          }
        } else if (selectedAgent.provider === "usepod") {
          updateAgentProfile(selectedAgent.id, {
            usePod: { ...(selectedAgent.usePod ?? {}), lastBalanceRemaining: providerBalanceRemaining, lastCheckedAt: checkedAt },
          });
        }
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      refreshStallTimer();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        refreshStallTimer();
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const eventText of events) {
          const line = eventText.split("\n").find((entry) => entry.startsWith("data: "));
          if (!line) {
              const label = processLabelFromComment(eventText);
              if (label) appendRunChatProcess(label);
            continue;
          }
          const payload = line.slice(6);
          if (payload === "[DONE]") {
            sawDone = true;
            continue;
          }
          const parsed = parseRuntimeSsePayload(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            error?: unknown;
            honey?: unknown;
            session?: { id?: string; runtime?: string; source?: string; startedAt?: number; updatedAt?: number; messageCount?: number };
            clarify?: unknown;
            prompt?: unknown;
            event?: { type?: string };
            type?: string;
            applicationGeneration?: Record<string, unknown>;
          };
          const runtimeError = runtimeErrorMessage(parsed);
          if (runtimeError) throw new Error(runtimeError);
          if (parsed.honey) {
            await refreshHoneyLedger();
            continue;
          }
          if (parsed.applicationGeneration && typeof parsed.applicationGeneration === "object") {
            updateActiveImageGenerationCard(parsed.applicationGeneration);
            continue;
          }
          const processEvent = processLabelFromRuntimeEvent(parsed);
          if (processEvent) {
            appendRunChatProcess(processEvent.label, processEvent.detail, processEvent.status);
            maybeStartImageGenerationCard(processEvent.label, processEvent.detail);
          }
          if (parsed.session?.id) {
            appendRunChatProcess(`Attached ${runtimeLabel} session`, parsed.session.id);
            setChatRuntimeSessionIdsByKey((current) => ({ ...current, [selectedStorageKey]: parsed.session.id }));
            if (requestStillSelected()) setSelectedChatRuntimeSessionId(parsed.session.id);
            continue;
          }
          const agentPrompt = runtimePromptFromPayload(parsed);
          if (agentPrompt) {
            sawAgentPrompt = true;
            sawAssistantContent = true;
            replacePendingAssistant({
              role: "assistant",
              content: agentPrompt.question,
              surface: "chat",
              agentPrompt,
            });
            updateTask(taskId, { status: "active", lastMessage: `Waiting for reply: ${agentPrompt.question}` });
            sawDone = true;
            continue;
          }
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) {
            const textDelta = nextChatTextDelta(chunk, streamedAssistantText);
            if (!textDelta) continue;
            streamedAssistantText += textDelta;
            maybeCompleteImageGenerationCardFromText(streamedAssistantText);
            markChatStreamChunk(selectedStorageKey);
            sawAssistantContent = true;
            let nextTaskMessage = "";
            setMessagesByAgent((current) => {
              const existing = current[selectedStorageKey] ?? [];
              const result = appendActiveAssistantText(existing, streamedAssistantText);
              if (!result.changed) return current;
              nextTaskMessage = result.text;
              return { ...current, [selectedStorageKey]: result.messages };
            });
            setSelectedChatPreview((current) => {
              if (!current || current.agentId !== selectedAgent.id || current.leafKey !== selectedChatLeafKey) return current;
              const result = appendActiveAssistantText(current.messages, streamedAssistantText);
              return result.changed ? { ...current, messages: result.messages } : current;
            });
            updateTask(taskId, { lastMessage: nextTaskMessage || streamedAssistantText });
            contentEventsSincePaint += 1;
            if (contentEventsSincePaint >= 8) {
              contentEventsSincePaint = 0;
              await yieldChatPaint();
            }
          }
        }
        if (sawDone) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
      if (!sawAssistantContent && !activeApplicationGenerationCard) {
        const message = `${selectedAgent.name || selectedAgent.runtime || "The agent"} finished without returning any text for this message. No runtime error was reported.`;
        replacePendingAssistant({ role: "assistant", content: `Error: ${message}`, surface: "chat" });
        updateTask(taskId, { status: "failed", lastMessage: message, completedAt: Date.now() });
        return;
      }
      if (!sawAssistantContent && activeApplicationGenerationCard) {
        const content = imageGenerationCardContent(activeApplicationGenerationCard);
        replacePendingAssistant({ role: "assistant", content, surface: "chat" });
        updateTask(taskId, { status: activeApplicationGenerationCard.status === "error" ? "failed" : "completed", lastMessage: content, completedAt: Date.now() });
        return;
      }
      updateTask(taskId, sawAgentPrompt ? { status: "active", completedAt: undefined } : { status: "completed", completedAt: Date.now() });
    } catch (error) {
      const aborted = abortController.signal.aborted;
      if (aborted) {
        appendRunChatProcess("Chat stream timed out", `Checking the ${runtimeLabel} session for late activity.`);
        recordActiveChatRun?.({
          storageKey: selectedStorageKey,
          agentId: selectedAgent.id,
          leafKey: selectedChatLeafKey,
          startedAt: requestStartedAt,
          updatedAt: Date.now(),
          requestLabel: outgoingLabel,
          sessionId: currentRuntimeSessionId || undefined,
          runId: taskId,
          status: "stalled",
        });
        await pollRuntimeSession();
      }
      if (aborted && recoveredAssistantText.trim()) {
        replacePendingAssistant({ role: "assistant", content: recoveredAssistantText.trim(), surface: "chat" });
        updateTask(taskId, { status: "completed", lastMessage: recoveredAssistantText.trim(), completedAt: Date.now() });
        return;
      }
      const message = aborted
        ? `${runtimeLabel} did not return a chat response within ${Math.round(CHAT_RESPONSE_STALL_TIMEOUT_MS / 1000)} seconds. The session ${latestSessionSummary ? `last reported: ${latestSessionSummary}` : `may still be running in ${runtimeLabel}`}; check the process panel before retrying.`
        : error instanceof Error && /^(?:load failed|failed to fetch|networkerror)/i.test(error.message.trim())
          ? "HivemindOS could not reach the local chat runtime route from the desktop webview. The Next/Tauri dev proxy likely dropped the request before the agent runtime started; wait for the app to finish compiling, then retry."
          : error instanceof Error ? error.message : "Unknown runtime error";
      const errorMessage: ChatMessage = { role: "assistant", content: `Error: ${message}`, surface: "chat" };
      replacePendingAssistant(errorMessage);
      updateTask(taskId, { status: "failed", lastMessage: message, completedAt: Date.now() });
    } finally {
      window.clearTimeout(stallTimer);
      if (sawDone || !abortController.signal.aborted || recoveredAssistantText.trim()) clearActiveChatRun?.(selectedStorageKey);
      finishChatStream(selectedStorageKey);
    }
  }

  async function generateKanbanTaskFromChat(targetStatus: "ideas" | "ready", source: { key: string; content: string }) {
    if (!selectedAgent || chatKanbanGeneration?.phase === "generating" || chatKanbanGeneration?.phase === "creating") return;
    const setupIssue = chatSetupIssue(selectedAgent);
    if (setupIssue) {
      setChatKanbanGeneration({ key: source.key, status: targetStatus, phase: "error", message: setupIssue });
      return;
    }
    const workingDirectory = selectedChatDirectoryPath || selectedAgent.localDataDir || "";
    const selectedStorageKey = chatMessageStorageKey(selectedAgent.id, selectedChatLeafKey);
    const requestRuntimeSessionId = chatRuntimeSessionIdsByKey?.[selectedStorageKey] || selectedChatRuntimeSessionId;
    const requestAgentId = selectedAgent.id;
    const requestLeafKey = selectedChatLeafKey;
    const requestStillSelected = () => {
      const current = selectedChatTargetRef?.current;
      return current?.agentId === requestAgentId && current?.leafKey === requestLeafKey;
    };
    const contextMessages = messages
      .filter((message) => (
        message.role !== "system"
        && isManualAgentChatMessage(message)
        && (message.content.trim() || message.attachments?.length)
      ))
      .slice(-12);
    const transcript = contextMessages.map((message) => `${message.role.toUpperCase()}:\n${message.content.trim()}`).join("\n\n");
    const laneLabel = targetStatus === "ready" ? "Ready" : "Ideas";
    const prompt = [
      "Generate exactly one Kanban task from this chat context.",
      `Target lane: ${laneLabel}.`,
      "Return only valid JSON with these keys: title, body, priority, acceptanceCriteria.",
      "Every value must be derived from the conversation. Do not copy field descriptions, placeholder text, or describe the schema.",
      "title must be a short human-visible Kanban card title.",
      "body must be a concrete worker brief with context and expected outcome.",
      "priority must be one of low, normal, high, urgent.",
      "acceptanceCriteria must be an array of observable outcomes.",
      "Do not include markdown fences, commentary, or extra keys.",
      "",
      "Conversation context:",
      transcript || "(No prior transcript available.)",
      "",
      "Message the user selected as the source:",
      source.content.trim(),
    ].join("\n");
    const abortController = new AbortController();
    let stallTimer = window.setTimeout(() => abortController.abort("chat-kanban-generation-stall"), CHAT_RESPONSE_STALL_TIMEOUT_MS);
    const refreshStallTimer = () => {
      window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => abortController.abort("chat-kanban-generation-stall"), CHAT_RESPONSE_STALL_TIMEOUT_MS);
    };
    let generatedText = "";
    setChatKanbanGeneration({ key: source.key, status: targetStatus, phase: "generating", message: "Asking agent to shape the task..." });
    try {
      const response = await fetch("/api/chat/agent-runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          agent: selectedAgent,
          sharedVault,
          workingDirectory,
          runtimeSessionId: requestRuntimeSessionId || undefined,
          hermesSessionId: requestRuntimeSessionId || undefined,
          chatStorageKey: selectedStorageKey,
          clientRunId: `kanban-${Date.now().toString(36)}`,
          wallet: walletsByAgent[selectedAgent.id] ?? createDefaultAgentWallet(selectedAgent.id),
          honeyLedgerEnabled,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!response.ok || !response.body) {
        throw new Error(await responseErrorMessage(response, `Request failed with ${response.status}`));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;
      refreshStallTimer();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        refreshStallTimer();
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const eventText of events) {
          const line = eventText.split("\n").find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") {
            sawDone = true;
            continue;
          }
          const parsed = parseRuntimeSsePayload(payload);
          const runtimeError = runtimeErrorMessage(parsed);
          if (runtimeError) throw new Error(runtimeError);
          if (parsed.honey) {
            await refreshHoneyLedger();
            continue;
          }
          if (parsed.session?.id) {
            setChatRuntimeSessionIdsByKey((current) => ({ ...current, [selectedStorageKey]: parsed.session.id }));
            if (requestStillSelected()) setSelectedChatRuntimeSessionId(parsed.session.id);
            continue;
          }
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) {
            generatedText += chunk;
            setChatKanbanGeneration({ key: source.key, status: targetStatus, phase: "generating", message: "Drafting task brief...", preview: generatedText });
          }
        }
        if (sawDone) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
      if (!generatedText.trim()) throw new Error("The agent did not return a task draft.");
      const taskDraft = extractGeneratedKanbanTask(generatedText, source.content.trim().split(/\s+/).slice(0, 8).join(" "));
      const fullTaskBody = kanbanBodyWithFullSource(taskDraft.body, source.content);
      setChatKanbanGeneration({ key: source.key, status: targetStatus, phase: "creating", message: `Sending to ${laneLabel}...`, taskTitle: taskDraft.title });
      const createResponse = await fetch(`/api/kanban?board=${encodeURIComponent(kanbanBoardSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...kanbanStorageBody(),
          title: taskDraft.title,
          body: fullTaskBody,
          assignee: "",
          tenant: "",
          priority: taskDraft.priority,
          status: targetStatus,
          attachments: [],
          linkedDirectories: [],
          targetMachine: null,
        }),
      });
      const data = await createResponse.json().catch(() => null);
      if (!createResponse.ok || !data?.ok) throw new Error(data?.error ?? "Could not create task.");
      if (data.board) {
        setKanbanBoard?.(data.board);
        setKanbanStorage?.(data.storage ?? null);
      }
      if (targetStatus === "ready" && data.task && orchestrateReadyKanbanTask) {
        kanbanReadyPickupInFlightRef?.current?.add(data.task.id);
        await orchestrateReadyKanbanTask(data.task).finally(() => {
          kanbanReadyPickupInFlightRef?.current?.delete(data.task.id);
        });
      } else {
        await refreshKanbanOnce?.();
      }
      setChatKanbanGeneration({ key: source.key, status: targetStatus, phase: "done", message: `Created in ${laneLabel}.`, taskTitle: taskDraft.title });
    } catch (error) {
      const aborted = abortController.signal.aborted;
      const message = aborted
        ? `The agent did not return a task draft within ${Math.round(CHAT_RESPONSE_STALL_TIMEOUT_MS / 1000)} seconds.`
        : error instanceof Error ? error.message : "Could not generate the Kanban task.";
      setKanbanError?.(message);
      setChatKanbanGeneration({ key: source.key, status: targetStatus, phase: "error", message });
    } finally {
      window.clearTimeout(stallTimer);
    }
  }

  function dismissChatKanbanGeneration(key?: string) {
    setChatKanbanGeneration((current) => {
      if (!current) return current;
      if (key && current.key !== key) return current;
      return null;
    });
  }
  return { checkStatus, checkVaultStatus, checkControlRoomStatus, runVaultTailnetSync, pairSyncthingCollector, pairSyncthingVaultSync, inspectBrainNode, startBrainPan, moveBrainPan, endBrainPan, addChatFiles, handleChatFileChange, handleChatFileReferenceDrop, handleChatImageChange, removeChatAttachment, attachChatDirectory, attachChatRecentDirectory, removeChatDirectory, addQuickAddFiles, handleQuickAddFileChange, handleQuickAddImageChange, removeQuickAddAttachment, attachQuickAddDirectory, attachQuickAddRecentDirectory, removeQuickAddDirectory, addKanbanSteerFiles, handleKanbanSteerFileChange, handleKanbanSteerImageChange, removeKanbanSteerAttachment, attachKanbanSteerDirectory, attachKanbanSteerRecentDirectory, removeKanbanSteerDirectory, updateVoiceTranscript, appendVoiceTranscriptToInput, cleanupVoiceCapture, startVoiceWaveform, startAudioRecording, stopAudioRecording, sendMessage, sendPromptMessage, queuedChatMessages, flushingChatQueueId, removeQueuedChatMessage, sendQueuedChatMessageNow, generateKanbanTaskFromChat, dismissChatKanbanGeneration, chatKanbanGeneration };
}
