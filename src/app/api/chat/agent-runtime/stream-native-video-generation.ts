import type { ChatMediaArtifact } from "./media-artifacts";
import { ssePayload } from "./messages";
import { runtimeProcessEventsSsePayload, type RuntimeProcessEvent } from "./process-events";
import { dispatchVideoGenerationViaRoute, videoGenerationArtifacts } from "./openai-compatible-tools";
import {
  appendRuntimeChatSessionEvent,
  finishRuntimeChatSession,
  upsertRuntimeChatSessionApplicationGeneration,
  type RuntimeApplicationGeneration,
} from "@/lib/services/chat/runtime-session-store";

type NativeVideoGenerationInput = {
  origin: string;
  prompt: string;
  inputImages: Array<Pick<ChatMediaArtifact, "path" | "dataUrl" | "mimeType" | "name">>;
  runtimeSessionId: string;
  runtime: string;
  startedAt: number;
  runId?: string;
  chatStorageKey?: string;
  agentId?: string;
  signal?: AbortSignal;
  preflightProcessEvents?: RuntimeProcessEvent[];
  sourceArtifacts?: Array<{
    kind: "image";
    url: string;
    label?: string;
    mimeType?: string;
  }>;
};

function generationId(input: NativeVideoGenerationInput) {
  return input.runId?.trim() || input.runtimeSessionId.trim() || `video-gen-${Date.now().toString(36)}`;
}

export function streamNativeVideoGeneration(input: NativeVideoGenerationInput) {
  const encoder = new TextEncoder();
  const id = generationId(input);
  const createdAt = Date.now();
  const runningCard: RuntimeApplicationGeneration = {
    id,
    status: "running",
    kind: "video",
    prompt: input.prompt,
    title: "Video generation",
    sourceArtifacts: input.sourceArtifacts,
    createdAt,
  };
  const readable = new ReadableStream({
    async start(controller) {
      if (input.runtimeSessionId) {
        controller.enqueue(encoder.encode(ssePayload({
          session: { id: input.runtimeSessionId, runtime: input.runtime, source: "hivemindos-chat", startedAt: input.startedAt },
        })));
      }
      const preflightPayload = runtimeProcessEventsSsePayload(input.preflightProcessEvents ?? []);
      if (preflightPayload) controller.enqueue(encoder.encode(preflightPayload));
      controller.enqueue(encoder.encode(ssePayload({ applicationGeneration: runningCard })));
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(ssePayload({})));
        } catch {
          clearInterval(heartbeat);
        }
      }, 5_000);
      try {
        await appendRuntimeChatSessionEvent(
          input.runtimeSessionId,
          "Video generation",
          input.inputImages.length
            ? "Dispatching attached-image video request to a connected video app."
            : "Dispatching text video request to a connected video app.",
        ).catch(() => undefined);
        await upsertRuntimeChatSessionApplicationGeneration(input.runtimeSessionId, runningCard).catch(() => undefined);
        const result = await dispatchVideoGenerationViaRoute(input.origin, input.prompt, input.inputImages, input.signal);
        const artifacts = videoGenerationArtifacts(result.videos);
        const readyCard: RuntimeApplicationGeneration = {
          id,
          status: "ready",
          kind: "video",
          prompt: result.prompt || input.prompt,
          title: "Video generation",
          appId: result.app?.id,
          appName: result.app?.name,
          serviceKind: result.app?.serviceKind,
          machineName: result.app?.machineName,
          sourceArtifacts: input.sourceArtifacts,
          artifacts,
          createdAt,
          completedAt: Date.now(),
        };
        controller.enqueue(encoder.encode(ssePayload({ applicationGeneration: readyCard })));
        await upsertRuntimeChatSessionApplicationGeneration(input.runtimeSessionId, readyCard).catch(() => undefined);
        await appendRuntimeChatSessionEvent(
          input.runtimeSessionId,
          "Video generation completed",
          `${artifacts.length} video${artifacts.length === 1 ? "" : "s"} from ${result.app?.name ?? "connected app"}.`,
        ).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "completed").catch(() => undefined);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Video generation failed.";
        const errorCard: RuntimeApplicationGeneration = {
          ...runningCard,
          status: "error",
          error: message,
          completedAt: Date.now(),
        };
        controller.enqueue(encoder.encode(ssePayload({ applicationGeneration: errorCard })));
        await upsertRuntimeChatSessionApplicationGeneration(input.runtimeSessionId, errorCard).catch(() => undefined);
        await appendRuntimeChatSessionEvent(input.runtimeSessionId, "Video generation failed", message).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
      } finally {
        clearInterval(heartbeat);
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
