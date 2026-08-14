type RuntimeSessionMessageLike = {
  role?: unknown;
  content?: unknown;
  createdAt?: unknown;
  timestamp?: unknown;
};

export type RuntimeSessionLike = {
  sessionId?: unknown;
  id?: unknown;
  startedAt?: unknown;
  updatedAt?: unknown;
  endedAt?: unknown;
  endReason?: unknown;
  messages?: unknown;
  [key: string]: unknown;
};

function timestampMs(value: unknown) {
  const raw = Number(value ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw < 10_000_000_000 ? Math.round(raw * 1000) : Math.round(raw);
}

function sessionMessages(session: RuntimeSessionLike | null | undefined): RuntimeSessionMessageLike[] {
  if (!Array.isArray(session?.messages)) return [];
  return session.messages.filter((message): message is RuntimeSessionMessageLike => (
    typeof message === "object" && message !== null
  ));
}

export function runtimeSessionHasUserPrompt(
  session: RuntimeSessionLike | null | undefined,
  prompt: string,
) {
  const needle = prompt.replace(/\s+/g, " ").trim().slice(0, 80).toLowerCase();
  if (!needle) return false;
  return sessionMessages(session).some((message) => (
    String(message.role ?? "").toLowerCase() === "user"
    && String(message.content ?? "").replace(/\s+/g, " ").toLowerCase().includes(needle)
  ));
}

export function runtimeSessionOriginalUserPrompt(
  session: RuntimeSessionLike | null | undefined,
) {
  const userMessage = [...sessionMessages(session)].reverse().find((message) => (
    String(message.role ?? "").toLowerCase() === "user" && String(message.content ?? "").trim()
  ));
  const content = String(userMessage?.content ?? "").trim();
  const originalTask = content.match(/^Original task:\s*(.+)$/m)?.[1]?.trim();
  return originalTask || content;
}

/**
 * Hermes CLI sessions can be flushed to state.db after the HivemindOS HTTP
 * wrapper has already timed out. Older Hermes builds did not always set
 * sessions.ended_at on that final flush. A later assistant-final row is still
 * authoritative completion evidence when the matched wrapper is already
 * terminal, so expose a completed session instead of reviving a stale loader.
 */
export function reconcileRuntimeSessionAfterWrapperFailure(
  wrapper: RuntimeSessionLike | null | undefined,
  candidate: RuntimeSessionLike | null | undefined,
): RuntimeSessionLike | null {
  if (!candidate) return null;
  if (timestampMs(candidate.endedAt)) return candidate;
  const wrapperEndedAt = timestampMs(wrapper?.endedAt);
  const wrapperEndReason = String(wrapper?.endReason ?? "").trim();
  if (!wrapperEndedAt) return candidate;
  const contentMessages = sessionMessages(candidate).filter((message) => String(message.content ?? "").trim());
  const finalMessage = contentMessages.at(-1);
  if (String(finalMessage?.role ?? "").toLowerCase() !== "assistant") return wrapper ?? candidate;
  const finalAt = timestampMs(finalMessage?.createdAt ?? finalMessage?.timestamp)
    || timestampMs(candidate.updatedAt);
  if (!/failed|error|timeout|aborted|interrupted/i.test(wrapperEndReason)) {
    return {
      ...candidate,
      endedAt: Math.max(wrapperEndedAt, finalAt),
      endReason: wrapperEndReason || "completed",
    };
  }
  if (finalAt <= wrapperEndedAt) return wrapper ?? candidate;
  return {
    ...candidate,
    endedAt: finalAt,
    endReason: "completed",
    recoveredAfterWrapperFailure: true,
  };
}
