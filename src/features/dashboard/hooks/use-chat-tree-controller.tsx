// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

/* eslint-disable react-hooks/immutability, react-hooks/purity */

import { useCallback, useEffect, useMemo, useState } from "react";
import { stripJsonRenderPayload } from "@/components/json-render/JsonRenderSurface";
import { createNativeLocalFolder } from "@/lib/native/filesystem";
import { runtimeSettingsFeature } from "@/lib/types/agent-runtime";
import { chatTelemetryMessages, chatTelemetrySession } from "@/lib/services/telemetry/chat-dev-telemetry";

function isAutomationHydratedTranscript(messages: Array<{ content?: string }> = []) {
  const transcript = messages.slice(0, 8).map((message) => message.content ?? "").join("\n");
  if (/\[IMPORTANT:\s*The user has invoked the "[^"]+" skill/i.test(transcript)) return true;
  if (/running as a scheduled cron job/i.test(transcript)) return true;
  if (/user has invoked the "[^"]+" skill/i.test(transcript)) return true;
  return false;
}

function isRuntimeDataDirectory(path?: string) {
  const normalized = path?.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return false;
  const segments = normalized.split("/").filter(Boolean);
  return segments.some((segment) => [".hermes", ".openclaw", ".aeon"].includes(segment.toLowerCase()));
}

function projectDirectoryPath(path?: string) {
  const trimmed = path?.trim() ?? "";
  return trimmed && !isRuntimeDataDirectory(trimmed) ? trimmed : "";
}

function chatStorageIdentity(storageKey: string) {
  const separatorIndex = storageKey.indexOf("::");
  const agentId = separatorIndex === -1 ? storageKey : storageKey.slice(0, separatorIndex);
  const leafKey = separatorIndex === -1 ? `agent-${agentId}` : storageKey.slice(separatorIndex + 2);
  return { agentId, leafKey };
}

function hasReadableChatMessages(messages: ChatMessage[] = [], isManualAgentChatMessage: (message: ChatMessage) => boolean) {
  return messages.some((message) => isManualAgentChatMessage(message) && message.content.trim());
}

function chatSearchContent(messages: ChatMessage[] = []) {
  return messages
    .slice(-80)
    .map((message) => stripJsonRenderPayload(message.content ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 24000);
}

function chatPreviewContent(message?: ChatMessage) {
  return stripJsonRenderPayload(message?.content ?? "").trim();
}

function chatLeafMatchesAgentId(leafKey: string, agentId: string) {
  return leafKey === `agent-${agentId}`
    || leafKey.endsWith(`-${agentId}`)
    || leafKey.startsWith(`task-${agentId}-`);
}

function chatLeafOwnerAgentId({
  displayAgents,
  isManualAgentChatMessage,
  leafKey,
  messagesByAgent,
  preferredAgentId,
}: {
  displayAgents: AgentProfile[];
  isManualAgentChatMessage: (message: ChatMessage) => boolean;
  leafKey: string;
  messagesByAgent: Record<string, ChatMessage[]>;
  preferredAgentId?: string;
}) {
  if (!leafKey) return "";
  const candidates = Object.entries(messagesByAgent)
    .map(([storageKey, messages]) => ({ ...chatStorageIdentity(storageKey), messages }))
    .filter((item) => item.leafKey === leafKey && hasReadableChatMessages(item.messages, isManualAgentChatMessage))
    .sort((left, right) => (
      Math.max(...right.messages.map((message) => Number(message.createdAt || 0)), 0)
      - Math.max(...left.messages.map((message) => Number(message.createdAt || 0)), 0)
    ));
  const preferredCandidate = candidates.find((item) => item.agentId === preferredAgentId);
  if (preferredCandidate) return preferredCandidate.agentId;
  if (candidates[0]?.agentId) return candidates[0].agentId;
  const knownAgent = displayAgents.find((agent) => chatLeafMatchesAgentId(leafKey, agent.id));
  return knownAgent?.id ?? preferredAgentId ?? "";
}

export function useChatTreeController(props: any) {
  const { RUNTIME_CAPABILITIES, RUNTIME_DEFAULTS, RUNTIME_KINDS, RUNTIME_LABELS, activeView, agentWorkById, chatCustomFolders, chatDedupeKey, chatFolderDraft, chatMessageStorageKey, chatMessageWindow, chatPreviewDedupeKey, chatSeedMessagesForTask, chooseDirectoryForMachine, createChatLeafKey, displayAgents, findRosterChatTask, runtimeSessionIdFromTask, isChatSidebarTask, isManualAgentChatMessage, logClientTelemetry, machineGroups, messagesByAgent, parentPathFromPath, preferChatTreeItem, recordRecentDirectory, runtimeCan, runtimeSessionForChat, selectedAgent, selectedAgentId, selectedChatDirectoryPath, selectedChatLeafKey, setActiveView, setChatCustomFolders, setChatFolderDraft, setChatHistoryLoadingByKey, setChatMessageWindow, setMessagesByAgent, setSelectedAgentId, setSelectedChatDirectoryPath, setSelectedChatLeafKey, setSelectedChatPreview, setSelectedChatRuntimeSessionId, setSetupCommandCopied, setSetupMachineKey, setupCollectorCommand, setStatus, setStatusAgentId, taskChatLeafKey, updateAgent, workPriority, workspaceLabelFromPath } = props;
  const [freshChatDraft, setFreshChatDraft] = useState<{ agentId: string; leafKey: string } | null>(null);
  function switchRuntime(runtime: AgentRuntime) {
    const defaults = RUNTIME_DEFAULTS[runtime];
    const runtimeSettings = runtimeSettingsFeature(runtime);
    const autopilotRuntime = runtimeSettings.kind === "autopilot";
    updateAgent({
      runtime,
      gatewayUrl: defaults.gatewayUrl,
      chatPath: defaults.chatPath,
      statusPath: defaults.statusPath,
      agentId: runtimeSettings.defaultAgentId || selectedAgent?.agentId || "",
      runtimeKind: RUNTIME_KINDS[runtime],
      runtimeCapabilities: RUNTIME_CAPABILITIES[runtime],
      a2aUrl: autopilotRuntime ? defaults.gatewayUrl : undefined,
      aeonBranch: autopilotRuntime ? "main" : undefined,
      aeonMode: autopilotRuntime ? "github" : undefined,
    });
  }

  function appendMessage(agentId: string, message: ChatMessage, storageKey = agentId) {
    logClientTelemetry("chat.message.appended", {
      agentId,
      storageKey,
      role: message.role,
      kanbanTaskId: message.kanbanTaskId ?? null,
      surface: message.surface ?? null,
      contentLength: message.content.length,
      attachmentCount: message.attachments?.length ?? 0,
    });
    setMessagesByAgent((current) => ({
      ...current,
      [storageKey]: [...(current[storageKey] ?? []), { ...message, createdAt: message.createdAt ?? Date.now() }],
    }));
  }

  const hasConversation = useCallback((agentId: string) => {
    return (messagesByAgent[agentId] ?? []).some((message) => (
      message.role !== "system"
      && isManualAgentChatMessage(message)
      && message.content.trim()
    ));
  }, [messagesByAgent]);

  const conversationTitle = useCallback((agentId: string) => {
    const firstUser = (messagesByAgent[agentId] ?? [])
      .find((message) => message.role === "user" && isManualAgentChatMessage(message))
    const firstUserMessage = chatPreviewContent(firstUser);
    return firstUserMessage ? firstUserMessage.slice(0, 56) : "Previous chat";
  }, [messagesByAgent]);

  const loadRuntimeSessionMessages = useCallback(async (agent: AgentProfile, sessionId: string, context: { leafKey?: string; storageKey?: string; reason?: string } = {}) => {
    const startedAt = Date.now();
    logClientTelemetry("chat.runtime_session.fetch.start", {
      agentId: agent.id,
      agentName: agent.name,
      runtime: agent.runtime,
      sessionId,
      leafKey: context.leafKey ?? null,
      reason: context.reason ?? null,
    }, { threadId: context.storageKey, runId: sessionId });
    const response = await fetch("/api/chat/agent-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, sessionId }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as {
      ok?: boolean;
      session?: {
        sessionId?: string;
        messages?: Array<{ role?: string; content?: string; createdAt?: number; index?: number }>;
      };
    } | null;
    const messages = (data?.session?.messages ?? [])
      .filter((message) => (
        (message.role === "user" || message.role === "assistant")
        && typeof message.content === "string"
        && message.content.trim()
      ))
      .map((message): ChatMessage => ({
        role: message.role as "user" | "assistant",
        content: message.content!.trim(),
        createdAt: Number(message.createdAt || 0) || undefined,
        sourceSessionId: data?.session?.sessionId ?? sessionId,
        sourceIndex: Number.isFinite(Number(message.index)) ? Number(message.index) : undefined,
      }));
    logClientTelemetry("chat.runtime_session.fetch.response", {
      agentId: agent.id,
      sessionId,
      leafKey: context.leafKey ?? null,
      reason: context.reason ?? null,
      ok: Boolean(response?.ok && data?.ok),
      status: response?.status ?? null,
      elapsedMs: Date.now() - startedAt,
      visibleMessageCount: messages.length,
      visibleMessages: chatTelemetryMessages(messages),
      session: chatTelemetrySession(data?.session),
    }, { threadId: context.storageKey, runId: sessionId });
    return messages;
  }, [logClientTelemetry]);

  function hasLocalInFlightChat(existing: ChatMessage[], hydratedMessages: ChatMessage[]) {
    const hydratedUser = hydratedMessages.find((message) => message.role === "user" && message.content.trim());
    if (!hydratedUser) return false;
    const hasMatchingLocalUser = existing.some((message) => (
      message.role === "user"
      && !message.sourceSessionId
      && message.content.trim() === hydratedUser.content.trim()
    ));
    if (!hasMatchingLocalUser) return false;
    return existing.some((message) => (
      message.role === "assistant"
      && !message.sourceSessionId
      && !message.content.trim()
    ));
  }

  const hydrateRuntimeSessionChat = useCallback(async (agent: AgentProfile, sessionId: string, leafKey: string) => {
    const startedAt = Date.now();
    const storageKey = chatMessageStorageKey(agent.id, leafKey);
    logClientTelemetry("chat.runtime_session.hydrate.start", {
      agentId: agent.id,
      sessionId,
      leafKey,
      storageKey,
    }, { threadId: storageKey, runId: sessionId });
    setChatHistoryLoadingByKey?.((current: Record<string, boolean>) => (
      current[storageKey] ? current : { ...current, [storageKey]: true }
    ));
    try {
      const hydratedMessages = await loadRuntimeSessionMessages(agent, sessionId, { leafKey, storageKey, reason: "hydrate" });
      if (!hydratedMessages.length) {
        logClientTelemetry("chat.runtime_session.hydrate.empty", {
          agentId: agent.id,
          sessionId,
          leafKey,
          storageKey,
          elapsedMs: Date.now() - startedAt,
        }, { threadId: storageKey, runId: sessionId });
        return;
      }

      if (isAutomationHydratedTranscript(hydratedMessages)) {
        logClientTelemetry("chat.runtime_session.hydrate.automation_skipped", {
          agentId: agent.id,
          sessionId,
          leafKey,
          storageKey,
          messageCount: hydratedMessages.length,
          elapsedMs: Date.now() - startedAt,
        }, { threadId: storageKey, runId: sessionId });
        setMessagesByAgent((current) => {
          if (!current[storageKey]) return current;
          const next = { ...current };
          delete next[storageKey];
          return next;
        });
        setSelectedChatPreview((current) => (
          current?.agentId === agent.id && current.leafKey === leafKey ? null : current
        ));
        return;
      }
      setMessagesByAgent((current) => {
        const existing = current[storageKey] ?? [];
        const userSentAfterOpen = existing.some((message) => (
          message.role === "user"
          && !message.sourceSessionId
            && Number(message.createdAt || 0) >= startedAt
        ));
        logClientTelemetry("chat.runtime_session.hydrate.replace_decision", {
          agentId: agent.id,
          sessionId,
          leafKey,
          storageKey,
          existingMessageCount: existing.length,
          hydratedMessageCount: hydratedMessages.length,
          userSentAfterOpen,
          hasLocalInFlightChat: hasLocalInFlightChat(existing, hydratedMessages),
          existingMessages: chatTelemetryMessages(existing),
          hydratedMessages: chatTelemetryMessages(hydratedMessages),
        }, { threadId: storageKey, runId: sessionId });
        return userSentAfterOpen || hasLocalInFlightChat(existing, hydratedMessages)
          ? current
          : { ...current, [storageKey]: hydratedMessages };
      });
      setSelectedChatPreview((current) => (
        current?.agentId === agent.id && current.leafKey === leafKey
          ? hasLocalInFlightChat(current.messages, hydratedMessages) ? current : { ...current, messages: hydratedMessages }
          : current
      ));
      logClientTelemetry("chat.runtime_session.hydrate.completed", {
        agentId: agent.id,
        sessionId,
        leafKey,
        storageKey,
        messageCount: hydratedMessages.length,
        elapsedMs: Date.now() - startedAt,
      }, { threadId: storageKey, runId: sessionId });
      return hydratedMessages;
    } finally {
      setChatHistoryLoadingByKey?.((current: Record<string, boolean>) => {
        if (!current[storageKey]) return current;
        const next = { ...current };
        delete next[storageKey];
        return next;
      });
    }
  }, [chatMessageStorageKey, loadRuntimeSessionMessages, setChatHistoryLoadingByKey, setMessagesByAgent, setSelectedChatPreview]);

  const startAgentChat = useCallback((agentId: string, options: { fresh?: boolean; messageLimit?: number; seedMessages?: ChatMessage[]; chatLeafKey?: string; workingDirectoryPath?: string; runtimeSessionId?: string } = {}) => {
    const agent = displayAgents.find((item) => item.id === agentId);
    if (!runtimeCan(agent, "chat")) return;
    if (!agent) return;
    const leafBase = options.chatLeafKey ?? `agent-${agentId}`;
    const leafKey = options.fresh ? createChatLeafKey(agentId, leafBase.replace(new RegExp(`-${agentId}$`), "")) : leafBase;
    const machine = machineGroups.find((group) => group.agents.some((item) => item.id === agentId));
    setFreshChatDraft(options.fresh ? { agentId, leafKey } : null);
    setSelectedAgentId(agentId);
    setSelectedChatLeafKey(leafKey);
    setSelectedChatRuntimeSessionId(runtimeSessionForChat(agent, leafKey, options.runtimeSessionId));
    setSelectedChatDirectoryPath(projectDirectoryPath(options.workingDirectoryPath ?? machine?.version?.appDir));
    setSelectedChatPreview(options.seedMessages?.length ? { agentId, leafKey, messages: options.seedMessages } : null);
    setActiveView("chat");
    setStatus(null);
    setStatusAgentId("");
    setChatMessageWindow(options.messageLimit ? { agentId, limit: options.messageLimit } : null);
    if (options.fresh) {
      const storageKey = chatMessageStorageKey(agentId, leafKey);
      setMessagesByAgent((current) => ({ ...current, [storageKey]: [] }));
    } else if (options.seedMessages?.length) {
      const storageKey = chatMessageStorageKey(agentId, leafKey);
      setMessagesByAgent((current) => {
        const existing = current[storageKey] ?? [];
        const hasExistingConversation = existing.some((message) => message.role !== "system" && message.content.trim());
        return hasExistingConversation ? current : { ...current, [storageKey]: options.seedMessages ?? [] };
      });
    }
  }, [displayAgents, machineGroups]);

  const openRuntimeSessionChat = useCallback((agent: AgentProfile, sessionId: string, options: { seedMessages?: ChatMessage[]; chatLeafKey: string; workingDirectoryPath?: string }) => {
    void (async () => {
      const hydratedMessages = await hydrateRuntimeSessionChat(agent, sessionId, options.chatLeafKey);
      startAgentChat(agent.id, {
        seedMessages: hydratedMessages?.length ? hydratedMessages : options.seedMessages,
        chatLeafKey: options.chatLeafKey,
        workingDirectoryPath: options.workingDirectoryPath,
        runtimeSessionId: sessionId,
      });
    })();
  }, [hydrateRuntimeSessionChat, startAgentChat]);

  const chatHistoryByAgent = useMemo(() => {
    const byAgent = new Map<string, ChatTreeItem[]>();
    for (const [storageKey, storedMessages] of Object.entries(messagesByAgent)) {
      const { agentId, leafKey: storedLeafKey } = chatStorageIdentity(storageKey);
      if (!agentId || !storedLeafKey || storedLeafKey === `agent-${agentId}` || storedLeafKey.startsWith("task-")) continue;
      const manualMessages = storedMessages.filter(isManualAgentChatMessage);
      if (!manualMessages.some((message) => chatPreviewContent(message))) continue;
      if (isAutomationHydratedTranscript(manualMessages)) continue;
      const firstUser = manualMessages.find((message) => message.role === "user" && chatPreviewContent(message));
      const lastMessage = [...manualMessages].reverse().find((message) => chatPreviewContent(message));
      const item: ChatTreeItem = {
        agentId,
        key: storedLeafKey,
        title: chatPreviewContent(firstUser).slice(0, 56) || "Previous chat",
        subtitle: chatPreviewContent(lastMessage).slice(0, 80) || agentId,
        updatedAt: Math.max(...manualMessages.map((message) => Number(message.createdAt || 0))),
        rank: 4,
        active: selectedAgentId === agentId && selectedChatLeafKey === storedLeafKey,
        searchText: chatSearchContent(manualMessages),
        onOpen: () => startAgentChat(agentId, { chatLeafKey: storedLeafKey }),
      };
      byAgent.set(agentId, [...(byAgent.get(agentId) ?? []), item]);
    }
    return byAgent;
  }, [isManualAgentChatMessage, messagesByAgent, selectedAgentId, selectedChatLeafKey, startAgentChat]);

  useEffect(() => {
    if (activeView !== "chat" || !selectedChatLeafKey) return;
    const ownerAgentId = chatLeafOwnerAgentId({
      displayAgents,
      isManualAgentChatMessage,
      leafKey: selectedChatLeafKey,
      messagesByAgent,
      preferredAgentId: selectedAgentId,
    });
    if (!ownerAgentId || ownerAgentId === selectedAgentId) return;
    setSelectedAgentId(ownerAgentId);
  }, [activeView, displayAgents, isManualAgentChatMessage, messagesByAgent, selectedAgentId, selectedChatLeafKey, setSelectedAgentId]);

  const startAgentWorkChat = useCallback((agentId: string, displayedTask?: string) => {
    const agent = displayAgents.find((item) => item.id === agentId);
    const agentWork = agentWorkById[agentId] ?? [];
    const match = findRosterChatTask(agentWork, displayedTask);
    if (!match) {
      startAgentChat(agentId);
      return;
    }
    const { task, index: taskIndex } = match;
    const leafKey = taskChatLeafKey(agentId, task, taskIndex);
    const runtimeSessionId = runtimeSessionIdFromTask(task);
    const seedMessages = chatSeedMessagesForTask(task);
    if (agent && runtimeSessionId) {
      openRuntimeSessionChat(agent, runtimeSessionId, {
        seedMessages,
        chatLeafKey: leafKey,
        workingDirectoryPath: task.workingDirectory,
      });
      return;
    }
    startAgentChat(agentId, {
      messageLimit: 5,
      seedMessages,
      chatLeafKey: leafKey,
      workingDirectoryPath: task.workingDirectory,
    });
  }, [agentWorkById, displayAgents, openRuntimeSessionChat, startAgentChat]);

  function openChatFolderCreator(machine: MachineGroup) {
    const chatAgents = machine.agents.filter((agent) => runtimeCan(agent, "chat"));
    const agent = chatAgents[0];
    if (!agent) return;
    void chooseDirectoryForMachine?.({
      key: machine.key,
      name: machine.name,
      collectorUrl: machine.collectorUrl,
    }, (directory) => {
      const path = directory.path?.trim();
      if (!path) {
        setStatus("Could not start a chat for that folder because the picker did not return a usable path.");
        setStatusAgentId(agent.id);
        return;
      }
      const label = directory.name || workspaceLabelFromPath(path);
      const linkedDirectory = { ...directory, name: label, path };
      const nextFolder: ChatCustomFolder = {
        id: `${machine.key}-${Date.now()}`,
        machineKey: machine.key,
        label,
        path,
        agentId: agent.id,
        createdAt: Date.now(),
      };
      setChatCustomFolders((current) => [
        nextFolder,
        ...current.filter((folder) => !(folder.machineKey === nextFolder.machineKey && folder.path === nextFolder.path)),
      ]);
      void recordRecentDirectory?.(linkedDirectory, {
        machineName: linkedDirectory.machineName ?? machine.name,
        machineKey: linkedDirectory.machineKey ?? machine.key,
        source: "chat",
      });
      startAgentChat(agent.id, {
        fresh: true,
        workingDirectoryPath: path,
        chatLeafKey: `folder-${machine.key}-${chatDedupeKey(path)}-${agent.id}`,
      });
    });
  }

  async function changeChatWorkingDirectory() {
    if (!selectedAgent) return;
    const machine = machineGroups.find((group) => group.agents.some((agent) => agent.id === selectedAgent.id));
    if (!machine) {
      setStatus("Choose a connected machine before changing the chat working directory.");
      setStatusAgentId(selectedAgent.id);
      return;
    }
    await chooseDirectoryForMachine?.({
      key: machine.key,
      name: machine.name,
      collectorUrl: machine.collectorUrl,
    }, (directory) => {
      const path = directory.path?.trim();
      if (!path) {
        setStatus("The directory picker did not return a usable path.");
        setStatusAgentId(selectedAgent.id);
        return;
      }

      const label = directory.name || workspaceLabelFromPath(path);
      const linkedDirectory = { ...directory, name: label, path };
      const existingFolder = chatCustomFolders.some((folder) => folder.machineKey === machine.key && folder.path === path)
        || machine.version?.appDir === path;
      const hasProjectChat = Boolean(selectedChatDirectoryPath && selectedChatLeafKey);
      const sourceStorageKey = chatMessageStorageKey(selectedAgent.id, selectedChatLeafKey);
      const sourceMessages = messagesByAgent[sourceStorageKey] ?? [];
      const hasMessages = sourceMessages.some((message) => isManualAgentChatMessage(message) && message.content.trim());
      const nextLeafKey = `folder-${machine.key}-${chatDedupeKey(path)}-${selectedAgent.id}`;
      const targetStorageKey = chatMessageStorageKey(selectedAgent.id, nextLeafKey);
      const shouldMove = hasProjectChat && hasMessages && sourceStorageKey !== targetStorageKey
        ? window.confirm(existingFolder
          ? `Move this chat to ${label}?`
          : `Create ${label} in chat history and move this chat there?`)
        : false;

      if (!existingFolder || shouldMove) {
        const nextFolder: ChatCustomFolder = {
          id: `${machine.key}-${Date.now()}`,
          machineKey: machine.key,
          label,
          path,
          agentId: selectedAgent.id,
          createdAt: Date.now(),
        };
        setChatCustomFolders((current) => [
          nextFolder,
          ...current.filter((folder) => !(folder.machineKey === nextFolder.machineKey && folder.path === nextFolder.path)),
        ]);
      }

      setSelectedChatDirectoryPath(path);
      if (shouldMove) {
        setSelectedChatLeafKey(nextLeafKey);
        setChatMessageWindow(null);
        setMessagesByAgent((current) => {
          const movedMessages = current[sourceStorageKey] ?? [];
          if (!movedMessages.length) return current;
          const next = { ...current };
          next[targetStorageKey] = movedMessages;
          if (sourceStorageKey !== targetStorageKey) delete next[sourceStorageKey];
          return next;
        });
        setSelectedChatPreview(sourceMessages.length ? { agentId: selectedAgent.id, leafKey: nextLeafKey, messages: sourceMessages } : null);
      }

      void recordRecentDirectory?.(linkedDirectory, {
        machineName: linkedDirectory.machineName ?? machine.name,
        machineKey: linkedDirectory.machineKey ?? machine.key,
        source: "chat",
      });
    });
  }

  function closeChatFolderCreator() {
    setChatFolderDraft({ machineKey: "", parentPath: "", name: "", busy: false, error: "" });
  }

  async function createChatFolder() {
    const machine = machineGroups.find((item) => item.key === chatFolderDraft.machineKey);
    const agent = machine?.agents.find((item) => runtimeCan(item, "chat"));
    const parentPath = chatFolderDraft.parentPath.trim();
    const name = chatFolderDraft.name.trim();
    if (!machine || !agent) {
      setChatFolderDraft((current) => ({ ...current, error: "Pick a machine with an available agent first." }));
      return;
    }
    if (!parentPath || !name) {
      setChatFolderDraft((current) => ({ ...current, error: "Choose a parent directory and name the folder." }));
      return;
    }
    setChatFolderDraft((current) => ({ ...current, busy: true, error: "" }));
    const nativeData = await createNativeLocalFolder({ parentPath, name });
    if (nativeData?.ok && nativeData.path) {
      const label = nativeData.label || workspaceLabelFromPath(nativeData.path);
      const nextFolder: ChatCustomFolder = {
        id: `${machine.key}-${Date.now()}`,
        machineKey: machine.key,
        label,
        path: nativeData.path,
        agentId: agent.id,
        createdAt: Date.now(),
      };
      setChatCustomFolders((current) => [
        nextFolder,
        ...current.filter((folder) => !(folder.machineKey === nextFolder.machineKey && folder.path === nextFolder.path)),
      ]);
      closeChatFolderCreator();
      startAgentChat(agent.id, {
        fresh: true,
        workingDirectoryPath: nativeData.path,
        workingDirectoryLabel: label,
      });
      return;
    }
    const response = await fetch("/api/chat/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentPath, name }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; path?: string; label?: string; error?: string } | null;
    if (!response?.ok || !data?.ok || !data.path) {
      setChatFolderDraft((current) => ({ ...current, busy: false, error: data?.error ?? "Could not create that folder." }));
      return;
    }
    const label = data.label || workspaceLabelFromPath(data.path);
    const nextFolder: ChatCustomFolder = {
      id: `${machine.key}-${Date.now()}`,
      machineKey: machine.key,
      label,
      path: data.path,
      agentId: agent.id,
      createdAt: Date.now(),
    };
    setChatCustomFolders((current) => [
      nextFolder,
      ...current.filter((folder) => !(folder.machineKey === nextFolder.machineKey && folder.path === nextFolder.path)),
    ]);
    closeChatFolderCreator();
    startAgentChat(agent.id, {
      fresh: true,
      workingDirectoryPath: data.path,
      chatLeafKey: `folder-${machine.key}-${chatDedupeKey(data.path)}-${agent.id}`,
    });
  }

  const chatSidebarTree = useMemo<ChatTreeMachine[]>(() => (
    machineGroups.map((machine) => {
      const folderMap = new Map<string, ChatTreeFolder>();
      const ensureFolder = (label: string, onStartChat?: () => void, path?: string, active?: boolean) => {
        const key = chatDedupeKey(path || label);
        const existing = folderMap.get(key);
        if (existing) {
          if (!existing.onStartChat && onStartChat) existing.onStartChat = onStartChat;
          if (!existing.path && path) existing.path = path;
          if (active) existing.active = true;
          return existing;
        }
        const next: ChatTreeFolder = { key: `${machine.key}-${key}`, label, path, active, chats: [], onStartChat };
        folderMap.set(key, next);
        return next;
      };

      for (const agent of machine.agents.filter((item) => runtimeCan(item, "chat"))) {
        const folderPath = projectDirectoryPath(machine.version?.appDir);
        let fallbackFolder: ChatTreeFolder | undefined;
        const strayFolder = () => ensureFolder("Stray chats");
        const machineChatFolder = () => ensureFolder("Unsorted chats");
        const defaultFolder = () => {
          if (!folderPath) return strayFolder();
          fallbackFolder ??= ensureFolder(workspaceLabelFromPath(folderPath), () => startAgentChat(agent.id, {
            fresh: true,
            workingDirectoryPath: folderPath,
            chatLeafKey: `folder-${machine.key}-${chatDedupeKey(folderPath)}-${agent.id}`,
          }), folderPath, Boolean(selectedChatDirectoryPath && selectedChatDirectoryPath === folderPath));
          return fallbackFolder;
        };
        const hasDirectConversation = hasConversation(agent.id);
        const agentWork = (agentWorkById[agent.id] ?? []).filter(isChatSidebarTask);
        const latestAgentWork = agentWork.find((task) => task.updatedAt > 0);
        const hasRecentHistory = agentWork.some((task) => task.source !== "dashboard-chat");
        const agentChatKey = `agent-${agent.id}`;
        const shouldShowDirectChat = hasDirectConversation;
        if (shouldShowDirectChat) {
          defaultFolder().chats.push({
            key: agentChatKey,
            title: hasDirectConversation ? conversationTitle(agent.id) : agent.name,
            subtitle: hasDirectConversation ? agent.name : `${RUNTIME_LABELS[agent.runtime]} chat`,
            updatedAt: latestAgentWork?.updatedAt,
            rank: hasRecentHistory ? 1 : 3,
            agentId: agent.id,
            searchText: chatSearchContent(messagesByAgent[agent.id] ?? []),
            active: selectedChatLeafKey
              ? selectedAgentId === agent.id && selectedChatLeafKey === agentChatKey
              : agent.id === selectedAgent?.id && !chatMessageWindow,
            onOpen: () => startAgentChat(agent.id, { chatLeafKey: agentChatKey }),
          });
        }

        const savedChats = (chatHistoryByAgent.get(agent.id) ?? []).map((chat) => ({
          ...chat,
          subtitle: chat.subtitle === agent.id ? agent.name : chat.subtitle,
        }));
        for (const savedChat of savedChats) {
          const targetFolder = savedChat.key.startsWith(`machine-${machine.key}-`)
            ? machineChatFolder()
            : defaultFolder();
          targetFolder.chats.push(savedChat);
        }

        const selectedStorageKey = chatMessageStorageKey(agent.id, selectedChatLeafKey);
        const selectedLeafMessages = selectedStorageKey !== agent.id
          ? messagesByAgent[selectedStorageKey]?.filter(isManualAgentChatMessage) ?? []
          : [];
        const selectedLeafVisible = [...folderMap.values()].some((treeFolder) => treeFolder.chats.some((chat) => chat.key === selectedChatLeafKey));
        if (
          agent.id === selectedAgent?.id
          && selectedChatLeafKey
          && selectedStorageKey !== agent.id
          && !selectedChatLeafKey.startsWith("task-")
          && !selectedLeafMessages.some((message) => message.content.trim())
          && !selectedLeafVisible
        ) {
          const targetProjectPath = projectDirectoryPath(selectedChatDirectoryPath);
          const targetFolder = selectedChatLeafKey.startsWith(`machine-${machine.key}-`)
            ? machineChatFolder()
            : targetProjectPath
            ? ensureFolder(workspaceLabelFromPath(targetProjectPath), undefined, targetProjectPath, true)
            : defaultFolder();
          targetFolder.chats.unshift({
            key: selectedChatLeafKey,
            title: "New Chat",
            subtitle: agent.name,
            rank: 5,
            agentId: agent.id,
            searchText: "",
            active: true,
            onOpen: () => startAgentChat(agent.id, { chatLeafKey: selectedChatLeafKey, workingDirectoryPath: selectedChatDirectoryPath }),
          });
        }

        for (const [taskIndex, task] of agentWork.entries()) {
          if (task.source === "dashboard-chat" && hasDirectConversation) continue;
          const seedMessages = chatSeedMessagesForTask(task);
          const taskChatKey = taskChatLeafKey(agent.id, task, taskIndex);
          const taskWorkingDirectory = projectDirectoryPath(task.workingDirectory);
          const taskFolder = taskWorkingDirectory
            ? ensureFolder(workspaceLabelFromPath(taskWorkingDirectory), () => startAgentChat(agent.id, {
              fresh: true,
              workingDirectoryPath: taskWorkingDirectory,
              chatLeafKey: `folder-${machine.key}-${chatDedupeKey(taskWorkingDirectory)}-${agent.id}`,
            }), taskWorkingDirectory, selectedChatDirectoryPath === taskWorkingDirectory)
            : defaultFolder();
          taskFolder.chats.push({
            key: taskChatKey,
            title: task.title || "Previous chat",
            subtitle: task.lastMessage || agent.name,
            updatedAt: task.updatedAt > 0 ? task.updatedAt : task.startedAt > 0 ? task.startedAt : undefined,
            rank: workPriority(task) + (task.messages?.length ? 3 : 0),
            agentId: agent.id,
            searchText: chatSearchContent(seedMessages),
            active: selectedAgentId === agent.id && selectedChatLeafKey === taskChatKey,
            onOpen: () => {
              const runtimeSessionId = runtimeSessionIdFromTask(task);
              if (runtimeSessionId) {
                openRuntimeSessionChat(agent, runtimeSessionId, {
                  seedMessages,
                  chatLeafKey: taskChatKey,
                  workingDirectoryPath: task.workingDirectory,
                });
                return;
              }
              startAgentChat(agent.id, {
                messageLimit: 5,
                seedMessages,
                chatLeafKey: taskChatKey,
                workingDirectoryPath: task.workingDirectory,
              });
            },
          });
        }
      }

      for (const customFolder of chatCustomFolders.filter((folder) => folder.machineKey === machine.key && projectDirectoryPath(folder.path))) {
        const chatAgents = machine.agents.filter((item) => runtimeCan(item, "chat"));
        const agent = chatAgents.find((item) => item.id === customFolder.agentId) ?? chatAgents[0];
        ensureFolder(customFolder.label, agent ? () => startAgentChat(agent.id, {
          fresh: true,
          workingDirectoryPath: customFolder.path,
          chatLeafKey: `folder-${machine.key}-${chatDedupeKey(customFolder.path)}-${agent.id}`,
        }) : undefined, customFolder.path, Boolean(selectedChatDirectoryPath && selectedChatDirectoryPath === customFolder.path));
      }

      const chatAgents = machine.agents.filter((item) => runtimeCan(item, "chat"));
      const newChatAgent = chatAgents.find((agent) => agent.id === selectedAgent?.id) ?? chatAgents[0];
      return {
        key: machine.key,
        name: machine.name,
        detail: machine.collector === "ready" ? `${machine.agents.length} available` : "Agent bridge not ready",
        onStartChat: newChatAgent
          ? () => startAgentChat(newChatAgent.id, {
            fresh: true,
            workingDirectoryPath: "",
            chatLeafKey: `machine-${machine.key}-${newChatAgent.id}`,
          })
          : undefined,
        onCreateFolder: chatAgents.length > 0 ? () => openChatFolderCreator(machine) : undefined,
        folders: [...folderMap.values()]
          .map((folder) => ({
            ...folder,
            chats: [...folder.chats.reduce((deduped, chat) => {
              const key = `${chat.agentId ?? ""}:${chat.key || chatPreviewDedupeKey(chat.title, chat.subtitle)}`;
              deduped.set(key, preferChatTreeItem(deduped.get(key), chat));
              return deduped;
            }, new Map<string, ChatTreeItem>()).values()]
              .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.title.localeCompare(b.title)),
          }))
          .sort((a, b) => (
            a.label === "Stray chats" ? 1 : b.label === "Stray chats" ? -1 : a.label.localeCompare(b.label)
          )),
      };
    })
  ), [agentWorkById, chatCustomFolders, chatHistoryByAgent, chatMessageWindow, conversationTitle, hasConversation, machineGroups, messagesByAgent, openRuntimeSessionChat, selectedAgent?.id, selectedAgentId, selectedChatDirectoryPath, selectedChatLeafKey, startAgentChat]);

  useEffect(() => {
    if (activeView !== "chat" || selectedChatLeafKey) return;
    if (freshChatDraft) {
      setSelectedAgentId(freshChatDraft.agentId);
      setSelectedChatLeafKey(freshChatDraft.leafKey);
      return;
    }
    const latestChat = chatSidebarTree
      .flatMap((machine) => machine.folders.flatMap((folder) => folder.chats))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
    latestChat?.onOpen();
  }, [activeView, chatSidebarTree, freshChatDraft, selectedChatLeafKey, setSelectedAgentId, setSelectedChatLeafKey]);

  const selectedChatMachine = useMemo(() => (
    selectedAgent
      ? chatSidebarTree.find((machine) => machine.folders.some((folder) => (
        folder.chats.some((chat) => chat.active) || machineGroups.find((group) => group.key === machine.key)?.agents.some((agent) => agent.id === selectedAgent.id)
      ))) ?? null
      : null
  ), [chatSidebarTree, machineGroups, selectedAgent]);

  const selectedChatDirectory = useMemo(() => {
    if (!selectedAgent) return "";
    const activeFolder = selectedChatMachine?.folders.find((folder) => folder.active || folder.chats.some((chat) => chat.active));
    if (activeFolder) return activeFolder.label;
    if (selectedChatDirectoryPath) return workspaceLabelFromPath(selectedChatDirectoryPath);
    const machine = machineGroups.find((group) => group.agents.some((agent) => agent.id === selectedAgent.id));
    return machine ? workspaceLabelFromPath(projectDirectoryPath(machine.version?.appDir)) : "Stray chats";
  }, [machineGroups, selectedAgent, selectedChatDirectoryPath, selectedChatMachine]);

  const chatFolderCreatorMachine = useMemo(
    () => machineGroups.find((machine) => machine.key === chatFolderDraft.machineKey) ?? null,
    [chatFolderDraft.machineKey, machineGroups],
  );

  const chatFolderCreatorParentOptions = useMemo(
    () => {
      if (!chatFolderCreatorMachine) return [];
      return [...new Set([
        chatFolderCreatorMachine.version?.appDir,
        ...chatCustomFolders
          .filter((folder) => folder.machineKey === chatFolderCreatorMachine.key)
          .map((folder) => parentPathFromPath(folder.path)),
        "~",
      ].map((path) => path?.trim()).filter(Boolean) as string[])];
    },
    [chatCustomFolders, chatFolderCreatorMachine],
  );

  function openSetupModal(machine: MachineGroup) {
    setSetupMachineKey(machine.key);
    setSetupCommandCopied(false);
  }

  async function copySetupCommand(os?: string) {
    await navigator.clipboard
      ?.writeText(setupCollectorCommand(os))
      .catch(() => undefined);
    setSetupCommandCopied(true);
    window.setTimeout(() => setSetupCommandCopied(false), 2500);
  }

  return { switchRuntime, appendMessage, hasConversation, conversationTitle, hydrateRuntimeSessionChat, startAgentChat, startAgentWorkChat, openChatFolderCreator, changeChatWorkingDirectory, closeChatFolderCreator, createChatFolder, chatSidebarTree, selectedChatMachine, selectedChatDirectory, chatFolderCreatorMachine, chatFolderCreatorParentOptions, openSetupModal, copySetupCommand };
}
