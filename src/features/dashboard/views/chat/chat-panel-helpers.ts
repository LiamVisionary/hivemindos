import { HIVEMIND_OS_RUNTIME } from "@/lib/types/agent-runtime";
import { CAPABILITY_APPROVAL_CONTINUATION_MARKER } from "@/lib/types/capability-approval";
import { isAgentColdStartProcessEvent } from "@/lib/services/chat/agent-cold-start";
import { normalizeChatPermissionMode } from "@/lib/types/chat-permissions";
import type { ChatPermissionMode } from "@/lib/types/chat-permissions";

type ChatAgentLike = {
  id?: string;
  beeRole?: string;
  name?: string;
  customWorkerClasses?: Array<{ id?: string; imageSrc?: string }>;
  selectedCustomWorkerClassId?: string;
  customWorkerClass?: { imageSrc?: string };
  workerClass?: string;
  machineName?: string;
  telemetryUrl?: string;
  gatewayUrl?: string;
  a2aUrl?: string;
  runtime?: string;
  provider?: string;
  model?: string;
};

type ChatMachineLike = {
  key?: string;
  name?: string;
};

type RuntimeModelSelectionLike = {
  provider?: string;
  model?: string;
};

type ChatMessageLike = {
  role?: unknown;
  sourceSessionId?: unknown;
  sourceIndex?: unknown;
  createdAt?: unknown;
  content?: unknown;
  text?: unknown;
  body?: unknown;
  agentPrompt?: {
    question?: unknown;
    choices?: unknown;
    allowFreeText?: unknown;
    response?: unknown;
  };
};

type ProcessEventLike = {
  label?: unknown;
  detail?: unknown;
};

export type ChatPromptUi = {
  displayText: string;
  options: Array<{
    label: string;
    value: string;
    permissionMode?: ChatPermissionMode;
    suppressUserMessage?: boolean;
  }>;
  allowFreeText?: boolean;
  response?: {
    label: string;
    value?: string;
    respondedAt?: number;
  };
};

export function isHiddenChatProcessEvent(event: ProcessEventLike = {}) {
  if (isAgentColdStartProcessEvent(event)) return true;
  const label = String(event?.label ?? "").trim();
  const detail = String(event?.detail ?? "").trim();
  if (/assistant started writing|assistant wrote in session|agent replied|queued chat request/i.test(label)) return true;
  if (/^Attached .+ session$/i.test(label)) return true;
  if (/^Runtime session active$/i.test(label)) return true;
  if (/^Runtime event$/i.test(label) || /^Runtime event$/i.test(detail)) return true;
  return false;
}

export function chatProcessTimerIsActive(streamActive: boolean, processEventsActive: boolean) {
  return streamActive && processEventsActive;
}

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

export const MODEL_SWITCHABLE_RUNTIMES = ["hermes", "openclaw", HIVEMIND_OS_RUNTIME];
export const CHAT_AUTO_SCROLL_THRESHOLD_PX = 180;

export const STATE_LABEL: Record<string, { tone: string; label: string }> = {
  working: { tone: "cyan", label: "working" },
  online: { tone: "cyan", label: "ready" },
  ready: { tone: "muted", label: "ready" },
  setup: { tone: "honey", label: "setup" },
  failed: { tone: "danger", label: "blocked" },
};

