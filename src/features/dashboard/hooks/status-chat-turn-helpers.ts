// Pure per-run thread-shape helpers for the status chat controller: matching a
// runtime session's rows to the in-flight request, and keeping the visible
// transcript honest at the end of a run. No React, no component state.

type SessionMessageLike = {
  role?: string;
  content?: unknown;
  createdAt?: number;
  timestamp?: number;
};

type RunChatMessageLike = {
  role?: string;
  content: string;
  sourceSessionId?: string;
  processEvents?: unknown[];
  agentPrompt?: unknown;
  capabilityApproval?: unknown;
  applicationGeneration?: unknown;
  billing?: unknown;
};

export function sessionMessageCreatedMs(message: SessionMessageLike | undefined) {
  const raw = Number(message?.createdAt ?? message?.timestamp ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

export function normalizeSessionTurnText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Builds the matchers that decide which rows of a polled runtime session
 * belong to the request that started at `requestStartedAt`. */
export function createSessionTurnMatcher(requestStartedAt: number, requestTexts: Iterable<unknown>) {
  const currentRequestTexts = new Set([...requestTexts].map(normalizeSessionTurnText).filter(Boolean));
  const findCurrentRequestSessionUserIndex = (sessionMessages: SessionMessageLike[]) => {
    let fallbackRecentUserIndex = -1;
    for (let index = 0; index < sessionMessages.length; index += 1) {
      const sessionMessage = sessionMessages[index];
      if (String(sessionMessage?.role ?? "").toLowerCase() !== "user") continue;
      const text = normalizeSessionTurnText(sessionMessage?.content);
      const createdAt = sessionMessageCreatedMs(sessionMessage);
      const isRecent = createdAt >= requestStartedAt - 2_000;
      if (text && currentRequestTexts.has(text) && (!createdAt || isRecent)) fallbackRecentUserIndex = index;
      else if (isRecent) fallbackRecentUserIndex = index;
    }
    return fallbackRecentUserIndex;
  };
  const sessionMessageBelongsToCurrentTurn = (sessionMessage: SessionMessageLike, index: number, currentUserIndex: number) => {
    if (currentUserIndex >= 0) return index > currentUserIndex;
    const createdAt = sessionMessageCreatedMs(sessionMessage);
    return createdAt >= requestStartedAt - 2_000;
  };
  return { findCurrentRequestSessionUserIndex, sessionMessageBelongsToCurrentTurn };
}

/** A run reports at most one issue notification, and never an empty one. */
export function createChatIssueNotifier(notify: (issue: string, runId: string) => void) {
  let reported = false;
  return (issue: string, runId: string) => {
    if (reported || !issue.trim()) return;
    reported = true;
    notify(issue, runId);
  };
}

/** Small state machine for the capability-preflight strip that runs before a
 * turn reaches the runtime: one start, in-place label updates, one finish. */
export function createCapabilityPreflightUi(deps: {
  begin: (runId: string, startedAt: number) => void;
  appendProcess: (label: string, status: "active" | "completed" | "failed", runId: string) => void;
  finish: (runId: string) => void;
  runId: string;
}) {
  let active = false;
  return {
    start(label: string) {
      if (active) return;
      active = true;
      deps.begin(deps.runId, Date.now());
      deps.appendProcess(label, "active", deps.runId);
    },
    update(label: string) {
      if (!active) return;
      deps.appendProcess(label, "active", deps.runId);
    },
    finish(label: string, status: "completed" | "failed") {
      if (!active) return;
      deps.appendProcess(label, status, deps.runId);
      deps.finish(deps.runId);
      active = false;
    },
  };
}

/** If the run ends while its freshly opened segment never received text or
 * steps, drop the invisible placeholder so it cannot linger in the saved
 * transcript or swallow later merges. */
export function pruneTrailingEmptyRunAssistant<T extends RunChatMessageLike>(items: T[], sessionId: string): T[] {
  const last = items[items.length - 1];
  if (
    !last
    || last.role !== "assistant"
    || last.sourceSessionId !== sessionId
    || last.content.trim()
    || last.processEvents?.length
    || last.agentPrompt
    || last.capabilityApproval
    || last.applicationGeneration
    || last.billing
  ) return items;
  return items.slice(0, -1);
}

/** Billing arrives at stream end, when the active slot can be a just-opened
 * empty segment — anchor the chip on the last message the person can see. */
export function visibleBillingAssistantIndex(items: RunChatMessageLike[], startIndex: number) {
  let assistantIndex = startIndex;
  while (
    assistantIndex > 0
    && items[assistantIndex].role === "assistant"
    && !items[assistantIndex].content.trim()
    && !items[assistantIndex].processEvents?.length
    && items[assistantIndex - 1].role === "assistant"
  ) assistantIndex -= 1;
  return assistantIndex;
}
