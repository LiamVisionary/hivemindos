// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { ChatFolderModal } from "@/features/dashboard/views/chat/ChatFolderModal";
import { ChatInlineMarkdown } from "@/features/dashboard/ChatMarkdown";
import hiveChatStyles from "@/features/dashboard/views/chat/HiveChatView.module.css";
import {
  extractMiroSharkSimulationCard,
  getMiroSharkProcessSummary,
  MiroSharkProcessCard,
  MiroSharkSimulationCard,
} from "@/features/dashboard/views/chat/MiroSharkSimulationCard";
import { createStyleClass } from "@/features/dashboard/style-classes";
import { LottiePlayer } from "@/components/ui/lottie-player";
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

const hiveClass = createStyleClass(hiveChatStyles);

const PROVIDER_LABELS: Record<string, string> = {
  "openai-codex": "OpenAI Codex",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  google: "Google",
  groq: "Groq",
  xai: "xAI",
  "lm-studio": "LM Studio",
  ollama: "Ollama",
};

const MODEL_SWITCHABLE_RUNTIMES = ["hermes", "openclaw", "openai-compatible"];

const STATE_LABEL: Record<string, { tone: string; label: string }> = {
  working: { tone: "cyan", label: "working" },
  ready: { tone: "muted", label: "ready" },
  setup: { tone: "honey", label: "setup" },
  failed: { tone: "danger", label: "blocked" },
};

function titleCaseLabel(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "Not set";
  const known = PROVIDER_LABELS[trimmed.toLowerCase()];
  if (known) return known;
  if (trimmed.toLowerCase() === "adaptive") return "Adaptive";
  return trimmed
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function shortModelLabel(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "Model";
  if (trimmed.toLowerCase() === "adaptive") return "Adaptive";
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function agentInitials(agent?: any) {
  if (agent?.beeRole === "queen") return "QB";
  const name = agent?.name?.trim() ?? "";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part.slice(0, 1).toUpperCase())
    .join("") || "A";
}

function selectedAgentIcon(agent?: any, beeRoleIconPath?: (role?: string, workerClass?: string) => string) {
  if (!agent) return "";
  if (agent.beeRole === "queen") return beeRoleIconPath?.("queen") ?? "/icons/queen-bee-v2.png";
  const customWorkerClass = agent.customWorkerClasses?.find((workerClass: any) => workerClass.id === agent.selectedCustomWorkerClassId)
    ?? agent.customWorkerClass;
  return customWorkerClass?.imageSrc
    || beeRoleIconPath?.("worker", agent.workerClass ?? "general")
    || "/icons/worker-bee-general-v5.png";
}

function isFixtureChatMachine(machine: any) {
  const identity = `${machine?.key ?? ""} ${machine?.name ?? ""}`.toLowerCase();
  return /\b(?:hivemindos-)?e2e[-_0-9]/i.test(identity);
}

function agentMenuMachineLabel(machine: any, agent: any) {
  if (machine?.key !== "unassigned") return machine?.name ?? "This Mac";
  const explicitMachine = agent?.machineName?.trim();
  if (explicitMachine) return explicitMachine;
  if (agent?.telemetryUrl?.trim()) return "Bridge linked";
  if (agent?.gatewayUrl?.trim() || agent?.a2aUrl?.trim()) return "Runtime URL configured";
  return "Setup needed";
}

function agentMenuStatusLabel(machine: any, agent: any) {
  if (machine?.key !== "unassigned") return agent?.name ?? "";
  if (agent?.telemetryUrl?.trim() || agent?.gatewayUrl?.trim() || agent?.a2aUrl?.trim()) {
    return `${agent?.name ?? "Agent"} / chat route saved`;
  }
  return `${agent?.name ?? "Agent"} / needs chat URL`;
}

function messageKey(message: any, index: number) {
  const role = String(message?.role ?? "message");
  const source = String(message?.sourceSessionId ?? "");
  const sourceIndex = Number.isFinite(message?.sourceIndex) ? String(message.sourceIndex) : "";
  const createdAt = Number.isFinite(message?.createdAt) ? String(message.createdAt) : "";
  return [source, sourceIndex, role, createdAt, index].filter(Boolean).join(":");
}

function messageText(message: any, chatDisplayContent?: (message: any) => string) {
  const display = chatDisplayContent?.(message);
  if (typeof display === "string" && display.trim()) return display;
  return String(message?.content ?? message?.text ?? message?.body ?? "").trim();
}

function markdownText(text: string) {
  return text
    .replace(/^``([A-Za-z0-9_-]+)\s*$/gm, "```$1")
    .replace(/^``\s*$/gm, "```");
}

function processText(events: any[] = []) {
  return events
    .slice(-12)
    .map((event) => {
      const label = String(event?.label ?? "event").trim();
      const detail = String(event?.detail ?? "").trim();
      return detail ? `${label}: ${detail}` : label;
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeSearchText(value?: string) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function chatSearchSnippet(text: string, query: string) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const normalizedText = normalizeSearchText(trimmed);
  const normalizedQuery = normalizeSearchText(query);
  const queryIndex = normalizedQuery ? normalizedText.indexOf(normalizedQuery) : -1;
  const start = queryIndex >= 0 ? Math.max(0, queryIndex - 56) : 0;
  const end = Math.min(trimmed.length, start + 150);
  return `${start > 0 ? "... " : ""}${trimmed.slice(start, end)}${end < trimmed.length ? " ..." : ""}`;
}

const PROCESS_TOOL_META: Record<string, { icon: string; color: string }> = {
  bash: { icon: "terminal", color: "#a78bfa" },
  command: { icon: "terminal", color: "#a78bfa" },
  read: { icon: "file", color: "#94a3b8" },
  file: { icon: "file", color: "#94a3b8" },
  image: { icon: "image", color: "#38bdf8" },
  edit: { icon: "edit", color: "#60a5fa" },
  write: { icon: "edit", color: "#60a5fa" },
  search: { icon: "search", color: "#fb923c" },
  skill: { icon: "sparkles", color: "#2dd4bf" },
  git: { icon: "git", color: "#f59e0b" },
  status: { icon: "activity", color: "#2dd4bf" },
  error: { icon: "alert", color: "#fb7185" },
  unknown: { icon: "hammer", color: "#94a3b8" },
};

function normalizeProcessEvents(value: any) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.events)) return value.events;
  if (Array.isArray(value?.steps)) return value.steps;
  return [];
}

