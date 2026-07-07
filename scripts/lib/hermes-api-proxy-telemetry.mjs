import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, appendFile, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const localTelemetryEventsPath = join(
  homedir(),
  ".hivemindos",
  "telemetry",
  "events.jsonl",
);

export function safeTelemetryText(value, limit = 160) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function collectorTelemetryEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.HIVEMINDOS_TELEMETRY === "true"
  );
}

export async function recordCollectorTelemetry(type, payload = {}, options = {}) {
  if (!collectorTelemetryEnabled()) return;
  try {
    const now = Date.now();
    await mkdir(dirname(localTelemetryEventsPath), {
      recursive: true,
      mode: 0o700,
    });
    await appendFile(
      localTelemetryEventsPath,
      `${JSON.stringify({
        id: `${now.toString(36)}-collector-${randomBytes(3).toString("hex")}`,
        ts: now,
        source: "runtime",
        type,
        threadId: safeTelemetryText(options.threadId || "", 160) || null,
        runId: safeTelemetryText(options.runId || "", 160) || null,
        payload,
      })}\n`,
      "utf8",
    );
  } catch {
    // Collector telemetry is diagnostic only; never break the chat bridge.
  }
}

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function safeTelemetryNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function summarizeTokenUsage(value) {
  const record = objectRecord(value);
  if (!record) return null;
  const promptTokens = safeTelemetryNumber(
    record.prompt_tokens ?? record.promptTokens ?? record.input_tokens,
  );
  const completionTokens = safeTelemetryNumber(
    record.completion_tokens ?? record.completionTokens ?? record.output_tokens,
  );
  const totalTokens = safeTelemetryNumber(
    record.total_tokens ?? record.totalTokens,
  );
  if (promptTokens === null && completionTokens === null && totalTokens === null)
    return null;
  return { promptTokens, completionTokens, totalTokens };
}

function summarizeHermesToolCall(value) {
  const record = objectRecord(value);
  if (!record) return null;
  const functionRecord = objectRecord(record.function);
  const name = safeTelemetryText(
    record.name ||
      record.tool_name ||
      record.toolName ||
      functionRecord?.name ||
      "",
    120,
  );
  const type = safeTelemetryText(record.type || record.kind || "", 80);
  if (!name && !type && !functionRecord) return null;
  return {
    name: name || null,
    type: type || null,
  };
}

function appendHermesToolCallSummaries(target, value) {
  if (Array.isArray(value)) {
    for (const item of value) appendHermesToolCallSummaries(target, item);
    return;
  }
  const summary = summarizeHermesToolCall(value);
  if (summary) target.push(summary);
}

function collectHermesToolCallsFromPayload(value) {
  const record = objectRecord(value);
  if (!record) return [];
  const calls = [];
  appendHermesToolCallSummaries(calls, record.tool_call);
  appendHermesToolCallSummaries(calls, record.toolCall);
  appendHermesToolCallSummaries(calls, record.tool_calls);
  appendHermesToolCallSummaries(calls, record.toolCalls);

  const event = objectRecord(record.event);
  if (event) {
    appendHermesToolCallSummaries(calls, event.tool_call);
    appendHermesToolCallSummaries(calls, event.tool_calls);
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  for (const choice of choices) {
    const delta = objectRecord(choice?.delta);
    const message = objectRecord(choice?.message);
    appendHermesToolCallSummaries(calls, delta?.tool_calls);
    appendHermesToolCallSummaries(calls, delta?.tool_call);
    appendHermesToolCallSummaries(calls, message?.tool_calls);
    appendHermesToolCallSummaries(calls, message?.tool_call);
  }
  return calls;
}

export function summarizeHermesProcessPayload(value) {
  const record = objectRecord(value);
  if (!record) return null;
  const event = objectRecord(record.event);
  const status = objectRecord(record.status);
  const toolCalls = collectHermesToolCallsFromPayload(record);
  const toolNames = [
    ...new Set(toolCalls.map((call) => call.name).filter(Boolean)),
  ].slice(0, 20);
  const keys = Object.keys(record)
    .filter(
      (key) =>
        ![
          "content",
          "messages",
          "prompt",
          "response",
          "text",
          "output",
          "result",
        ].includes(key),
    )
    .slice(0, 16);
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const hasReasoning = Boolean(
    record.reasoning ||
      record.thinking ||
      choices.some((choice) => {
        const delta = objectRecord(choice?.delta);
        return Boolean(delta?.reasoning || delta?.thinking);
      }),
  );
  const summary = {
    keys,
    eventType: safeTelemetryText(event?.type ?? record.type ?? "", 120) || null,
    statusType:
      safeTelemetryText(
        status?.type ?? status?.state ?? status?.phase ?? "",
        120,
      ) || null,
    hasReasoning,
    toolCallCount: toolCalls.length,
    toolNames,
    usage: summarizeTokenUsage(record.usage),
  };
  if (
    !summary.eventType &&
    !summary.statusType &&
    !summary.hasReasoning &&
    !summary.toolCallCount &&
    !summary.usage &&
    keys.length === 0
  )
    return null;
  return summary;
}

async function execJson(cmd, args, fallback) {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout: 5000,
      maxBuffer: 1_200_000,
    });
    if (!stdout.trim()) return fallback;
    return JSON.parse(stdout);
  } catch {
    return fallback;
  }
}