export function titleCaseLabel(value?: string) {
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

export function shortModelLabel(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "Model";
  if (trimmed.toLowerCase() === "adaptive") return "Adaptive";
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

export function agentInitials(agent?: ChatAgentLike) {
  if (agent?.beeRole === "queen") return "QB";
  const name = agent?.name?.trim() ?? "";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part.slice(0, 1).toUpperCase())
    .join("") || "A";
}

export function selectedAgentIcon(agent?: ChatAgentLike, beeRoleIconPath?: (role?: string, workerClass?: string) => string) {
  if (!agent) return "";
  if (agent.beeRole === "queen") return beeRoleIconPath?.("queen") ?? "/icons/queen-bee-v2.png";
  const customWorkerClass = agent.customWorkerClasses?.find((workerClass) => workerClass.id === agent.selectedCustomWorkerClassId)
    ?? agent.customWorkerClass;
  return (customWorkerClass?.imageSrc?.trim()
    || beeRoleIconPath?.("worker", agent.workerClass ?? "general")?.trim()
    || "/icons/worker-bee-general-v5.png");
}

export function isFixtureChatMachine(machine: ChatMachineLike) {
  const identity = `${machine?.key ?? ""} ${machine?.name ?? ""}`.toLowerCase();
  return /\b(?:hivemindos-)?e2e[-_0-9]/i.test(identity);
}

export function agentMenuMachineLabel(machine: ChatMachineLike, agent: ChatAgentLike) {
  if (machine?.key !== "unassigned") return machine?.name ?? "This Mac";
  const explicitMachine = agent?.machineName?.trim();
  if (explicitMachine) return explicitMachine;
  if (agent?.telemetryUrl?.trim()) return "Bridge linked";
  if (agent?.gatewayUrl?.trim() || agent?.a2aUrl?.trim()) return "Runtime URL configured";
  return "Setup needed";
}

export function agentMenuRuntimeIdentity(agent: ChatAgentLike, runtimeModelSelectionsByRuntime?: Record<string, RuntimeModelSelectionLike>) {
  const selection = agent?.runtime ? runtimeModelSelectionsByRuntime?.[agent.runtime] : undefined;
  const provider = agent?.provider?.trim() || selection?.provider || "";
  const model = agent?.model?.trim() || selection?.model || "";
  const hasProviderModel = Boolean(provider && model);
  return {
    runtime: agent?.runtime?.trim() || "runtime",
    provider: hasProviderModel ? provider : "",
    model: hasProviderModel ? model : "",
  };
}

export function agentMenuStatusLabel(machine: ChatMachineLike, agent: ChatAgentLike) {
  if (machine?.key !== "unassigned") return agent?.name ?? "";
  if (agent?.telemetryUrl?.trim() || agent?.gatewayUrl?.trim() || agent?.a2aUrl?.trim()) {
    return `${agent?.name ?? "Agent"} / chat route saved`;
  }
  return `${agent?.name ?? "Agent"} / needs chat URL`;
}

export type ChatAgentUsageStat = { lastUsedAt: number; threadCount: number };

/**
 * Per-agent recency/volume, derived from the same sidebar rows the chat history
 * renders. `threadCount` counts every thread row the agent owns — including the
 * placeholder row for a freshly opened, still-empty chat, because opening a
 * thread with an agent is itself a use of that agent.
 */
export function chatAgentUsageStats(rows: Array<{ agentId?: string; updatedAt?: unknown }> = []) {
  const stats = new Map<string, ChatAgentUsageStat>();
  for (const row of rows) {
    const agentId = String(row?.agentId ?? "").trim();
    if (!agentId) continue;
    const updatedAtValue = Number(row?.updatedAt ?? 0);
    const updatedAt = Number.isFinite(updatedAtValue) && updatedAtValue > 0 ? updatedAtValue : 0;
    const current = stats.get(agentId);
    if (current) {
      current.threadCount += 1;
      current.lastUsedAt = Math.max(current.lastUsedAt, updatedAt);
      continue;
    }
    stats.set(agentId, { lastUsedAt: updatedAt, threadCount: 1 });
  }
  return stats;
}

export type AgentMenuGroupKey = "recent" | "frequent" | "all";

export const AGENT_MENU_GROUP_LABELS: Record<AgentMenuGroupKey, string> = {
  recent: "Recent",
  frequent: "Most used",
  all: "All agents",
};

const AGENT_MENU_RECENT_LIMIT = 4;
const AGENT_MENU_FREQUENT_MIN_THREADS = 2;

function compareAgentNames(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }) || a.localeCompare(b);
}

/**
 * Orders the agent picker: a short most-recently-used run, then the agents you
 * chat with most, then everything else alphabetically. Ranking runs over the
 * unfiltered list so a search never reshuffles which group an agent belongs to.
 */
