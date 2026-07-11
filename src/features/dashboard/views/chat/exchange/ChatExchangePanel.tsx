"use client";

import "@/components/json-render/fr/fr-style.css";
import "./chat-exchange.css";
import "./chat-exchange-errors.css";
import "./chat-exchange-motion.css";
import "./chat-exchange-shell.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatFolderModal } from "@/features/dashboard/views/chat/ChatFolderModal";
import { collapseSameTurnGenerationMessages } from "@/features/dashboard/chat-generation-message-dedupe";
import { transcriptCardIsRunning } from "@/features/dashboard/chat-transcript-card";
import { agentWakeStatusText, isAgentColdStartProcessEvent } from "@/lib/services/chat/agent-cold-start";
import {
  MODEL_SWITCHABLE_RUNTIMES,
  agentInitials,
  agentMenuMachineLabel,
  agentMenuRuntimeIdentity,
  agentMenuStatusLabel,
  isChatScrollNearBottom,
  isFixtureChatMachine,
  messageKey,
  messageText,
  normalizeSearchText,
  processText,
  selectedAgentIcon,
  titleCaseLabel,
} from "@/features/dashboard/views/chat/chat-panel-helpers";
import { mergeProcessEvents, normalizeProcessEvents, processEventsAreActive } from "@/features/dashboard/views/chat/AgentProcessPanel";
import { normalizeChatPermissionMode } from "@/lib/types/chat-permissions";
import type { ChatPermissionMode } from "@/lib/types/chat-permissions";
import { normalizeChatReasoningEffort } from "@/lib/types/chat-reasoning-effort";
import type { ChatReasoningEffort } from "@/lib/types/chat-reasoning-effort";
import type { ChatThreadUsage } from "@/lib/services/chat/thread-usage";
import { normalizeEvaluationHumanFeedback } from "@/lib/types/evaluation";
import { evaluationOutputFingerprint } from "@/lib/services/evaluation/control-plane";
import { selectChatPreviewTargets } from "@/lib/services/chat/chat-preview-targets";
import { nativeOpenInAppSupported, openNativeInApp } from "@/lib/native/filesystem";

import { MessageThread } from "./MessageThread";
import { ThreadTitleSettings } from "./ThreadTitleSettings";
import { Dot, HiveMark, HistorySkeleton, frChatState } from "./primitives";
import { useChatThreadTitleConfig } from "@/features/dashboard/hooks/use-chat-thread-titles";

import { ChatSidebar } from "./ChatSidebar";
import type { SidebarRow } from "./ChatSidebar";
import { ContextShelf, PreviewFrame } from "./ContextShelf";
import type { ShelfDeliverable, ShelfMode } from "./ContextShelf";
import { ChatTerminalDrawer } from "./ChatTerminalDrawer";
import { ExchangeComposer } from "./ExchangeComposer";
import { useChatViewPreferences } from "./use-chat-view-preferences";
import {
  deleteChatThread,
  duplicateChatThreadSeed,
  serializeChatTranscript,
} from "./chat-thread-actions";
import { HexIco, ICON_PATHS, Ico, POP_STYLE, headerIconBtnStyle } from "./composer-primitives";

function coldStartStatusText(events: any[], selectedAgent: any) {
  return events.some((event) => isAgentColdStartProcessEvent(event)) ? agentWakeStatusText(selectedAgent) : undefined;
}

