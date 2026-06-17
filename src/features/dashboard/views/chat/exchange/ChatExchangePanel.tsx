// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import "@/components/json-render/fr/fr-style.css";
import "./chat-exchange.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import hiveChatStyles from "@/features/dashboard/views/chat/HiveChatView.module.css";
import { ChatFolderModal } from "@/features/dashboard/views/chat/ChatFolderModal";
import { collapseSameTurnGenerationMessages } from "@/features/dashboard/chat-generation-message-dedupe";
import { createStyleClass } from "@/features/dashboard/style-classes";
import {
  MODEL_SWITCHABLE_RUNTIMES,
  agentInitials,
  isChatScrollNearBottom,
  isFixtureChatMachine,
  messageKey,
  messageText,
  processText,
  selectedAgentIcon,
  shortModelLabel,
  titleCaseLabel,
} from "@/features/dashboard/views/chat/chat-panel-helpers";
import { mergeProcessEvents, normalizeProcessEvents, processEventsAreActive } from "@/features/dashboard/views/chat/AgentProcessPanel";
import { ConversationNav } from "./ConversationNav";
import { ContextPanel } from "./ContextPanel";
import { MessageThread } from "./MessageThread";
import { Dot, HiveMark, frChatState } from "./primitives";

const hiveClass = createStyleClass(hiveChatStyles);

function friendlyThreadLabel(rawLabel: string, directoryLabel?: string) {
  const label = rawLabel.trim();
  if (directoryLabel?.trim()) return directoryLabel.trim();
  if (!label) return "agent chat";
  if (label.startsWith("task-")) return "task chat";
  if (label.startsWith("folder-")) return "folder chat";
  if (label.startsWith("machine-")) return "machine chat";
  if (label.startsWith("agent-")) return "agent chat";
  return "agent chat";
}

function makeMetricRows(selectedAgent: any, runtimeLabel: string, providerLabel: string, modelLabel: string, machineLabel: string) {
  return [
    ["Runtime", runtimeLabel],
    ["Provider", providerLabel],
    ["Model", modelLabel],
    ["Machine", machineLabel],
    ["Agent", selectedAgent?.name ?? "No agent selected"],
  ];
}

function asChatRows(rows?: any[]) {
  return Array.isArray(rows) ? rows : [];
}