export function rankAgentMenuRows<T extends { agent?: ChatAgentLike }>(
  rows: T[],
  usage: Map<string, ChatAgentUsageStat>,
  options?: { recentLimit?: number; frequentMinThreads?: number },
): Array<T & { menuGroup: AgentMenuGroupKey }> {
  const recentLimit = options?.recentLimit ?? AGENT_MENU_RECENT_LIMIT;
  const frequentMinThreads = options?.frequentMinThreads ?? AGENT_MENU_FREQUENT_MIN_THREADS;
  const decorated = rows.map((row, index) => {
    const agentId = String(row?.agent?.id ?? "").trim();
    const stat = usage.get(agentId);
    return {
      row,
      index,
      name: String(row?.agent?.name ?? agentId).trim(),
      lastUsedAt: stat?.lastUsedAt ?? 0,
      threadCount: stat?.threadCount ?? 0,
    };
  });

  const recent = decorated
    .filter((item) => item.lastUsedAt > 0)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt || compareAgentNames(a.name, b.name) || a.index - b.index)
    .slice(0, Math.max(0, recentLimit));
  const recentIndexes = new Set(recent.map((item) => item.index));

  const rest = decorated.filter((item) => !recentIndexes.has(item.index));
  const frequent = rest
    .filter((item) => item.threadCount >= frequentMinThreads)
    .sort((a, b) => (
      b.threadCount - a.threadCount
      || b.lastUsedAt - a.lastUsedAt
      || compareAgentNames(a.name, b.name)
      || a.index - b.index
    ));
  const frequentIndexes = new Set(frequent.map((item) => item.index));

  const remaining = rest
    .filter((item) => !frequentIndexes.has(item.index))
    .sort((a, b) => compareAgentNames(a.name, b.name) || a.index - b.index);

  return [
    ...recent.map((item) => ({ ...item.row, menuGroup: "recent" as const })),
    ...frequent.map((item) => ({ ...item.row, menuGroup: "frequent" as const })),
    ...remaining.map((item) => ({ ...item.row, menuGroup: "all" as const })),
  ];
}

export function messageKey(message: ChatMessageLike, index: number) {
  const role = String(message?.role ?? "message");
  const source = String(message?.sourceSessionId ?? "");
  const sourceIndex = typeof message?.sourceIndex === "number" && Number.isFinite(message.sourceIndex) ? String(message.sourceIndex) : "";
  const createdAt = typeof message?.createdAt === "number" && Number.isFinite(message.createdAt) ? String(message.createdAt) : "";
  return [source, sourceIndex, role, createdAt, index].filter(Boolean).join(":");
}

/** A capability-plan continuation is runtime plumbing: the person only typed
 * the original task, so that is all the thread may ever display. The full
 * continuation stays in the session for the runtime. */
function compactCapabilityContinuation(text: string) {
  if (!text.startsWith(CAPABILITY_APPROVAL_CONTINUATION_MARKER)) return text;
  const originalTask = text.match(/^Original task:\s*(.+)$/m)?.[1]?.trim();
  return originalTask || "Approved capability plan. Continue with the task.";
}

export function messageText(message: ChatMessageLike, chatDisplayContent?: (message: ChatMessageLike) => string) {
  const display = chatDisplayContent?.(message);
  if (typeof display === "string" && display.trim()) return compactCapabilityContinuation(display);
  return compactCapabilityContinuation(String(message?.content ?? message?.text ?? message?.body ?? "").trim());
}

export function isSilentCommandApprovalMessage(message: ChatMessageLike) {
  if (message?.role !== "user") return false;
  return /^Approved: run this pending local command now\.\s+Command:\s+\S[\s\S]*$/.test(messageText(message));
}

export function isChatScrollNearBottom(node: HTMLElement) {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= CHAT_AUTO_SCROLL_THRESHOLD_PX;
}

export function markdownText(text: string) {
  return text
    .replace(/^``([A-Za-z0-9_-]+)\s*$/gm, "```$1")
    .replace(/^``\s*$/gm, "```");
}

