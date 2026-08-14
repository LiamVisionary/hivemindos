import { AGENT_COLD_START_EVENT_LABEL, AGENT_COLD_START_EVENT_TYPE } from "@/lib/services/chat/agent-cold-start";
import { namedToolProcessEventFromRaw } from "@/lib/services/chat/chat-process-events";

// Chats on a machine-level leaf ("Unsorted chats") are general chats with no
// working directory; they must never inherit the machine's appDir or the
// agent's data dir as an implicit project folder.
export function isUnsortedChatLeafKey(leafKey?: string) {
  return Boolean(leafKey?.startsWith("machine-"));
}

// Working-directory pair for one chat send. `record` is what the dashboard
// stores and displays ("" = no folder); `request` is what the runtime host
// receives — "~" so a no-folder chat runs in the OS home directory (every
// chat runtime host expands it) instead of a project checkout.
export function chatWorkingDirectoryTargets(directoryPath: string, leafKey: string, agentDataDir?: string) {
  if (!directoryPath && isUnsortedChatLeafKey(leafKey)) return { record: "", request: "~" };
  const record = directoryPath || agentDataDir || "";
  return { record, request: record };
}

export function runtimePromptFromPayload(parsed: any) {
  const event = parsed?.event && typeof parsed.event === "object" ? parsed.event : null;
  const source = parsed?.clarify ?? parsed?.prompt ?? event ?? parsed;
  const type = String(event?.type ?? parsed?.type ?? source?.type ?? "");
  if (!/clarify|approval|sudo|secret|prompt/i.test(type)) return null;
  const question = String(source?.question ?? source?.message ?? source?.content ?? source?.text ?? "").trim();
  if (!question) return null;
  const rawChoices = source?.choices ?? source?.options;
  const choices = Array.isArray(rawChoices)
    ? rawChoices.map((choice) => {
      if (typeof choice === "string") return choice;
      if (!choice || typeof choice !== "object") return "";
      const label = String(choice.label ?? choice.value ?? "").trim();
      const value = String(choice.value ?? choice.label ?? "").trim();
      const permissionMode = String(choice.permissionMode ?? "").trim();
      const suppressUserMessage = choice.suppressUserMessage === true;
      return label || value ? {
        label: label || value,
        value: value || label,
        permissionMode,
        ...(suppressUserMessage ? { suppressUserMessage: true } : {}),
      } : "";
    }).filter(Boolean)
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

export function runtimePromptFromSessionMessage(message: any) {
  if (String(message?.role ?? "").trim().toLowerCase() !== "assistant") return null;
  return runtimePromptFromPayload(message?.raw);
}

export function processLabelFromComment(eventText: string) {
  return eventText
    .split("\n")
    .map((line) => line.replace(/^:\s?/, "").trim())
    .filter(Boolean)
    .join(" ");
}

function browserPreviewFromRuntimeEvent(parsed: any, event: any) {
  const source = event?.browserPreview ?? parsed?.browserPreview;
  if (!source || typeof source !== "object") return undefined;
  const url = String(source.url ?? "").trim();
  const port = Number(url.match(/^https?:\/\/[^/]+\/app-proxy\/(\d{1,5})\/?$/i)?.[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return {
    url,
    source: String(source.source ?? "agent-browser").trim().slice(0, 64) || "agent-browser",
  };
}

export function processLabelFromRuntimeEvent(parsed: any) {
  if (Array.isArray(parsed?.choices) && parsed.choices.length > 0 && parsed.choices.every((choice: any) => {
    if (!choice || typeof choice !== "object") return false;
    const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason.trim() : "";
    const text = [
      choice.delta?.content,
      choice.delta?.reasoning,
      choice.message?.content,
      choice.message?.reasoning,
      choice.text,
    ].map((value) => String(value ?? "")).join("").trim();
    return Boolean(finishReason) && !text && !choice.delta?.tool_calls && !choice.delta?.function_call && !choice.message?.tool_calls;
  })) return null;
  const event = parsed?.event && typeof parsed.event === "object" ? parsed.event : null;
  const type = String(event?.type ?? parsed?.type ?? "").trim();
  const source = event ?? parsed;
  const browserPreview = browserPreviewFromRuntimeEvent(parsed, event);
  const withBrowserPreview = (value: Record<string, unknown>) => browserPreview
    ? { ...value, browserPreview }
    : value;
  const message = String(source?.message ?? source?.label ?? source?.title ?? source?.name ?? source?.content ?? source?.delta ?? "").trim();
  const toolName = String(source?.tool ?? source?.toolName ?? source?.name ?? source?.command ?? "").trim();
  if (/^chat\.(text|session|done)$/.test(type)) return null;
  if (type === AGENT_COLD_START_EVENT_TYPE) {
    return { label: AGENT_COLD_START_EVENT_LABEL, detail: message || undefined, status: "running" };
  }
  if (/approval/i.test(type)) {
    const commandLine = String(source?.commandLine ?? "").trim();
    return {
      label: message || "Permission required",
      detail: commandLine || String(source?.detail ?? "").trim() || undefined,
      status: "running",
    };
  }
  if (/thinking|reasoning/i.test(type)) return { label: type.includes("reason") ? "Reasoning" : "Thinking", detail: message || undefined };
  const rawStatus = String(source?.status ?? "").trim().toLowerCase();
  const status = rawStatus === "completed" || rawStatus === "failed" || rawStatus === "running" ? rawStatus : undefined;
  if (/tool\.(generating|start|started|pending)/i.test(type)) {
    return withBrowserPreview({ label: toolName ? `Starting ${toolName}` : "Starting tool", detail: message || undefined, status: status ?? "running" });
  }
  if (/tool\.(progress|running)/i.test(type)) {
    return withBrowserPreview({ label: toolName ? `${toolName} running` : "Tool running", detail: message || undefined, status: status ?? "running" });
  }
  if (/tool\.(done|completed|failed|error)/i.test(type)) {
    return withBrowserPreview({ label: toolName ? `${toolName} finished` : "Tool finished", detail: message || undefined, status: status ?? (/failed|error/i.test(type) ? "failed" : "completed") });
  }
  if (parsed?.tool_call && typeof parsed.tool_call === "object") {
    const tool = parsed.tool_call;
    const label = String(tool.name ?? tool.tool ?? tool.command ?? "Tool call").trim();
    const detail = String(tool.message ?? tool.summary ?? tool.result ?? "").trim();
    return { label, detail: detail || undefined };
  }
  if (parsed?.status && typeof parsed.status === "object") {
    const statusPayload = parsed.status;
    const label = String(statusPayload.message ?? statusPayload.label ?? statusPayload.type ?? "Runtime status").trim();
    const detail = String(statusPayload.detail ?? statusPayload.phase ?? "").trim();
    const rawNestedStatus = String(statusPayload.status ?? "").trim().toLowerCase();
    const nestedStatus = rawNestedStatus === "completed" || rawNestedStatus === "failed" || rawNestedStatus === "running"
      ? rawNestedStatus
      : undefined;
    return { label, detail: detail || undefined, status: nestedStatus };
  }
  if (type && !/^chat\.text$/i.test(type)) {
    return { label: message || type.replace(/^chat\./, "").replace(/[._-]+/g, " "), detail: message && message !== type ? type : undefined };
  }
  return null;
}

function compactProcessDetail(value: unknown, maxLength = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function processLabelFromSessionMessage(message: any) {
  const role = String(message?.role ?? "").trim().toLowerCase();
  const content = String(message?.content ?? "").trim();
  if (!content) return null;
  if (role === "user" || role === "assistant") return null;
  if (role === "tool") {
    if (message?.type === "process") {
      const namedToolEvent = namedToolProcessEventFromRaw(message?.raw);
      if (namedToolEvent) return namedToolEvent;
      const [labelLine, ...detailLines] = content.split("\n");
      const label = labelLine?.trim() || "Runtime event";
      const detail = detailLines.join(" ").replace(/\s+/g, " ").trim().slice(0, 180);
      const failed = /\b(error|failed|failure|timed out|http\s+5\d\d)\b/i.test(`${label} ${detail}`);
      return { label, detail: detail || undefined, status: failed ? "failed" : undefined };
    }
    if (/^Runtime event$/i.test(content)) return null;
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

export function yieldChatPaint() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 16));
}

export function nextChatTextDelta(incoming: string, current: string) {
  if (!incoming) return "";
  if (!current) return incoming;
  if (incoming.startsWith(current)) return incoming.slice(current.length);
  if (current.endsWith(incoming)) return "";
  return incoming;
}

export function isChatTransportInterruption(error: unknown) {
  const name = error instanceof Error ? error.name.trim() : "";
  const message = error instanceof Error ? error.message.trim() : String(error ?? "");
  return /^(?:aborterror|networkerror)$/i.test(name)
    || /(?:load failed|failed to fetch|networkerror|network error|request aborted|fetch.*aborted|operation was aborted|cancelled|canceled)/i.test(message);
}

export function compactRepeatedAssistantText(value: string) {
  let text = value.replace(/\r\n/g, "\n");
  // Some runtimes switch from token deltas to a cumulative snapshot mid-stream.
  // When that snapshot starts with the prose already rendered, the transport can
  // leave one long exact prefix twice before the real continuation. Compact only
  // substantial adjacent prefixes so intentional short repetition is preserved.
  for (let pass = 0; pass < 2; pass += 1) {
    const maxPrefixLength = Math.floor(text.length / 2);
    if (maxPrefixLength < 80) break;
    const seed = text.slice(0, Math.min(80, maxPrefixLength));
    let repeatAt = text.indexOf(seed, seed.length);
    let compacted = false;
    while (repeatAt >= seed.length && repeatAt <= maxPrefixLength) {
      const prefix = text.slice(0, repeatAt);
      if (text.startsWith(prefix, repeatAt)) {
        text = `${prefix}${text.slice(repeatAt + prefix.length)}`;
        compacted = true;
        break;
      }
      repeatAt = text.indexOf(seed, repeatAt + 1);
    }
    if (!compacted) break;
  }
  const draftMatches = [...text.matchAll(/(?:^|\n)draft:\s*\n/gi)];
  if (draftMatches.length < 2) return text;
  const firstStart = draftMatches[0].index ?? 0;
  const secondStart = draftMatches[1].index ?? 0;
  const normalized = (content: string) => content.replace(/\s+/g, " ").trim().toLowerCase();
  const firstBody = normalized(text.slice(firstStart, secondStart));
  const secondBody = normalized(text.slice(secondStart));
  if (!firstBody || !secondBody) return text;
  if (firstBody.startsWith(secondBody) || secondBody.startsWith(firstBody)) return text.slice(0, secondStart).trimEnd();
  return text;
}

export function extractGeneratedKanbanTask(rawText: string, fallbackTitle: string) {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const objectText = fenced ?? rawText.match(/\{[\s\S]*\}/)?.[0] ?? rawText;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(objectText);
  } catch {
    const looseTitle = objectText.match(/["']title["']\s*:\s*["']([^"'\n\r]+)/i)?.[1]?.trim();
    return { title: cleanGeneratedKanbanTitle(looseTitle, fallbackTitle), body: rawText.trim(), priority: "normal" };
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
    priority: ["low", "normal", "high", "urgent"].includes(String(parsed.priority)) ? parsed.priority : "normal",
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

export function kanbanBodyWithFullSource(taskBody: string, sourceContent: string) {
  const body = taskBody.trim();
  const source = sourceContent.trim();
  if (!source) return body;
  return [body, "Full source task from chat:", source].filter(Boolean).join("\n\n");
}
