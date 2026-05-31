// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { ChatFolderModal } from "@/features/dashboard/views/chat/ChatFolderModal";
import { ChatInlineMarkdown } from "@/features/dashboard/ChatMarkdown";
import { SkillBrowserModal } from "@/features/dashboard/views/chat/SkillBrowserModal";
import { AgentSettingsModal } from "@/features/dashboard/views/chat/AgentSettingsModal";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { useEffect, useState } from "react";

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

function headerValueLabel(value?: string) {
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

function modelValueLabel(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "Not set";
  if (trimmed.toLowerCase() === "adaptive") return "Adaptive";
  return trimmed;
}

// Compact label for the composer model button: drop the provider prefix
// from ids like "anthropic/hermes-3" so the pill stays readable.
function shortModelLabel(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "Model";
  if (trimmed.toLowerCase() === "adaptive") return "Adaptive";
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

const MODEL_SWITCHABLE_RUNTIMES = ["hermes", "openclaw", "openai-compatible"];

function runtimeIdentityLabel(agent?: any, runtimeModelSelection?: any, runtimeModelSelectionsByRuntime?: Record<string, any>) {
  if (!agent) return "not-set";
  const runtime = agent.runtime?.trim() || "not-set";
  const runtimeSelection = runtimeModelSelectionsByRuntime?.[runtime];
  const provider = agent.provider?.trim() || runtimeModelSelection?.provider?.trim() || runtimeSelection?.provider?.trim();
  const model = agent.model?.trim() || runtimeModelSelection?.model?.trim() || runtimeSelection?.model?.trim();
  return provider && model ? `${runtime} • ${provider}/${model}` : runtime;
}

function agentInitials(agent?: any) {
  if (agent?.beeRole === "queen") return "QB";
  const name = agent?.name?.trim() ?? "";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part.slice(0, 1).toUpperCase())
    .join("");
  return initials || "A";
}

function selectedAgentIcon(agent?: any, beeRoleIconPath?: (role?: string, workerClass?: string) => string) {
  if (!agent) return "";
  if (agent.beeRole === "queen") return beeRoleIconPath?.("queen") ?? "/icons/queen-bee-v2.png";
  const customWorkerClass = agent.customWorkerClasses?.find((workerClass: any) => workerClass.id === agent.selectedCustomWorkerClassId)
    ?? agent.customWorkerClass;
  return customWorkerClass?.imageSrc
    || beeRoleIconPath?.("worker", agent.workerClass ?? "general")
    || "/icons/worker-bee-general-v2.png";
}

function agentMenuIcon(agent?: any, beeRoleIconPath?: (role?: string, workerClass?: string) => string) {
  return selectedAgentIcon(agent, beeRoleIconPath);
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
    return `${agent?.name ?? "Agent"} · chat route saved`;
  }
  return `${agent?.name ?? "Agent"} · needs chat URL`;
}

const PROCESS_TOOL_META: Record<string, { icon: string; color: string }> = {
  bash: { icon: "terminal", color: "#A855F7" },
  command: { icon: "terminal", color: "#A855F7" },
  read: { icon: "file", color: "#94A3B8" },
  file: { icon: "file", color: "#94A3B8" },
  image: { icon: "image", color: "#38BDF8" },
  edit: { icon: "edit", color: "#60A5FA" },
  write: { icon: "edit", color: "#60A5FA" },
  search: { icon: "search", color: "#FB923C" },
  skill: { icon: "sparkles", color: "#2DD4BF" },
  git: { icon: "git", color: "#F59E0B" },
  status: { icon: "activity", color: "#2DD4BF" },
  error: { icon: "alert", color: "#F87171" },
  unknown: { icon: "hammer", color: "#94A3B8" },
};

