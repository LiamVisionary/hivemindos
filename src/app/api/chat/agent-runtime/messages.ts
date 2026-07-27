import { normalizeRuntimeStreamEvent, RUNTIME_STREAM_EVENT_TYPES, type RuntimeStreamEvent } from "@/lib/services/runtime-stream-events";
import { artifactByDataUrl, textHandleForArtifact, type ChatMediaArtifact } from "./media-artifacts";

export type IncomingContentPart = {
  type: string;
  text?: string;
  image_url?: { url?: string };
  file?: { filename?: string; file_data?: string };
  cache_control?: { type: string };
};

export type IncomingMessage = {
  role: string;
  content: string | IncomingContentPart[];
};

export function messageText(message?: IncomingMessage) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.map((part) => part.text ?? "").join("\n");
}

export function safeAgentEnv(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof entry === "string") env[key] = entry;
  }
  return Object.keys(env).length ? env : undefined;
}

export function extractUserText(messages: IncomingMessage[]): string {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUserMessage) return "";
  if (typeof lastUserMessage.content === "string") return lastUserMessage.content;
  return lastUserMessage.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join(" ");
}

function messageHasContent(message: IncomingMessage) {
  if (typeof message.content === "string") return Boolean(message.content.trim());
  return message.content.some((part) => {
    if (part.type === "text") return Boolean(part.text?.trim());
    if (part.type === "image_url") return Boolean(part.image_url?.url);
    if (part.type === "file") return Boolean(part.file?.file_data);
    return false;
  });
}

export function latestUserMessage(messages: IncomingMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user" && messageHasContent(message));
}