function normalizeHermesSessionId(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  return value.replace(/^session_/, "").replace(/\.json$/, "");
}

function timelineOffset(timestampSeconds, requestStartedAt) {
  const timestampMs = Number(timestampSeconds || 0) * 1000;
  if (!timestampMs || !requestStartedAt) return null;
  return Math.round(timestampMs - requestStartedAt);
}

export async function summarizeHermesDbSessionTimeline(
  hermesHome,
  sessionId,
  requestStartedAt,
) {
  const normalized = normalizeHermesSessionId(sessionId);
  if (!normalized) return null;
  const dbPath = join(hermesHome, "state.db");
  try {
    await access(dbPath, constants.R_OK);
  } catch {
    return null;
  }
  const escaped = normalized.replaceAll("'", "''");
  const sessions = await execJson(
    "sqlite3",
    [
      "-json",
      dbPath,
      `
    select id, source, started_at, ended_at, end_reason, message_count, tool_call_count
    from sessions
    where id = '${escaped}'
    limit 1;
  `,
    ],
    [],
  );
  const session = sessions[0];
  if (!session) return null;
  const rows = await execJson(
    "sqlite3",
    [
      "-json",
      dbPath,
      `
    select role, length(coalesce(content, '')) as content_length, tool_name, timestamp
    from messages
    where session_id = '${escaped}'
    order by timestamp asc
    limit 200;
  `,
    ],
    [],
  );
  const messages = rows.map((row, index) => ({
    index,
    role: safeTelemetryText(row.role || "assistant", 40) || "assistant",
    toolName: safeTelemetryText(row.tool_name || "", 120) || null,
    contentLength: safeTelemetryNumber(row.content_length) ?? 0,
    offsetMs: timelineOffset(row.timestamp, requestStartedAt),
  }));
  const toolMessages = messages.filter(
    (message) => message.role === "tool" || message.toolName,
  );
  const assistantMessages = messages.filter(
    (message) => message.role === "assistant" && message.contentLength > 0,
  );
  const toolNames = [
    ...new Set(toolMessages.map((message) => message.toolName).filter(Boolean)),
  ].slice(0, 30);
  const sessionStartedOffsetMs = timelineOffset(
    session.started_at,
    requestStartedAt,
  );
  const sessionEndedOffsetMs = timelineOffset(session.ended_at, requestStartedAt);
  return {
    hermesSessionId: normalized,
    source: safeTelemetryText(session.source || "state.db", 80),
    endReason: safeTelemetryText(session.end_reason || "", 80) || null,
    sessionStartedOffsetMs,
    sessionEndedOffsetMs,
    sessionDurationMs:
      sessionStartedOffsetMs !== null && sessionEndedOffsetMs !== null
        ? sessionEndedOffsetMs - sessionStartedOffsetMs
        : null,
    messageCount: safeTelemetryNumber(session.message_count) ?? messages.length,
    observedMessageCount: messages.length,
    toolCallCount: safeTelemetryNumber(session.tool_call_count),
    observedToolMessageCount: toolMessages.length,
    toolNames,
    firstToolOffsetMs: toolMessages[0]?.offsetMs ?? null,
    finalToolOffsetMs: toolMessages.at(-1)?.offsetMs ?? null,
    firstAssistantOffsetMs: assistantMessages[0]?.offsetMs ?? null,
    finalAssistantOffsetMs: assistantMessages.at(-1)?.offsetMs ?? null,
    messages: messages.slice(-30),
  };
}
