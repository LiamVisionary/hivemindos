export type AgentCallVoiceRun = {
  id?: string;
  status?: string;
  recipeId?: string;
  toolBundleId?: string;
};

async function postVoiceRun(voiceRunId: string | undefined, body: Record<string, unknown>) {
  if (!voiceRunId) return;
  await fetch("/api/phone", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ voiceRunId, ...body }),
    cache: "no-store",
  }).catch(() => undefined);
}

function recordVoiceRunEvent(voiceRunId: string | undefined, event: Record<string, unknown>) {
  return postVoiceRun(voiceRunId, {
    action: "voice-run-event",
    event,
  });
}

export function completeVoiceRun(voiceRunId: string | undefined, status: "ended" | "failed", reason: string) {
  return postVoiceRun(voiceRunId, {
    action: "voice-run-complete",
    status,
    reason,
  });
}

export function recordCallConnected(voiceRunId: string | undefined, text: string, payload?: Record<string, unknown>) {
  return recordVoiceRunEvent(voiceRunId, {
    type: "call.connected",
    speaker: "system",
    text,
    ...(payload ? { payload } : {}),
  });
}

export function recordRuntimeFailure(voiceRunId: string | undefined, text: string, detail: string) {
  return recordVoiceRunEvent(voiceRunId, {
    type: "runtime.turn.failed",
    speaker: "system",
    text,
    detail,
  });
}

export function recordAgentCaption(voiceRunId: string | undefined, text: string, payload?: Record<string, unknown>) {
  return recordVoiceRunEvent(voiceRunId, {
    type: "agent.caption",
    speaker: "agent",
    text,
    ...(payload ? { payload } : {}),
  });
}

export function recordUserTranscript(voiceRunId: string | undefined, text: string, payload?: Record<string, unknown>) {
  return recordVoiceRunEvent(voiceRunId, {
    type: "user.transcript",
    speaker: "user",
    text,
    ...(payload ? { payload } : {}),
  });
}

export function recordToolStarted(voiceRunId: string | undefined, input: {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}) {
  return recordVoiceRunEvent(voiceRunId, {
    type: "tool.call.started",
    speaker: "tool",
    text: input.name,
    payload: input,
  });
}

export function recordToolCompleted(voiceRunId: string | undefined, input: {
  callId: string;
  name: string;
  output: string;
}) {
  return recordVoiceRunEvent(voiceRunId, {
    type: "tool.call.completed",
    speaker: "tool",
    text: input.name,
    detail: input.output,
    payload: { callId: input.callId, name: input.name },
  });
}
