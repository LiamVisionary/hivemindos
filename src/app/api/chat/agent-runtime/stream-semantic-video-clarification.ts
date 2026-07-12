import { semanticVideoMethodClarification } from "@/lib/services/chat/semantic-video-intent";
import {
  appendRuntimeChatSessionText,
  finishRuntimeChatSession,
} from "@/lib/services/chat/runtime-session-store";
import { RUNTIME_STREAM_EVENT_TYPES } from "@/lib/services/runtime-stream-events";
import { ssePayload } from "./messages";

export async function streamSemanticVideoClarification(input: {
  requestText: string;
  runtimeSessionId: string;
  runtime: string;
  startedAt: number;
  preflightProcessPayload?: string;
}) {
  const clarification = {
    type: RUNTIME_STREAM_EVENT_TYPES.CLARIFY,
    ...semanticVideoMethodClarification(input.requestText),
  };
  if (input.runtimeSessionId) {
    await appendRuntimeChatSessionText(
      input.runtimeSessionId,
      "assistant",
      clarification.question,
      clarification,
    ).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "completed").catch(() => undefined);
  }
  return new Response(
    (input.preflightProcessPayload ?? "")
    + ssePayload({
      session: {
        id: input.runtimeSessionId,
        runtime: input.runtime,
        source: "hivemindos-chat",
        startedAt: input.startedAt,
      },
    })
    + ssePayload(clarification)
    + "data: [DONE]\n\n",
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    },
  );
}
