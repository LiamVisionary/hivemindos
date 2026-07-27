import {
  appendRuntimeChatSessionEvent,
  finishRuntimeChatSession,
} from "@/lib/services/chat/runtime-session-store";

export async function runtimeSessionErrorResponse(
  runtimeSessionId: string,
  message: string,
  status: number,
  endReason: "failed" | "blocked" = "failed",
) {
  const label = endReason === "blocked" ? "Runtime blocked" : "Runtime failed";
  await appendRuntimeChatSessionEvent(runtimeSessionId, label, message).catch(() => undefined);
  await finishRuntimeChatSession(runtimeSessionId, endReason).catch(() => undefined);
  return Response.json({ error: message }, { status });
}
