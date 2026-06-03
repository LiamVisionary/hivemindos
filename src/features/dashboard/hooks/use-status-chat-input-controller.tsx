// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

/* eslint-disable react-hooks/immutability, react-hooks/purity */

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveDashboardSlashCommand } from "@/features/chat/dashboard-slash-commands";
import { runtimeChatFeature } from "@/lib/types/agent-runtime";
import { parseRuntimeSsePayload, responseErrorMessage, runtimeErrorMessage } from "./runtime-stream-errors";

export function useStatusChatInputController(props: any) {
  const { AbortController, CHAT_RESPONSE_STALL_TIMEOUT_MS, Uint8Array, appendMessage, attachmentSummary, brainDragMovedRef, brainDragRef, brainGraph, brainPan, busy, chatAttachments, chatAutoScrollRef, chatDirectories, chatMessageStorageKey, chatRuntimeSessionIdsByKey, chatSetupIssue, chooseDirectoryForMachine, clearActiveChatRun, collectorKey, createDefaultAgentWallet, discoveredMachines, honeyLedgerEnabled, hydrated, isManualAgentChatMessage, kanbanBoardSlug, kanbanReadyPickupInFlightRef, kanbanStorageBody, linkedDirectoryLabel, localKanbanMachineTarget, machineGroups, messageContentParts, messages, orchestrateReadyKanbanTask, quickAddMachineTarget, quickAddMachineTargets, readComposerFiles, recordActiveChatRun, recordRecentDirectory, recording, refreshHoneyLedger, refreshKanbanOnce, refreshMaintenanceReport, refreshNotifications, refreshRuntimeUsage, searchAllRuntimeSessions, selectedAgent, selectedBrainNodeId, selectedChatDirectoryPath, selectedChatLeafKey, selectedChatRuntimeSessionId, selectedChatTargetRef, selectedKanbanAgent, selectedKanbanTask, setActiveView, setAttachmentError, setAttachmentMenuOpen, setBrainGraph, setBrainGraphStatus, setBrainPan, setChatAttachments, setChatDirectories, setChatProcessByKey, setControlRoomStatus, setChatRuntimeSessionIdsByKey, setChatStreamingByKey, setKanbanBoard, setKanbanError, setKanbanSteerAttachmentError, setKanbanSteerAttachmentMenuOpen, setKanbanSteerAttachments, setKanbanSteerDirectories, setKanbanSteerDraft, setKanbanStorage, setMessagesByAgent, setQuickAddAttachmentError, setQuickAddAttachmentMenuOpen, setQuickAddAttachments, setQuickAddDirectories, setQuickAddDrafts, setRecentDirectoriesExpanded, setRecording, setSelectedBrainNodeId, setSelectedChatPreview, setSelectedChatRuntimeSessionId, setStatus, setStatusAgentId, setText, setVaultStatus, setVaultSyncPending, setVaultSyncStatus, setVoiceBands, setVoiceTarget, setVoiceTranscript, sharedVault, speechRecognitionConstructor, syncthingAutoPairRef, tailscaleDevices, text, updateSharedVault, updateTask, upsertTask, voiceAnimationRef, voiceAudioContextRef, voiceRecognitionRef, voiceStreamRef, voiceTarget, voiceTranscriptRef, walletsByAgent } = props;
  const [chatKanbanGeneration, setChatKanbanGeneration] = useState(null);
  const [chatQueue, setChatQueue] = useState([]);
  const [flushingChatQueueId, setFlushingChatQueueId] = useState("");
  const chatSubmitGuardRef = useRef({ signature: "", at: 0 });
  const queuedChatMessages = selectedAgent
    ? chatQueue.filter((item: any) => item.agentId === selectedAgent.id && item.leafKey === selectedChatLeafKey)
    : [];

  function runtimePromptFromPayload(parsed: any) {
    const event = parsed?.event && typeof parsed.event === "object" ? parsed.event : null;
    const source = parsed?.clarify ?? parsed?.prompt ?? event ?? parsed;
    const type = String(event?.type ?? parsed?.type ?? source?.type ?? "");
    if (!/clarify|approval|sudo|secret|prompt/i.test(type)) return null;
    const question = String(source?.question ?? source?.message ?? source?.content ?? source?.text ?? "").trim();
    if (!question) return null;
    const rawChoices = source?.choices ?? source?.options;
    const choices = Array.isArray(rawChoices)
      ? rawChoices.map((choice) => typeof choice === "string" ? choice : String(choice?.label ?? choice?.value ?? "")).filter(Boolean)
      : [];
    const promptType = /approval/i.test(type)
      ? "approval"
      : /sudo/i.test(type)
        ? "sudo"
        : /secret/i.test(type)
          ? "secret"
          : /clarify/i.test(type)
            ? "clarify"
            : "prompt";
    return {
      id: String(source?.id ?? event?.id ?? `prompt-${Date.now()}`),
      type: promptType,
      question,
      choices,
      allowFreeText: source?.allowFreeText !== false,
    };
  }

  function startChatStream(storageKey: string, agentId: string, leafKey: string, requestLabel?: string) {
    setChatStreamingByKey((current) => {
      return { ...current, [storageKey]: { agentId, leafKey, hasChunk: false } };
    });
    setChatProcessByKey?.((current) => ({
      ...current,
      [storageKey]: [{ at: Date.now(), label: "Queued chat request", detail: "Preparing the runtime bridge." }],
    }));
    recordActiveChatRun?.({
      storageKey,
      agentId,
      leafKey,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      requestLabel,
      status: "active",
    });
  }

  function markChatStreamChunk(storageKey: string) {
    setChatStreamingByKey((current) => {
      if (!current[storageKey]?.hasChunk) {
        return { ...current, [storageKey]: { ...current[storageKey], hasChunk: true } };
      }
      return current;
    });
  }

  function finishChatStream(storageKey: string) {
    setChatStreamingByKey((current) => {
      const next = { ...current };
      delete next[storageKey];
      return next;
    });
  }

  function appendChatProcess(storageKey: string, label: string, detail?: string, status?: string) {
    const cleanLabel = label.trim();
    if (!cleanLabel) return;
    setChatProcessByKey?.((current) => {
      const existing = current[storageKey] ?? [];
      const last = existing[existing.length - 1];
      if (last?.label === cleanLabel && last?.detail === detail) {
        return {
          ...current,
          [storageKey]: [...existing.slice(0, -1), { ...last, at: Date.now(), status }],
        };
      }
      return {
        ...current,
        [storageKey]: [...existing, { at: Date.now(), label: cleanLabel, detail, status }].slice(-80),
      };
    });
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

  function processLabelFromComment(eventText: string) {
    return eventText
      .split("\n")
      .map((line) => line.replace(/^:\s?/, "").trim())
      .filter(Boolean)
      .join(" ");
  }

  function processLabelFromRuntimeEvent(parsed: any) {
    const event = parsed?.event && typeof parsed.event === "object" ? parsed.event : null;
    const type = String(event?.type ?? parsed?.type ?? "").trim();
    const source = event ?? parsed;
    const message = String(source?.message ?? source?.label ?? source?.title ?? source?.name ?? source?.content ?? source?.delta ?? "").trim();
    const toolName = String(source?.tool ?? source?.toolName ?? source?.name ?? source?.command ?? "").trim();
    if (/^chat\.(text|session|done)$/.test(type)) return null;
    if (/thinking|reasoning/i.test(type)) {
      return { label: type.includes("reason") ? "Reasoning" : "Thinking", detail: message || undefined };
    }
    const rawStatus = String(source?.status ?? "").trim().toLowerCase();
    const status = rawStatus === "completed" || rawStatus === "failed" || rawStatus === "running" ? rawStatus : undefined;
    if (/tool\.(generating|start|started|pending)/i.test(type)) {
      return { label: toolName ? `Starting ${toolName}` : "Starting tool", detail: message || undefined, status: status ?? "running" };
    }
    if (/tool\.(progress|running)/i.test(type)) {
      return { label: toolName ? `${toolName} running` : "Tool running", detail: message || undefined, status: status ?? "running" };
    }
    if (/tool\.(done|completed|failed|error)/i.test(type)) {
      return { label: toolName ? `${toolName} finished` : "Tool finished", detail: message || undefined, status: status ?? (/failed|error/i.test(type) ? "failed" : "completed") };
    }
    if (parsed?.tool_call && typeof parsed.tool_call === "object") {
      const tool = parsed.tool_call;
      const label = String(tool.name ?? tool.tool ?? tool.command ?? "Tool call").trim();
      const detail = String(tool.message ?? tool.summary ?? tool.result ?? "").trim();
      return { label, detail: detail || undefined };
    }
    if (parsed?.status && typeof parsed.status === "object") {
      const status = parsed.status;
      const label = String(status.message ?? status.label ?? status.type ?? "Runtime status").trim();
      const detail = String(status.detail ?? status.phase ?? "").trim();
      return { label, detail: detail || undefined };
    }
    if (type && !/^chat\.text$/i.test(type)) {
      return { label: message || type.replace(/^chat\./, "").replace(/[._-]+/g, " "), detail: message && message !== type ? type : undefined };
    }
    return null;
  }

  function compactProcessDetail(value: unknown, maxLength = 180) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function processLabelFromSessionMessage(message: any) {
    const role = String(message?.role ?? "").trim().toLowerCase();
    const content = String(message?.content ?? "").trim();
    if (!content) return null;
    if (role === "user" || role === "assistant") return null;
    if (role === "tool") {
      if (/\[Command interrupted\]/i.test(content)) return { label: "Command interrupted" };
      if (/Tool execution skipped/i.test(content)) return { label: "Tool execution skipped", detail: compactProcessDetail(content) };
      if (/\bexit\s+\d+\b/i.test(content)) return { label: "Command finished", detail: compactProcessDetail(content) };
      if (/Image loaded into your context/i.test(content)) return { label: "Image inspected", detail: compactProcessDetail(content.replace(/^Image loaded into your context\s*[—-]\s*/i, "")) };
      if (/^\s*\d+\|/m.test(content)) return { label: "File content read", detail: compactProcessDetail(content) };
      if (/^---\s*\nname:/i.test(content)) return { label: "Skill context loaded", detail: compactProcessDetail(content.match(/^name:\s*(.+)$/mi)?.[1] ?? content) };
      return { label: "Tool output", detail: compactProcessDetail(content) };
    }
    return { label: `${role || "Session"} message`, detail: compactProcessDetail(content) };
  }

  function yieldChatPaint() {
    return new Promise<void>((resolve) => window.setTimeout(resolve, 16));
  }

  function nextChatTextDelta(incoming: string, current: string) {
    if (!incoming) return "";
    if (!current) return incoming;
    if (incoming.startsWith(current)) return incoming.slice(current.length);
    if (current.endsWith(incoming)) return "";
    return incoming;
  }

  function compactRepeatedAssistantText(value: string) {
    const text = value.replace(/\r\n/g, "\n");
    const draftMatches = [...text.matchAll(/(?:^|\n)draft:\s*\n/gi)];
    if (draftMatches.length < 2) return value;
    const firstStart = draftMatches[0].index ?? 0;
    const secondStart = draftMatches[1].index ?? 0;
    const normalized = (content: string) => content.replace(/\s+/g, " ").trim().toLowerCase();
    const firstBody = normalized(text.slice(firstStart, secondStart));
    const secondBody = normalized(text.slice(secondStart));
    if (!firstBody || !secondBody) return value;
    if (firstBody.startsWith(secondBody) || secondBody.startsWith(firstBody)) {
      return text.slice(0, secondStart).trimEnd();
    }
    return value;
  }

  function extractGeneratedKanbanTask(rawText: string, fallbackTitle: string) {
    const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const objectText = fenced ?? rawText.match(/\{[\s\S]*\}/)?.[0] ?? rawText;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(objectText);
    } catch {
      const looseTitle = objectText.match(/["']title["']\s*:\s*["']([^"'\n\r]+)/i)?.[1]?.trim();
      return {
        title: cleanGeneratedKanbanTitle(looseTitle, fallbackTitle),
        body: rawText.trim(),
        priority: "normal",
      };
    }
    const title = cleanGeneratedKanbanTitle(parsed.title, fallbackTitle);
    const bodyParts = [
      parsed.body,
      Array.isArray(parsed.acceptanceCriteria) && parsed.acceptanceCriteria.length
        ? `Acceptance criteria:\n${parsed.acceptanceCriteria.map((item) => `- ${String(item).trim()}`).filter(Boolean).join("\n")}`
        : "",
      Array.isArray(parsed.context) && parsed.context.length
        ? `Context:\n${parsed.context.map((item) => `- ${String(item).trim()}`).filter(Boolean).join("\n")}`
        : "",
    ].map((value) => String(value ?? "").trim()).filter(Boolean);
    return {
      title,
      body: bodyParts.join("\n\n") || String(parsed.summary ?? rawText).trim(),
      priority: ["low", "normal", "high", "urgent"].includes(parsed.priority) ? parsed.priority : "normal",
    };
  }

  function cleanGeneratedKanbanTitle(value: unknown, fallbackTitle: string) {
    const title = normalizeGeneratedKanbanTitle(String(value ?? ""));
    const placeholder = /^(short imperative task title|specific action for the next agent|task title|untitled task)$/i.test(title);
    return placeholder ? fallbackTitle || "Follow up from chat" : title || fallbackTitle || "Follow up from chat";
  }

  function normalizeGeneratedKanbanTitle(value: string) {
    const title = value
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
    if (/\s/.test(title) || !/^[A-Za-z]{16,80}$/.test(title)) return title;
    const knownWords = [
      "acceptance", "animation", "browser", "desktop", "dispatch", "emoji", "generate", "implement",
      "interaction", "kanban", "mobile", "playful", "progress", "responsive", "tooltip", "website",
      "build", "card", "chat", "copy", "create", "draft", "fix", "page", "plan", "send", "task", "test",
      "add", "app", "ui",
    ].sort((a, b) => b.length - a.length);
    const words: string[] = [];
    let remaining = title.toLowerCase();
    while (remaining) {
      const match = knownWords.find((word) => remaining.startsWith(word));
      if (!match) return title;
      words.push(match);
      remaining = remaining.slice(match.length);
    }
    if (words.length < 2) return title;
    return `${words[0].charAt(0).toUpperCase()}${words[0].slice(1)} ${words.slice(1).join(" ")}`;
  }

  function kanbanBodyWithFullSource(taskBody: string, sourceContent: string) {
    const body = taskBody.trim();
    const source = sourceContent.trim();
    if (!source) return body;
    return [
      body,
      "Full source task from chat:",
      source,
    ].filter(Boolean).join("\n\n");
  }
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
    setVaultSyncStatus(data ?? { ok: false, error: "Tailnet vault sync request failed." });
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
    const data = await pairSyncthingCollector({
      remoteCollectorUrl: /^https?:\/\//.test(cleanHost) ? cleanHost : `http://${cleanHost}:8787`,
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
    const ElementCtor = globalThis.Element;
    const target = ElementCtor && event.target instanceof ElementCtor
      ? event.target.closest("[data-brain-node-id]") as HTMLElement | null
      : null;
    brainDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: brainPan.x,
      panY: brainPan.y,
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
    setBrainPan({ x: drag.panX - dx, y: drag.panY - dy });
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

  function handleChatFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void addChatFiles(event.target.files, "file");
    event.target.value = "";
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
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const binSize = Math.max(1, Math.floor(data.length / bands));
      const next = Array.from({ length: bands }, (_, index) => {
        const start = index * binSize;
        const slice = data.slice(start, start + binSize);
        const average = slice.reduce((total, value) => total + value, 0) / Math.max(1, slice.length);
        return Math.min(1, average / 180);
      });
      setVoiceBands(next);
      voiceAnimationRef.current = window.requestAnimationFrame(tick);
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

  /* eslint-disable react-hooks/purity */
  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (recording) {
      stopAudioRecording();
      return;
    }
    const prompt = (text ?? "").trim();
    const form = event.currentTarget as HTMLFormElement | null;
    const submittedAgentMode = String(form ? new FormData(form).get("agentMode") ?? "" : "");
    const agentMode = submittedAgentMode === "plan" ? "plan" : "act";
    const outgoingAttachments = chatAttachments;
    const outgoingDirectories = chatDirectories;
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
      queuedAt: Date.now(),
    };
    if (busy) {
      queueChatMessage(queuedMessage);
      return;
    }
    await runChatMessage(queuedMessage);
  }

  async function runChatMessage(queuedMessage: any) {
    const selectedAgent = queuedMessage.agent;
    const selectedChatLeafKey = queuedMessage.leafKey;
    const selectedChatDirectoryPath = queuedMessage.directoryPath;
    const prompt = queuedMessage.prompt;
    const agentMode = queuedMessage.agentMode === "plan" ? "plan" : "act";
    const outgoingAttachments = queuedMessage.attachments ?? [];
    const outgoingDirectories = queuedMessage.directories ?? [];
    const sameChatMessage = (left: ChatMessage | undefined, right: ChatMessage) => (
      Boolean(left)
      && left?.role === right.role
      && (left?.content ?? "").trim() === (right.content ?? "").trim()
      && (left?.attachments?.length ?? 0) === (right.attachments?.length ?? 0)
      && Boolean(left?.agentPrompt) === Boolean(right.agentPrompt)
    );
    const appendPreviewMessages = (agentId: string, leafKey: string, appendedMessages: ChatMessage[]) => {
      setSelectedChatPreview((current) => {
        if (!current || current.agentId !== agentId || current.leafKey !== leafKey) return current;
        const next = [...current.messages];
        for (const message of appendedMessages) {
          if (sameChatMessage(next.at(-1), message)) continue;
          let previousUserIndex = -1;
          for (let index = next.length - 1; index >= 0; index -= 1) {
            if (next[index].role === "user" && next[index].content.trim() === message.content.trim()) {
              previousUserIndex = index;
              break;
            }
          }
          const between = previousUserIndex >= 0 ? next.slice(previousUserIndex + 1) : [];
          const duplicateActiveUser = message.role === "user" && between.length > 0 && between.every((item) => (
            item.role === "assistant"
            && !(item.content ?? "").trim()
            && !item.agentPrompt
          ));
          if (duplicateActiveUser) continue;
          next.push(message);
        }
        return { ...current, messages: next };
      });
    };
    const dashboardCommand = outgoingAttachments.length === 0 && outgoingDirectories.length === 0
      ? resolveDashboardSlashCommand(prompt)
      : null;
    if (dashboardCommand) {
      const selectedStorageKey = chatMessageStorageKey(selectedAgent.id, selectedChatLeafKey);
      const userMessage = { role: "user", content: prompt, surface: "chat" };
      const assistantMessage = { role: "assistant", content: dashboardCommand.reply, surface: "chat" };
      appendMessage(selectedAgent.id, userMessage, selectedStorageKey);
      appendMessage(selectedAgent.id, assistantMessage, selectedStorageKey);
      appendPreviewMessages(selectedAgent.id, selectedChatLeafKey, [userMessage, assistantMessage]);
      setText("");
      setAttachmentError("");
      setAttachmentMenuOpen(false);
      setActiveView?.(dashboardCommand.view);
      if (dashboardCommand.refresh === "diagnostics") void refreshMaintenanceReport?.();
      if (dashboardCommand.refresh === "sessions") void searchAllRuntimeSessions?.("");
      if (dashboardCommand.refresh === "usage") void refreshRuntimeUsage?.();
      if (dashboardCommand.refresh === "notifications") void refreshNotifications?.();
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
    setText("");
    setChatAttachments([]);
    setChatDirectories([]);
    setAttachmentError("");
    setAttachmentMenuOpen(false);
    const requestStartedAt = Date.now();
    const taskId = `${selectedAgent.id}-${requestStartedAt}`;
    const workingDirectory = selectedChatDirectoryPath || selectedAgent.localDataDir || "";
    const selectedStorageKey = chatMessageStorageKey(selectedAgent.id, selectedChatLeafKey);
    const requestRuntimeSessionId = chatRuntimeSessionIdsByKey?.[selectedStorageKey] || selectedChatRuntimeSessionId;
    startChatStream(selectedStorageKey, selectedAgent.id, selectedChatLeafKey, outgoingLabel);
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
    const pendingAssistantMessage: ChatMessage = { role: "assistant", content: "", surface: "chat" };
    appendMessage(selectedAgent.id, outgoingUserMessage, selectedStorageKey);
    appendMessage(selectedAgent.id, pendingAssistantMessage, selectedStorageKey);
    appendPreviewMessages(selectedAgent.id, selectedChatLeafKey, [outgoingUserMessage, pendingAssistantMessage]);

    const replacePendingAssistant = (message: ChatMessage) => {
      setMessagesByAgent((current) => {
        const existing = current[selectedStorageKey] ?? [];
        const next = [...existing];
        if (next.length) next[next.length - 1] = message;
        else next.push(message);
        return { ...current, [selectedStorageKey]: next };
      });
      setSelectedChatPreview((current) => {
        if (!current || current.agentId !== selectedAgent.id || current.leafKey !== selectedChatLeafKey) return current;
        const next = [...current.messages];
        if (next.length) next[next.length - 1] = message;
        else next.push(message);
        return { ...current, messages: next };
      });
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
    let sessionPollTimer: number | null = null;
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
          status: "active",
        });
        if (attachedRuntimeSessionId !== sessionId) {
          attachedRuntimeSessionId = sessionId;
          appendChatProcess(selectedStorageKey, `Attached ${runtimeLabel} session`, sessionId);
        }
      }
      const sessionMessages = Array.isArray(session.messages) ? session.messages : [];
      for (const sessionMessage of sessionMessages) {
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
          appendChatProcess(selectedStorageKey, processEvent.label, processEvent.detail);
        }
        if (String(sessionMessage?.role ?? "").toLowerCase() === "assistant") {
          recoveredAssistantText += String(sessionMessage?.content ?? "");
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
        sinceMs: currentRuntimeSessionId ? undefined : requestStartedAt - 2_000,
        chatStorageKey: selectedStorageKey,
      });
      if (!response?.ok && currentRuntimeSessionId) {
        response = await fetchSession({ agent: selectedAgent, sinceMs: requestStartedAt - 2_000, chatStorageKey: selectedStorageKey });
      }
      if (!response?.ok) return;
      const data = await response.json().catch(() => null);
      if (data?.ok && data.session) ingestRuntimeSession(data.session);
    };

    sessionPollTimer = window.setInterval(() => {
      void pollRuntimeSession();
    }, 5_000);
    void pollRuntimeSession();

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
            if (label) appendChatProcess(selectedStorageKey, label);
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
          };
          const runtimeError = runtimeErrorMessage(parsed);
          if (runtimeError) throw new Error(runtimeError);
          if (parsed.honey) {
            await refreshHoneyLedger();
            continue;
          }
          const processEvent = processLabelFromRuntimeEvent(parsed);
          if (processEvent) appendChatProcess(selectedStorageKey, processEvent.label, processEvent.detail, processEvent.status);
          if (parsed.session?.id) {
            appendChatProcess(selectedStorageKey, `Attached ${runtimeLabel} session`, parsed.session.id);
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
            if (!sawAssistantContent) appendChatProcess(selectedStorageKey, "Assistant started writing", undefined, "completed");
            markChatStreamChunk(selectedStorageKey);
            sawAssistantContent = true;
            let nextTaskMessage = "";
            setMessagesByAgent((current) => {
              const existing = current[selectedStorageKey] ?? [];
              const next = [...existing];
              const last = next[next.length - 1];
              if (!last) {
                nextTaskMessage = textDelta;
                next.push({ role: "assistant", content: textDelta, surface: "chat" });
              } else {
                const existingText = last.content ?? "";
                const localDelta = nextChatTextDelta(textDelta, existingText);
                if (!localDelta) return current;
                nextTaskMessage = compactRepeatedAssistantText(existingText + localDelta);
                next[next.length - 1] = { ...last, content: nextTaskMessage };
              }
              return { ...current, [selectedStorageKey]: next };
            });
            setSelectedChatPreview((current) => {
              if (!current || current.agentId !== selectedAgent.id || current.leafKey !== selectedChatLeafKey) return current;
              const next = [...current.messages];
              const last = next[next.length - 1];
              if (!last) {
                next.push({ role: "assistant", content: textDelta, surface: "chat" });
              } else {
                const existingText = last.content ?? "";
                const localDelta = nextChatTextDelta(textDelta, existingText);
                if (!localDelta) return current;
                next[next.length - 1] = { ...last, content: compactRepeatedAssistantText(existingText + localDelta) };
              }
              return { ...current, messages: next };
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
      if (!sawAssistantContent) {
        const message = `${selectedAgent.name || selectedAgent.runtime || "The agent"} finished without returning any text for this message. No runtime error was reported.`;
        replacePendingAssistant({ role: "assistant", content: `Error: ${message}`, surface: "chat" });
        updateTask(taskId, { status: "failed", lastMessage: message, completedAt: Date.now() });
        return;
      }
      updateTask(taskId, sawAgentPrompt ? { status: "active", completedAt: undefined } : { status: "completed", completedAt: Date.now() });
    } catch (error) {
      const aborted = abortController.signal.aborted;
      if (aborted) {
        appendChatProcess(selectedStorageKey, "Chat stream timed out", `Checking the ${runtimeLabel} session for late activity.`);
        recordActiveChatRun?.({
          storageKey: selectedStorageKey,
          agentId: selectedAgent.id,
          leafKey: selectedChatLeafKey,
          startedAt: requestStartedAt,
          updatedAt: Date.now(),
          requestLabel: outgoingLabel,
          sessionId: currentRuntimeSessionId || undefined,
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
        : error instanceof Error ? error.message : "Unknown runtime error";
      const errorMessage: ChatMessage = { role: "assistant", content: `Error: ${message}`, surface: "chat" };
      replacePendingAssistant(errorMessage);
      updateTask(taskId, { status: "failed", lastMessage: message, completedAt: Date.now() });
    } finally {
      window.clearTimeout(stallTimer);
      if (sessionPollTimer) window.clearInterval(sessionPollTimer);
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
  /* eslint-enable react-hooks/purity */

  return { checkStatus, checkVaultStatus, checkControlRoomStatus, runVaultTailnetSync, pairSyncthingCollector, pairSyncthingVaultSync, inspectBrainNode, startBrainPan, moveBrainPan, endBrainPan, addChatFiles, handleChatFileChange, handleChatImageChange, removeChatAttachment, attachChatDirectory, attachChatRecentDirectory, removeChatDirectory, addQuickAddFiles, handleQuickAddFileChange, handleQuickAddImageChange, removeQuickAddAttachment, attachQuickAddDirectory, attachQuickAddRecentDirectory, removeQuickAddDirectory, addKanbanSteerFiles, handleKanbanSteerFileChange, handleKanbanSteerImageChange, removeKanbanSteerAttachment, attachKanbanSteerDirectory, attachKanbanSteerRecentDirectory, removeKanbanSteerDirectory, updateVoiceTranscript, appendVoiceTranscriptToInput, cleanupVoiceCapture, startVoiceWaveform, startAudioRecording, stopAudioRecording, sendMessage, queuedChatMessages, flushingChatQueueId, removeQueuedChatMessage, sendQueuedChatMessageNow, generateKanbanTaskFromChat, dismissChatKanbanGeneration, chatKanbanGeneration };
}