function elapsedLabel(startedAt: number | undefined, nowMs: number) {
  if (!startedAt) return "—";
  const seconds = Math.max(0, Math.round((nowMs - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours ? `${hours}h ` : ""}${minutes}m ${seconds % 60}s`;
}

/** Real generated artifacts on this thread's messages — never fixtures. */
function deliverablesFromMessages(messages: any[]): ShelfDeliverable[] {
  const out: ShelfDeliverable[] = [];
  messages.forEach((message, index) => {
    const card = message?.applicationGeneration ?? message?.imageGeneration;
    const artifacts = card?.artifacts ?? (card?.images ?? []).map((image: any) => ({ kind: "image", url: image.url }));
    (artifacts ?? []).forEach((artifact: any, artifactIndex: number) => {
      if (!artifact?.url) return;
      const kind = artifact.kind === "audio" || artifact.kind === "video" || artifact.kind === "model3d" || artifact.kind === "image" ? artifact.kind : "file";
      out.push({
        id: `${index}-${artifactIndex}-${artifact.url}`,
        kind,
        name: artifact.label || card?.title || `${kind} ${artifactIndex + 1}`,
        meta: [card?.modelName, card?.machineName].filter(Boolean).join(" · ") || kind,
        url: artifact.url,
      });
    });
  });
  return out;
}

export function ChatExchangePanel(props: any) {
  const {
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
    Pencil,
    Search,
    Send,
    Settings2,
    Sparkles,
    Terminal,
    Activity,
    activeView,
    attachChatDirectory,
    attachChatRecentDirectory,
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
    chatThreadTitles = {},
    checkStatus,
    dashboardTheme,
    dismissChatKanbanGeneration,
    displayAgents = [],
    fleetHostedApps = [],
    flushingChatQueueId,
    formatRelativeTime,
    generateKanbanTaskFromChat,
    handleChatFileChange,
    handleChatFileReferenceDrop,
    handleChatImageChange,
    hasStreamingChunk,
    machineGroups = [],
    messagesByAgent = {},
    messagesEndRef,
    messagesScrollRef,
    queuedChatMessages = [],
    recentDirectories = [],
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
    setChatThreadTitle,
    setMessagesByAgent,
    setStatusAgentId,
    setText,
    startAgentChat,
    startAudioRecording,
    status,
    statusAgentId,
    stopAudioRecording,
    text,
    toggleDashboardTheme,
    updateAgent,
    updateChatAutoScroll,
    visibleMessages = [],
    voiceTarget,
    ChatMarkdown,
  } = props;

  const renderMessages = useMemo(() => collapseSameTurnGenerationMessages(visibleMessages), [visibleMessages]);
  const { chatThreadTitleConfig, updateChatThreadTitleConfig } = useChatThreadTitleConfig();
  const prefs = useChatViewPreferences();

  const [shelfOpen, setShelfOpen] = useState(true);
  const [shelfMode, setShelfMode] = useState<ShelfMode>("details");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [openInOpen, setOpenInOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [agentMenuSearchQuery, setAgentMenuSearchQuery] = useState("");
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [copiedAll, setCopiedAll] = useState(false);
  const [toast, setToast] = useState("");
  const [openKanbanTaskMenuKey, setOpenKanbanTaskMenuKey] = useState("");
  const [copiedMessageKey, setCopiedMessageKey] = useState("");
  const [feedbackBusyKey, setFeedbackBusyKey] = useState("");
  const [agentMode, setAgentMode] = useState<"plan" | "act">("act");
  const [permissionMode, setPermissionMode] = useState<ChatPermissionMode>("manual");
  const [reasoningEffort, setReasoningEffort] = useState<ChatReasoningEffort>("medium");
  const [threadTitleSettingsOpen, setThreadTitleSettingsOpen] = useState(false);
  const [statusChecking, setStatusChecking] = useState(false);
  const [usage, setUsage] = useState<ChatThreadUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [stickyChatProcess, setStickyChatProcess] = useState<any[]>([]);
  const [stickyChatProcessTargetKey, setStickyChatProcessTargetKey] = useState("");

  const scrollNodeRef = useRef<HTMLDivElement | null>(null);
  const threadNodeRef = useRef<HTMLDivElement | null>(null);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);
  const headerPopRef = useRef<HTMLDivElement | null>(null);
  const stickyChatProcessSignatureRef = useRef("");
  const previousChatScrollKeyRef = useRef("");
  const chatScrollFrameRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const threadStartedAtRef = useRef<number>(Date.now());
  const composerFormRef = useRef<HTMLFormElement | null>(null);

  const flashToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2200);
  }, []);
  useEffect(() => () => { if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current); }, []);

  async function submitMessageFeedback(message: any, renderKey: string, rating: "up" | "down") {
    const sessionId = String(message?.sourceSessionId ?? "").trim();
    const messageIndex = Number(message?.sourceIndex);
    if (!sessionId) return;
    const nextRating = message.feedback?.rating === rating ? null : rating;
    const pendingKey = `${renderKey}:${rating}`;
    const storageKey = selectedChatStorageKey;
    setFeedbackBusyKey(pendingKey);
    try {
      const response = await fetch("/api/chat/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          messageIndex: Number.isInteger(messageIndex) ? messageIndex : undefined,
          messageFingerprint: evaluationOutputFingerprint(message.content),
          rating: nextRating,
        }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; feedback?: unknown; error?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not save response feedback.");
      const feedback = normalizeEvaluationHumanFeedback(data.feedback);
      setMessagesByAgent((current: any) => {
        const threadMessages = current[storageKey] ?? [];
        const nextMessages = threadMessages.map((item: any) => (
          item.sourceSessionId === sessionId && (
            Number.isInteger(messageIndex)
              ? Number(item.sourceIndex) === messageIndex
              : evaluationOutputFingerprint(item.content) === evaluationOutputFingerprint(message.content)
          )
            ? { ...item, feedback }
            : item
        ));
        return { ...current, [storageKey]: nextMessages };
      });
      flashToast(nextRating ? "Response feedback saved" : "Response feedback removed");
    } catch (error) {
      flashToast(error instanceof Error ? error.message : "Could not save response feedback");
    } finally {
      setFeedbackBusyKey((current) => current === pendingKey ? "" : current);
    }
  }

  const liveProcessEvents = normalizeProcessEvents(selectedChatProcess);
  const chatProcessScopeKey = `${selectedChatStorageKey || ""}${selectedChatLeafKey || ""}`;
  const activeTurnProcessTargetKey = (() => {
    for (let index = renderMessages.length - 1; index >= 0; index -= 1) {
      if (renderMessages[index]?.role === "user") return `${chatProcessScopeKey}user${messageKey(renderMessages[index], index)}`;
    }
    for (let index = renderMessages.length - 1; index >= 0; index -= 1) {
      if (renderMessages[index]?.role === "assistant") return `${chatProcessScopeKey}assistant${messageKey(renderMessages[index], index)}`;
    }
    return "";
  })();
  const activeTurnMessageProcessEvents = (() => {
    let latestUserIndex = -1;
    for (let index = renderMessages.length - 1; index >= 0; index -= 1) {
      if (renderMessages[index]?.role === "user") { latestUserIndex = index; break; }
    }
    for (let index = renderMessages.length - 1; index > latestUserIndex; index -= 1) {
      const message = renderMessages[index];
      if (message?.role !== "assistant") continue;
      const events = normalizeProcessEvents(message.processEvents ?? message.events);
      if (events.length) return events;
    }
    return [];
  })();
  const processTargetKeys = useMemo(() => new Set(renderMessages.flatMap((message: any, index: number) => {
    const key = messageKey(message, index);
    return [`${chatProcessScopeKey}user${key}`, `${chatProcessScopeKey}assistant${key}`];
  })), [chatProcessScopeKey, renderMessages]);
  const stickyProcessBelongsToCurrentThread = Boolean(stickyChatProcessTargetKey && processTargetKeys.has(stickyChatProcessTargetKey));
  const currentProcessEvents = mergeProcessEvents(activeTurnMessageProcessEvents, liveProcessEvents);
  const currentProcessSignature = currentProcessEvents
    .map((event: any) => [event?.at, event?.label, event?.detail, event?.status, event?.runId].join(""))
    .join("");

  useEffect(() => {
    if (!currentProcessEvents.length) return;
    if (stickyChatProcessSignatureRef.current !== currentProcessSignature) {
      stickyChatProcessSignatureRef.current = currentProcessSignature;
      setStickyChatProcess(currentProcessEvents);
      setStickyChatProcessTargetKey(activeTurnProcessTargetKey);
    }
  }, [activeTurnProcessTargetKey, currentProcessEvents, currentProcessSignature]);

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
      setOpenKanbanTaskMenuKey((current) => (current === key ? "" : current));
    }, 2600);
    return () => window.clearTimeout(timeout);
  }, [chatKanbanGeneration, dismissChatKanbanGeneration]);

  useEffect(() => {
    if (!agentMenuOpen) return undefined;
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (agentMenuRef.current?.contains(target)) return;
      setAgentMenuOpen(false);
      setAgentMenuSearchQuery("");
    }
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [agentMenuOpen]);

  useEffect(() => {
    if (!moreOpen && !openInOpen) return undefined;
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (headerPopRef.current?.contains(target)) return;
      setMoreOpen(false);
      setOpenInOpen(false);
    }
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [moreOpen, openInOpen]);

  // Per-thread token/cost. Never fabricates: `tokensAvailable` gates the row.
  useEffect(() => {
    if (!selectedChatStorageKey) { setUsage(null); return undefined; }
    let cancelled = false;
    setUsageLoading(true);
    fetch(`/api/chat/thread-usage?chatStorageKey=${encodeURIComponent(selectedChatStorageKey)}`)
      .then((response) => response.json())
      .then((payload) => { if (!cancelled) setUsage((payload?.data ?? payload) as ChatThreadUsage); })
      .catch(() => { if (!cancelled) setUsage(null); })
      .finally(() => { if (!cancelled) setUsageLoading(false); });
    return () => { cancelled = true; };
  }, [selectedChatStorageKey, busy]);

  useEffect(() => { threadStartedAtRef.current = Date.now(); }, [selectedChatStorageKey]);

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

  const pendingAssistantStatusText = busy && !hasStreamingChunk ? coldStartStatusText(currentProcessEvents, selectedAgent) : undefined;

  const lastVisibleMessage = renderMessages.length ? renderMessages[renderMessages.length - 1] : null;
  const chatScrollKey = `${selectedChatStorageKey || ""}${selectedChatLeafKey || ""}`;
  const chatScrollSignature = [
    renderMessages.length,
    lastVisibleMessage?.role ?? "",
    lastVisibleMessage ? messageText(lastVisibleMessage, chatDisplayContent).length : 0,
    normalizeProcessEvents(lastVisibleMessage?.processEvents ?? lastVisibleMessage?.events).length,
    String(lastVisibleMessage?.applicationGeneration?.status ?? lastVisibleMessage?.imageGeneration?.status ?? ""),
    busy ? "busy" : "idle",
    hasStreamingChunk ? "chunk" : "empty",
  ].join("");

  const scheduleChatScrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (chatScrollFrameRef.current !== null) window.cancelAnimationFrame(chatScrollFrameRef.current);
    chatScrollFrameRef.current = window.requestAnimationFrame(() => {
      chatScrollFrameRef.current = null;
      const node = scrollNodeRef.current;
      if (!node) return;
      const reduceMotion = behavior === "smooth" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      node.scrollTo({ top: node.scrollHeight, behavior: reduceMotion ? "auto" : behavior });
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
    scheduleChatScrollToBottom(chatChanged || hasStreamingChunk ? "auto" : "smooth");
  }, [chatAutoScrollRef, chatScrollKey, chatScrollSignature, hasStreamingChunk, scheduleChatScrollToBottom, selectedChatHistoryLoading]);

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

  useEffect(() => () => { if (chatScrollFrameRef.current !== null) window.cancelAnimationFrame(chatScrollFrameRef.current); }, []);

  function handleScroll(event: any) {
    messagesScrollRef.current = event.currentTarget;
    if (chatAutoScrollRef) chatAutoScrollRef.current = isChatScrollNearBottom(event.currentTarget);
    updateChatAutoScroll?.();
  }
  function attachScrollNode(node: HTMLDivElement | null) {
    scrollNodeRef.current = node;
    messagesScrollRef.current = node;
  }

  const runtimeLabel = titleCaseLabel(selectedAgent?.runtime);
  const providerLabel = titleCaseLabel(chatCurrentProvider);
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

  const processEventsForDisplay = currentProcessEvents.length
    ? currentProcessEvents
    : stickyProcessBelongsToCurrentThread ? stickyChatProcess : [];
  const processEventsTargetKey = currentProcessEvents.length
    ? activeTurnProcessTargetKey
    : stickyProcessBelongsToCurrentThread ? stickyChatProcessTargetKey : activeTurnProcessTargetKey;
  const activeChatTaskRunning = busy || processEventsAreActive(processEventsForDisplay);
  const liveOutput = processText(processEventsForDisplay);

  const runningChatStorageKeys = useMemo(() => new Set(Object.keys(chatStreamingByKey ?? {})), [chatStreamingByKey]);

  // ---- sidebar rows, from the real chat tree -------------------------------
  const machinesWithChats = useMemo(() => (
    chatSidebarTree.filter((machine: any) => machine.key !== "unassigned" && !isFixtureChatMachine(machine))
  ), [chatSidebarTree]);

  const sidebarRows = useMemo<SidebarRow[]>(() => {
    const rows: SidebarRow[] = [];
    for (const machine of chatSidebarTree) {
      const isGeneral = machine.key === "unassigned";
      for (const folder of machine.folders ?? []) {
        for (const chat of folder.chats ?? []) {
          const agentId = String(chat.agentId ?? "");
          if (!agentId) continue;
          const leafKey = String(chat.key ?? "");
          const storageKey = !leafKey || leafKey === `agent-${agentId}` ? agentId : `${agentId}::${leafKey}`;
          const running = runningChatStorageKeys.has(storageKey) || transcriptCardIsRunning(String(chat.subtitle ?? ""));
          rows.push({
            storageKey,
            agentId,
            agentName: displayAgents.find((agent: any) => agent.id === agentId)?.name ?? agentId,
            machineName: isGeneral ? "" : machine.name,
            projectLabel: isGeneral ? "" : folder.label,
            workingDirectoryPath: folder.path,
            title: chatThreadTitles[storageKey]?.title || chat.title,
            subtitle: chat.subtitle,
            status: running ? "active" : "idle",
            updatedAt: Number(chat.updatedAt ?? 0),
            active: Boolean(chat.active),
            running,
            onOpen: chat.onOpen,
          });
        }
      }
    }
    return rows;
  }, [chatSidebarTree, chatThreadTitles, displayAgents, runningChatStorageKeys]);

  const machineNames = useMemo(() => machinesWithChats.map((machine: any) => machine.name), [machinesWithChats]);

  const newChatTarget = useMemo(() => {
    for (const machine of chatSidebarTree) {
      for (const folder of machine.folders ?? []) {
        const holdsActiveChat = folder.active || (folder.chats ?? []).some((chat: any) => chat.active);
        if (!holdsActiveChat) continue;
        if (folder.onStartChat) return { label: folder.label, onStartChat: folder.onStartChat };
        if (machine.onStartChat) return { label: machine.name, onStartChat: machine.onStartChat };
      }
    }
    const fallback = machinesWithChats.find((machine: any) => machine.onStartChat);
    return fallback?.onStartChat ? { label: fallback.name, onStartChat: fallback.onStartChat } : null;
  }, [chatSidebarTree, machinesWithChats]);

  // ---- agent menu ----------------------------------------------------------
  const normalizedAgentMenuSearchQuery = normalizeSearchText(agentMenuSearchQuery);
  const agentMenuRows = useMemo(() => machinesWithChats
    .map((machine: any) => ({ machine, agents: (machineGroups.find((group: any) => group.key === machine.key)?.agents ?? []).filter((agent: any) => agent?.id) }))
    .filter((item: any) => item.agents.length > 0)
    .flatMap(({ machine, agents }: any) => agents.map((agent: any) => ({
      agent,
      machine,
      machineMenuLabel: agentMenuMachineLabel(machine, agent),
      statusLabel: agentMenuStatusLabel(machine, agent),
      runtimeIdentity: agentMenuRuntimeIdentity(agent, runtimeModelSelectionsByRuntime),
    })))
    .filter(({ agent, machine, machineMenuLabel, statusLabel }: any) => {
      if (!normalizedAgentMenuSearchQuery) return true;
      const searchable = normalizeSearchText([agent?.name, agent?.runtime, agent?.provider, agent?.model, agent?.workerClass, machine?.name, machineMenuLabel, statusLabel].filter(Boolean).join(" "));
      return normalizedAgentMenuSearchQuery.split(" ").every((token) => searchable.includes(token));
    }), [machinesWithChats, machineGroups, normalizedAgentMenuSearchQuery, runtimeModelSelectionsByRuntime]);

  // ---- thread actions ------------------------------------------------------
  function handleDeleteThread(storageKey: string) {
    setMessagesByAgent?.((current: Record<string, any[]>) => deleteChatThread(current, storageKey));
    prefs.archive(storageKey);
    // Local state is only half the thread: its runtime session files still back
    // the Run telemetry shelf, and its rows still sit in the local event log.
    // Best-effort — the client-side delete already happened, and a static
    // desktop build has no /api server to reach.
    void fetch(`/api/chat/thread?chatStorageKey=${encodeURIComponent(storageKey)}`, { method: "DELETE" })
      .catch(() => undefined);
    flashToast("Chat deleted");
  }

  function handleDuplicateThread(storageKey: string) {
    const seed = duplicateChatThreadSeed(messagesByAgent, storageKey, Date.now());
    if (!seed) { flashToast("Nothing to duplicate"); return; }
    const agentId = storageKey.includes("::") ? storageKey.slice(0, storageKey.indexOf("::")) : storageKey;
    startAgentChat?.(agentId, { fresh: true, chatLeafKey: seed.leafKey, seedMessages: seed.seedMessages });
    flashToast("Chat duplicated");
  }

  function applyRename() {
    const next = renameDraft.trim();
    setRenameOpen(false);
    if (!next || !selectedChatStorageKey) return;
    setChatThreadTitle?.(selectedChatStorageKey, next);
    flashToast("Thread renamed");
  }

  function copyChat() {
    const transcript = serializeChatTranscript(renderMessages, { agentName: selectedAgent?.name, displayContent: chatDisplayContent });
    void navigator.clipboard?.writeText(transcript).then(() => {
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1600);
    }).catch(() => flashToast("Could not copy the transcript"));
    setMoreOpen(false);
  }

  const deliverables = useMemo(() => deliverablesFromMessages(renderMessages), [renderMessages]);
  const previewTargets = useMemo(() => selectChatPreviewTargets(fleetHostedApps, machineLabel), [fleetHostedApps, machineLabel]);

  const collectorUrl = useMemo(() => (
    machineGroups.find((group: any) => group.key === selectedChatMachine?.key)?.collectorUrl ?? ""
  ), [machineGroups, selectedChatMachine?.key]);

  const threadTitle = (selectedChatStorageKey && chatThreadTitles[selectedChatStorageKey]?.title) || selectedChatDirectory || "agent chat";
  const agentSubline = [selectedAgent?.workerClass ?? selectedAgent?.beeRole, machineLabel].filter(Boolean).join(" · ");
  const headerSubline = selectedAgent
    ? `${runtimeLabel} · ${machineLabel}${selectedChatDirectory ? ` · ${selectedChatDirectory}` : ""}`
    : "Pick a chat from the rail.";

  const iconProps = { Activity, Check, ChevronDown, ChevronUp, CircleAlert, Copy, FileText, GitBranch, Hammer, KanbanSquare, LoaderCircle, Pencil, Search, Sparkles, Terminal };

  if (activeView !== "chat") return <ChatFolderModal {...props} />;

  const canSend = Boolean((text ?? "").trim() || chatAttachments.length || chatDirectories.length);

  return (
    <>
      <section className="fr-root fr-chat-root" aria-label="Agent chat">
        <div className="fr-chat-layout" data-shelf-open={shelfOpen ? "true" : "false"}>
          <ChatSidebar
            rows={sidebarRows}
            machineNames={machineNames}
            prefs={prefs}
            search={sidebarSearch}
            onSearchChange={setSidebarSearch}
            theme={dashboardTheme === "hive-light" ? "light" : "dark"}
            onToggleTheme={() => toggleDashboardTheme?.()}
            onNewChat={newChatTarget ? () => newChatTarget.onStartChat?.() : undefined}
            newChatLabel={newChatTarget ? `New chat in ${newChatTarget.label}` : undefined}
            onDuplicate={handleDuplicateThread}
            onDelete={handleDeleteThread}
            footerLabel={`${machineLabel} · tailnet-only`}
            loading={selectedChatHistoryLoading && !sidebarRows.length}
          />

          <main className="fr-chat-main" aria-label="Current chat">
            <header className="fr-chat-header" style={{ padding: "13px 18px" }}>
              <div className="fr-chat-agent-picker" ref={agentMenuRef} style={{ paddingRight: shelfOpen ? 8 : 96 }}>
                <button
                  type="button"
                  className="fr-chat-agent-trigger cx-agenttrigger"
                  title="Choose the machine and agent for this chat"
                  aria-haspopup="dialog"
                  aria-expanded={agentMenuOpen}
                  onClick={() => { if (agentMenuOpen) setAgentMenuSearchQuery(""); setAgentMenuOpen((open) => !open); }}
                >
                  <span className="fr-chat-agent-avatar">
                    {iconSrc
                      ? <span className="fr-chat-agent-avatar-image" style={{ backgroundImage: `url(${iconSrc})` }} aria-hidden />
                      : selectedAgent ? <span>{agentInitials(selectedAgent)}</span> : <HiveMark size={20} stroke="var(--honey)" />}
                  </span>
                  <span className="fr-chat-agent-copy">
                    <span className="fr-chat-agent-title-row">
                      <span className="fr-chat-agent-title">{selectedAgent?.name ?? "Hive overview"}</span>
                      <span className="fr-chat-agent-state" style={{ color: state.text }}>
                        <Dot state={stateKey} size={5} /> {state.label}
                      </span>
                    </span>
                    <span className="fr-chat-agent-subline" title={headerSubline}>{headerSubline}</span>
                  </span>
                  {ChevronDown ? <ChevronDown aria-hidden className="fr-chat-agent-chevron" data-open={agentMenuOpen ? "true" : undefined} /> : null}
                </button>
                {agentMenuOpen ? (
                  <div className="fr-chat-agent-menu cx-pop" role="dialog" aria-label="Choose chat agent">
                    <label className="fr-chat-agent-menu-search">
                      {Search ? <Search aria-hidden /> : null}
                      <input
                        type="search"
                        value={agentMenuSearchQuery}
                        onChange={(event) => setAgentMenuSearchQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") return;
                          event.preventDefault();
                          event.stopPropagation();
                          if (agentMenuSearchQuery) setAgentMenuSearchQuery("");
                          else { setAgentMenuOpen(false); setAgentMenuSearchQuery(""); }
                        }}
                        placeholder="Search agents"
                        aria-label="Search agents by name, machine, runtime, or model"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <div className="fr-chat-agent-menu-list" role="menu" aria-label="Agents">
                      {agentMenuRows.length ? agentMenuRows.map(({ machine, agent, machineMenuLabel, statusLabel, runtimeIdentity }: any) => {
                        const agentIconSrc = selectedAgentIcon(agent, beeRoleIconPath);
                        return (
                          <button
                            type="button"
                            role="menuitem"
                            key={`${machine.key}-${agent.id}`}
                            className={agent.id === selectedAgent?.id ? "active" : undefined}
                            onClick={() => {
                              startAgentChat?.(agent.id, { fresh: true, chatLeafKey: `machine-${machine.key}-${agent.id}` });
                              setAgentMenuOpen(false);
                              setAgentMenuSearchQuery("");
                            }}
                          >
                            <span className={`fr-chat-agent-menu-icon${agentIconSrc ? " has-image" : ""}`} style={agentIconSrc ? { backgroundImage: `url(${agentIconSrc})` } : undefined} aria-hidden>
                              {agentIconSrc ? null : <b>{agentInitials(agent)}</b>}
                            </span>
                            <span>
                              <strong>{agent.name}</strong>
                              <small>
                                {runtimeIdentity.provider && runtimeIdentity.model ? `${runtimeIdentity.runtime} / ${runtimeIdentity.provider}/${runtimeIdentity.model}` : runtimeIdentity.runtime}
                                {" / "}{machineMenuLabel}
                                {statusLabel && statusLabel !== agent.name ? ` / ${statusLabel.replace(`${agent.name} / `, "")}` : ""}
                              </small>
                            </span>
                          </button>
                        );
                      }) : <p className="fr-chat-empty-text">{normalizedAgentMenuSearchQuery ? "No agents match that search" : "No chat agents found"}</p>}
                    </div>
                  </div>
                ) : null}
              </div>
            </header>

            <div ref={attachScrollNode} className="cx-scroll fr-chat-scroller" onScroll={handleScroll} aria-busy={selectedChatHistoryLoading} style={{ minHeight: 0, overflow: "auto", padding: "26px 24px 14px" }}>
              <div ref={threadNodeRef} className="fr-chat-content-rail fr-chat-thread-rail" style={{ display: "grid", gap: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
                  {renameOpen ? (
                    <input
                      type="text"
                      value={renameDraft}
                      autoFocus
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onBlur={applyRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") { event.preventDefault(); applyRename(); }
                        if (event.key === "Escape") { event.preventDefault(); setRenameOpen(false); }
                      }}
                      aria-label="Rename thread"
                      style={{ flexShrink: 0, minWidth: 180, border: "1px solid var(--honey-line)", borderRadius: 8, background: "var(--panel)", color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 12, padding: "5px 9px", outline: 0 }}
                    />
                  ) : (
                    <span style={{ flexShrink: 0, fontFamily: "var(--f-body)", fontSize: 12, fontWeight: 500, color: "var(--fg-3)" }}>{threadTitle}</span>
                  )}
                  <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
                </div>

                {selectedChatHistoryLoading ? <HistorySkeleton /> : (
                  <MessageThread
                    AgentResponseLoader={AgentResponseLoader}
                    ChatMarkdown={ChatMarkdown}
                    FileText={FileText}
                    Send={Send}
                    activeChatTaskRunning={activeChatTaskRunning}
                    agentSubline={agentSubline}
                    busy={busy}
                    chatDisplayContent={chatDisplayContent}
                    chatKanbanGeneration={chatKanbanGeneration}
                    chatProcessScopeKey={chatProcessScopeKey}
                    copiedMessageKey={copiedMessageKey}
                    feedbackBusyKey={feedbackBusyKey}
                    dismissChatKanbanGeneration={dismissChatKanbanGeneration}
                    formatRelativeTime={formatRelativeTime}
                    generateKanbanTaskFromChat={generateKanbanTaskFromChat}
                    hasStreamingChunk={hasStreamingChunk}
                    iconProps={iconProps}
                    messages={renderMessages}
                    openKanbanTaskMenuKey={openKanbanTaskMenuKey}
                    pendingAssistantStatusText={pendingAssistantStatusText}
                    processEventsForDisplay={processEventsForDisplay}
                    processEventsTargetKey={processEventsTargetKey}
                    selectedAgent={selectedAgent}
                    sendPromptMessage={sendPromptMessage}
                    onMessageFeedback={submitMessageFeedback}
                    setCopiedMessageKey={setCopiedMessageKey}
                    setOpenKanbanTaskMenuKey={setOpenKanbanTaskMenuKey}
                  />
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <section className="fr-chat-composer-dock" aria-label="Message composer" style={{ position: "relative", zIndex: 5, padding: "8px 24px 18px" }}>
              <div className="fr-chat-content-rail fr-chat-composer-rail">
                {queuedChatMessages.length ? (
                  <div className="cx-fade" style={{ display: "grid", gap: 8, border: "1px solid var(--line)", borderRadius: 14, background: "var(--panel-2)", color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "9px 11px", marginBottom: 8 }} aria-label="Queued messages">
                    <strong style={{ color: "var(--fg)" }}>{queuedChatMessages.length} queued</strong>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                      {queuedChatMessages.slice(0, 3).map((item: any, index: number) => (
                        <span key={item.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--line-2)", borderRadius: 999, background: "var(--panel)", padding: "5px 8px" }}>
                          <span>{item.label || `Queued ${index + 1}`}</span>
                          <button type="button" className="fr-chat-mini-button" onClick={() => sendQueuedChatMessageNow?.(item.id)} disabled={busy || Boolean(flushingChatQueueId)} aria-label="Send now">↑</button>
                          <button type="button" className="fr-chat-mini-button" onClick={() => removeQueuedChatMessage?.(item.id)} disabled={flushingChatQueueId === item.id} aria-label="Remove">×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <form ref={composerFormRef} onSubmit={sendMessage}>
                  <ExchangeComposer
                    value={text ?? ""}
                    onChange={setText}
                    placeholder={selectedAgent ? `Message ${selectedAgent.name}…  ⌘↵ to send` : "Pick an agent to start"}
                    busy={busy && !hasStreamingChunk}
                    canSend={canSend}
                    onSubmit={() => composerFormRef.current?.requestSubmit()}
                    agentMode={agentMode}
                    permissionMode={permissionMode}
                    onPermissionModeChange={(mode) => {
                      const normalized = normalizeChatPermissionMode(mode);
                      setPermissionMode(normalized);
                      setAgentMode(normalized === "plan" ? "plan" : "act");
                    }}
                    reasoningEffort={reasoningEffort}
                    onReasoningEffortChange={(effort) => setReasoningEffort(normalizeChatReasoningEffort(effort))}
                    modelProviders={chatModelProviders}
                    currentProvider={chatCurrentProvider}
                    currentModel={chatCurrentModel}
                    onSelectModel={selectChatModel}
                    onOpenModelMenu={() => { if (selectedAgent && !chatModelProviders.length) void refreshRuntimeIntegrations?.(selectedAgent); }}
                    modelPickerEnabled={modelPickerEnabled}
                    attachments={chatAttachments}
                    onRemoveAttachment={removeChatAttachment}
                    fileInputRef={chatFileInputRef}
                    imageInputRef={chatImageInputRef}
                    onFileChange={handleChatFileChange}
                    onDropFileReferences={handleChatFileReferenceDrop}
                    onImageChange={handleChatImageChange}
                    onAttachDirectory={attachChatDirectory ? () => void attachChatDirectory() : undefined}
                    directories={chatDirectories}
                    onRemoveDirectory={removeChatDirectory}
                    recentDirectories={recentDirectories}
                    onAttachRecentDirectory={attachChatRecentDirectory}
                    machines={machinesWithChats.map((machine: any) => ({ key: machine.key, name: machine.name, detail: machine.detail }))}
                    selectedMachineName={selectedChatMachine?.name ?? ""}
                    workingDirectoryLabel={selectedChatDirectory ?? ""}
                    onChangeWorkingDirectory={changeChatWorkingDirectory ? () => void changeChatWorkingDirectory() : undefined}
                    recording={recording && voiceTarget === "chat"}
                    onToggleRecording={() => (recording ? stopAudioRecording?.() : void startAudioRecording?.("chat"))}
                    onSwarmCommand={() => {
                      const current = (text ?? "").trim();
                      setText(current && !current.toLowerCase().startsWith("/swarm") ? `/swarm ${current}` : "/swarm ");
                    }}
                  />
                </form>
              </div>
            </section>

            {terminalOpen ? (
              <ChatTerminalDrawer
                machineName={machineLabel}
                machineKey={selectedChatMachine?.key ?? "local"}
                collectorUrl={collectorUrl}
                workingDirectory={selectedChatDirectory ?? ""}
                onClose={() => setTerminalOpen(false)}
              />
            ) : null}
          </main>

          <aside className="fr-chat-shelf" aria-label="Chat details" style={{ position: "relative", minWidth: 0, overflow: "hidden", borderLeft: "1px solid var(--line)", background: "color-mix(in srgb, var(--bg-soft) 88%, transparent)" }}>
            <div className="cx-scroll" style={{ display: "grid", alignContent: "start", gap: 20, width: "100%", maxWidth: 366, height: "100%", overflowY: "auto", overflowX: "hidden", padding: "60px 18px 24px" }}>
              <ContextShelf
                mode={shelfMode}
                onModeChange={setShelfMode}
                taskTitle={threadTitle}
                statusLabel={activeChatTaskRunning ? "Working" : state.label}
                statusColor={activeChatTaskRunning ? "var(--live)" : state.text}
                agentLine={[selectedAgent?.name, selectedAgent?.workerClass ?? selectedAgent?.beeRole].filter(Boolean).join(", ")}
                machineLabel={machineLabel}
                runtimes={runtimeLabel ? [runtimeLabel] : []}
                providers={providerLabel ? [providerLabel] : []}
                models={chatCurrentModel ? [chatCurrentModel] : []}
                elapsedLabel={activeChatTaskRunning ? elapsedLabel(threadStartedAtRef.current, Date.now()) : "—"}
                workingDirectory={selectedChatDirectory ?? ""}
                usage={usage}
                usageLoading={usageLoading}
                messageCount={renderMessages.length}
                liveOutput={liveOutput}
                live={activeChatTaskRunning}
                deliverables={deliverables}
                onOpenDeliverable={(deliverable) => { if (deliverable.url) window.open(deliverable.url, "_blank", "noopener,noreferrer"); }}
                previewTargets={previewTargets}
                onExpandPreview={() => setPreviewExpanded(true)}
              />
              {statusAgentId === selectedAgent?.id && status?.message ? <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.55 }}>{status.message}</p> : null}
              {statusChecking ? <p className="fr-eyebrow" style={{ margin: 0, color: "var(--live)" }}>checking status…</p> : null}
            </div>
          </aside>
        </div>

        {/* floating header controls — overlay the shelf when it is open */}
        <div ref={headerPopRef} style={{ position: "absolute", top: 14, right: 18, zIndex: 70, display: "flex", alignItems: "center", gap: 2 }}>
          {nativeOpenInAppSupported() && selectedChatDirectory ? (
            <div style={{ position: "relative" }}>
              <button type="button" className="cx-iconbtn" onClick={() => { setOpenInOpen((open) => !open); setMoreOpen(false); }} aria-expanded={openInOpen} title="Open working directory in an app" aria-label="Open in" style={headerIconBtnStyle(openInOpen)}>
                <Ico d={ICON_PATHS.openIn} size={18} sw={1.7} />
              </button>
              {openInOpen ? (
                <div className="cx-pop" role="menu" aria-label="Open in" style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 90, width: 214, ...POP_STYLE }}>
                  <div style={{ padding: "5px 9px 6px", fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--fg-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedChatDirectory}</div>
                  {(["vscode", "xcode", "terminal", "finder"] as const).map((app) => (
                    <button
                      key={app}
                      type="button"
                      className="cx-menuitem"
                      onClick={() => {
                        setOpenInOpen(false);
                        void openNativeInApp({ app, path: selectedChatDirectory }).then((result) => {
                          if (!result.ok) flashToast(result.error || `Could not open ${app}`);
                        });
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", border: 0, borderRadius: 9, background: "transparent", color: "var(--fg)", cursor: "pointer", padding: "8px 9px", textAlign: "left", fontSize: 13.5 }}
                    >
                      <span style={{ textTransform: "capitalize" }}>{app === "vscode" ? "VS Code" : app}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <button type="button" className="cx-iconbtn" onClick={() => setTerminalOpen((open) => !open)} aria-pressed={terminalOpen} title="Open shell on this machine" aria-label="Open terminal" style={headerIconBtnStyle(terminalOpen)}>
            <Ico d={ICON_PATHS.terminal} size={18} sw={1.7}><rect x="3" y="4" width="18" height="16" rx="2" /></Ico>
          </button>
          <button type="button" className="cx-iconbtn" onClick={() => { setShelfOpen(true); setShelfMode("preview"); }} aria-pressed={shelfMode === "preview"} title="Preview a hosted app on this machine" aria-label="Preview" style={headerIconBtnStyle(shelfMode === "preview")}>
            <Ico d={ICON_PATHS.eye} size={18} sw={1.7}><circle cx="12" cy="12" r="3" /></Ico>
          </button>

          <div style={{ position: "relative" }}>
            <button type="button" className="cx-iconbtn" onClick={() => { setMoreOpen((open) => !open); setOpenInOpen(false); }} aria-expanded={moreOpen} title="More actions" aria-label="More actions" style={headerIconBtnStyle(moreOpen)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></svg>
            </button>
            {moreOpen ? (
              <div className="cx-pop" role="menu" aria-label="More actions" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 90, width: 238, ...POP_STYLE }}>
                <button type="button" className="cx-menuitem" onClick={copyChat} style={moreItem}>
                  <Ico d={copiedAll ? ICON_PATHS.check : ICON_PATHS.copy} size={16} sw={1.7} stroke={copiedAll ? "var(--live)" : "currentColor"}>
                    {copiedAll ? null : <rect x="9" y="9" width="12" height="12" rx="2" />}
                  </Ico>
                  <span>{copiedAll ? "Copied chat" : "Copy chat"}</span>
                </button>
                <button type="button" className="cx-menuitem" onClick={() => { setShelfOpen(true); setShelfMode("files"); setMoreOpen(false); }} style={moreItem}>
                  <Ico d={["M4 5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z", "M4 10h16"]} size={16} sw={1.7} />
                  <span>Files</span>
                </button>
                <button type="button" className="cx-menuitem" onClick={() => { setMoreOpen(false); setRenameDraft(threadTitle); setRenameOpen(true); }} style={moreItem} disabled={!selectedChatStorageKey}>
                  <Ico d={ICON_PATHS.pencil} size={16} sw={1.7} />
                  <span>Rename thread</span>
                </button>
                <button type="button" className="cx-menuitem" onClick={() => { setMoreOpen(false); setThreadTitleSettingsOpen(true); }} style={moreItem}>
                  {Settings2 ? <Settings2 size={16} aria-hidden /> : null}
                  <span>Thread title settings</span>
                </button>
                <button type="button" className="cx-menuitem" onClick={() => { setMoreOpen(false); if (selectedChatStorageKey) handleDuplicateThread(selectedChatStorageKey); }} style={moreItem} disabled={!selectedChatStorageKey}>
                  <Ico d={ICON_PATHS.copy} size={16} sw={1.7}><rect x="9" y="9" width="12" height="12" rx="2" /></Ico>
                  <span>Duplicate chat</span>
                </button>
              </div>
            ) : null}
          </div>

          <button type="button" className="cx-iconbtn" onClick={() => setShelfOpen((open) => !open)} aria-pressed={shelfOpen} title="Toggle details panel" aria-label="Toggle details panel" style={headerIconBtnStyle(shelfOpen)}>
            <Ico d={ICON_PATHS.panel} size={17} sw={1.7}><rect x="3" y="4" width="18" height="16" rx="2" /></Ico>
          </button>
        </div>

        {previewExpanded && previewTargets.length ? (
          <div className="cx-slidefull fr-root fr-chat-root" style={{ position: "absolute", inset: 0, zIndex: 110, display: "grid", gridTemplateRows: "auto minmax(0,1fr)", background: "var(--bg)" }}>
            <header style={{ display: "flex", alignItems: "center", gap: 11, padding: "15px 20px", borderBottom: "1px solid var(--line)" }}>
              <HexIco size={20} />
              <span style={{ flex: 1, fontFamily: "var(--f-body)", fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>Preview · {previewTargets[0].name}</span>
              <button type="button" className="cx-iconbtn" onClick={() => setPreviewExpanded(false)} title="Collapse preview" aria-label="Collapse preview" style={headerIconBtnStyle(false)}>
                <Ico d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" size={17} sw={1.8} />
              </button>
            </header>
            <div className="cx-scroll" style={{ display: "grid", placeItems: "center", overflow: "auto", padding: 30 }}>
              <PreviewFrame target={previewTargets[0]} tall />
            </div>
          </div>
        ) : null}

        {toast ? (
          <div className="cx-pop" role="status" style={{ position: "absolute", left: "50%", bottom: 26, zIndex: 130, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 9, border: "1px solid var(--line-2)", borderRadius: 999, color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 11.5, padding: "9px 16px" }}>
            <span className="cx-dot-live" style={{ width: 7, height: 7, borderRadius: 99, background: "currentColor", color: "var(--live)" }} />
            {toast}
          </div>
        ) : null}
      </section>

      <ThreadTitleSettings
        agents={displayAgents}
        config={chatThreadTitleConfig}
        open={threadTitleSettingsOpen}
        runtimeModelSelectionsByRuntime={runtimeModelSelectionsByRuntime}
        onChange={updateChatThreadTitleConfig}
        onClose={() => setThreadTitleSettingsOpen(false)}
      />
      <ChatFolderModal {...props} />
    </>
  );
}

const moreItem: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  width: "100%",
  border: 0,
  borderRadius: 9,
  background: "transparent",
  color: "var(--fg)",
  cursor: "pointer",
  padding: "10px 11px",
  textAlign: "left",
  fontSize: 13.5,
};