export function ChatExchangePanel(props: any) {
  const {
    Activity,
    AgentResponseLoader,
    Check,
    ChevronDown,
    ChevronUp,
    CircleAlert,
    Copy,
    FileText,
    GitBranch,
    Hammer,
    KanbanSquare,
    LoaderCircle,
    MessageSquare,
    Pencil,
    Plus,
    Search,
    Send,
    Sparkles,
    Terminal,
    activeView,
    attachChatDirectory,
    attachChatRecentDirectory,
    attachmentError,
    attachmentMenuOpen,
    attachmentMenuRef,
    beeRoleIconPath,
    busy,
    changeChatWorkingDirectory,
    chatAttachments = [],
    chatAutoScrollRef,
    chatDirectories = [],
    chatDisplayContent,
    chatFileInputRef,
    chatImageInputRef,
    chatKanbanGeneration,
    chatSidebarTree = [],
    chatStreamingByKey = {},
    checkStatus,
    dismissChatKanbanGeneration,
    expandedChatFolders,
    flushingChatQueueId,
    formatRelativeTime,
    generateKanbanTaskFromChat,
    handleChatFileChange,
    handleChatFileReferenceDrop,
    handleChatImageChange,
    hasStreamingChunk,
    messagesEndRef,
    messagesScrollRef,
    machineGroups = [],
    queuedChatMessages = [],
    recentDirectories = [],
    recentDirectoriesExpanded,
    recording,
    refreshRuntimeIntegrations,
    removeChatAttachment,
    removeChatDirectory,
    removeQueuedChatMessage,
    runRuntimeIntegrationAction,
    runtimeIntegrationBusy,
    runtimeModelSelectionsByRuntime,
    selectedAgent,
    selectedChatDirectory,
    selectedChatHistoryLoading,
    selectedChatLeafKey,
    selectedChatMachine,
    selectedChatProcess,
    selectedChatStorageKey,
    sendMessage,
    sendPromptMessage,
    sendQueuedChatMessageNow,
    setAttachmentMenuOpen,
    setExpandedChatFolders,
    setRecentDirectoriesExpanded,
    setStatusAgentId,
    setText,
    startAudioRecording,
    status,
    statusAgentId,
    stopAudioRecording,
    text,
    updateAgent,
    updateChatAutoScroll,
    visibleMessages = [],
    voiceBands = [],
    voiceTarget,
    voiceTranscript,
    ChatMarkdown,
    ComposerField,
  } = props;

  const renderMessages = useMemo(() => collapseSameTurnGenerationMessages(visibleMessages), [visibleMessages]);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [openKanbanTaskMenuKey, setOpenKanbanTaskMenuKey] = useState("");
  const [copiedMessageKey, setCopiedMessageKey] = useState("");
  const [agentMode, setAgentMode] = useState<"plan" | "act">("act");
  const [statusChecking, setStatusChecking] = useState(false);
  const [newChatPressed, setNewChatPressed] = useState(false);
  const [stickyChatProcess, setStickyChatProcess] = useState<any[]>([]);
  const [stickyChatProcessTargetKey, setStickyChatProcessTargetKey] = useState("");
  const scrollNodeRef = useRef<HTMLDivElement | null>(null);
  const threadNodeRef = useRef<HTMLDivElement | null>(null);
  const stickyChatProcessSignatureRef = useRef("");
  const previousChatScrollKeyRef = useRef("");
  const chatScrollFrameRef = useRef<number | null>(null);
  const newChatFeedbackTimerRef = useRef<number | null>(null);

  const liveProcessEvents = normalizeProcessEvents(selectedChatProcess);
  const chatProcessScopeKey = `${selectedChatStorageKey || ""}\u001f${selectedChatLeafKey || ""}`;
  const activeTurnProcessTargetKey = (() => {
    for (let index = renderMessages.length - 1; index >= 0; index -= 1) {
      if (renderMessages[index]?.role === "user") return `${chatProcessScopeKey}\u001fuser\u001f${messageKey(renderMessages[index], index)}`;
    }
    for (let index = renderMessages.length - 1; index >= 0; index -= 1) {
      const message = renderMessages[index];
      if (message?.role === "assistant") return `${chatProcessScopeKey}\u001fassistant\u001f${messageKey(message, index)}`;
    }
    return "";
  })();
  const activeTurnMessageProcessEvents = (() => {
    let latestUserIndex = -1;
    for (let index = renderMessages.length - 1; index >= 0; index -= 1) {
      if (renderMessages[index]?.role === "user") {
        latestUserIndex = index;
        break;
      }
    }
    for (let index = renderMessages.length - 1; index > latestUserIndex; index -= 1) {
      const message = renderMessages[index];
      if (message?.role !== "assistant") continue;
      const events = normalizeProcessEvents(message.processEvents ?? message.events);
      if (events.length) return events;
    }
    return [];
  })();
  const currentProcessEvents = mergeProcessEvents(activeTurnMessageProcessEvents, liveProcessEvents);
  const currentProcessSignature = currentProcessEvents
    .map((event: any) => [event?.at, event?.label, event?.detail, event?.status, event?.runId].join("\u001f"))
    .join("\u001e");

  useEffect(() => {
    const events = currentProcessEvents;
    if (!events.length) return undefined;
    if (stickyChatProcessSignatureRef.current !== currentProcessSignature) {
      stickyChatProcessSignatureRef.current = currentProcessSignature;
      setStickyChatProcess(events);
      setStickyChatProcessTargetKey(activeTurnProcessTargetKey);
    }
    return undefined;
  }, [activeTurnProcessTargetKey, currentProcessEvents, currentProcessSignature]);

  useEffect(() => () => {
    if (newChatFeedbackTimerRef.current !== null) window.clearTimeout(newChatFeedbackTimerRef.current);
  }, []);

  const autoStatusAgentIdRef = useRef("");
  useEffect(() => {
    if (activeView !== "chat") return;
    const agentId = selectedAgent?.id;
    if (!agentId || !checkStatus || autoStatusAgentIdRef.current === agentId) return;
    autoStatusAgentIdRef.current = agentId;
    setStatusAgentId?.(agentId);
    setStatusChecking(true);
    void Promise.resolve(checkStatus()).catch(() => undefined).finally(() => setStatusChecking(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, selectedAgent?.id]);

  const modelSelectionRefreshedRuntimesRef = useRef(new Set<string>());
  useEffect(() => {
    if (activeView !== "chat" || !selectedAgent || !refreshRuntimeIntegrations) return;
    const runtime = selectedAgent.runtime;
    if (!runtime || runtimeModelSelectionsByRuntime?.[runtime] || modelSelectionRefreshedRuntimesRef.current.has(runtime)) return;
    modelSelectionRefreshedRuntimesRef.current.add(runtime);
    void refreshRuntimeIntegrations(selectedAgent);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, selectedAgent?.id]);

  useEffect(() => {
    if (chatKanbanGeneration?.phase !== "done") return undefined;
    const key = chatKanbanGeneration.key;
    const timeout = window.setTimeout(() => {
      dismissChatKanbanGeneration?.(key);
      setOpenKanbanTaskMenuKey((current) => current === key ? "" : current);
    }, 2600);
    return () => window.clearTimeout(timeout);
  }, [chatKanbanGeneration, dismissChatKanbanGeneration]);

  useEffect(() => {
    if (!attachmentMenuOpen) return undefined;
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (attachmentMenuRef?.current?.contains(target)) return;
      setAttachmentMenuOpen?.(false);
    }
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [attachmentMenuOpen, attachmentMenuRef, setAttachmentMenuOpen]);

  const selectedRuntimeModelSelection = selectedAgent ? runtimeModelSelectionsByRuntime?.[selectedAgent.runtime] : undefined;
  const chatModelProviders = selectedRuntimeModelSelection?.providers ?? [];
  const chatCurrentProvider = selectedAgent ? (selectedAgent.provider?.trim() || selectedRuntimeModelSelection?.provider || "") : "";
  const chatCurrentModel = selectedAgent ? (selectedAgent.model?.trim() || selectedRuntimeModelSelection?.model || "") : "";
  const modelPickerEnabled = Boolean(selectedAgent) && MODEL_SWITCHABLE_RUNTIMES.includes(selectedAgent?.runtime);

  function selectChatModel(provider: string, model: string) {
    if (!selectedAgent) return;
    updateAgent?.({ provider, model });
    if (selectedAgent.runtime === "hermes" || selectedAgent.runtime === "openclaw") {
      void runRuntimeIntegrationAction?.("set-model", { provider, model }, { ...selectedAgent, provider, model });
    }
  }

  const modelPicker = modelPickerEnabled ? {
    label: shortModelLabel(chatCurrentModel),
    provider: chatCurrentProvider,
    model: chatCurrentModel,
    providers: chatModelProviders,
    loading: runtimeIntegrationBusy === "status",
    emptyHint: "No models configured for this agent yet. Open agent settings to add one.",
    onSelect: selectChatModel,
    onOpen: () => {
      if (!selectedAgent || chatModelProviders.length) return;
      void refreshRuntimeIntegrations?.(selectedAgent);
    },
    onRefresh: () => {
      if (selectedAgent) void refreshRuntimeIntegrations?.(selectedAgent);
    },
  } : undefined;

  useEffect(() => {
    if (!selectedAgent || selectedAgent.provider?.trim() || selectedAgent.model?.trim() || selectedRuntimeModelSelection) return;
    if (!["hermes", "openclaw"].includes(selectedAgent.runtime)) return;
    void refreshRuntimeIntegrations?.(selectedAgent);
  }, [refreshRuntimeIntegrations, selectedAgent, selectedRuntimeModelSelection]);

  const lastVisibleMessage = renderMessages.length ? renderMessages[renderMessages.length - 1] : null;
  const lastVisibleMessageTextLength = lastVisibleMessage ? messageText(lastVisibleMessage, chatDisplayContent).length : 0;
  const lastVisibleMessageProcessCount = normalizeProcessEvents(lastVisibleMessage?.processEvents ?? lastVisibleMessage?.events).length;
  const lastVisibleMessageGenerationStatus = String(lastVisibleMessage?.applicationGeneration?.status ?? lastVisibleMessage?.imageGeneration?.status ?? "");
  const chatScrollKey = `${selectedChatStorageKey || ""}\u001f${selectedChatLeafKey || ""}`;
  const chatScrollSignature = [
    renderMessages.length,
    lastVisibleMessage?.role ?? "",
    lastVisibleMessageTextLength,
    lastVisibleMessageProcessCount,
    lastVisibleMessageGenerationStatus,
    busy ? "busy" : "idle",
    hasStreamingChunk ? "chunk" : "empty",
  ].join("\u001f");

  const scheduleChatScrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (chatScrollFrameRef.current !== null) window.cancelAnimationFrame(chatScrollFrameRef.current);
    chatScrollFrameRef.current = window.requestAnimationFrame(() => {
      chatScrollFrameRef.current = null;
      const node = scrollNodeRef.current;
      if (!node) return;
      node.scrollTo({ top: node.scrollHeight, behavior });
    });
  }, []);

  useEffect(() => {
    const node = scrollNodeRef.current;
    if (!node || selectedChatHistoryLoading) return;
    const chatChanged = previousChatScrollKeyRef.current !== chatScrollKey;
    if (chatChanged) {
      previousChatScrollKeyRef.current = chatScrollKey;
      if (chatAutoScrollRef) chatAutoScrollRef.current = true;
    }
    if (!chatChanged && !chatAutoScrollRef?.current && !isChatScrollNearBottom(node)) return;
    if (chatAutoScrollRef) chatAutoScrollRef.current = true;
    scheduleChatScrollToBottom(chatChanged ? "auto" : "smooth");
  }, [chatAutoScrollRef, chatScrollKey, chatScrollSignature, scheduleChatScrollToBottom, selectedChatHistoryLoading]);

  useEffect(() => {
    const scrollNode = scrollNodeRef.current;
    const threadNode = threadNodeRef.current;
    if (!scrollNode || !threadNode || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (!chatAutoScrollRef?.current && !isChatScrollNearBottom(scrollNode)) return;
      if (chatAutoScrollRef) chatAutoScrollRef.current = true;
      scheduleChatScrollToBottom("auto");
    });
    observer.observe(threadNode);
    return () => observer.disconnect();
  }, [chatAutoScrollRef, chatScrollKey, scheduleChatScrollToBottom]);

  useEffect(() => () => {
    if (chatScrollFrameRef.current !== null) window.cancelAnimationFrame(chatScrollFrameRef.current);
  }, []);

  function handleScroll(event: any) {
    messagesScrollRef.current = event.currentTarget;
    const node = event.currentTarget;
    const nearBottom = isChatScrollNearBottom(node);
    if (chatAutoScrollRef) chatAutoScrollRef.current = nearBottom;
    updateChatAutoScroll?.();
  }

  function attachScrollNode(node: HTMLDivElement | null) {
    scrollNodeRef.current = node;
    messagesScrollRef.current = node;
  }

  async function handleCheckStatus() {
    if (!selectedAgent || !checkStatus) return;
    setStatusAgentId?.(selectedAgent.id);
    setStatusChecking(true);
    try {
      await checkStatus();
    } finally {
      setStatusChecking(false);
    }
  }

  const runtimeLabel = titleCaseLabel(selectedAgent?.runtime);
  const providerLabel = titleCaseLabel(chatCurrentProvider);
  const modelLabel = chatCurrentModel?.trim() || "Not set";
  const machineLabel = selectedChatMachine?.name ?? selectedAgent?.machineName ?? "This Mac";
  const stateKey = !selectedAgent
    ? "setup"
    : statusAgentId === selectedAgent.id && status && status.ok === false
      ? "failed"
      : busy
        ? "working"
        : statusAgentId === selectedAgent.id && status?.ok
          ? "online"
          : "ready";
  const state = frChatState(stateKey);
  const iconSrc = selectedAgentIcon(selectedAgent, beeRoleIconPath);
  const activeThreadLabel = selectedChatLeafKey || selectedChatStorageKey || "agent chat";
  const displayThreadLabel = friendlyThreadLabel(activeThreadLabel, selectedChatDirectory);
  const hasQueued = queuedChatMessages.length > 0;
  const processEventsForDisplay = currentProcessEvents.length ? currentProcessEvents : stickyChatProcess;
  const processEventsTargetKey = currentProcessEvents.length ? activeTurnProcessTargetKey : stickyChatProcessTargetKey;
  const activeChatTaskRunning = busy || processEventsAreActive(processEventsForDisplay);
  const runningChatStorageKeys = useMemo(() => new Set(Object.keys(chatStreamingByKey ?? {})), [chatStreamingByKey]);
  const runningChatIdentityKeys = useMemo(() => new Set(Object.values(chatStreamingByKey ?? {})
    .map((stream: any) => `${stream?.agentId ?? ""}\u001f${stream?.leafKey || `agent-${stream?.agentId ?? ""}`}`)
    .filter((key) => !key.startsWith("\u001f"))), [chatStreamingByKey]);
  const liveOutput = processText(processEventsForDisplay);
  const metrics = makeMetricRows(selectedAgent, runtimeLabel, providerLabel, modelLabel, machineLabel);
  const generalMachine = useMemo(() => chatSidebarTree.find((machine: any) => machine.key === "unassigned"), [chatSidebarTree]);
  const generalChats = useMemo(() => (
    asChatRows(generalMachine?.folders)
      .flatMap((folder: any) => asChatRows(folder.chats).map((chat: any) => ({ ...chat, folder, machine: generalMachine })))
      .slice(0, 8)
  ), [generalMachine]);
  const machinesWithChats = useMemo(() => (
    chatSidebarTree
      .filter((machine: any) => machine.key !== "unassigned")
      .map((machine: any) => {
        const folders = asChatRows(machine.folders).filter((folder: any) => folder.active || folder.onStartChat || (folder.chats?.length ?? 0) > 0);
        const rosterAgentCount = machineGroups.find((group: any) => group.key === machine.key)?.agents?.length ?? 0;
        return { ...machine, folders, rosterAgentCount };
      })
      .filter((machine: any) => !isFixtureChatMachine(machine) && ((machine.folders?.length ?? 0) > 0 || Boolean(machine.onStartChat) || machine.rosterAgentCount > 0))
  ), [chatSidebarTree, machineGroups]);
  const defaultChatMachine = machinesWithChats.find((machine: any) => machine.key === selectedChatMachine?.key && machine.onStartChat)
    ?? machinesWithChats.find((machine: any) => machine.name === "This Mac" && machine.onStartChat)
    ?? machinesWithChats.find((machine: any) => machine.onStartChat)
    ?? generalMachine;
  const newChatTarget = (() => {
    for (const machine of chatSidebarTree) {
      for (const folder of machine.folders ?? []) {
        const holdsActiveChat = folder.active || (folder.chats ?? []).some((chat: any) => chat.active);
        if (!holdsActiveChat) continue;
        if (folder.onStartChat) return { label: folder.label, onStartChat: folder.onStartChat };
        if (machine.onStartChat) return { label: machine.name, onStartChat: machine.onStartChat };
      }
    }
    return defaultChatMachine?.onStartChat
      ? { label: defaultChatMachine.name, onStartChat: defaultChatMachine.onStartChat }
      : null;
  })();

  function handleStartNewChat() {
    if (!newChatTarget) return;
    setNewChatPressed(true);
    if (newChatFeedbackTimerRef.current !== null) window.clearTimeout(newChatFeedbackTimerRef.current);
    newChatFeedbackTimerRef.current = window.setTimeout(() => {
      setNewChatPressed(false);
      newChatFeedbackTimerRef.current = null;
    }, 900);
    newChatTarget.onStartChat?.();
  }

  function chatRowStorageKey(chat: any) {
    const agentId = String(chat?.agentId ?? "");
    const leafKey = String(chat?.key ?? "");
    if (!agentId) return "";
    if (!leafKey || leafKey === `agent-${agentId}`) return agentId;
    return `${agentId}::${leafKey}`;
  }

  function chatRowIdentityKey(chat: any) {
    const agentId = String(chat?.agentId ?? "");
    const leafKey = String(chat?.key || (agentId ? `agent-${agentId}` : ""));
    return agentId && leafKey ? `${agentId}\u001f${leafKey}` : "";
  }

  function chatRowIsRunning(chat: any) {
    const storageKey = chatRowStorageKey(chat);
    const identityKey = chatRowIdentityKey(chat);
    return Boolean(
      (storageKey && runningChatStorageKeys.has(storageKey))
      || (identityKey && runningChatIdentityKeys.has(identityKey)),
    );
  }

  function revealFolder(folderKey: string) {
    setExpandedChatFolders?.((current: Set<string>) => new Set(current).add(folderKey));
  }

  const conv = {
    id: selectedAgent?.id ?? selectedChatStorageKey ?? "chat",
    name: selectedAgent?.name ?? "Hive overview",
    sub: selectedChatDirectory || displayThreadLabel,
    state: stateKey,
    kind: selectedAgent ? "agent" : "general",
    runtime: runtimeLabel,
    role: selectedAgent?.workerClass ?? selectedAgent?.beeRole,
    machine: machineLabel,
  };
  const thread = {
    taskId: displayThreadLabel,
    task: selectedChatDirectory ? `Working in ${selectedChatDirectory}` : selectedAgent ? "Ready for a new instruction." : "Pick a chat from the rail.",
    column: busy ? "working" : "ready",
    priority: activeChatTaskRunning ? "live" : "normal",
    tenant: selectedAgent?.runtime ?? "chat",
    eta: activeChatTaskRunning ? "running" : "idle",
    repo: selectedChatDirectory || "—",
    branch: selectedChatLeafKey || "—",
    cwd: selectedChatDirectory,
    tokens: `${renderMessages.length} msgs`,
    cost: providerLabel,
    elapsed: activeChatTaskRunning ? "live" : "—",
    blocked: stateKey === "failed",
    general: !selectedAgent,
    scope: selectedChatDirectory || machineLabel,
    actions: ["Check status", "Refresh runtime"],
  };

  const iconProps = {
    Activity,
    Check,
    ChevronDown,
    ChevronUp,
    CircleAlert,
    Copy,
    FileText,
    GitBranch,
    Hammer,
    KanbanSquare,
    LoaderCircle,
    Pencil,
    Search,
    Sparkles,
    Terminal,
  };

  if (activeView !== "chat") return <ChatFolderModal {...props} />;

  const headerSubline = selectedAgent
    ? `${runtimeLabel} · ${machineLabel}${selectedChatDirectory ? ` · ${selectedChatDirectory}` : ""}`
    : thread.scope || conv.sub;

  return (
    <>
      <section className="fr-root fr-chat-root" aria-label="Agent chat">
        <div className="fr-chat-layout" data-shelf-open={shelfOpen ? "true" : "false"}>
          <aside className="fr-chat-sidebar" aria-label="Chats">
            <header style={{ padding: "20px 18px 14px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 17, letterSpacing: "-0.01em" }}>Chat</span>
                <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>talk to the hive</span>
              </div>
            </header>
            <div style={{ padding: "0 14px 12px" }}>
              <button
                type="button"
                className="fr-chat-new-chat-button"
                onClick={handleStartNewChat}
                disabled={!newChatTarget}
                title={newChatTarget ? `New chat in ${newChatTarget.label}` : undefined}
                data-pressed={newChatPressed ? "true" : undefined}
              >
                {newChatPressed && Check ? <Check aria-hidden="true" /> : Plus ? <Plus aria-hidden="true" /> : null}
                <span>{newChatPressed ? "Starting..." : "New chat"}</span>
              </button>
            </div>
            <div style={{ minHeight: 0, overflow: "hidden" }}>
              <ConversationNav
                generalChats={generalChats}
                machines={machinesWithChats}
                expandedChatFolders={expandedChatFolders}
                formatRelativeTime={formatRelativeTime}
                onOpenChat={(chat) => chat.onOpen?.()}
                onRevealFolder={revealFolder}
                running={chatRowIsRunning}
              />
            </div>
            <footer style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--line)", color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 10, padding: "12px 18px" }}>
              <span className="fr-dot live" style={{ color: "var(--live)" }} />
              {machineLabel}
            </footer>
          </aside>

          <main className="fr-chat-main" aria-label="Current chat">
            <header style={{ display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid var(--line)", padding: "16px 24px" }}>
              <span style={{ display: "grid", placeItems: "center", width: 40, height: 40, flexShrink: 0, border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", background: "var(--panel)", overflow: "hidden" }}>
                {iconSrc ? (
                  <span style={{ width: "100%", height: "100%", backgroundImage: `url(${iconSrc})`, backgroundPosition: "center", backgroundSize: "cover" }} aria-hidden="true" />
                ) : selectedAgent ? (
                  <span style={{ color: "var(--honey)", fontFamily: "var(--f-display)", fontWeight: 700 }}>{agentInitials(selectedAgent)}</span>
                ) : (
                  <HiveMark size={20} stroke="var(--honey)" />
                )}
              </span>
              <div style={{ minWidth: 0, flex: "1 1 auto", paddingRight: shelfOpen ? 8 : 96, transition: "padding-right 340ms cubic-bezier(.2,.8,.2,1)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ overflow: "hidden", color: "var(--fg)", fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.name}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: state.text, flexShrink: 0, fontFamily: "var(--f-mono)", fontSize: 10.5 }}>
                    <Dot state={stateKey} size={5} /> {state.label}
                  </span>
                </div>
                <div title={headerSubline} style={{ overflow: "hidden", color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 11, marginTop: 3, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ color: "var(--fg-3)" }}>{headerSubline}</span>
                </div>
              </div>
            </header>

            <div ref={attachScrollNode} className="fr-scroll" onScroll={handleScroll} aria-busy={selectedChatHistoryLoading} style={{ minHeight: 0, overflow: "auto", padding: "26px 24px 12px" }}>
              <div ref={threadNodeRef} className="fr-chat-content-rail fr-chat-thread-rail">
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
                  <span className="fr-eyebrow" style={{ flexShrink: 0, whiteSpace: "nowrap" }} title={activeThreadLabel}>{displayThreadLabel}</span>
                  <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
                </div>

                {selectedChatHistoryLoading ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 12, padding: 24 }}>
                    {LoaderCircle ? <LoaderCircle aria-hidden="true" style={{ animation: "fr-spin 0.8s linear infinite" }} /> : null}
                    Loading history
                  </div>
                ) : (
                  <MessageThread
                    AgentResponseLoader={AgentResponseLoader}
                    ChatMarkdown={ChatMarkdown}
                    FileText={FileText}
                    Send={Send}
                    activeChatTaskRunning={activeChatTaskRunning}
                    busy={busy}
                    chatDisplayContent={chatDisplayContent}
                    chatKanbanGeneration={chatKanbanGeneration}
                    chatProcessScopeKey={chatProcessScopeKey}
                    copiedMessageKey={copiedMessageKey}
                    dismissChatKanbanGeneration={dismissChatKanbanGeneration}
                    formatRelativeTime={formatRelativeTime}
                    generateKanbanTaskFromChat={generateKanbanTaskFromChat}
                    hasStreamingChunk={hasStreamingChunk}
                    iconProps={iconProps}
                    messages={renderMessages}
                    openKanbanTaskMenuKey={openKanbanTaskMenuKey}
                    processEventsForDisplay={processEventsForDisplay}
                    processEventsTargetKey={processEventsTargetKey}
                    selectedAgent={selectedAgent}
                    sendPromptMessage={sendPromptMessage}
                    setCopiedMessageKey={setCopiedMessageKey}
                    setOpenKanbanTaskMenuKey={setOpenKanbanTaskMenuKey}
                  />
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <section className={`${hiveClass("hiveComposerDock")} fr-chat-composer-dock`} aria-label="Message composer">
              <div className="fr-chat-content-rail fr-chat-composer-rail">
                {hasQueued ? (
                  <div style={{ display: "grid", gap: 8, border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--panel-2)", color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "9px 11px" }} aria-label="Queued messages">
                    <strong style={{ color: "var(--fg)" }}>{queuedChatMessages.length} queued</strong>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                      {queuedChatMessages.slice(0, 3).map((item: any, index: number) => {
                        const flushing = flushingChatQueueId === item.id;
                        return (
                          <span key={item.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--line-2)", borderRadius: 999, background: "var(--panel)", padding: "5px 8px" }}>
                            {MessageSquare ? <MessageSquare aria-hidden="true" /> : null}
                            <span>{item.label || `Queued ${index + 1}`}</span>
                            <button type="button" className="fr-chat-mini-button" onClick={() => sendQueuedChatMessageNow?.(item.id)} disabled={busy || Boolean(flushingChatQueueId)}>
                              {flushing && LoaderCircle ? <LoaderCircle aria-hidden="true" /> : Send ? <Send aria-hidden="true" /> : null}
                            </button>
                            <button type="button" className="fr-chat-mini-button" onClick={() => removeQueuedChatMessage?.(item.id)} disabled={flushing}>x</button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <form onSubmit={sendMessage}>
                  {selectedAgent && ComposerField ? (
                    <ComposerField
                      className={hiveClass("hiveComposerField")}
                      value={text ?? ""}
                      onChange={setText}
                      placeholder={`Message ${selectedAgent.name}...`}
                      disabled={false}
                      busy={busy && !hasStreamingChunk}
                      attachments={chatAttachments}
                      directories={chatDirectories}
                      attachmentError={attachmentError}
                      attachmentMenuOpen={attachmentMenuOpen}
                      setAttachmentMenuOpen={setAttachmentMenuOpen}
                      attachmentMenuRef={attachmentMenuRef}
                      fileInputRef={chatFileInputRef}
                      imageInputRef={chatImageInputRef}
                      onFileChange={handleChatFileChange}
                      onDropFileReferences={handleChatFileReferenceDrop}
                      onImageChange={handleChatImageChange}
                      onRemoveAttachment={removeChatAttachment}
                      onAttachDirectory={() => void attachChatDirectory?.()}
                      recentDirectories={recentDirectories}
                      recentDirectoriesExpanded={recentDirectoriesExpanded}
                      setRecentDirectoriesExpanded={setRecentDirectoriesExpanded}
                      onAttachRecentDirectory={attachChatRecentDirectory}
                      onRemoveDirectory={removeChatDirectory}
                      workingDirectoryLabel={selectedChatDirectory}
                      onChangeWorkingDirectory={() => void changeChatWorkingDirectory?.()}
                      recording={recording && voiceTarget === "chat"}
                      voiceBands={voiceBands}
                      voiceTranscript={voiceTranscript}
                      onToggleRecording={recording ? stopAudioRecording : () => void startAudioRecording?.("chat")}
                      onSwarmCommand={() => {
                        const current = (text ?? "").trim();
                        setText(current && !current.toLowerCase().startsWith("/swarm") ? `/swarm ${current}` : "/swarm ");
                      }}
                      onImageGenerationCommand={() => {
                        const current = (text ?? "").trim();
                        setText(current && !/^\/(?:image-gen|imagine|txt2img)\b/i.test(current) ? `/image-gen ${current}` : "/image-gen ");
                      }}
                      canSend={Boolean((text ?? "").trim() || chatAttachments.length || chatDirectories.length)}
                      submitOnEnter
                      hermesSlashCommands
                      agentMode={agentMode}
                      onAgentModeChange={setAgentMode}
                      modelPicker={modelPicker}
                    />
                  ) : null}
                </form>
              </div>
            </section>
          </main>

          <aside className="fr-chat-shelf" aria-label="Chat details">
            <div className="fr-scroll fr-chat-shelf-inner">
              <ContextPanel
                conv={conv}
                isAgent={Boolean(selectedAgent)}
                live={activeChatTaskRunning}
                output={liveOutput}
                rows={metrics}
                thread={thread}
                onAction={(action) => {
                  if (/check status/i.test(action)) void handleCheckStatus();
                  else if (/refresh runtime/i.test(action)) void refreshRuntimeIntegrations?.(selectedAgent);
                }}
              />
              {statusAgentId === selectedAgent?.id && status?.message ? <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.55 }}>{status.message}</p> : null}
              {statusChecking ? <p className="fr-eyebrow" style={{ margin: 0, color: "var(--live)" }}>checking status...</p> : null}
            </div>
          </aside>
        </div>

        <button
          type="button"
          onClick={() => setShelfOpen((open) => !open)}
          aria-pressed={shelfOpen}
          title={shelfOpen ? "Hide details panel" : "Show details panel"}
          style={{ position: "absolute", top: 18, right: 18, zIndex: 80, display: "grid", placeItems: "center", width: 36, height: 36, border: `1px solid ${shelfOpen ? "var(--honey-line)" : "var(--line-2)"}`, borderRadius: "var(--radius-sm)", background: shelfOpen ? "color-mix(in srgb, var(--honey) 15%, var(--panel))" : "var(--panel)", color: shelfOpen ? "var(--honey)" : "var(--fg-3)", boxShadow: "0 6px 18px -10px rgba(0,0,0,0.6)", cursor: "pointer", transition: "all 160ms ease" }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="15" y1="4" x2="15" y2="20" /></svg>
        </button>
      </section>
      <ChatFolderModal {...props} />
    </>
  );
}
