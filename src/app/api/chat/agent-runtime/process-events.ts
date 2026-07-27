import { ssePayload } from "./messages";

export type RuntimeProcessEvent = {
  at?: number;
  label: string;
  detail?: string;
  status?: "running" | "completed" | "failed";
};

export function runtimeProcessEvent(input: {
  label: string;
  detail?: string;
  status?: RuntimeProcessEvent["status"];
  at?: number;
}): RuntimeProcessEvent {
  return {
    at: input.at ?? Date.now(),
    label: input.label,
    detail: input.detail,
    status: input.status ?? "completed",
  };
}

export async function appendRuntimeProcessEvents(runtimeSessionId: string, events: RuntimeProcessEvent[]) {
  if (!runtimeSessionId || !events.length) return;
  const { appendRuntimeChatSessionEvent } = await import("@/lib/services/chat/runtime-session-store");
  await Promise.all(events.map((event) => appendRuntimeChatSessionEvent(
    runtimeSessionId,
    event.label,
    event.detail,
    event,
  ).catch(() => undefined)));
}

export function runtimeProcessEventsSsePayload(events: RuntimeProcessEvent[]) {
  return events
    .filter((event) => event?.label?.trim())
    .map((event) => ssePayload({
      status: {
        label: event.label,
        detail: event.detail,
        status: event.status,
      },
    }))
    .join("");
}
