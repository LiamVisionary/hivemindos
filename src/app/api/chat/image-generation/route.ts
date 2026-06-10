import { NextRequest } from "next/server";
import { runChatImageGeneration } from "@/lib/services/chat/image-generation";
import { recordTelemetryBatch } from "@/lib/services/telemetry/local-telemetry";

export const runtime = "nodejs";

type ImageGenerationRequest = {
  prompt?: string;
  appId?: string;
  serviceKind?: string;
  agentId?: string;
  model?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function recordImageGenerationTelemetry(request: NextRequest, type: string, payload: Record<string, unknown> = {}) {
  await recordTelemetryBatch([{
    source: "route",
    type,
    threadId: request.headers.get("x-hivemind-chat-storage-key"),
    runId: request.headers.get("x-hivemind-run-id"),
    payload,
  }]).catch(() => undefined);
}

export async function POST(request: NextRequest) {
  const routeStartedAt = Date.now();
  let body: ImageGenerationRequest;
  try {
    body = await request.json() as ImageGenerationRequest;
  } catch {
    await recordImageGenerationTelemetry(request, "chat.image_generation.invalid", {
      reason: "invalid-json",
      elapsedMs: Date.now() - routeStartedAt,
    });
    return Response.json({ ok: false, error: "Expected JSON body." }, { status: 400 });
  }
  const prompt = clean(body.prompt);
  if (!prompt) {
    await recordImageGenerationTelemetry(request, "chat.image_generation.invalid", {
      reason: "missing-prompt",
      agentId: clean(body.agentId) || null,
      elapsedMs: Date.now() - routeStartedAt,
    });
    return Response.json({ ok: false, error: "Prompt is required." }, { status: 400 });
  }

  await recordImageGenerationTelemetry(request, "chat.image_generation.request.received", {
    agentId: clean(body.agentId) || null,
    appId: clean(body.appId) || null,
    serviceKind: clean(body.serviceKind) || null,
    promptLength: prompt.length,
    elapsedMs: Date.now() - routeStartedAt,
  });

  const result = await runChatImageGeneration({
    origin: request.nextUrl.origin,
    prompt,
    appId: clean(body.appId) || undefined,
    serviceKind: clean(body.serviceKind) || undefined,
    model: clean(body.model) || undefined,
    runId: request.headers.get("x-hivemind-run-id") ?? undefined,
  });

  if (!result.ok) {
    if (result.reason === "no-app") {
      await recordImageGenerationTelemetry(request, "chat.image_generation.app_missing", {
        agentId: clean(body.agentId) || null,
        appCount: result.appCount ?? 0,
        elapsedMs: Date.now() - routeStartedAt,
      });
    } else {
      await recordImageGenerationTelemetry(request, "chat.image_generation.failed", {
        agentId: clean(body.agentId) || null,
        error: result.error,
        elapsedMs: Date.now() - routeStartedAt,
      });
    }
    return Response.json({ ok: false, error: result.error }, { status: result.status });
  }

  await recordImageGenerationTelemetry(request, "chat.image_generation.completed", {
    agentId: clean(body.agentId) || null,
    appId: result.app.id,
    appName: result.app.name,
    machineName: result.app.machineName,
    serviceKind: result.app.serviceKind,
    endpoint: result.endpoint,
    requestedModel: result.requestedModel || null,
    preferenceApplied: result.preferenceApplied,
    imageCount: result.images.length,
    elapsedMs: Date.now() - routeStartedAt,
  });
  return Response.json({
    ok: true,
    prompt: result.prompt,
    app: result.app,
    endpoint: result.endpoint,
    images: result.images,
    rawStatus: result.rawStatus,
  });
}
