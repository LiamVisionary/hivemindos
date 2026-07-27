import { hyperframesPromptBuilderClarification } from "@/lib/services/chat/hyperframes-prompt";
import {
  appendRuntimeChatSessionText,
  finishRuntimeChatSession,
} from "@/lib/services/chat/runtime-session-store";
import { RUNTIME_STREAM_EVENT_TYPES } from "@/lib/services/runtime-stream-events";
import { ssePayload } from "./messages";

export async function streamHyperframesPromptBuilder(input: {
  requestText: string;
  runtimeSessionId: string;
  runtime: string;
  startedAt: number;
  preflightProcessPayload?: string;
}) {
  const promptBuilder = {
    type: RUNTIME_STREAM_EVENT_TYPES.CLARIFY,
    ...hyperframesPromptBuilderClarification(input.requestText),
  };
  if (input.runtimeSessionId) {
    await appendRuntimeChatSessionText(
      input.runtimeSessionId,
      "assistant",
      promptBuilder.question,
      promptBuilder,
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
    + ssePayload(promptBuilder)
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