export function attachmentPromptSummary(message?: IncomingMessage) {
  if (!message || typeof message.content === "string") return "";
  const images = message.content.filter((part) => part.type === "image_url" && part.image_url?.url).length;
  const files = message.content.filter((part) => part.type === "file" && part.file?.file_data).length;
  const pieces = [
    images ? `${images} image${images === 1 ? "" : "s"}` : "",
    files ? `${files} file${files === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return pieces.length ? `Please respond to the attached ${pieces.join(" and ")}.` : "";
}

function dataUrlMetadata(value: string) {
  const match = value.match(/^data:([^;,]+)?(?:;[^,]*)?,([A-Za-z0-9+/=_-]*)$/);
  if (!match) return { mimeType: "", sizeLabel: "" };
  const rawSize = Math.floor((match[2].length * 3) / 4);
  const sizeLabel = rawSize >= 1_000_000
    ? `${(rawSize / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(rawSize / 1_000))} KB`;
  return { mimeType: match[1] || "", sizeLabel };
}

function attachmentHandleLine(part: IncomingContentPart, artifacts: ChatMediaArtifact[], index: number) {
  if (part.type === "image_url") {
    const url = part.image_url?.url ?? "";
    if (!url) return "";
    const artifact = artifactByDataUrl(artifacts, url);
    if (artifact) return textHandleForArtifact(artifact);
    const meta = dataUrlMetadata(url);
    const detail = [meta.mimeType || "image", meta.sizeLabel].filter(Boolean).join(", ");
    return `[media artifact: unmaterialized-image-${index + 1}] kind=image${detail ? ` ${detail}` : ""}`;
  }
  if (part.type === "file") {
    const data = part.file?.file_data ?? "";
    if (!data) return "";
    const artifact = artifactByDataUrl(artifacts, data);
    if (artifact) return textHandleForArtifact(artifact);
    const meta = dataUrlMetadata(data);
    const name = part.file?.filename?.trim() || `file ${index + 1}`;
    const detail = [meta.mimeType, meta.sizeLabel].filter(Boolean).join(", ");
    return `[media artifact: unmaterialized-file-${index + 1}] kind=file name=${name}${detail ? ` ${detail}` : ""}`;
  }
  return "";
}

function stripAttachmentReferenceText(value: string) {
  const lines = value.split(/\r?\n/);
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^Attached file(?: and folder)? references:\s*$/i.test(line.trim())) {
      while (index + 1 < lines.length && /^\s*-\s+/.test(lines[index + 1])) index += 1;
      continue;
    }
    output.push(line);
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function currentVisualArtifactParts(mediaArtifacts: ChatMediaArtifact[]) {
  return mediaArtifacts.flatMap((artifact) => {
    if (artifact.kind === "image" && artifact.dataUrl) {
      return [{ type: "image_url", image_url: { url: artifact.dataUrl } }];
    }
    if (artifact.kind === "video" && artifact.previewDataUrl) {
      return [{ type: "image_url", image_url: { url: artifact.previewDataUrl } }];
    }
    return [];
  });
}

function messageHasImageDataUrl(message: IncomingMessage, dataUrl: string) {
  if (typeof message.content === "string") return false;
  return message.content.some((part) => part.type === "image_url" && part.image_url?.url === dataUrl);
}

function partMatchesArtifactPayload(part: IncomingContentPart, mediaArtifacts: ChatMediaArtifact[]) {
  const dataUrl = part.type === "image_url"
    ? part.image_url?.url?.trim()
    : part.type === "file"
      ? part.file?.file_data?.trim()
      : "";
  return Boolean(dataUrl && artifactByDataUrl(mediaArtifacts, dataUrl));
}

export function messagesWithCurrentMediaArtifacts(messages: IncomingMessage[], mediaArtifacts: ChatMediaArtifact[] = []): IncomingMessage[] {
  const visualParts = currentVisualArtifactParts(mediaArtifacts);
  if (!visualParts.length) return messages;
  const latestUserIndex = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user") return index;
    }
    return -1;
  })();
  if (latestUserIndex < 0) return messages;
  return messages.map((message, index) => {
    if (index !== latestUserIndex) return message;
    if (typeof message.content === "string") {
      return {
        ...message,
        content: [
          { type: "text", text: stripAttachmentReferenceText(message.content) },
          ...visualParts,
        ],
      };
    }
    const content = message.content
      .map((part) => (
        part.type === "text" && part.text
          ? { ...part, text: stripAttachmentReferenceText(part.text) }
          : part
      ))
      .filter((part) => !partMatchesArtifactPayload(part, mediaArtifacts))
      .filter((part) => !(part.type === "text" && !part.text?.trim()));
    const missingImageParts = visualParts.filter((part) => !messageHasImageDataUrl({ ...message, content }, part.image_url.url));
    return { ...message, content: [...content, ...missingImageParts] };
  });
}

export function textOnlyMessagesForTextModel(messages: IncomingMessage[], mediaArtifacts: ChatMediaArtifact[] = []): IncomingMessage[] {
  return messages.map((message) => {
    if (typeof message.content === "string") return message;
    const textParts = message.content
      .filter((part) => part.type === "text" && part.text?.trim())
      .map((part) => part.text?.trim() ?? "");
    let omittedAttachmentIndex = 0;
    const attachmentHandles = message.content.flatMap((part) => {
      const line = attachmentHandleLine(part, mediaArtifacts, omittedAttachmentIndex);
      if (!line) return [];
      omittedAttachmentIndex += 1;
      return [line];
    });
    if (!attachmentHandles.length) return message;
    const content = [
      ...textParts,
      [
        "Attached media artifact handles:",
        ...attachmentHandles,
      ].join("\n"),
    ].filter(Boolean).join("\n\n");
    return { ...message, content };
  });
}

function streamEventForPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string") {
    return normalizeRuntimeStreamEvent({ type: RUNTIME_STREAM_EVENT_TYPES.ERROR, error: record.error });
  }
  if (typeof record.type === "string" && record.type !== RUNTIME_STREAM_EVENT_TYPES.TEXT_DELTA) {
    return normalizeRuntimeStreamEvent(record as RuntimeStreamEvent);
  }
  const chunk = extractChunk(payload);
  if (chunk) {
    return normalizeRuntimeStreamEvent({ type: RUNTIME_STREAM_EVENT_TYPES.TEXT_DELTA, delta: chunk });
  }
  if (record.tool_call && typeof record.tool_call === "object") {
    return normalizeRuntimeStreamEvent({ type: RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, ...(record.tool_call as Record<string, unknown>) });
  }
  if (record.status && typeof record.status === "object") {
    return normalizeRuntimeStreamEvent({ type: "chat.status", ...(record.status as Record<string, unknown>) });
  }
  if (record.clarify && typeof record.clarify === "object") {
    return normalizeRuntimeStreamEvent({ type: RUNTIME_STREAM_EVENT_TYPES.CLARIFY, ...(record.clarify as Record<string, unknown>) });
  }
  if (record.prompt && typeof record.prompt === "object") {
    return normalizeRuntimeStreamEvent({ type: RUNTIME_STREAM_EVENT_TYPES.CLARIFY, ...(record.prompt as Record<string, unknown>) });
  }
  if (record.session && typeof record.session === "object") {
    return normalizeRuntimeStreamEvent({ type: RUNTIME_STREAM_EVENT_TYPES.SESSION, ...(record.session as Record<string, unknown>) });
  }
  return undefined;
}

export function ssePayload(payload: unknown): string {
  const event = streamEventForPayload(payload);
  const enriched = event && payload && typeof payload === "object" && !("event" in payload)
    ? { ...(payload as Record<string, unknown>), event }
    : payload;
  return `data: ${JSON.stringify(enriched)}\n\n`;
}

export function extractChunk(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const value = payload as {
    reasoning?: string;
    delta?: string;
    text?: string;
    content?: string;
    event?: { delta?: string; content?: string };
    message?: { content?: string; reasoning?: string };
    choices?: Array<{ delta?: { content?: string; reasoning?: string }; text?: string; message?: { content?: string; reasoning?: string } }>;
  };
  return (
    value.choices?.[0]?.delta?.content ??
    value.choices?.[0]?.text ??
    value.choices?.[0]?.message?.content ??
    value.event?.delta ??
    value.event?.content ??
    value.delta ??
    value.text ??
    value.content ??
    value.message?.content ??
    ""
  );
}

export function extractReasoningChunk(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const value = payload as {
    reasoning?: string;
    reasoning_content?: string;
    message?: { reasoning?: string; reasoning_content?: string };
    choices?: Array<{
      delta?: { reasoning?: string; reasoning_content?: string };
      message?: { reasoning?: string; reasoning_content?: string };
    }>;
  };
  return (
    value.choices?.[0]?.delta?.reasoning ??
    value.choices?.[0]?.delta?.reasoning_content ??
    value.choices?.[0]?.message?.reasoning ??
    value.choices?.[0]?.message?.reasoning_content ??
    value.reasoning ??
    value.reasoning_content ??
    value.message?.reasoning ??
    value.message?.reasoning_content ??
    ""
  );
}

export function isTerminalOpenAiStreamMetadata(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return false;
  return choices.every((choice) => {
    if (!choice || typeof choice !== "object") return false;
    const entry = choice as {
      delta?: { content?: unknown; reasoning?: unknown; tool_calls?: unknown; function_call?: unknown };
      finish_reason?: unknown;
      message?: { content?: unknown; reasoning?: unknown; tool_calls?: unknown };
      text?: unknown;
    };
    if (typeof entry.finish_reason !== "string" || !entry.finish_reason.trim()) return false;
    const text = [
      entry.delta?.content,
      entry.delta?.reasoning,
      entry.message?.content,
      entry.message?.reasoning,
      entry.text,
    ].map((value) => String(value ?? "")).join("").trim();
    return (
      !text
      && !entry.delta?.tool_calls
      && !entry.delta?.function_call
      && !entry.message?.tool_calls
    );
  });
}

export type ChannelMarkupState = {
  channel: "content" | "thinking";
  pending: string;
};

// Also matches bare <think>/<thinking> spans: MiniMax, DeepSeek-R1, and Qwen
// stream reasoning inline in delta.content wrapped in those tags instead of a
// separate reasoning field (observed 2026-06-11: MiniMax-M2.7 leaked a raw
// <think> block into a BankrAgent02 chat).
const channelControlPattern = /<channel>\s*(thought|thinking|analysis|reasoning|final|message|content|assistant|response)\s*<\/channel>|<\|?channel\|?>\s*(thought|thinking|analysis|reasoning|final|message|content|assistant|response)\s*|<\|?message\|?>|<\/channel>|<(?<thinkOpen>think|thinking)>|<\/(?<thinkClose>think|thinking)>/gi;

export function createChannelMarkupState(): ChannelMarkupState {
  return { channel: "content", pending: "" };
}

export function routeChannelMarkupDelta(
  value: string,
  state: ChannelMarkupState,
): { content: string; thinking: string } {
  let input = `${state.pending}${value}`;
  state.pending = "";

  const pendingStart = input.lastIndexOf("<");
  if (pendingStart >= 0 && !input.slice(pendingStart).includes(">")) {
    state.pending = input.slice(pendingStart);
    input = input.slice(0, pendingStart);
  }

  let cursor = 0;
  let content = "";
  let thinking = "";
  const append = (text: string) => {
    if (!text) return;
    if (state.channel === "thinking") thinking += text;
    else content += text;
  };

  for (const match of input.matchAll(channelControlPattern)) {
    const index = match.index ?? 0;
    append(input.slice(cursor, index));
    if (match.groups?.thinkOpen) {
      state.channel = "thinking";
    } else if (match.groups?.thinkClose) {
      state.channel = "content";
    } else {
      const channel = String(match[1] ?? match[2] ?? "").trim().toLowerCase();
      if (/^(thought|thinking|analysis|reasoning)$/.test(channel)) {
        state.channel = "thinking";
      } else if (/^(final|message|content|assistant|response)$/.test(channel)) {
        state.channel = "content";
      }
    }
    cursor = index + match[0].length;
  }
  append(input.slice(cursor));

  return { content, thinking };
}

// The Queen voice pipeline flattens persona + history + the spoken utterance into
// ONE user message (buildRuntimeVoiceUserText in queen-bee/voice-turn.ts) because
// runtime adapters drop messages[] history. Keep these markers in sync with it.
const QUEEN_VOICE_UTTERANCE_MARKER = "\nUser's latest spoken message:";
const QUEEN_VOICE_UTTERANCE_END = "\nRespond now as Queen Bee";

// The FAB prepends a screen-context briefing ("<capabilities…>\n\nUser request: X")
// to the relayed message, and the Queen voice pipeline flattens its persona prompt
// and history around the spoken utterance. The intent matchers below must key on
// the user's ACTUAL request, NOT that scaffolding — otherwise briefing words like
// "run" or "Polymarket" false-trigger a handler (e.g. the MiroShark x402 matcher
// hijacking a plain "swap 1 usdc to eth"), and persona words like "automation"
// fire the Bankr rail on every spoken turn. This returns a copy of the message
// list whose latest user message is unwrapped to just the request; the agent
// fallthrough keeps the original (scaffolding intact) for context.
export function bareUserRequestText(text: string): string {
  const fabMarker = text.lastIndexOf("\n\nUser request:");
  if (fabMarker >= 0) return text.slice(fabMarker + "\n\nUser request:".length).trim();
  const spokenMarker = text.lastIndexOf(QUEEN_VOICE_UTTERANCE_MARKER);
  if (spokenMarker >= 0) {
    const rest = text.slice(spokenMarker + QUEEN_VOICE_UTTERANCE_MARKER.length);
    const end = rest.indexOf(QUEEN_VOICE_UTTERANCE_END);
    return (end >= 0 ? rest.slice(0, end) : rest).trim();
  }
  return "";
}

export function unwrapLatestUserRequest(messages: IncomingMessage[]): IncomingMessage[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== "user") continue;
    const bare = bareUserRequestText(messageText(messages[i]));
    if (!bare) return messages;
    const copy = messages.slice();
    copy[i] = { ...messages[i], content: bare };
    return copy;
  }
  return messages;
}
