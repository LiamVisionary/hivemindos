import "server-only";

import {
  appendRuntimeChatSessionEvent,
  appendRuntimeChatSessionText,
  finishRuntimeChatSession,
  readRuntimeChatSession,
  type RuntimeChatSessionRecord,
} from "@/lib/services/chat/runtime-session-store";
import {
  completeMobileAgentJob,
  getMobileAgentJob,
  pollMobileAgentHost,
  touchMobileAgentJob,
} from "@/lib/services/mobile-agents/store";
import type { MobileAgentHostModel } from "@/lib/types/mobile-agents";

// SHARED CONTRACT — the HivemindOS Mobile app posts exactly these actions to
// /api/phone: "agent-host-poll", "agent-host-event", "agent-host-complete".
// Do not rename actions or fields.

export type MobileAgentHostActionResult = {
  status: number;
  payload: Record<string, unknown>;
};

type PhoneAgentEvent =
  | { type: "text_delta"; text?: string }
  | { type: "thinking_delta"; text?: string }
  | {
      type: "tool_start";
      id?: string;
      tool?: string;
      label?: string;
      detail?: string;
    }
  | { type: "tool_end"; id?: string; error?: string };

function normalizedModels(value: unknown): MobileAgentHostModel[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): MobileAgentHostModel | null => {
      const record = entry as { id?: unknown; sizeBytes?: unknown };
      const id = typeof record?.id === "string" ? record.id.trim() : "";
      const sizeBytes = Number(record?.sizeBytes);
      if (!id) return null;
      return {
        id,
        sizeBytes:
          Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : undefined,
      };
    })
    .filter((model): model is MobileAgentHostModel => Boolean(model));
}

export async function handleMobileAgentHostPoll(
  body: Record<string, unknown>,
): Promise<MobileAgentHostActionResult> {
  const machineName = String(body.machineName ?? "").trim();
  if (!machineName) {
    return {
      status: 400,
      payload: { ok: false, error: "machineName is required." },
    };
  }
  const names = Array.isArray(body.names)
    ? body.names.filter((name): name is string => typeof name === "string")
    : [];
  const result = await pollMobileAgentHost({
    machineName,
    names,
    models: normalizedModels(body.models),
    claim: body.claim !== false,
  });
  return { status: 200, payload: { ok: true, ...result } };
}

export async function handleMobileAgentHostEvent(
  body: Record<string, unknown>,
): Promise<MobileAgentHostActionResult> {
  const jobId = String(body.jobId ?? "").trim();
  const job = jobId ? await getMobileAgentJob(jobId) : null;
  if (!job) {
    return {
      status: 404,
      payload: {
        ok: false,
        error: `Unknown mobile agent job: ${jobId || "(missing jobId)"}`,
      },
    };
  }
  const events = Array.isArray(body.events)
    ? (body.events.filter(
        (event) => event && typeof event === "object",
      ) as PhoneAgentEvent[])
    : [];
  for (const event of events) {
    if (event.type === "text_delta" && event.text) {
      await appendRuntimeChatSessionText(
        job.sessionId,
        "assistant",
        event.text,
      ).catch(() => undefined);
      continue;
    }
    if (event.type === "tool_start") {
      const tool = event.tool?.trim() || event.id?.trim() || "tool";
      await appendRuntimeChatSessionEvent(
        job.sessionId,
        `tool: ${tool}`,
        [event.label?.trim(), event.detail?.trim()]
          .filter(Boolean)
          .join(" — ") || undefined,
        event,
      ).catch(() => undefined);
      continue;
    }
    if (event.type === "tool_end" && event.error) {
      await appendRuntimeChatSessionEvent(
        job.sessionId,
        `tool failed: ${event.id?.trim() || "tool"}`,
        event.error,
        event,
      ).catch(() => undefined);
    }
    // thinking_delta and successful tool_end events carry no durable content.
  }
  await touchMobileAgentJob(jobId);
  return { status: 200, payload: { ok: true } };
}

/** The current turn's assistant text: assistant messages after the last user message. */
function currentTurnAssistantText(session: RuntimeChatSessionRecord | null) {
  if (!session) return "";
  const lastUserIndex = session.messages.reduce(
    (latest, message, index) => (message.role === "user" ? index : latest),
    -1,
  );
  return session.messages
    .slice(lastUserIndex + 1)
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .join("")
    .trim();
}

export async function handleMobileAgentHostComplete(
  body: Record<string, unknown>,
): Promise<MobileAgentHostActionResult> {
  const jobId = String(body.jobId ?? "").trim();
  const job = jobId ? await getMobileAgentJob(jobId) : null;
  if (!job) {
    return {
      status: 404,
      payload: {
        ok: false,
        error: `Unknown mobile agent job: ${jobId || "(missing jobId)"}`,
      },
    };
  }
  const ok = body.ok === true;
  const resultText =
    typeof body.resultText === "string" ? body.resultText.trim() : "";
  const errorReason =
    typeof body.errorReason === "string" ? body.errorReason.trim() : "";
  if (resultText) {
    // If no deltas arrived (e.g. the phone only buffered the final answer),
    // land the result as the turn's assistant text before finishing.
    const session = await readRuntimeChatSession({
      sessionId: job.sessionId,
    }).catch(() => null);
    if (!currentTurnAssistantText(session)) {
      await appendRuntimeChatSessionText(
        job.sessionId,
        "assistant",
        resultText,
      ).catch(() => undefined);
    }
  }
  await completeMobileAgentJob(jobId, { ok, resultText, errorReason });
  await finishRuntimeChatSession(
    job.sessionId,
    ok ? "completed" : "error",
  ).catch(() => undefined);
  return { status: 200, payload: { ok: true } };
}
