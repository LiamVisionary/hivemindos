import "server-only";

import { openAICompatibleInferenceCacheHints } from "@/lib/services/chat/inference-cache-hints";

import { messageText } from "./prompts";
import type {
  FusionCompletionOptions,
  FusionCompletionResult,
  FusionMessage,
  FusionStreamOptions,
  ResolvedFusionMember,
} from "./types";

const DEFAULT_TIMEOUT_MS = 90_000;
// Streamed synthesis can legitimately run for minutes; bound it by INACTIVITY
// (no token for this long), not a fixed total deadline, so long answers finish.
const STREAM_IDLE_TIMEOUT_MS = 5 * 60_000;

/** Pull text/reasoning out of an OpenAI-compatible chunk or full response. */
function extractChunk(payload: unknown): { content: string; reasoning: string; finishReason?: string } {
  if (!payload || typeof payload !== "object") return { content: "", reasoning: "" };
  const value = payload as {
    delta?: string;
    text?: string;
    content?: string;
    reasoning?: string;
    message?: { content?: string; reasoning?: string };
    choices?: Array<{
      delta?: { content?: string; reasoning?: string; reasoning_content?: string };
      text?: string;
      message?: { content?: string; reasoning?: string };
      finish_reason?: string;
    }>;
  };
  const choice = value.choices?.[0];
  const content =
    choice?.delta?.content ??
    choice?.text ??
    choice?.message?.content ??
    value.delta ??
    value.text ??
    value.content ??
    value.message?.content ??
    "";
  const reasoning =
    choice?.delta?.reasoning ??
    choice?.delta?.reasoning_content ??
    choice?.message?.reasoning ??
    value.reasoning ??
    value.message?.reasoning ??
    "";
  return { content: content || "", reasoning: reasoning || "", finishReason: choice?.finish_reason ?? undefined };
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") return anyFn([signal, timeout]);
  // Fallback combiner for runtimes without AbortSignal.any: forward whichever
  // of the caller signal or the timeout fires first.
  const controller = new AbortController();
  const forward = (source: AbortSignal) => {
    if (source.aborted) controller.abort(source.reason);
    else source.addEventListener("abort", () => controller.abort(source.reason), { once: true });
  };
  forward(signal);
  forward(timeout);
  return controller.signal;
}

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: string; message?: string; cause?: { code?: string } };
  const code = err.cause?.code ?? "";
  return (
    err.name === "TimeoutError" ||
    /ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|fetch failed/i.test(`${err.message ?? ""} ${code}`)
  );
}

/** Strip rich content the panel models do not need (images/files → text markers). */
function normalizeMessages(messages: FusionMessage[]): Array<{ role: string; content: string }> {
  return messages
    .map((message) => ({ role: message.role, content: messageText(message.content) }))
    .filter((message) => message.content.trim() || message.role === "system");
}

function buildBody(
  member: ResolvedFusionMember,
  messages: FusionMessage[],
  stream: boolean,
  options?: FusionCompletionOptions,
): string {
  const cacheHints = openAICompatibleInferenceCacheHints({
    provider: member.provider,
    model: member.model,
    cacheScope: `fusion:${member.id}`,
  });
  return JSON.stringify({
    model: member.model,
    messages: normalizeMessages(messages),
    stream,
    ...cacheHints.body,
    ...(typeof options?.temperature === "number" ? { temperature: options.temperature } : {}),
    ...(typeof options?.maxTokens === "number" ? { max_tokens: options.maxTokens } : {}),
    ...(options?.extraBody ?? {}),
  });
}

function buildHeaders(member: ResolvedFusionMember): Record<string, string> {
  const cacheHints = openAICompatibleInferenceCacheHints({
    provider: member.provider,
    model: member.model,
    cacheScope: `fusion:${member.id}`,
  });
  return {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...(member.apiKey && member.apiKey !== "local" ? { Authorization: `Bearer ${member.apiKey}` } : {}),
    ...cacheHints.headers,
    ...(member.headers ?? {}),
  };
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string };
    const message = typeof json.error === "string" ? json.error : json.error?.message;
    if (message) return message;
  } catch {
    /* not json */
  }
  return text.slice(0, 300) || `HTTP ${response.status}`;
}

/** Non-streaming completion for panel members and the judge. */
export async function callFusionCompletion(
  member: ResolvedFusionMember,
  messages: FusionMessage[],
  options?: FusionCompletionOptions,
): Promise<FusionCompletionResult> {
  const url = `${member.baseUrl}/chat/completions`;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: buildHeaders(member),
        body: buildBody(member, messages, false, options),
        cache: "no-store",
        signal: combineSignals(options?.signal, timeoutMs),
      });
      if (!response.ok) {
        const message = await errorText(response);
        if (response.status >= 500 && attempt === 0) {
          lastError = new Error(message);
          continue;
        }
        throw new Error(message);
      }
      const data = (await response.json()) as unknown;
      const { content, reasoning, finishReason } = extractChunk(data);
      return { text: content, reasoning: reasoning || undefined, finishReason };
    } catch (error) {
      lastError = error;
      if (attempt === 0 && isRetryable(error)) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        continue;
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Fusion completion failed.");
}

/** Streaming completion for the synthesizer (and hosted OpenRouter Fusion). */
export async function streamFusionCompletion(
  member: ResolvedFusionMember,
  messages: FusionMessage[],
  options: FusionStreamOptions,
): Promise<FusionCompletionResult> {
  const url = `${member.baseUrl}/chat/completions`;
  const idleMs = options.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;
  // Drive an idle (inactivity) deadline that resets on every received chunk, so
  // a long-but-active synthesis is never aborted mid-stream by a fixed timer.
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => controller.abort(new Error(`Fusion stream idle for ${Math.round(idleMs / 1000)}s`)),
      idleMs,
    );
  };
  const external = options.signal;
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener("abort", () => controller.abort(external.reason), { once: true });
  }
  resetIdle();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(member),
      body: buildBody(member, messages, true, options),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(await errorText(response));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let reasoning = "";
    let finishReason: string | undefined;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resetIdle();
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const eventText of events) {
        const line = eventText.split("\n").find((entry) => entry.startsWith("data:"));
        if (!line) continue;
        const raw = line.replace(/^data:\s*/, "");
        if (raw === "[DONE]") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }
        const chunk = extractChunk(parsed);
        if (chunk.finishReason) finishReason = chunk.finishReason;
        if (chunk.reasoning) {
          reasoning += chunk.reasoning;
          options.onReasoning?.(chunk.reasoning);
        }
        if (chunk.content) {
          text += chunk.content;
          options.onDelta(chunk.content);
        }
      }
    }
    return { text, reasoning: reasoning || undefined, finishReason };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}
