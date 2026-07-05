import { HIVEMIND_OS_RUNTIME } from "@/lib/types/agent-runtime";

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
  };
};

type ProcessEventLike = {
  label?: unknown;
  detail?: unknown;
};

export function isHiddenChatProcessEvent(event: ProcessEventLike = {}) {
  const label = String(event?.label ?? "").trim();
  const detail = String(event?.detail ?? "").trim();
  if (/assistant started writing|assistant wrote in session|agent replied|queued chat request/i.test(label)) return true;
  if (/^Attached .+ session$/i.test(label)) return true;
  if (/^Runtime session active$/i.test(label)) return true;
  if (/^Runtime event$/i.test(label) || /^Runtime event$/i.test(detail)) return true;
  return false;
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

export function messageKey(message: ChatMessageLike, index: number) {
  const role = String(message?.role ?? "message");
  const source = String(message?.sourceSessionId ?? "");
  const sourceIndex = typeof message?.sourceIndex === "number" && Number.isFinite(message.sourceIndex) ? String(message.sourceIndex) : "";
  const createdAt = typeof message?.createdAt === "number" && Number.isFinite(message.createdAt) ? String(message.createdAt) : "";
  return [source, sourceIndex, role, createdAt, index].filter(Boolean).join(":");
}

export function messageText(message: ChatMessageLike, chatDisplayContent?: (message: ChatMessageLike) => string) {
  const display = chatDisplayContent?.(message);
  if (typeof display === "string" && display.trim()) return display;
  return String(message?.content ?? message?.text ?? message?.body ?? "").trim();
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
  const parentheticalIndex = text.search(/\s+\(/);
  return parentheticalIndex > 0 ? text.slice(0, parentheticalIndex).trim() : text;
}

export function promptUiFromMessage(message: ChatMessageLike, content: string) {
  const structuredPrompt = message?.agentPrompt;
  const structuredChoices = Array.isArray(structuredPrompt?.choices)
    ? structuredPrompt.choices.map((choice) => plainPromptOptionText(String(choice))).filter(Boolean)
    : [];
  if (structuredPrompt?.question && structuredChoices.length) {
    return {
      displayText: String(structuredPrompt.question).trim() || content,
      options: structuredChoices.map((choice) => ({ label: promptOptionButtonLabel(choice), value: choice })),
    };
  }

  const lines = content.split(/\r?\n/);
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