function plainPromptOptionText(value: string) {
  return value
    .replace(/^\s*[-*]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/__+/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function promptOptionButtonLabel(value: string) {
  const text = plainPromptOptionText(value);
  const detailIndexes = [text.search(/\s+\(/), text.search(/\s+[—–]\s+/)].filter((index) => index > 0);
  const detailIndex = detailIndexes.length ? Math.min(...detailIndexes) : -1;
  return detailIndex > 0 ? text.slice(0, detailIndex).trim() : text;
}

function markdownDecisionPrompt(lines: string[]): ChatPromptUi | null {
  const firstOptionIndex = lines.findIndex((line) => /^\s*[-*+]\s+\S/.test(line));
  if (firstOptionIndex <= 0) return null;
  const question = lines.slice(0, firstOptionIndex).join("\n").trim();
  if (!/(?:\b(?:which|what)\b[\s\S]{0,120}\b(?:prefer|choose|select|want)\b|\b(?:choose|select|pick)\b[\s\S]{0,120})[?:]?\s*$/i.test(question)) return null;
  const options: Array<{ label: string; value: string }> = [];
  let optionEndIndex = firstOptionIndex;
  for (; optionEndIndex < lines.length; optionEndIndex += 1) {
    const line = lines[optionEndIndex] ?? "";
    const match = line.match(/^\s*[-*+]\s+(.+?)\s*$/);
    if (!match) break;
    const value = plainPromptOptionText(match[1] ?? "");
    if (value) options.push({ label: promptOptionButtonLabel(value), value });
  }
  if (options.length < 2 || options.length > 6) return null;
  const trailingText = lines.slice(optionEndIndex).join("\n").trim();
  return {
    displayText: [question, trailingText].filter(Boolean).join("\n\n"),
    options,
  };
}

export function promptUiFromMessage(message: ChatMessageLike, content: string): ChatPromptUi | null {
  const structuredPrompt = message?.agentPrompt;
  const structuredResponse = structuredPrompt?.response && typeof structuredPrompt.response === "object"
    ? structuredPrompt.response as { label?: unknown; value?: unknown; respondedAt?: unknown }
    : null;
  const response = structuredResponse && typeof structuredResponse.label === "string" && structuredResponse.label.trim()
    ? {
      label: structuredResponse.label.trim(),
      value: typeof structuredResponse.value === "string" ? structuredResponse.value.trim() : undefined,
      respondedAt: typeof structuredResponse.respondedAt === "number" ? structuredResponse.respondedAt : undefined,
    }
    : undefined;
  const structuredChoices = Array.isArray(structuredPrompt?.choices)
    ? structuredPrompt.choices.map((choice) => {
      if (typeof choice === "string") {
        const value = plainPromptOptionText(choice);
        return value ? { label: promptOptionButtonLabel(value), value } : null;
      }
      if (!choice || typeof choice !== "object") return null;
      const record = choice as { label?: unknown; value?: unknown; permissionMode?: unknown; suppressUserMessage?: unknown };
      const value = plainPromptOptionText(String(record.value ?? record.label ?? ""));
      if (!value) return null;
      const label = promptOptionButtonLabel(String(record.label ?? value));
      return {
        label,
        value,
        permissionMode: normalizeChatPermissionMode(record.permissionMode),
        ...(record.suppressUserMessage === true ? { suppressUserMessage: true } : {}),
      };
    }).filter((choice): choice is { label: string; value: string; permissionMode?: ChatPermissionMode; suppressUserMessage?: boolean } => Boolean(choice))
    : [];
  if (structuredPrompt?.question && structuredChoices.length) {
    return {
      displayText: String(structuredPrompt.question).trim() || content,
      options: structuredChoices,
      allowFreeText: structuredPrompt.allowFreeText !== false,
      response,
    };
  }

  const lines = content.split(/\r?\n/);
  const markdownDecision = markdownDecisionPrompt(lines);
  if (markdownDecision) return markdownDecision;
  const optionsIndex = lines.findIndex((line) => /^options?\s*:?\s*$/i.test(line.trim()));
  if (optionsIndex < 0) return null;
  const options: Array<{ label: string; value: string }> = [];
  let listEnded = false;
  const trailingLines: string[] = [];
  for (const line of lines.slice(optionsIndex + 1)) {
    const match = line.match(/^\s*(?:[-*]\s*)?(?:\d+|[A-Za-z])[\).:-]\s+(.+?)\s*$/);
    if (match && !listEnded) {
      const value = plainPromptOptionText(match[1] ?? "");
      if (value) options.push({ label: promptOptionButtonLabel(value), value });
      continue;
    }
    if (line.trim()) listEnded = true;
    if (listEnded) trailingLines.push(line);
  }
  if (options.length < 2) return null;
  const displayText = [
    ...lines.slice(0, optionsIndex),
    ...trailingLines,
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { displayText: displayText || content, options };
}

export function processText(events: ProcessEventLike[] = []) {
  return events
    .slice(-12)
    .filter((event) => !isHiddenChatProcessEvent(event))
    .map((event) => {
      const label = String(event?.label ?? "event").trim();
      const detail = String(event?.detail ?? "").trim();
      return detail ? `${label}: ${detail}` : label;
    })
    .filter(Boolean)
    .join("\n");
}

export function normalizeSearchText(value?: string) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function chatSearchSnippet(text: string, query: string) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const normalizedText = normalizeSearchText(trimmed);
  const normalizedQuery = normalizeSearchText(query);
  const queryIndex = normalizedQuery ? normalizedText.indexOf(normalizedQuery) : -1;
  const start = queryIndex >= 0 ? Math.max(0, queryIndex - 56) : 0;
  const end = Math.min(trimmed.length, start + 150);
  return `${start > 0 ? "... " : ""}${trimmed.slice(start, end)}${end < trimmed.length ? " ..." : ""}`;
}
