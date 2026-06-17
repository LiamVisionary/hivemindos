// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatFolderModal } from "@/features/dashboard/views/chat/ChatFolderModal";
import { ChatInlineMarkdown } from "@/features/dashboard/ChatMarkdown";
import { JsonRenderSurface, extractJsonRenderPayload } from "@/components/json-render/JsonRenderSurface";
import hiveChatStyles from "@/features/dashboard/views/chat/HiveChatView.module.css";
import { imageGenerationToApplicationGeneration } from "@/features/dashboard/chat-application-generation";
import { collapseSameTurnGenerationMessages } from "@/features/dashboard/chat-generation-message-dedupe";
import { generatedImageCardFromAssistantText } from "@/features/dashboard/chat-generated-media";
import { AgentProcessPanel, mergeProcessEvents, normalizeProcessEvents, processEventsAreActive } from "@/features/dashboard/views/chat/AgentProcessPanel";
import { ApplicationGenerationCard } from "@/features/dashboard/views/chat/ApplicationGenerationCard";
import {
  extractMiroSharkSimulationCard,
  MiroSharkSimulationCard,
} from "@/features/dashboard/views/chat/MiroSharkSimulationCard";
import {
  MODEL_SWITCHABLE_RUNTIMES,
  STATE_LABEL,
  agentInitials,
  agentMenuMachineLabel,
  agentMenuRuntimeIdentity,
  agentMenuStatusLabel,
  chatSearchSnippet,
  isChatScrollNearBottom,
  isFixtureChatMachine,
  markdownText,
  messageKey,
  messageText,
  normalizeSearchText,
  processText,
  promptUiFromMessage,
  selectedAgentIcon,
  shortModelLabel,
  titleCaseLabel,
} from "@/features/dashboard/views/chat/chat-panel-helpers";
import { createStyleClass } from "@/features/dashboard/style-classes";
import { LottiePlayer } from "@/components/ui/lottie-player";
import { Fragment, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

const hiveClass = createStyleClass(hiveChatStyles);

function InteractivePromptControls({
  disabled,
  options,
  sendPromptMessage,
  Send,
}: {
  disabled?: boolean;
  options: Array<{ label: string; value: string }>;
  sendPromptMessage?: (prompt: string) => void | Promise<void>;
  Send?: any;
}) {
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState("");
  if (!sendPromptMessage || !options.length) return null;
  const submitValue = (value: string) => {
    const prompt = value.trim();
    if (!prompt) return;
    void sendPromptMessage(prompt);
    setOtherText("");
    setOtherOpen(false);
  };
  return (
    <div className={hiveClass("hivePromptActions")} aria-label="Prompt response options">
      <div className={hiveClass("hivePromptChoiceGrid")}>
        {options.map((option, index) => (
          <button
            type="button"
            key={`${option.value}-${index}`}
            className={hiveClass("hivePromptChoiceButton")}
            onClick={() => submitValue(option.value)}
            disabled={disabled}
          >
            <span>{index + 1}</span>
            <strong>{option.label}</strong>
          </button>
        ))}
        <button
          type="button"
          className={hiveClass("hivePromptChoiceButton", "other")}
          onClick={() => setOtherOpen((open) => !open)}
          aria-expanded={otherOpen}
          disabled={disabled}
        >
          <span>{options.length + 1}</span>
          <strong>Other</strong>
        </button>
      </div>
      {otherOpen ? (
        <form
          className={hiveClass("hivePromptOtherForm")}
          onSubmit={(event) => {
            event.preventDefault();
            submitValue(otherText);
          }}
        >
          <input
            type="text"
            value={otherText}
            onChange={(event) => setOtherText(event.currentTarget.value)}
            placeholder="Type another answer..."
            disabled={disabled}
            autoFocus
          />
          <button type="submit" disabled={disabled || !otherText.trim()} aria-label="Send other answer">
            {Send ? <Send aria-hidden="true" /> : "Send"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

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

function renderInline(text: string) {
  const out: any[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      out.push(<strong key={`strong-${key++}`}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(<code key={`code-${key++}`}>{token.slice(1, -1)}</code>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
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

export const ChatPanel = memo(ChatPanelComponent);

// Memoized (see export above) so unrelated background re-renders skip this panel.
function ChatPanelComponent(props: any) {
  const {
    Activity,
    AgentResponseLoader,
    AlignLeft,
    Check,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    CircleAlert,
    Copy,
    FileText,
    Folder,
    FolderOpen,
    GitBranch,
    Hammer,
    KanbanSquare,
    LoaderCircle,
    MessageSquare,
    Monitor,
    Pencil,
    Plus,
    RefreshCcw,
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
    recentDirectories,
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
    startAgentChat,
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
    voiceBands,
    voiceTarget,
    voiceTranscript,
    ChatMarkdown,
    ComposerField,
  } = props;
  const renderMessages = useMemo(() => collapseSameTurnGenerationMessages(visibleMessages), [visibleMessages]);

  const [shelfOpen, setShelfOpen] = useState(false);
  const [generalOpen, setGeneralOpen] = useState(true);
  const [machinesOpen, setMachinesOpen] = useState(true);
  const [openMachines, setOpenMachines] = useState<Record<string, boolean>>({});
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [statusChecking, setStatusChecking] = useState(false);
  const [openKanbanTaskMenuKey, setOpenKanbanTaskMenuKey] = useState("");
  const [copiedMessageKey, setCopiedMessageKey] = useState("");
  const [chatCopied, setChatCopied] = useState(false);
  const [agentMode, setAgentMode] = useState<"plan" | "act">("act");
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [agentMenuSearchQuery, setAgentMenuSearchQuery] = useState("");
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [stickyChatProcess, setStickyChatProcess] = useState<any[]>([]);
  const [stickyChatProcessTargetKey, setStickyChatProcessTargetKey] = useState("");
  const scrollNodeRef = useRef<HTMLDivElement | null>(null);
  const threadNodeRef = useRef<HTMLDivElement | null>(null);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);
  const agentMenuSearchInputRef = useRef<HTMLInputElement | null>(null);
  const chatSearchInputRef = useRef<HTMLInputElement | null>(null);
  const stickyChatProcessSignatureRef = useRef("");
  const previousChatScrollKeyRef = useRef("");
  const chatScrollFrameRef = useRef<number | null>(null);
  const deferredChatSearchQuery = useDeferredValue(chatSearchQuery);
  const liveProcessEvents = normalizeProcessEvents(selectedChatProcess);
  const chatProcessScopeKey = `${selectedChatStorageKey || ""}\u001f${selectedChatLeafKey || ""}`;
  const activeTurnProcessTargetKey = (() => {
    for (let index = renderMessages.length - 1; index >= 0; index -= 1) {
      if (renderMessages[index]?.role === "user") {
        return `${chatProcessScopeKey}\u001fuser\u001f${messageKey(renderMessages[index], index)}`;
      }
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
    if (events.length) {
      if (stickyChatProcessSignatureRef.current !== currentProcessSignature) {
        stickyChatProcessSignatureRef.current = currentProcessSignature;
        setStickyChatProcess(events);
        setStickyChatProcessTargetKey(activeTurnProcessTargetKey);
      }
      return undefined;
    }
    return undefined;
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
      setOpenKanbanTaskMenuKey((current) => current === key ? "" : current);
    }, 2600);
    return () => window.clearTimeout(timeout);
  }, [chatKanbanGeneration, dismissChatKanbanGeneration]);

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
    if (chatScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(chatScrollFrameRef.current);
    }
    chatScrollFrameRef.current = window.requestAnimationFrame(() => {
      chatScrollFrameRef.current = null;
      const node = scrollNodeRef.current;
      if (!node) return;
      node.scrollTo({ top: node.scrollHeight, behavior });
    });
  }, []);

  useEffect(() => {
    if (!selectedAgent || selectedAgent.provider?.trim() || selectedAgent.model?.trim() || selectedRuntimeModelSelection) return;
    if (!["hermes", "openclaw"].includes(selectedAgent.runtime)) return;
    void refreshRuntimeIntegrations?.(selectedAgent);
  }, [refreshRuntimeIntegrations, selectedAgent, selectedRuntimeModelSelection]);

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
    if (chatScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(chatScrollFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (!agentMenuOpen) return undefined;
    window.requestAnimationFrame(() => agentMenuSearchInputRef.current?.focus());
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
    if (!chatSearchOpen) return;
    window.requestAnimationFrame(() => chatSearchInputRef.current?.focus());
  }, [chatSearchOpen]);

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
  const state = STATE_LABEL[stateKey] ?? STATE_LABEL.ready;
  const iconSrc = selectedAgentIcon(selectedAgent, beeRoleIconPath);
  const activeThreadLabel = selectedChatLeafKey || selectedChatStorageKey || "agent chat";
  const displayThreadLabel = friendlyThreadLabel(activeThreadLabel, selectedChatDirectory);
  const headerMetaLabel = "Connect a machine and choose an agent to start chatting.";
  const hasQueued = queuedChatMessages.length > 0;
  const processEventsForDisplay = currentProcessEvents.length ? currentProcessEvents : stickyChatProcess;
  const processEventsTargetKey = currentProcessEvents.length ? activeTurnProcessTargetKey : stickyChatProcessTargetKey;
  const activeChatTaskRunning = busy || processEventsAreActive(processEventsForDisplay);
  const runningChatStorageKeys = useMemo(() => new Set(Object.keys(chatStreamingByKey ?? {})), [chatStreamingByKey]);
  const runningChatIdentityKeys = useMemo(() => new Set(Object.values(chatStreamingByKey ?? {})
    .map((stream: any) => `${stream?.agentId ?? ""}\u001f${stream?.leafKey || `agent-${stream?.agentId ?? ""}`}`)
    .filter((key) => !key.startsWith("\u001f"))), [chatStreamingByKey]);
  const liveOutput = processText(processEventsForDisplay);
  const pendingAssistantBubbleVisible = busy && !hasStreamingChunk && renderMessages.some((message: any, index: number) => (
    index === renderMessages.length - 1
    && message?.role === "assistant"
    && !messageText(message, chatDisplayContent)
  ));
  const metrics = makeMetricRows(selectedAgent, runtimeLabel, providerLabel, modelLabel, machineLabel);
  const generalMachine = useMemo(() => chatSidebarTree.find((machine: any) => machine.key === "unassigned"), [chatSidebarTree]);
  const generalChats = useMemo(() => (
    (generalMachine?.folders ?? [])
      .flatMap((folder: any) => (folder.chats ?? []).map((chat: any) => ({ ...chat, folder, machine: generalMachine })))
      .slice(0, 8)
  ), [generalMachine]);
  const machinesWithChats = useMemo(() => (
    chatSidebarTree
      .filter((machine: any) => machine.key !== "unassigned")
      .map((machine: any) => {
        const folders = (machine.folders ?? []).filter((folder: any) => folder.active || folder.onStartChat || (folder.chats?.length ?? 0) > 0);
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
  const agentMenuMachines = machinesWithChats
    .map((machine: any) => ({
      machine,
      agents: (machineGroups.find((group: any) => group.key === machine.key)?.agents ?? []).filter((agent: any) => agent?.id),
    }))
    .filter((item: any) => item.agents.length > 0);
  const normalizedAgentMenuSearchQuery = normalizeSearchText(agentMenuSearchQuery);
  const agentMenuRows = agentMenuMachines.flatMap(({ machine, agents }: any) => agents
    .map((agent: any) => {
      const machineMenuLabel = agentMenuMachineLabel(machine, agent);
      const statusLabel = agentMenuStatusLabel(machine, agent);
      const runtimeIdentity = agentMenuRuntimeIdentity(agent, runtimeModelSelectionsByRuntime);
      return { agent, machine, machineMenuLabel, statusLabel, runtimeIdentity };
    })
    .filter(({ agent, machine, machineMenuLabel, statusLabel }: any) => {
      if (!normalizedAgentMenuSearchQuery) return true;
      const searchable = normalizeSearchText([
        agent?.name,
        agent?.runtime,
        agent?.provider,
        agent?.model,
        agent?.workerClass,
        machine?.name,
        machineMenuLabel,
        statusLabel,
      ].filter(Boolean).join(" "));
      return normalizedAgentMenuSearchQuery.split(" ").every((token) => searchable.includes(token));
    }));
  const chatSearchIndex = useMemo(() => {
    if (!chatSearchOpen) return [];
    const indexed = new Map<string, any>();
    function addChat(chat: any, machine: any, folder: any) {
      const cacheKey = `${chat.agentId ?? ""}:${chat.key ?? ""}`;
      if (indexed.has(cacheKey)) return;
      const content = String(chat.searchText ?? "").slice(0, 24000);
      const title = String(chat.title ?? "");
      const subtitle = String(chat.subtitle ?? "");
      const machineName = String(machine?.name ?? "");
      const folderLabel = String(folder?.label ?? "");
      indexed.set(cacheKey, {
        chat,
        content,
        folderLabel,
        machineName,
        normalizedContent: normalizeSearchText(content),
        normalizedLabel: normalizeSearchText([title, subtitle, machineName, folderLabel].join(" ")),
        subtitle,
        title,
        updatedAt: Number(chat.updatedAt || 0),
      });
    }
    for (const chat of generalChats) addChat(chat, chat.machine, chat.folder);
    for (const machine of machinesWithChats) {
      for (const folder of machine.folders ?? []) {
        for (const chat of folder.chats ?? []) addChat(chat, machine, folder);
      }
    }
    return [...indexed.values()];
  }, [chatSearchOpen, generalChats, machinesWithChats]);
  const normalizedChatSearchQuery = normalizeSearchText(deferredChatSearchQuery);
  const chatSearchResults = useMemo(() => {
    if (!normalizedChatSearchQuery) return [];
    const tokens = normalizedChatSearchQuery.split(" ").filter(Boolean).slice(0, 8);
    return chatSearchIndex
      .map((row) => {
        const labelHit = row.normalizedLabel.includes(normalizedChatSearchQuery);
        const contentHit = row.normalizedContent.includes(normalizedChatSearchQuery);
        const tokenHits = tokens.reduce((count, token) => (
          count + (row.normalizedLabel.includes(token) || row.normalizedContent.includes(token) ? 1 : 0)
        ), 0);
        const score = (labelHit ? 80 : 0) + (contentHit ? 42 : 0) + (tokenHits * 9);
        return { ...row, contentHit, score, snippet: chatSearchSnippet(row.content || row.subtitle || row.title, deferredChatSearchQuery) };
      })
      .filter((row) => row.score > 0)
      .sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt || left.title.localeCompare(right.title))
      .slice(0, 40);
  }, [chatSearchIndex, deferredChatSearchQuery, normalizedChatSearchQuery]);

  if (activeView !== "chat") {
    return <ChatFolderModal {...props} />;
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

  function copyMessageContent(key: string, content: string) {
    void navigator.clipboard?.writeText(content).then(() => {
      setCopiedMessageKey(key);
      window.setTimeout(() => setCopiedMessageKey((current) => current === key ? "" : current), 1400);
    });
  }

  function dismissKanbanPopover(key: string) {
    dismissChatKanbanGeneration?.(key);
    setOpenKanbanTaskMenuKey((current) => current === key ? "" : current);
  }

  function copyChatMarkdown() {
    const agentName = selectedAgent?.name ?? "Agent";
    const lines: string[] = [`# Chat with ${agentName}`, ""];
    for (const message of renderMessages) {
      const content = messageText(message, chatDisplayContent);
      if (!content) continue;
      const speaker = message.role === "user" ? "You" : message.role === "system" ? "System" : agentName;
      const timeLabel = Number.isFinite(message.createdAt) ? new Date(message.createdAt).toLocaleString() : "";
      lines.push(`**${speaker}**${timeLabel ? ` — ${timeLabel}` : ""}`, "", content, "");
    }
    void navigator.clipboard?.writeText(`${lines.join("\n").trim()}\n`).then(() => {
      setChatCopied(true);
      window.setTimeout(() => setChatCopied(false), 1400);
    });
  }

  function renderMessageActions(renderKey: string, content: string) {
    if (!content?.trim()) return null;
    const copied = copiedMessageKey === renderKey;
    const generationForMessage = chatKanbanGeneration?.key === renderKey ? chatKanbanGeneration : null;
    const generating = Boolean(generationForMessage && ["generating", "creating"].includes(generationForMessage.phase));
    const actions = (
      <div className={hiveClass("hiveMessageActions")}>
        <ButtonGroup>
          <Tooltip {...(copied ? { open: true } : {})}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                className="rounded-full"
                aria-label={copied ? "Copied message" : "Copy message"}
                onClick={() => copyMessageContent(renderKey, content)}
              >
                {copied && Check ? <Check aria-hidden="true" /> : Copy ? <Copy aria-hidden="true" /> : null}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{copied ? "Copied!" : "Copy message"}</TooltipContent>
          </Tooltip>
          {generateKanbanTaskFromChat ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  className="rounded-full"
                  aria-label="Generate Kanban task from this message"
                  disabled={generating}
                  onClick={() => setOpenKanbanTaskMenuKey((current) => current === renderKey ? "" : renderKey)}
                >
                  {generating && LoaderCircle ? <LoaderCircle aria-hidden="true" className={hiveClass("spinIcon")} /> : KanbanSquare ? <KanbanSquare aria-hidden="true" /> : null}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Send to Kanban</TooltipContent>
            </Tooltip>
          ) : null}
        </ButtonGroup>
        {generateKanbanTaskFromChat && (openKanbanTaskMenuKey === renderKey || generationForMessage) ? (
          <div className={hiveClass("hiveKanbanPopover")}>
            <div className={hiveClass("hiveKanbanPopoverHeader")}>
              {generationForMessage?.phase === "done" && Check ? <Check aria-hidden="true" /> : Sparkles ? <Sparkles aria-hidden="true" /> : null}
              <span>{generationForMessage ? generationForMessage.message : "Generate and send to:"}</span>
              {!generationForMessage || ["done", "error"].includes(generationForMessage.phase) ? (
                <button type="button" className={hiveClass("hiveKanbanPopoverClose")} aria-label="Close Kanban menu" onClick={() => dismissKanbanPopover(renderKey)}>
                  x
                </button>
              ) : null}
            </div>
            {generationForMessage ? (
              <small>{generationForMessage.taskTitle || (generationForMessage.status === "ready" ? "Ready lane" : "Ideas lane")}</small>
            ) : (
              <div className={hiveClass("hiveKanbanPopoverActions")}>
                <button
                  type="button"
                  onClick={() => {
                    setOpenKanbanTaskMenuKey(renderKey);
                    void generateKanbanTaskFromChat("ideas", { key: renderKey, content });
                  }}
                >
                  Ideas
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpenKanbanTaskMenuKey(renderKey);
                    void generateKanbanTaskFromChat("ready", { key: renderKey, content });
                  }}
                >
                  Ready
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
    return <TooltipProvider>{actions}</TooltipProvider>;
  }

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

  function renderThinkingLoader() {
    return AgentResponseLoader ? (
      <AgentResponseLoader />
    ) : (
      <span className={hiveClass("hiveTypingDots")} aria-label="Agent is thinking">
        <i />
        <i />
        <i />
      </span>
    );
  }

  function renderTaskBee(active?: boolean) {
    return active ? (
      <span className={hiveClass("hiveTaskBee")} aria-label="Task running">
        <LottiePlayer src="/animations/Honey%20bee.lottie" size={18} ariaLabel="Task running" />
      </span>
    ) : null;
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

  function openChat(chat: any) {
    chat.onOpen?.();
  }

  function startMachineChat(machine: any) {
    machine.onStartChat?.();
  }

  function startFolderChat(folder: any) {
    folder.onStartChat?.();
  }

  function revealFolder(folderKey: string) {
    setExpandedChatFolders?.((current: Set<string>) => new Set(current).add(folderKey));
  }

  return (
    <>
      <section className={hiveClass("hiveChatRoot", shelfOpen && "shelfOpen")} aria-label="Agent chat">
        <div className={hiveClass("hiveGridBackdrop")} aria-hidden="true" />
        <div className={hiveClass("hiveHeaderControls")}>
          <button type="button" className={hiveClass("hiveHeaderButton")} onClick={copyChatMarkdown} disabled={!renderMessages.length} title="Copy this chat as markdown">
            {chatCopied && Check ? <Check aria-hidden="true" /> : Copy ? <Copy aria-hidden="true" /> : null}
            <span>{chatCopied ? "copied" : "copy chat"}</span>
          </button>
          <button
            type="button"
            className={hiveClass("hiveShelfToggle")}
            aria-label={shelfOpen ? "Collapse info panel" : "Expand info panel"}
            aria-pressed={shelfOpen}
            onClick={() => setShelfOpen((current) => !current)}
          >
            {AlignLeft ? <AlignLeft aria-hidden="true" /> : null}
          </button>
        </div>

        <aside className={hiveClass("hiveChatRail")} aria-label="Chats">
          <header className={hiveClass("hiveRailHeader")}>
            <div className={hiveClass("hiveRailToolbar")}>
              <button
                type="button"
                className={hiveClass("hiveNewChatButton")}
                title={newChatTarget ? `New chat in ${newChatTarget.label}` : undefined}
                onClick={() => newChatTarget?.onStartChat?.()}
                disabled={!newChatTarget}
              >
                {Plus ? <Plus aria-hidden="true" /> : null}
                <span>New chat</span>
              </button>
              <button
                type="button"
                className={hiveClass("hiveRailIconButton")}
                aria-label={chatSearchOpen ? "Close chat search" : "Search chat history"}
                aria-pressed={chatSearchOpen}
                onClick={() => {
                  setChatSearchOpen((current) => {
                    const next = !current;
                    if (!next) setChatSearchQuery("");
                    return next;
                  });
                }}
              >
                {Search ? <Search aria-hidden="true" /> : null}
              </button>
            </div>
            {chatSearchOpen ? (
              <label className={hiveClass("hiveRailSearch")}>
                {Search ? <Search aria-hidden="true" /> : null}
                <input
                  ref={chatSearchInputRef}
                  type="search"
                  value={chatSearchQuery}
                  onChange={(event) => setChatSearchQuery(event.target.value)}
                  placeholder="Search chats and messages"
                  aria-label="Search chat history by title and message content"
                />
              </label>
            ) : null}
          </header>

          <nav className={hiveClass("hiveRailBody")} aria-label="Chat history">
            {chatSearchOpen && normalizedChatSearchQuery ? (
              <section className={hiveClass("hiveNavSection", "hiveSearchResults")}>
                <div className={hiveClass("hiveSearchSummary")}>
                  <span>{chatSearchResults.length} result{chatSearchResults.length === 1 ? "" : "s"}</span>
                  <small>titles + message text</small>
                </div>
                {chatSearchResults.length ? chatSearchResults.map((result: any) => (
                  <button
                    type="button"
                    key={`${result.chat.agentId ?? ""}-${result.chat.key}`}
                    className={hiveClass("hiveNavRow", "chatLeaf", "searchResult", result.chat.active && "active")}
                    aria-current={result.chat.active ? "true" : undefined}
                    title={[result.title, result.subtitle, result.snippet].filter(Boolean).join("\n")}
                    onClick={() => {
                      openChat(result.chat);
                      setChatSearchOpen(false);
                      setChatSearchQuery("");
                    }}
                  >
                    {renderTaskBee(chatRowIsRunning(result.chat))}
                    <span className={hiveClass("hiveNavCopy")}>
                      <strong><ChatInlineMarkdown text={result.title || "Previous chat"} /></strong>
                      <small><ChatInlineMarkdown text={[result.machineName, result.folderLabel].filter(Boolean).join(" / ")} /></small>
                      {result.snippet ? <small className={hiveClass("hiveSearchSnippet")}>{result.snippet}</small> : null}
                    </span>
                  </button>
                )) : <p className={hiveClass("hiveEmptyText")}>No matching chats</p>}
              </section>
            ) : (
              <Fragment>
              <section className={hiveClass("hiveNavSection")}>
              <button type="button" className={hiveClass("hiveNavGroupHeader")} onClick={() => setGeneralOpen((current) => !current)} aria-expanded={generalOpen}>
                {ChevronRight ? <ChevronRight aria-hidden="true" className={hiveClass(generalOpen && "openChevron")} /> : null}
                {MessageSquare ? <MessageSquare aria-hidden="true" /> : null}
                <span>general</span>
                <small>{generalChats.length}</small>
              </button>
              {generalOpen ? (
                <div className={hiveClass("hiveNavChildren")}>
                  {generalChats.length ? generalChats.map((chat: any) => (
                    <button
                      type="button"
                      key={chat.key}
                      className={hiveClass("hiveNavRow", chat.active && "active")}
                      aria-current={chat.active ? "true" : undefined}
                      title={[chat.title, chat.subtitle].filter(Boolean).join("\n")}
                      onClick={() => openChat(chat)}
                    >
                      {chatRowIsRunning(chat) ? renderTaskBee(true) : <span className={hiveClass("hiveNavIcon")}>{MessageSquare ? <MessageSquare aria-hidden="true" /> : null}</span>}
                      <span className={hiveClass("hiveNavCopy")}>
                        <strong><ChatInlineMarkdown text={chat.title ?? ""} /></strong>
                        {chat.subtitle ? <small><ChatInlineMarkdown text={chat.subtitle} /></small> : null}
                      </span>
                    </button>
                  )) : <p className={hiveClass("hiveEmptyText")}>No general chats yet</p>}
                </div>
              ) : null}
            </section>

            <section className={hiveClass("hiveNavSection")}>
              <button type="button" className={hiveClass("hiveNavGroupHeader")} onClick={() => setMachinesOpen((current) => !current)} aria-expanded={machinesOpen}>
                {ChevronRight ? <ChevronRight aria-hidden="true" className={hiveClass(machinesOpen && "openChevron")} /> : null}
                {Monitor ? <Monitor aria-hidden="true" /> : null}
                <span>machines</span>
                <small>{machinesWithChats.length}</small>
              </button>
              {machinesOpen ? machinesWithChats.map((machine: any) => {
                const machineOpen = openMachines[machine.key] ?? true;
                return (
                  <div className={hiveClass("hiveMachineGroup")} key={machine.key}>
                    <div className={hiveClass("hiveNavRowWrap")}>
                      <button
                        type="button"
                        className={hiveClass("hiveNavRow", "machine")}
                        onClick={() => setOpenMachines((current) => ({ ...current, [machine.key]: !machineOpen }))}
                        aria-expanded={machineOpen}
                      >
                        {ChevronRight ? <ChevronRight aria-hidden="true" className={hiveClass(machineOpen && "openChevron")} /> : null}
                        <span className={hiveClass("hiveNavIcon")}>{Monitor ? <Monitor aria-hidden="true" /> : null}</span>
                        <span className={hiveClass("hiveNavCopy")}>
                          <strong>{machine.name}</strong>
                          <small>{machine.folders?.length ?? 0} folder{machine.folders?.length === 1 ? "" : "s"}</small>
                        </span>
                      </button>
                      {machine.onStartChat ? (
                        <button type="button" className={hiveClass("hiveRowAction")} aria-label={`New chat on ${machine.name}`} onClick={() => startMachineChat(machine)}>
                          {MessageSquare ? <MessageSquare aria-hidden="true" /> : null}
                        </button>
                      ) : null}
                    </div>
                    {machineOpen ? (
                      <div className={hiveClass("hiveNavNested")}>
                        {(machine.folders ?? []).map((folder: any) => {
                          const folderOpen = openFolders[folder.key] ?? true;
                          const folderExpanded = expandedChatFolders?.has?.(folder.key);
                          const visibleFolderChats = folderExpanded ? folder.chats : folder.chats?.slice(0, 5);
                          return (
                            <div className={hiveClass("hiveFolderGroup")} key={folder.key}>
                              <div className={hiveClass("hiveNavRowWrap")}>
                                <button
                                  type="button"
                                  className={hiveClass("hiveNavRow", "folder")}
                                  onClick={() => setOpenFolders((current) => ({ ...current, [folder.key]: !folderOpen }))}
                                  aria-expanded={folderOpen}
                                >
                                  {ChevronRight ? <ChevronRight aria-hidden="true" className={hiveClass(folderOpen && "openChevron")} /> : null}
                                  <span className={hiveClass("hiveNavIcon")}>{folderOpen && FolderOpen ? <FolderOpen aria-hidden="true" /> : Folder ? <Folder aria-hidden="true" /> : null}</span>
                                  <span className={hiveClass("hiveNavCopy")}>
                                    <strong>{folder.label}</strong>
                                    <small>{folder.chats?.length ?? 0} chat{folder.chats?.length === 1 ? "" : "s"}</small>
                                  </span>
                                </button>
                                {folder.onStartChat ? (
                                  <button type="button" className={hiveClass("hiveRowAction")} aria-label={`New chat in ${folder.label}`} onClick={() => startFolderChat(folder)}>
                                    {MessageSquare ? <MessageSquare aria-hidden="true" /> : null}
                                  </button>
                                ) : null}
                              </div>
                              {folderOpen ? (
                                <div className={hiveClass("hiveNavLeafList")}>
                                  {visibleFolderChats?.length ? visibleFolderChats.map((chat: any) => (
                                    <button
                                      type="button"
                                      key={chat.key}
                                      className={hiveClass("hiveNavRow", "chatLeaf", chat.active && "active")}
                                      aria-current={chat.active ? "true" : undefined}
                                      title={[chat.title, chat.subtitle].filter(Boolean).join("\n")}
                                      onClick={() => openChat(chat)}
                                    >
                                      {renderTaskBee(chatRowIsRunning(chat))}
                                      <span className={hiveClass("hiveNavCopy")}>
                                        <strong><ChatInlineMarkdown text={chat.title ?? ""} /></strong>
                                        <small><ChatInlineMarkdown text={[chat.updatedAt ? formatRelativeTime?.(chat.updatedAt) : "", chat.subtitle].filter(Boolean).join(" / ")} /></small>
                                      </span>
                                    </button>
                                  )) : <p className={hiveClass("hiveEmptyText")}>No chats yet</p>}
                                  {!folderExpanded && folder.chats?.length > 5 ? (
                                    <button type="button" className={hiveClass("hiveShowMoreButton")} onClick={() => revealFolder(folder.key)}>
                                      Show {folder.chats.length - 5} more
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              }) : null}
            </section>
              </Fragment>
            )}
          </nav>

          <footer className={hiveClass("hiveRailFooter")}>
            <small>{machineLabel}</small>
          </footer>
        </aside>

        <main className={hiveClass("hiveChatMain")} aria-label="Current chat">
          <header className={hiveClass("hiveChatHeader")}>
            <div className={hiveClass("hiveAgentPicker")} ref={agentMenuRef}>
              <button
                type="button"
                className={hiveClass("hiveAgentCard")}
                title="Choose the machine and agent for this chat"
                aria-haspopup="dialog"
                aria-expanded={agentMenuOpen}
                onClick={() => {
                  if (agentMenuOpen) setAgentMenuSearchQuery("");
                  setAgentMenuOpen((current) => !current);
                }}
              >
                <span className={hiveClass("hiveAgentAvatar")}>
                  {iconSrc ? (
                    <span className={hiveClass("hiveAgentIconImage")} style={{ backgroundImage: `url(${iconSrc})` }} aria-hidden="true" />
                  ) : (
                    <span>{agentInitials(selectedAgent)}</span>
                  )}
                </span>
                <span className={hiveClass("hiveHeaderCopy")}>
                  <span className={hiveClass("hiveTitleRow")}>
                    <h1>{selectedAgent?.name ?? "Choose an agent"}</h1>
                    <span className={hiveClass("hiveStatePill", state.tone)}>
                      <span aria-hidden="true" />
                      {state.label}
                    </span>
                  </span>
                  <span className={hiveClass("hiveHeaderMeta")} title={selectedAgent ? activeThreadLabel : undefined}>
                    {selectedAgent ? (
                      <>
                        {selectedAgent.runtime?.trim() || "runtime"}
                        {chatCurrentProvider && chatCurrentModel ? <> / {chatCurrentProvider}/<b>{chatCurrentModel}</b></> : null}
                        {` / ${machineLabel}`}
                      </>
                    ) : headerMetaLabel}
                  </span>
                </span>
                {ChevronDown ? <ChevronDown aria-hidden="true" className={hiveClass("hiveAgentChevron", agentMenuOpen && "openChevron")} /> : null}
              </button>
              {agentMenuOpen ? (
                <div className={hiveClass("hiveAgentMenu")} role="dialog" aria-label="Choose chat agent">
                  <label className={hiveClass("hiveAgentMenuSearch")}>
                    {Search ? <Search aria-hidden="true" /> : null}
                    <input
                      ref={agentMenuSearchInputRef}
                      type="search"
                      value={agentMenuSearchQuery}
                      onChange={(event) => setAgentMenuSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (agentMenuSearchQuery) setAgentMenuSearchQuery("");
                        else {
                          setAgentMenuOpen(false);
                          setAgentMenuSearchQuery("");
                        }
                      }}
                      placeholder="Search agents"
                      aria-label="Search agents by name, machine, runtime, or model"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <div className={hiveClass("hiveAgentMenuList")} role="menu" aria-label="Agents">
                    {agentMenuRows.length ? agentMenuRows.map(({ machine, agent, machineMenuLabel, statusLabel, runtimeIdentity }: any) => {
                      const agentIconSrc = selectedAgentIcon(agent, beeRoleIconPath);
                      return (
                        <button
                          type="button"
                          role="menuitem"
                          key={`${machine.key}-${agent.id}`}
                          className={hiveClass(agent.id === selectedAgent?.id && "active")}
                          onClick={() => {
                            startAgentChat?.(agent.id, { fresh: true, chatLeafKey: `machine-${machine.key}-${agent.id}` });
                            setAgentMenuOpen(false);
                            setAgentMenuSearchQuery("");
                          }}
                        >
                          <span
                            className={hiveClass("hiveAgentMenuIcon", agentIconSrc && "hasImage")}
                            style={agentIconSrc ? { backgroundImage: `url(${agentIconSrc})` } : undefined}
                            aria-hidden="true"
                          >
                            {agentIconSrc ? null : <b>{agentInitials(agent)}</b>}
                          </span>
                          <span>
                            <strong>{agent.name}</strong>
                            <small>
                              {runtimeIdentity.runtime}
                              {runtimeIdentity.model ? <> / {runtimeIdentity.provider}/<b>{runtimeIdentity.model}</b></> : null}
                              {` / ${machineMenuLabel}`}
                              {statusLabel && statusLabel !== agent.name ? ` / ${statusLabel.replace(`${agent.name} / `, "")}` : ""}
                            </small>
                          </span>
                        </button>
                      );
                    }) : <p className={hiveClass("hiveEmptyText")}>{normalizedAgentMenuSearchQuery ? "No agents match that search" : "No chat agents found"}</p>}
                  </div>
                </div>
              ) : null}
            </div>
          </header>

          <div
            ref={attachScrollNode}
            className={hiveClass("hiveChatMessages")}
            onScroll={handleScroll}
            aria-busy={selectedChatHistoryLoading}
          >
            <div className={hiveClass("hiveMessageThread")} ref={threadNodeRef}>
              <div className={hiveClass("hiveThreadDivider")}>
                <span />
                <small title={activeThreadLabel}>{displayThreadLabel}</small>
                <span />
              </div>

              {selectedChatHistoryLoading ? (
                <div className={hiveClass("hiveLoaderRow")}>
                  {LoaderCircle ? <LoaderCircle aria-hidden="true" className={hiveClass("spinIcon")} /> : null}
                  <span>Loading history</span>
                </div>
              ) : renderMessages.length ? renderMessages.map((message: any, index: number) => {
                const content = messageText(message, chatDisplayContent);
                const isUser = message.role === "user";
                const mirosharkCard = !isUser && content ? extractMiroSharkSimulationCard(content) : null;
                const rawApplicationGenerationCard = !isUser
                  ? message.applicationGeneration ?? (message.imageGeneration ? imageGenerationToApplicationGeneration(message.imageGeneration) : null)
                  : null;
                const generatedImagePathCard = !isUser && content ? generatedImageCardFromAssistantText(content, message.createdAt) : null;
                const applicationGenerationCard = generatedImagePathCard && rawApplicationGenerationCard?.status !== "ready"
                  ? generatedImagePathCard
                  : rawApplicationGenerationCard;
                const hasAssistantBody = Boolean(content || applicationGenerationCard || generatedImagePathCard || mirosharkCard);
                const promptUi = !isUser && content ? promptUiFromMessage(message, content) : null;
                const assistantDisplayText = promptUi?.displayText ?? content;
                const jsonRenderPayload = !isUser && assistantDisplayText ? extractJsonRenderPayload(assistantDisplayText) : null;
                const assistantDisplayTextWithoutJsonRender = jsonRenderPayload?.remainingText ?? assistantDisplayText;
                const timeLabel = Number.isFinite(message.createdAt) ? formatRelativeTime?.(message.createdAt) : "";
                const attachments = message.attachments ?? [];
                const messageEvents = normalizeProcessEvents(message.processEvents ?? message.events);
                const isPendingAssistant = !isUser && !content && busy && index === renderMessages.length - 1;
                const renderKey = messageKey(message, index);
                const userProcessRenderKey = `${chatProcessScopeKey}\u001fuser\u001f${renderKey}`;
                const assistantProcessRenderKey = `${chatProcessScopeKey}\u001fassistant\u001f${renderKey}`;
                const liveEvents = !isUser && assistantProcessRenderKey === processEventsTargetKey && !messageEvents.length
                  ? processEventsForDisplay
                  : [];
                const nextAssistantHasProcessEvents = isUser ? (() => {
                  for (let nextIndex = index + 1; nextIndex < renderMessages.length; nextIndex += 1) {
                    const candidate = renderMessages[nextIndex];
                    if (candidate?.role === "user") return false;
                    if (candidate?.role === "assistant" && normalizeProcessEvents(candidate.processEvents ?? candidate.events).length > 0) return true;
                  }
                  return false;
                })() : false;
                const userLiveEvents = isUser && userProcessRenderKey === processEventsTargetKey && !nextAssistantHasProcessEvents
                  ? processEventsForDisplay
                  : [];
                const events = messageEvents.length ? messageEvents : liveEvents;
                return isUser ? (
                  <Fragment key={renderKey}>
                    <article className={hiveClass("hiveUserTurn")}>
                      <div className={hiveClass("hiveUserBubble")}>
                        {ChatMarkdown
                          ? <ChatMarkdown text={markdownText(content || "(sent attachments)")} className={hiveClass("hiveMarkdown")} />
                          : renderInline(content || "(sent attachments)")}
                      </div>
                      {attachments.length ? (
                        <div className={hiveClass("hiveAttachmentList")}>
                          {attachments.map((attachment: any, attachmentIndex: number) => (
                            <span className={hiveClass("hiveMetaPill")} key={`${attachment.name ?? attachmentIndex}-${attachmentIndex}`}>
                              {FileText ? <FileText aria-hidden="true" /> : null}
                              {attachment.name ?? attachment.label ?? "Attachment"}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {timeLabel ? <time>{timeLabel}</time> : null}
                      {renderMessageActions(renderKey, content)}
                    </article>
                    {userLiveEvents.length ? (
                      <AgentProcessPanel
                        Activity={Activity}
                        ChevronDown={ChevronDown}
                        ChevronUp={ChevronUp}
                        CircleAlert={CircleAlert}
                        FileText={FileText}
                        GitBranch={GitBranch}
                        Hammer={Hammer}
                        Pencil={Pencil}
                        Search={Search}
                        Sparkles={Sparkles}
                        Terminal={Terminal}
                        active={busy || processEventsAreActive(userLiveEvents)}
                        events={userLiveEvents}
                      />
                    ) : null}
                  </Fragment>
                ) : (
                  <Fragment key={renderKey}>
                    {events.length ? (
                      <AgentProcessPanel
                        Activity={Activity}
                        ChevronDown={ChevronDown}
                        ChevronUp={ChevronUp}
                        CircleAlert={CircleAlert}
                        FileText={FileText}
                        GitBranch={GitBranch}
                        Hammer={Hammer}
                        Pencil={Pencil}
                        Search={Search}
                        Sparkles={Sparkles}
                        Terminal={Terminal}
                        active={liveEvents.length ? busy || processEventsAreActive(liveEvents) : processEventsAreActive(messageEvents)}
                        events={events}
                      />
                    ) : null}
                    {isPendingAssistant && !hasAssistantBody ? (
                      <article className={hiveClass("hiveAssistantTurn")} aria-label="Agent is thinking">
                        <div className={hiveClass("hiveAssistantText")}>
                          {renderThinkingLoader()}
                        </div>
                      </article>
                    ) : hasAssistantBody ? (
                      <article className={hiveClass("hiveAssistantTurn")}>
                        <div className={hiveClass("hiveAssistantByline")}>
                          {renderTaskBee(activeChatTaskRunning && index === renderMessages.length - 1)}
                          <strong>{selectedAgent?.name ?? "Agent"}</strong>
                          {timeLabel ? <time>{timeLabel}</time> : null}
                        </div>
                        <div className={hiveClass("hiveAssistantText")}>
                          {applicationGenerationCard ? <ApplicationGenerationCard card={applicationGenerationCard} /> : null}
                          {!applicationGenerationCard && generatedImagePathCard ? <ApplicationGenerationCard card={generatedImagePathCard} /> : null}
                          {mirosharkCard ? <MiroSharkSimulationCard card={mirosharkCard} ChatMarkdown={ChatMarkdown} /> : null}
                          {jsonRenderPayload && !applicationGenerationCard && !generatedImagePathCard && !mirosharkCard?.hideRawContent ? <JsonRenderSurface value={assistantDisplayText} /> : null}
                          {applicationGenerationCard || generatedImagePathCard || mirosharkCard?.hideRawContent ? null : ChatMarkdown
                            ? (assistantDisplayTextWithoutJsonRender ? <ChatMarkdown text={markdownText(assistantDisplayTextWithoutJsonRender)} className={hiveClass("hiveMarkdown")} /> : null)
                            : renderInline(assistantDisplayTextWithoutJsonRender)}
                          {promptUi?.options?.length ? (
                            <InteractivePromptControls
                              disabled={false}
                              options={promptUi.options}
                              sendPromptMessage={sendPromptMessage}
                              Send={Send}
                            />
                          ) : null}
                        </div>
                        {!(busy && index === renderMessages.length - 1) ? renderMessageActions(renderKey, content) : null}
                      </article>
                    ) : null}
                  </Fragment>
                );
              }) : (
                <div className={hiveClass("hiveEmptyConversation")}>
                  <strong>{selectedAgent ? `Start with ${selectedAgent.name}` : "No agent selected"}</strong>
                  <p>{selectedAgent ? "Send a message from the composer below." : "Use the rail to select a chat or start a new one."}</p>
                </div>
              )}

              {(busy && !hasStreamingChunk && !pendingAssistantBubbleVisible) ? (
                <div className={hiveClass("hiveTypingRow")}>
                  {renderThinkingLoader()}
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <section className={hiveClass("hiveComposerDock")} aria-label="Message composer">
            {hasQueued ? (
              <div className={hiveClass("hiveQueueStrip")} aria-label="Queued messages">
                <strong>{queuedChatMessages.length} queued</strong>
                <div>
                  {queuedChatMessages.slice(0, 3).map((item: any, index: number) => {
                    const flushing = flushingChatQueueId === item.id;
                    return (
                      <span className={hiveClass("hiveQueueItem")} key={item.id}>
                        {MessageSquare ? <MessageSquare aria-hidden="true" /> : null}
                        <span>{item.label || `Queued ${index + 1}`}</span>
                        <button type="button" onClick={() => sendQueuedChatMessageNow?.(item.id)} disabled={busy || Boolean(flushingChatQueueId)}>
                          {flushing && LoaderCircle ? <LoaderCircle aria-hidden="true" className={hiveClass("spinIcon")} /> : Send ? <Send aria-hidden="true" /> : null}
                        </button>
                        <button type="button" onClick={() => removeQueuedChatMessage?.(item.id)} disabled={flushing}>x</button>
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
          </section>
        </main>

        <aside className={hiveClass("hiveChatShelf")} aria-label="Chat details">
          <div className={hiveClass("hiveShelfInner")}>
            <section className={hiveClass("hiveShelfPanel")}>
              <div className={hiveClass("hiveShelfLabel")}>current task</div>
              <h2>{selectedAgent?.name ?? "No agent selected"}</h2>
              <p>{selectedChatDirectory ? `Working in ${selectedChatDirectory}` : selectedAgent ? "Ready for a new instruction." : "Pick a chat from the rail."}</p>
              {chatKanbanGeneration?.phase === "done" ? (
                <button type="button" className={hiveClass("hiveActionButton")} onClick={() => dismissChatKanbanGeneration?.(chatKanbanGeneration.key)}>
                  {Check ? <Check aria-hidden="true" /> : null}
                  <span>Kanban task created</span>
                </button>
              ) : null}
            </section>

            <section className={hiveClass("hiveShelfPanel")}>
              <div className={hiveClass("hiveShelfLabel")}>telemetry</div>
              <dl className={hiveClass("hiveShelfMeta")}>
                {metrics.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className={hiveClass("hiveShelfPanel")}>
              <div className={hiveClass("hiveShelfLabel")}>live stdout</div>
              <pre className={hiveClass("hiveTerminalBlock")}>{liveOutput || "No recent runtime output."}</pre>
            </section>

            <section className={hiveClass("hiveShelfPanel")}>
              <div className={hiveClass("hiveShelfLabel")}>quick actions</div>
              <div className={hiveClass("hiveQuickActions")}>
                <button type="button" onClick={handleCheckStatus} disabled={statusChecking || !selectedAgent}>
                  {Activity ? <Activity aria-hidden="true" /> : null}
                  <span>Check status</span>
                </button>
                <button type="button" onClick={() => void refreshRuntimeIntegrations?.(selectedAgent)} disabled={!selectedAgent}>
                  {RefreshCcw ? <RefreshCcw aria-hidden="true" /> : null}
                  <span>Refresh runtime</span>
                </button>
              </div>
              {statusAgentId === selectedAgent?.id && status?.message ? <p className={hiveClass("hiveStatusNote")}>{status.message}</p> : null}
            </section>
          </div>
        </aside>
      </section>
      <ChatFolderModal {...props} />
    </>
  );
}