function processDisplayEvents(events: any[] = []) {
  return events.filter((event) => !/assistant started writing|assistant wrote in session|agent replied/i.test(String(event?.label ?? "")));
}

function processEventsAreActive(events: any[] = []) {
  const visibleEvents = processDisplayEvents(events);
  if (!visibleEvents.length) return false;
  const lastEvent = visibleEvents[visibleEvents.length - 1];
  const lastStatus = String(lastEvent?.status ?? "").trim().toLowerCase();
  const lastText = `${String(lastEvent?.label ?? "").trim()} ${String(lastEvent?.detail ?? "").trim()}`.toLowerCase();
  if (/\b(done|complete|completed|failed|failure|finished|settled|succeeded|cancelled|canceled)\b/.test(lastText)) return false;
  return lastStatus !== "completed" && lastStatus !== "failed";
}

function processToolKey(event: any) {
  const text = `${event?.label ?? ""} ${event?.detail ?? ""}`.toLowerCase();
  if (/error|failed|interrupted|timed out/.test(text)) return "error";
  if (/git|commit|branch|origin\//.test(text)) return "git";
  if (/image|screenshot|vision/.test(text)) return "image";
  if (/skill context|skill loaded/.test(text)) return "skill";
  if (/file content|read file|cat\b|view file/.test(text)) return "read";
  if (/edit|write|patch|created|updated/.test(text)) return "edit";
  if (/grep|search|rg\b|find/.test(text)) return "search";
  if (/command|bash|shell|terminal|exit\s+\d+/.test(text)) return "bash";
  if (/tool/.test(text)) return "unknown";
  return "status";
}

function processIconComponent(key: string, icons: any) {
  const map: Record<string, any> = {
    activity: icons.Activity,
    alert: icons.CircleAlert,
    edit: icons.Pencil,
    file: icons.FileText,
    git: icons.GitBranch,
    hammer: icons.Hammer,
    image: icons.Image,
    search: icons.Search,
    sparkles: icons.Sparkles,
    terminal: icons.Terminal,
  };
  return map[key] ?? icons.Activity;
}

function processFileTarget(event: any) {
  const detail = String(event?.detail ?? "");
  const label = String(event?.label ?? "");
  const haystack = `${label}\n${detail}`;
  const structured = detail.match(/"?(?:path|file|filename|target)"?\s*[:=]\s*"?([^"',}\]\s]+)"?/i)?.[1];
  const gitStatus = haystack.match(/(?:^|\s)[AMDRC?]{1,2}\s+([^\s]+\.[A-Za-z0-9]{1,8}|[^\s]+\/[^\s]+)/m)?.[1];
  const mentioned = haystack.match(/(?:^|\s)([~./A-Za-z0-9_-]+\/[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)*\.[A-Za-z0-9]{1,8})\b/)?.[1]
    ?? haystack.match(/`([^`]+\.[A-Za-z0-9]{1,8})`/)?.[1];
  const target = structured ?? gitStatus ?? mentioned ?? "";
  return target ? target.split(/[)\],]/)[0].replace(/^["'`]+|["'`]+$/g, "") : "";
}

function processDisplayLabel(event: any) {
  const label = String(event?.label ?? "Runtime event").trim();
  if (/tool output/i.test(label)) return "Tool output";
  return label;
}

function processTimeLabel(value: unknown) {
  const timestamp = typeof value === "number" ? value : Date.now();
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function AgentProcessPanel(props: any) {
  const {
    Activity,
    ChevronDown,
    ChevronUp,
    CircleAlert,
    FileText,
    GitBranch,
    Hammer,
    Image,
    Pencil,
    Search,
    Sparkles,
    Terminal,
    active = false,
    events = [],
  } = props;
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const visibleEvents = processDisplayEvents(events);
  const latestActive = active && processEventsAreActive(visibleEvents);
  const mirosharkProcess = getMiroSharkProcessSummary(visibleEvents, latestActive);
  const open = latestActive || expanded;
  const latestEvent = visibleEvents[visibleEvents.length - 1];
  const latestEventSignature = [
    visibleEvents.length,
    latestEvent?.at ?? "",
    latestEvent?.label ?? "",
    latestEvent?.detail ?? "",
    latestEvent?.status ?? "",
  ].join("|");

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [open, latestEventSignature]);

  if (!visibleEvents.length) return null;

  const ToggleIcon = open ? ChevronUp : ChevronDown;
  const iconProps = { Activity, CircleAlert, FileText, GitBranch, Hammer, Image, Pencil, Search, Sparkles, Terminal };

  return (
    <section className={hiveClass("hiveProcessPanel", open && "expanded")} aria-label="Agent process">
      <button
        type="button"
        className={hiveClass("hiveProcessToggle")}
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={open}
      >
        <span>{mirosharkProcess ? "MiroShark" : "Process"}</span>
        <small>{visibleEvents.length} event{visibleEvents.length === 1 ? "" : "s"}</small>
        {ToggleIcon ? <ToggleIcon aria-hidden="true" /> : null}
      </button>
      {open ? (
        <>
        {mirosharkProcess ? <MiroSharkProcessCard summary={mirosharkProcess} /> : null}
        <div className={hiveClass("hiveProcessScroll")} ref={scrollRef}>
          {visibleEvents.map((event: any, index: number) => {
            const toolKey = processToolKey(event);
            const meta = PROCESS_TOOL_META[toolKey] ?? PROCESS_TOOL_META.unknown;
            const BadgeIcon = processIconComponent(meta.icon, iconProps);
            const isActive = index === visibleEvents.length - 1 && latestActive;
            const fileTarget = processFileTarget(event);
            return (
              <div className={hiveClass("hiveProcessRow", isActive && "active")} key={`${event.at ?? "event"}-${index}`}>
                <time>{processTimeLabel(event.at)}</time>
                <div className={hiveClass("hiveProcessBadge", isActive && "active")} style={{ "--process-accent": meta.color } as any} aria-hidden="true">
                  {BadgeIcon ? <BadgeIcon /> : null}
                </div>
                <div className={hiveClass("hiveProcessBody")}>
                  <div className={hiveClass("hiveProcessMetaLine")}>
                    <strong>{processDisplayLabel(event)}</strong>
                    {fileTarget ? <code>{fileTarget}</code> : null}
                  </div>
                  {event.detail ? <span>{event.detail}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
        </>
      ) : null}
    </section>
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

export function ChatPanel(props: any) {
  const {
    Activity,
    AgentResponseLoader,
    AlignLeft,
    Check,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    CircleAlert,
    FileText,
    Folder,
    FolderOpen,
    GitBranch,
    Hammer,
    Image,
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

  const [shelfOpen, setShelfOpen] = useState(false);
  const [generalOpen, setGeneralOpen] = useState(true);
  const [machinesOpen, setMachinesOpen] = useState(true);
  const [openMachines, setOpenMachines] = useState<Record<string, boolean>>({});
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [statusChecking, setStatusChecking] = useState(false);
  const [agentMode, setAgentMode] = useState<"plan" | "act">("act");
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [stickyChatProcess, setStickyChatProcess] = useState<any[]>([]);
  const [stickyChatProcessTargetKey, setStickyChatProcessTargetKey] = useState("");
  const scrollNodeRef = useRef<HTMLDivElement | null>(null);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);
  const chatSearchInputRef = useRef<HTMLInputElement | null>(null);
  const stickyChatProcessSignatureRef = useRef("");
  const deferredChatSearchQuery = useDeferredValue(chatSearchQuery);
  const liveProcessEvents = normalizeProcessEvents(selectedChatProcess);
  const liveProcessSignature = liveProcessEvents
    .map((event: any) => [event?.at, event?.label, event?.detail, event?.status].join("\u001f"))
    .join("\u001e");
  const chatProcessScopeKey = `${selectedChatStorageKey || ""}\u001f${selectedChatLeafKey || ""}`;
  const activeTurnProcessTargetKey = (() => {
    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      if (visibleMessages[index]?.role === "user") {
        return `${chatProcessScopeKey}\u001fuser\u001f${messageKey(visibleMessages[index], index)}`;
      }
    }
    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      const message = visibleMessages[index];
      if (message?.role === "assistant") return `${chatProcessScopeKey}\u001fassistant\u001f${messageKey(message, index)}`;
    }
    return "";
  })();

  useEffect(() => {
    const events = normalizeProcessEvents(selectedChatProcess);
    if (events.length) {
      if (stickyChatProcessSignatureRef.current !== liveProcessSignature) {
        stickyChatProcessSignatureRef.current = liveProcessSignature;
        setStickyChatProcess(events);
        setStickyChatProcessTargetKey(activeTurnProcessTargetKey);
      }
      return undefined;
    }
    return undefined;
  }, [activeTurnProcessTargetKey, liveProcessSignature, selectedChatProcess]);

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

  useEffect(() => {
    const node = scrollNodeRef.current;
    if (!node || selectedChatHistoryLoading) return;
    if (chatAutoScrollRef) chatAutoScrollRef.current = true;
    window.requestAnimationFrame(() => {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    });
  }, [busy, chatAutoScrollRef, selectedChatHistoryLoading, selectedChatLeafKey, selectedChatStorageKey, visibleMessages.length]);

  useEffect(() => {
    if (!agentMenuOpen) return undefined;
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (agentMenuRef.current?.contains(target)) return;
      setAgentMenuOpen(false);
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
  const runtimeIdentity = selectedAgent ? [
    selectedAgent.runtime?.trim() || "runtime",
    chatCurrentProvider && chatCurrentModel ? `${chatCurrentProvider}/${chatCurrentModel}` : "",
  ].filter(Boolean).join(" / ") : "no runtime";
  const stateKey = !selectedAgent
    ? "setup"
    : statusAgentId === selectedAgent.id && status && status.ok === false
      ? "failed"
      : busy
        ? "working"
        : "ready";
  const state = STATE_LABEL[stateKey] ?? STATE_LABEL.ready;
  const iconSrc = selectedAgentIcon(selectedAgent, beeRoleIconPath);
  const activeThreadLabel = selectedChatLeafKey || selectedChatStorageKey || "agent chat";
  const displayThreadLabel = friendlyThreadLabel(activeThreadLabel, selectedChatDirectory);
  const headerMetaLabel = selectedAgent
    ? [runtimeIdentity, machineLabel].filter(Boolean).join(" / ")
    : "Connect a machine and choose an agent to start chatting.";
  const hasQueued = queuedChatMessages.length > 0;
  const processEventsForDisplay = liveProcessEvents.length ? liveProcessEvents : stickyChatProcess;
  const processEventsTargetKey = liveProcessEvents.length ? activeTurnProcessTargetKey : stickyChatProcessTargetKey;
  const activeChatTaskRunning = busy || processEventsAreActive(processEventsForDisplay);
  const runningChatStorageKeys = useMemo(() => new Set(Object.keys(chatStreamingByKey ?? {})), [chatStreamingByKey]);
  const runningChatIdentityKeys = useMemo(() => new Set(Object.values(chatStreamingByKey ?? {})
    .map((stream: any) => `${stream?.agentId ?? ""}\u001f${stream?.leafKey || `agent-${stream?.agentId ?? ""}`}`)
    .filter((key) => !key.startsWith("\u001f"))), [chatStreamingByKey]);
  const liveOutput = processText(processEventsForDisplay);
  const pendingAssistantBubbleVisible = busy && !hasStreamingChunk && visibleMessages.some((message: any, index: number) => (
    index === visibleMessages.length - 1
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
  const agentMenuMachines = machinesWithChats
    .map((machine: any) => ({
      machine,
      agents: (machineGroups.find((group: any) => group.key === machine.key)?.agents ?? []).filter((agent: any) => agent?.id),
    }))
    .filter((item: any) => item.agents.length > 0);
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

  function handleScroll(event: any) {
    messagesScrollRef.current = event.currentTarget;
    const node = event.currentTarget;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
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
          <button type="button" className={hiveClass("hiveHeaderButton")} onClick={handleCheckStatus} disabled={statusChecking || !selectedAgent}>
            {statusChecking && LoaderCircle ? <LoaderCircle aria-hidden="true" className={hiveClass("spinIcon")} /> : Activity ? <Activity aria-hidden="true" /> : null}
            <span>{statusChecking ? "checking" : "status"}</span>
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
              <button type="button" className={hiveClass("hiveNewChatButton")} onClick={() => startMachineChat(defaultChatMachine)} disabled={!defaultChatMachine?.onStartChat}>
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
                aria-haspopup="menu"
                aria-expanded={agentMenuOpen}
                onClick={() => setAgentMenuOpen((current) => !current)}
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
                  <span className={hiveClass("hiveHeaderMeta")} title={selectedAgent ? activeThreadLabel : undefined}>{headerMetaLabel}</span>
                </span>
                {ChevronDown ? <ChevronDown aria-hidden="true" className={hiveClass("hiveAgentChevron", agentMenuOpen && "openChevron")} /> : null}
              </button>
              {agentMenuOpen ? (
                <div className={hiveClass("hiveAgentMenu")} role="menu">
                  {agentMenuMachines.length ? agentMenuMachines.flatMap(({ machine, agents }: any) => agents.map((agent: any) => {
                    const agentIconSrc = selectedAgentIcon(agent, beeRoleIconPath);
                    const machineMenuLabel = agentMenuMachineLabel(machine, agent);
                    const statusLabel = agentMenuStatusLabel(machine, agent);
                    return (
                      <button
                        type="button"
                        role="menuitem"
                        key={`${machine.key}-${agent.id}`}
                        className={hiveClass(agent.id === selectedAgent?.id && "active")}
                        onClick={() => {
                          startAgentChat?.(agent.id, { fresh: true, chatLeafKey: `machine-${machine.key}-${agent.id}` });
                          setAgentMenuOpen(false);
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
                          <small>{machineMenuLabel}{statusLabel && statusLabel !== agent.name ? ` / ${statusLabel.replace(`${agent.name} / `, "")}` : ""}</small>
                        </span>
                      </button>
                    );
                  })) : <p className={hiveClass("hiveEmptyText")}>No chat agents found</p>}
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
            <div className={hiveClass("hiveMessageThread")}>
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
              ) : visibleMessages.length ? visibleMessages.map((message: any, index: number) => {
                const content = messageText(message, chatDisplayContent);
                const isUser = message.role === "user";
                const mirosharkCard = !isUser && content ? extractMiroSharkSimulationCard(content) : null;
                const timeLabel = Number.isFinite(message.createdAt) ? formatRelativeTime?.(message.createdAt) : "";
                const attachments = message.attachments ?? [];
                const messageEvents = normalizeProcessEvents(message.processEvents ?? message.events);
                const isPendingAssistant = !isUser && !content && busy && index === visibleMessages.length - 1;
                const renderKey = messageKey(message, index);
                const userProcessRenderKey = `${chatProcessScopeKey}\u001fuser\u001f${renderKey}`;
                const assistantProcessRenderKey = `${chatProcessScopeKey}\u001fassistant\u001f${renderKey}`;
                const liveEvents = !isUser && assistantProcessRenderKey === processEventsTargetKey && !messageEvents.length
                  ? processEventsForDisplay
                  : [];
                const nextAssistantHasProcessEvents = isUser ? (() => {
                  for (let nextIndex = index + 1; nextIndex < visibleMessages.length; nextIndex += 1) {
                    const candidate = visibleMessages[nextIndex];
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
                        Image={Image}
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
                        Image={Image}
                        Pencil={Pencil}
                        Search={Search}
                        Sparkles={Sparkles}
                        Terminal={Terminal}
                        active={liveEvents.length ? busy || processEventsAreActive(liveEvents) : processEventsAreActive(messageEvents)}
                        events={events}
                      />
                    ) : null}
                    {isPendingAssistant ? (
                      <article className={hiveClass("hiveAssistantTurn")} aria-label="Agent is thinking">
                        <div className={hiveClass("hiveAssistantText")}>
                          {renderThinkingLoader()}
                        </div>
                      </article>
                    ) : content ? (
                      <article className={hiveClass("hiveAssistantTurn")}>
                        <div className={hiveClass("hiveAssistantByline")}>
                          {renderTaskBee(activeChatTaskRunning && index === visibleMessages.length - 1)}
                          <strong>{selectedAgent?.name ?? "Agent"}</strong>
                          {timeLabel ? <time>{timeLabel}</time> : null}
                        </div>
                        <div className={hiveClass("hiveAssistantText")}>
                          {mirosharkCard ? <MiroSharkSimulationCard card={mirosharkCard} ChatMarkdown={ChatMarkdown} /> : null}
                          {mirosharkCard?.hideRawContent ? null : ChatMarkdown
                            ? <ChatMarkdown text={markdownText(content)} className={hiveClass("hiveMarkdown")} />
                            : renderInline(content)}
                        </div>
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
                <button type="button" onClick={() => startMachineChat(chatSidebarTree[0])} disabled={!chatSidebarTree[0]?.onStartChat}>
                  {MessageSquare ? <MessageSquare aria-hidden="true" /> : null}
                  <span>New chat</span>
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