function processToolKey(event: any) {
  const text = `${event?.label ?? ""} ${event?.detail ?? ""}`.toLowerCase();
  if (/assistant (wrote|started)|agent replied/.test(text)) return "assistant";
  if (/error|failed|interrupted|timed out/.test(text)) return "error";
  if (/git|commit|branch|origin\//.test(text)) return "git";
  if (/image|screenshot|vision/.test(text)) return "image";
  if (/skill context|skill loaded/.test(text)) return "skill";
  if (/file content|read file|cat\b|view file/.test(text)) return "read";
  if (/edit|write|patch|created|updated/.test(text)) return "edit";
  if (/grep|search|rg\b|find/.test(text)) return "search";
  if (/command|bash|shell|terminal|exit\s+\d+/.test(text)) return "bash";
  if (/queued|attached|runtime|session|stream|waiting/.test(text)) return "status";
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
  if (!target) return "";
  return target.split(/[)\],]/)[0].replace(/^["'`]+|["'`]+$/g, "");
}

function processDisplayLabel(event: any) {
  const label = String(event?.label ?? "Runtime event").trim();
  if (/assistant wrote in session/i.test(label)) return "Agent replied";
  if (/assistant started writing/i.test(label)) return "Agent started writing";
  if (/tool output/i.test(label)) return "Tool output";
  return label;
}

function AgentProcessPanel({ Activity, ChevronDown, ChevronUp, CircleAlert, FileText, GitBranch, Hammer, Image, Pencil, Search, Sparkles, Terminal, agentIconSrc, agentInitials, chatClass, events = [] }: any) {
  const [expanded, setExpanded] = useState(false);
  if (!events.length) return null;
  const Icon = expanded ? ChevronUp : ChevronDown;
  const iconProps = { Activity, CircleAlert, FileText, GitBranch, Hammer, Image, Pencil, Search, Sparkles, Terminal };
  return (
    <section className={chatClass("processPanel", expanded && "expanded")} aria-label="Agent process">
      <button
        type="button"
        className={chatClass("processToggle")}
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <span>Process</span>
        <small>{events.length} event{events.length === 1 ? "" : "s"}</small>
        {Icon ? <Icon aria-hidden="true" /> : null}
      </button>
      <div className={chatClass("processScroll")}>
        {events.map((event: any, index: number) => {
          const toolKey = processToolKey(event);
          const isAssistant = toolKey === "assistant";
          const meta = PROCESS_TOOL_META[toolKey] ?? PROCESS_TOOL_META.unknown;
          const BadgeIcon = processIconComponent(meta.icon, iconProps);
          const fileTarget = processFileTarget(event);
          return (
          <div className={chatClass("processRow", isAssistant && "assistant")} key={`${event.at}-${index}`}>
            <time>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
            <div className={chatClass("processBadge", isAssistant && agentIconSrc && "avatar")} style={{ "--process-accent": meta.color, ...(isAssistant && agentIconSrc ? { backgroundImage: `url(${agentIconSrc})` } : {}) } as any} aria-hidden="true">
              {isAssistant && agentIconSrc ? (
                null
              ) : isAssistant ? (
                <b>{agentInitials}</b>
              ) : BadgeIcon ? (
                <BadgeIcon />
              ) : null}
            </div>
            <div className={chatClass("processBody")}>
              <div className={chatClass("processMetaLine")}>
                <strong>{processDisplayLabel(event)}</strong>
                {fileTarget ? <code>{fileTarget}</code> : null}
              </div>
              {event.detail ? <span>{event.detail}</span> : null}
            </div>
          </div>
          );
        })}
      </div>
    </section>
  );
}

export function ChatPanel(props: any) {
  const { Activity, AgentResponseLoader, AlignLeft, Button, ChatMarkdown, Check, ChevronDown, ChevronUp, CircleAlert, ComposerField, Copy, FileText, Folder, GitBranch, Hammer, Image, KanbanSquare, LoaderCircle, MessageAttachments, MessageSquare, Monitor, Pencil, RUNTIME_LABELS, Search, Sparkles, Terminal, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Upload, activeView, aeonEnvKeys, aeonEnvSyncStatus, aeonEnvSyncing, attachChatDirectory, attachChatRecentDirectory, attachmentError, attachmentMenuOpen, attachmentMenuRef, beeRoleIconPath, busy, changeChatWorkingDirectory, chatAttachments, chatClass, chatContextMenu, chatContextMenuRef, chatDirectories, chatDisplayContent, chatFileInputRef, chatImageInputRef, chatKanbanGeneration, chatSidebarTree, checkStatus, dismissChatKanbanGeneration, displayAgents, expandedChatFolders, fleetClass, formatAgentEnvText, formatRelativeTime, generateKanbanTaskFromChat, handleChatFileChange, handleChatImageChange, hasStreamingChunk, lastAssistant, machineGroups, messagesEndRef, messagesScrollRef, parseAgentEnvText, recentDirectories, recentDirectoriesExpanded, recording, refreshRuntimeIntegrations, removeChatAttachment, removeChatDirectory, runRuntimeIntegrationAction, runtimeIntegrationBusy, runtimeModelSelection, runtimeModelSelectionsByRuntime, selectedAgent, selectedChatDirectory, selectedChatMachine, selectedChatProcess, sendMessage, sessionNotice, setAeonEnvKeys, setAttachmentMenuOpen, setChatContextMenu, setExpandedChatFolders, setRecentDirectoriesExpanded, setStatus, setStatusAgentId, setText, startAgentChat, startAudioRecording, status, statusAgentId, stopAudioRecording, switchRuntime, syncAeonEnvToGitHub, text, updateAgent, updateChatAutoScroll, vaultClass, visibleMessages, voiceBands, voiceTarget, voiceTranscript } = props;
  const [openKanbanTaskMenuKey, setOpenKanbanTaskMenuKey] = useState("");
  const [copiedMessageKey, setCopiedMessageKey] = useState("");
  const [agentMode, setAgentMode] = useState<"plan" | "act">("act");
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [statusCheckingAgentId, setStatusCheckingAgentId] = useState("");
  const runtimeLabel = selectedAgent ? RUNTIME_LABELS[selectedAgent.runtime] ?? headerValueLabel(selectedAgent.runtime) : "Not set";
  const providerLabel = selectedAgent ? headerValueLabel(selectedAgent.provider ?? runtimeModelSelection?.provider) : "Not set";
  const modelLabel = selectedAgent ? modelValueLabel(selectedAgent.model ?? runtimeModelSelection?.model) : "Not set";
  const runtimeIdentity = runtimeIdentityLabel(selectedAgent, runtimeModelSelection, runtimeModelSelectionsByRuntime);
  const selectedAgentInitials = agentInitials(selectedAgent);
  const selectedAgentIconSrc = selectedAgentIcon(selectedAgent, beeRoleIconPath);
  const selectedStatusChecking = Boolean(selectedAgent?.id && statusCheckingAgentId === selectedAgent.id);
  async function handleCheckStatus() {
    if (!selectedAgent || selectedStatusChecking) return;
    setStatusCheckingAgentId(selectedAgent.id);
    try {
      await checkStatus();
    } finally {
      setStatusCheckingAgentId("");
    }
  }
  const selectedAgentIsQueen = selectedAgent?.beeRole === "queen";
  const selectedRuntimeModelSelection = selectedAgent ? runtimeModelSelectionsByRuntime?.[selectedAgent.runtime] : undefined;
  const chatModelProviders = selectedRuntimeModelSelection?.providers ?? [];
  const chatCurrentProvider = selectedAgent ? (selectedAgent.provider?.trim() || selectedRuntimeModelSelection?.provider || "") : "";
  const chatCurrentModel = selectedAgent ? (selectedAgent.model?.trim() || selectedRuntimeModelSelection?.model || "") : "";
  const modelPickerEnabled = Boolean(selectedAgent) && MODEL_SWITCHABLE_RUNTIMES.includes(selectedAgent?.runtime);
  function selectChatModel(provider: string, model: string) {
    if (!selectedAgent) return;
    updateAgent({ provider, model });
    // Hermes/OpenClaw keep the active model in their own runtime config, so push
    // the change through set-model too; other runtimes read it from the profile.
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
  const shouldLoadRuntimeIdentity = selectedAgent
    && activeView === "chat"
    && !selectedAgent.provider?.trim()
    && !selectedAgent.model?.trim()
    && !selectedRuntimeModelSelection
    && ["hermes", "openclaw"].includes(selectedAgent.runtime);
  useEffect(() => {
    if (!shouldLoadRuntimeIdentity) return;
    void refreshRuntimeIntegrations?.(selectedAgent);
  }, [refreshRuntimeIntegrations, selectedAgent, shouldLoadRuntimeIdentity]);
  useEffect(() => {
    if (chatKanbanGeneration?.phase !== "done") return undefined;
    const key = chatKanbanGeneration.key;
    const timer = window.setTimeout(() => {
      dismissChatKanbanGeneration?.(key);
      setOpenKanbanTaskMenuKey((current) => current === key ? "" : current);
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [chatKanbanGeneration, dismissChatKanbanGeneration]);

  function dismissKanbanPopover(messageKey: string) {
    dismissChatKanbanGeneration?.(messageKey);
    setOpenKanbanTaskMenuKey((current) => current === messageKey ? "" : current);
  }

  function copyAssistantResponse(messageKey: string, content: string) {
    void navigator.clipboard?.writeText(content).then(() => {
      setCopiedMessageKey(messageKey);
      window.setTimeout(() => setCopiedMessageKey((current) => current === messageKey ? "" : current), 1400);
    });
  }

  function renderAgentAvatar(className: string) {
    return (
      <div className={chatClass("agentAvatar", className, selectedAgentIsQueen && "queenAvatar")} aria-hidden="true">
        <span className={chatClass("agentAvatarFallback")}>{selectedAgentInitials}</span>
        {selectedAgentIconSrc ? (
          <img
            className={chatClass("agentAvatarImage")}
            src={selectedAgentIconSrc}
            alt=""
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        ) : null}
      </div>
    );
  }

  return (<>
      {activeView === "chat" ? (
        <section className={chatClass("workspace", "tabPanel", chatHistoryOpen && "historyOpen")}>
          <aside className={chatClass("settings")}>
            <div className={chatClass("settingsHeader")}>
              <div>
                <p className="eyebrow">Chat</p>
                <h2>Machines</h2>
              </div>
              <button
                type="button"
                className={chatClass("historyCloseButton")}
                aria-label="Close chat history"
                onClick={() => setChatHistoryOpen(false)}
              >
                Close
              </button>
              <span className={chatClass("runtimeBadge")}>{displayAgents.length} agents</span>
            </div>

            <TooltipProvider>
              <div className={chatClass("machineTree")}>
                {chatSidebarTree.length > 0 ? chatSidebarTree.map((machine) => (
                  <details className={chatClass("machineTreeNode")} key={machine.key} open>
                    <summary>
                      <span className={chatClass("treeDisclosure")} aria-hidden="true" />
                      <Monitor className={chatClass("treeIcon")} aria-hidden="true" />
                      <span className={chatClass("treeLabel")}>{machine.name}</span>
                      {machine.onCreateFolder ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className={chatClass("treeChatButton")}
                              aria-label={`Choose directory on ${machine.name}`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                machine.onCreateFolder?.();
                              }}
                            >
                              <Folder aria-hidden="true" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">{`Choose directory on ${machine.name}`}</TooltipContent>
                        </Tooltip>
                      ) : null}
                      {machine.onStartChat ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className={chatClass("treeChatButton")}
                              aria-label={`Start chat on ${machine.name}`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                machine.onStartChat?.();
                                setChatHistoryOpen(false);
                              }}
                            >
                              <MessageSquare aria-hidden="true" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">{`New chat in ${machine.name}`}</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </summary>
                    <div className={chatClass("machineTreeChildren")}>
                      {machine.folders.length > 0 ? machine.folders.map((folder) => (
                        <details className={chatClass("machineFolderNode")} key={folder.key} open>
                          <summary>
                            <span className={chatClass("treeDisclosure")} aria-hidden="true" />
                            <Folder className={chatClass("treeIcon")} aria-hidden="true" />
                            <span className={chatClass("treeLabel")}>{folder.label}</span>
                            {folder.onStartChat ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className={chatClass("treeChatButton")}
                                    aria-label={`Start chat in ${folder.label}`}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      folder.onStartChat?.();
                                      setChatHistoryOpen(false);
                                    }}
                                  >
                                    <MessageSquare aria-hidden="true" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top">{`New chat in ${folder.label}`}</TooltipContent>
                              </Tooltip>
                            ) : null}
                          </summary>
                          <div className={chatClass("machineChatLeaves")}>
                            {(expandedChatFolders.has(folder.key) ? folder.chats : folder.chats.slice(0, 4)).map((chat) => (
                              <button
                                type="button"
                                key={chat.key}
                                className={chatClass(chat.active && "active")}
                                aria-current={chat.active ? "true" : undefined}
                                onClick={() => {
                                  chat.onOpen?.();
                                  setChatHistoryOpen(false);
                                }}
                              >
                                <span><ChatInlineMarkdown text={chat.title} /></span>
                                {chat.updatedAt ? <time>{formatRelativeTime(chat.updatedAt)}</time> : null}
                                <small><ChatInlineMarkdown text={chat.subtitle} /></small>
                              </button>
                            ))}
                            {!expandedChatFolders.has(folder.key) && folder.chats.length > 4 ? (
                              <button
                                type="button"
                                className={chatClass("machineChatShowMore")}
                                onClick={() => setExpandedChatFolders((current) => new Set(current).add(folder.key))}
                              >
                                Show {folder.chats.length - 4} more
                              </button>
                            ) : null}
                            {folder.chats.length === 0 ? (
                              <span className={chatClass("machineTreeEmpty")}>No chats yet</span>
                            ) : null}
                          </div>
                        </details>
                      )) : (
                        <div className={chatClass("machineTreeEmpty")}>No chats yet</div>
                      )}
                    </div>
                  </details>
                )) : (
                  <div className={chatClass("emptyMachineChat")}>
                    <strong>No machines yet</strong>
                    <p>Connect a machine from Agents, then come back here to start chatting.</p>
                  </div>
                )}
              </div>
            </TooltipProvider>

            {selectedAgent ? (
            <>
            <details className={chatClass("advancedSettings")}>
              <summary>Manual setup</summary>
              <div className={chatClass("advancedFields")}>
                <label>
                  Name
                  <input value={selectedAgent.name} onChange={(event) => updateAgent({ name: event.target.value })} />
                </label>

                <label>
                  Runtime
                  <select value={selectedAgent.runtime} onChange={(event) => switchRuntime(event.target.value as AgentRuntime)}>
                    {Object.entries(RUNTIME_LABELS).map(([runtime, label]) => (
                      <option value={runtime} key={runtime}>{label}</option>
                    ))}
                  </select>
                </label>

                <label className={fleetClass("toggleRow")}>
                  <input
                    type="checkbox"
                    checked={selectedAgent.useSharedVault !== false}
                    onChange={(event) => updateAgent({ useSharedVault: event.target.checked })}
                  />
                  Use shared Obsidian vault
                </label>

                <label>
                  Agent-specific env
                  <textarea
                    value={formatAgentEnvText(selectedAgent.agentEnv)}
                    onChange={(event) => updateAgent({ agentEnv: parseAgentEnvText(event.target.value) })}
                    rows={4}
                    placeholder={"WRITER_STYLE=concise\nRESEARCH_REGION=US"}
                  />
                  <small>These overlay shared hive-env-add runtime env values for dashboard-dispatched runs.</small>
                </label>

                <label>
                  {selectedAgent.runtime === "aeon" ? "A2A Gateway URL" : selectedAgent.runtime === "openclaw" ? "Gateway URL" : "Runtime URL"}
                  <input
                    value={selectedAgent.runtime === "aeon" ? selectedAgent.a2aUrl ?? selectedAgent.gatewayUrl : selectedAgent.gatewayUrl}
                    onChange={(event) => updateAgent(selectedAgent.runtime === "aeon"
                      ? { gatewayUrl: event.target.value, a2aUrl: event.target.value }
                      : { gatewayUrl: event.target.value })}
                  />
                </label>

                <label>
                  Agent ID
                  <input value={selectedAgent.agentId ?? ""} onChange={(event) => updateAgent({ agentId: event.target.value })} placeholder="main, researcher, writer..." />
                </label>

                <label>
                  Token
                  <input value={selectedAgent.token ?? ""} onChange={(event) => updateAgent({ token: event.target.value })} placeholder="Optional if runtime config has one" />
                </label>

                {selectedAgent.runtime === "aeon" ? (
                  <>
                    <label>
                      Aeon Repo
                      <input value={selectedAgent.aeonRepo ?? ""} onChange={(event) => updateAgent({ aeonRepo: event.target.value })} placeholder="owner/repo" />
                    </label>
                    <label>
                      Aeon Local Path
                      <input value={selectedAgent.aeonLocalPath ?? selectedAgent.localDataDir ?? ""} onChange={(event) => updateAgent({ aeonLocalPath: event.target.value, localDataDir: event.target.value })} placeholder="~/aeon" />
                    </label>
	                    <label>
	                      Aeon Branch
	                      <input value={selectedAgent.aeonBranch ?? "main"} onChange={(event) => updateAgent({ aeonBranch: event.target.value })} />
	                    </label>
	                    <label>
	                      GitHub secret keys
	                      <textarea
	                        value={aeonEnvKeys}
	                        onChange={(event) => setAeonEnvKeys(event.target.value)}
	                        rows={4}
	                        placeholder="ANTHROPIC_API_KEY&#10;BANKR_LLM_KEY&#10;GH_GLOBAL"
	                      />
	                    </label>
	                    <div className={fleetClass("setupActions")}>
	                      <Button type="button" size="sm" variant="secondary" onClick={() => void syncAeonEnvToGitHub()} disabled={aeonEnvSyncing || !selectedAgent.aeonRepo?.trim()}>
	                        {aeonEnvSyncing ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Upload aria-hidden="true" />}
	                        {aeonEnvSyncing ? "Syncing secrets" : "Sync env to GitHub"}
	                      </Button>
	                      {aeonEnvSyncStatus ? <small>{aeonEnvSyncStatus}</small> : <small>Push selected local HivemindOS/Aeon env keys to this Aeon repo as GitHub Actions secrets.</small>}
	                    </div>
	                  </>
                ) : selectedAgent.runtime !== "openclaw" ? (
                  <>
                    <label>
                      Chat Path
                      <input value={selectedAgent.chatPath ?? "/chat"} onChange={(event) => updateAgent({ chatPath: event.target.value })} />
                    </label>
                    <label>
                      Status Path
                      <input value={selectedAgent.statusPath ?? "/health"} onChange={(event) => updateAgent({ statusPath: event.target.value })} />
                    </label>
                  </>
                ) : (
                  <label>
                    Session Key
                    <input value={selectedAgent.sessionKey ?? ""} onChange={(event) => updateAgent({ sessionKey: event.target.value })} placeholder="Optional OpenClaw session override" />
                  </label>
                )}

                <label>
                  Runtime Data Dir
                  <input
                    value={selectedAgent.localDataDir ?? ""}
                    onChange={(event) => updateAgent({ localDataDir: event.target.value })}
                    placeholder="~/.hermes, /srv/hermes-seo/data, mounted runtime path..."
                  />
                </label>

                <label>
                  Telemetry URL
                  <input
                    value={selectedAgent.telemetryUrl ?? ""}
                    onChange={(event) => updateAgent({ telemetryUrl: event.target.value })}
                    placeholder="http://100.x.y.z:8787"
                  />
                </label>

                <label>
                  Machine Name
                  <input
                    value={selectedAgent.machineName ?? ""}
                    onChange={(event) => updateAgent({ machineName: event.target.value })}
                    placeholder="local, vps-1, macbook, workstation..."
                  />
                </label>
              </div>
            </details>

            </>
            ) : null}
          </aside>

          {selectedAgent ? (
          <section className={chatClass("chat")}>
            <button
              type="button"
              className={chatClass("historyOpenButton")}
              aria-label="Open chat history"
              aria-expanded={chatHistoryOpen}
              onClick={() => setChatHistoryOpen(true)}
            >
              <AlignLeft aria-hidden="true" />
            </button>
            <div className={chatClass("chatHeader")}>
              <div className={chatClass("chatContextControls", "chatIdentityMenu")} ref={chatContextMenuRef}>
                <button
                  type="button"
                  className={chatClass("chatIdentity", "chatIdentityTrigger")}
                  title="Choose the machine and agent for this chat"
                  aria-haspopup="menu"
                  aria-expanded={chatContextMenu === "machine"}
                  onClick={() => setChatContextMenu((current) => current === "machine" ? "" : "machine")}
                >
                  {renderAgentAvatar("agentAvatarLarge")}
                  <span className={chatClass("chatIdentityCopy")}>
                    <span className={chatClass("chatTitleRow")}>
                      <span className={chatClass("chatIdentityTitle")}>{selectedAgent.name}</span>
                      <span className={chatClass("livePill")}><span aria-hidden="true" />Live</span>
                    </span>
                    <span className={chatClass("chatIdentityMeta")}>
                      <span className={chatClass("chatHeaderMetaFull")}>{runtimeIdentity} · {selectedChatMachine?.name ?? selectedAgent.machineName ?? "This Mac"}</span>
                      <span className={chatClass("chatHeaderMetaMobile")}>{runtimeLabel} · {selectedChatMachine?.name ?? selectedAgent.machineName ?? "This Mac"}</span>
                    </span>
                  </span>
                  <ChevronDown aria-hidden="true" className={chatClass("chatIdentityChevron")} />
                </button>
                {chatContextMenu === "machine" ? (
                  <div className={chatClass("chatContextMenu")} role="menu">
                    {chatSidebarTree.flatMap((machine) => {
                      const group = machineGroups.find((item) => item.key === machine.key);
                      return (group?.agents ?? []).map((agent) => {
                        const iconSrc = agentMenuIcon(agent, beeRoleIconPath);
                        const machineLabel = agentMenuMachineLabel(machine, agent);
                        const statusLabel = agentMenuStatusLabel(machine, agent);
                        return (
                          <button
                            type="button"
                            role="menuitem"
                            key={`${machine.key}-${agent.id}`}
                            onClick={() => {
                              startAgentChat(agent.id, { fresh: true, chatLeafKey: `machine-${machine.key}-${agent.id}` });
                              setChatContextMenu("");
                            }}
                          >
                            <span
                              className={chatClass("chatContextAgentIcon", iconSrc && "hasImage")}
                              style={iconSrc ? { backgroundImage: `url(${iconSrc})` } : undefined}
                              aria-hidden="true"
                            >
                              {iconSrc ? null : <b>{agentInitials(agent)}</b>}
                            </span>
                            <span>{agent.name}</span>
                            <small>{machineLabel}{statusLabel && statusLabel !== agent.name ? ` · ${statusLabel.replace(`${agent.name} · `, "")}` : ""}</small>
                          </button>
                        );
                      });
                    })}
                  </div>
                ) : null}
              </div>
              <div className={chatClass("chatHeaderActions")}>
                <Button type="button" variant="secondary" onClick={handleCheckStatus} disabled={selectedStatusChecking}>
                  {selectedStatusChecking ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Activity aria-hidden="true" />}
                  {selectedStatusChecking ? "Checking" : "Check status"}
                </Button>
                <details className={chatClass("runtimeDetails")}>
                  <summary>System</summary>
                  <dl className={chatClass("chatRuntimeMeta")} aria-label="Agent runtime details">
                    <div>
                      <dt>Runtime</dt>
                      <dd>{runtimeLabel}</dd>
                    </div>
                    <div>
                      <dt>Provider</dt>
                      <dd>{providerLabel}</dd>
                    </div>
                    <div>
                      <dt>Model</dt>
                      <dd>{modelLabel}</dd>
                    </div>
                  </dl>
                </details>
              </div>
            </div>
            {sessionNotice && visibleMessages.length > 0 ? (
              <div className={chatClass("chatSessionNote")}>
                <MessageSquare aria-hidden="true" />
                <span>{sessionNotice}</span>
              </div>
            ) : null}
            {status && statusAgentId === selectedAgent.id ? (
              // Plain-English status summary in place of raw runtime JSON (rule 6).
              <div className="flex items-center gap-2 rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.55)] px-3 py-2 text-xs">
                <strong className={status.ok ? "text-[#bbf7d0]" : "text-[#fecdd3]"}>
                  {status.ok ? "Runtime is responding." : "Runtime did not respond."}
                </strong>
                <span className="text-[var(--muted)]">
                  {status.runtime ? `${RUNTIME_LABELS[status.runtime]} agent` : "Unknown runtime"}
                  {status.status ? ` · code ${status.status}` : ""}
                  {status.error ? ` · ${status.error}` : ""}
                </span>
                <details className="ml-auto" onClick={(event) => event.stopPropagation()}>
                  <summary className="cursor-pointer text-[0.65rem] uppercase tracking-[0.12em] text-[var(--muted)]">
                    Raw payload
                  </summary>
                  <pre className="mt-2 max-w-full overflow-auto text-[0.7rem] text-[var(--muted)]">{JSON.stringify(status, null, 2)}</pre>
                </details>
                <CloseIconButton
                  aria-label="Dismiss status message"
                  size="sm"
                  onClick={() => {
                    setStatus?.(null);
                    setStatusAgentId?.("");
                  }}
                />
              </div>
            ) : null}
            <div
              className={chatClass("messages", visibleMessages.length === 0 && "empty")}
              ref={messagesScrollRef}
              onScroll={updateChatAutoScroll}
            >
              {visibleMessages.length === 0 ? (
                <div className={chatClass("chatEmptyPrompt")}>
                  <strong>No messages yet</strong>
                  <p>Messages with {selectedAgent.name} will appear here.</p>
                </div>
              ) : null}
              {visibleMessages.map((message, index) => {
                const messageKey = `${message.role}-${index}`;
                const displayContent = chatDisplayContent(message);
                const generationForMessage = chatKanbanGeneration?.key === messageKey ? chatKanbanGeneration : null;
                const generating = generationForMessage && ["generating", "creating"].includes(generationForMessage.phase);
                const isStreamingAssistant = message.role === "assistant" && busy && index === visibleMessages.length - 1;
                const canGenerateKanbanTask = message.role === "assistant" && !isStreamingAssistant && displayContent?.trim() && generateKanbanTaskFromChat;
                const copied = copiedMessageKey === messageKey;
                const agentPrompt = message.agentPrompt;
                return (
                  <div className={chatClass("message", message.role, isStreamingAssistant && "streaming")} key={messageKey}>
                    {message.role === "assistant" ? (
                      renderAgentAvatar("messageAvatar")
                    ) : null}
                    <div className={chatClass("messageBody")}>
                      {message.role === "user" ? <span className={chatClass("messageRole")}>You</span> : null}
                      {message.role === "assistant" ? (
                        <div className={chatClass("assistantByline")}>
                          {renderAgentAvatar("messageBylineAvatar")}
                          <span>{selectedAgent.name}</span>
                          <small>{runtimeIdentity}</small>
                        </div>
                      ) : null}
                      <MessageAttachments attachments={message.attachments} />
                      {agentPrompt ? (
                        <div className={chatClass("agentPromptCard")}>
                          <div className={chatClass("agentPromptHeader")}>
                            <Sparkles aria-hidden="true" />
                            <span>{agentPrompt.type === "approval" ? "Approval needed" : agentPrompt.type === "secret" ? "Secret needed" : agentPrompt.type === "sudo" ? "Local prompt" : "Agent question"}</span>
                          </div>
                          <p>{agentPrompt.question}</p>
                          {agentPrompt.choices?.length ? (
                            <div className={chatClass("agentPromptChoices")}>
                              {agentPrompt.choices.map((choice) => (
                                <button
                                  type="button"
                                  key={choice}
                                  onClick={() => setText(choice)}
                                >
                                  {choice}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {agentPrompt.allowFreeText ? <small>Choose a reply or type your answer below.</small> : null}
                        </div>
                      ) : displayContent ? (
                        <ChatMarkdown text={displayContent} />
                      ) : (
                        message.role === "assistant" && busy ? (
                          <>
                            <AgentResponseLoader />
                            <AgentProcessPanel {...{ Activity, ChevronDown, ChevronUp, CircleAlert, FileText, GitBranch, Hammer, Image, Pencil, Search, Sparkles, Terminal, agentIconSrc: selectedAgentIconSrc, agentInitials: selectedAgentInitials, chatClass, events: selectedChatProcess }} />
                          </>
                        ) : <p />
                      )}
                      {isStreamingAssistant && displayContent?.trim() ? (
                        <div className={chatClass("streamingStatus")} aria-live="polite">
                          <span aria-hidden="true" />
                          <small>Still writing</small>
                        </div>
                      ) : null}
                      {message.role === "assistant" && !isStreamingAssistant && displayContent?.trim() ? (
                        <TooltipProvider>
                          <div className={chatClass("messageActions")}>
                            <Tooltip open={copied ? true : undefined}>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className={chatClass("messageActionButton", copied && "active", copied && "copied")}
                                  aria-label={copied ? "Copied response" : "Copy response"}
                                  onClick={() => copyAssistantResponse(messageKey, displayContent)}
                                >
                                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">{copied ? "Copied!" : "Copy response"}</TooltipContent>
                            </Tooltip>
                            {canGenerateKanbanTask ? (
                              <>
                                <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className={chatClass("messageActionButton", openKanbanTaskMenuKey === messageKey && "active")}
                                    aria-label="Generate Kanban task from this response"
                                    onClick={() => setOpenKanbanTaskMenuKey((current) => current === messageKey ? "" : messageKey)}
                                    disabled={Boolean(generating)}
                                  >
                                    {generating ? <LoaderCircle aria-hidden="true" /> : <KanbanSquare aria-hidden="true" />}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Send to Kanban</TooltipContent>
                              </Tooltip>
                              {openKanbanTaskMenuKey === messageKey || generationForMessage ? (
                                <div className={chatClass("generateKanbanPopover", generationForMessage && `phase-${generationForMessage.phase}`)}>
                                  <div className={chatClass("generateKanbanHeader")}>
                                    {generationForMessage?.phase === "done"
                                      ? <Check className={chatClass("generateKanbanStatusIcon")} aria-hidden="true" />
                                      : <Sparkles className={chatClass("generateKanbanStatusIcon")} aria-hidden="true" />}
                                    <span>{generationForMessage ? generationForMessage.message : "Generate and send to:"}</span>
                                    {generationForMessage && ["done", "error"].includes(generationForMessage.phase) ? (
                                      <CloseIconButton
                                        className={chatClass("generateKanbanClose")}
                                        size="sm"
                                        aria-label="Close Kanban status"
                                        onClick={() => dismissKanbanPopover(messageKey)}
                                      />
                                    ) : null}
                                  </div>
                                  {generationForMessage ? (
                                    <div className={chatClass("generateKanbanProgress")}>
                                      <span aria-hidden="true" />
                                      <small>{generationForMessage.taskTitle || (generationForMessage.status === "ready" ? "Ready lane" : "Ideas lane")}</small>
                                    </div>
                                  ) : (
                                    <div className={chatClass("generateKanbanActions")}>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenKanbanTaskMenuKey(messageKey);
                                          void generateKanbanTaskFromChat("ideas", { key: messageKey, content: displayContent });
                                        }}
                                      >
                                        Ideas
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenKanbanTaskMenuKey(messageKey);
                                          void generateKanbanTaskFromChat("ready", { key: messageKey, content: displayContent });
                                        }}
                                      >
                                        Ready
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ) : null}
                            </>
                          ) : null}
                          </div>
                        </TooltipProvider>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} aria-hidden="true" />
            </div>
            {visibleMessages.length === 0 ? (
              <div className={chatClass("chatSuggestions")} aria-label="Suggested prompts">
                {[
                  "What are you working on?",
                  "Summarize latest task",
                  "Check workspace status",
                ].map((prompt) => (
                  <button type="button" key={prompt} onClick={() => setText(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
            <form onSubmit={sendMessage}>
              <ComposerField
                value={text}
                onChange={setText}
                placeholder={`Ask ${selectedAgent.name} to do something...`}
                disabled={busy}
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
                onImageChange={handleChatImageChange}
                onRemoveAttachment={removeChatAttachment}
                onAttachDirectory={() => void attachChatDirectory()}
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
                onToggleRecording={recording ? stopAudioRecording : () => void startAudioRecording("chat")}
                canSend={Boolean(text.trim() || chatAttachments.length || chatDirectories.length)}
                submitOnEnter
                hermesSlashCommands={selectedAgent.runtime === "hermes"}
                agentMode={agentMode}
                onAgentModeChange={setAgentMode}
                modelPicker={modelPicker}
              />
            </form>
            <p className={chatClass("composerHint")}>
              <span>{runtimeIdentity} active</span>
              <span>Enter to send · Shift Enter for a new line</span>
              {lastAssistant ? <span>Last reply ready</span> : null}
            </p>
          </section>
          ) : (
          <section className={chatClass("chat", "chatEmptyState")}>
            <button
              type="button"
              className={chatClass("historyOpenButton")}
              aria-label="Open chat history"
              aria-expanded={chatHistoryOpen}
              onClick={() => setChatHistoryOpen(true)}
            >
              <AlignLeft aria-hidden="true" />
            </button>
            <strong>No machine selected</strong>
            <p>Choose a connected machine on the left to start a chat.</p>
          </section>
          )}
        </section>
      ) : null}
      <ChatFolderModal {...props} />

      <SkillBrowserModal {...props} />

      <AgentSettingsModal {...props} />
  </>);
}
