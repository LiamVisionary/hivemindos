import { NextRequest } from "next/server";
import { runChatVideoGeneration, type VideoGenerationInputImage } from "@/lib/services/chat/video-generation";
import { recordTelemetryBatch } from "@/lib/services/telemetry/local-telemetry";

export const runtime = "nodejs";

type VideoGenerationRequest = {
  prompt?: string;
  inputImages?: VideoGenerationInputImage[];
  appId?: string;
  serviceKind?: string;
  agentId?: string;
  model?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeInputImages(value: unknown): VideoGenerationInputImage[] {
  if (!Array.isArray(value)) return [];
  const images: VideoGenerationInputImage[] = [];
  for (const entry of value.slice(0, 4)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const image = entry as VideoGenerationInputImage;
    const path = clean(image.path);
    const dataUrl = clean(image.dataUrl);
    if (!path && !dataUrl) continue;
    images.push({
      path: path || undefined,
      dataUrl: dataUrl || undefined,
      mimeType: clean(image.mimeType) || undefined,
      name: clean(image.name) || undefined,
    });
  }
  return images;
}

async function recordVideoGenerationTelemetry(request: NextRequest, type: string, payload: Record<string, unknown> = {}) {
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
  let body: VideoGenerationRequest;
  try {
    body = await request.json() as VideoGenerationRequest;
  } catch {
    await recordVideoGenerationTelemetry(request, "chat.video_generation.invalid", {
      reason: "invalid-json",
      elapsedMs: Date.now() - routeStartedAt,
    });
    return Response.json({ ok: false, error: "Expected JSON body." }, { status: 400 });
  }
  const prompt = clean(body.prompt);
  if (!prompt) {
    await recordVideoGenerationTelemetry(request, "chat.video_generation.invalid", {
      reason: "missing-prompt",
      agentId: clean(body.agentId) || null,
      elapsedMs: Date.now() - routeStartedAt,
    });
    return Response.json({ ok: false, error: "Prompt is required." }, { status: 400 });
  }
  const inputImages = normalizeInputImages(body.inputImages);
  await recordVideoGenerationTelemetry(request, "chat.video_generation.request.received", {
    agentId: clean(body.agentId) || null,
    appId: clean(body.appId) || null,
    serviceKind: clean(body.serviceKind) || null,
    promptLength: prompt.length,
    inputImageCount: inputImages.length,
    elapsedMs: Date.now() - routeStartedAt,
  });

  const result = await runChatVideoGeneration({
    origin: request.nextUrl.origin,
    prompt,
    inputImages,
    appId: clean(body.appId) || undefined,
    serviceKind: clean(body.serviceKind) || undefined,
    model: clean(body.model) || undefined,
    runId: request.headers.get("x-hivemind-run-id") ?? undefined,
  });

  if (!result.ok) {
    await recordVideoGenerationTelemetry(request, result.reason === "no-app" ? "chat.video_generation.app_missing" : "chat.video_generation.failed", {
      agentId: clean(body.agentId) || null,
      appId: result.appId ?? null,
      appName: result.appName ?? null,
      machineName: result.machineName ?? null,
      serviceKind: result.serviceKind ?? null,
      appCount: result.appCount ?? 0,
      error: result.error,
      elapsedMs: Date.now() - routeStartedAt,
    });
    return Response.json({ ok: false, error: result.error }, { status: result.status });
  }

  await recordVideoGenerationTelemetry(request, "chat.video_generation.completed", {
    agentId: clean(body.agentId) || null,
    appId: result.app.id,
    appName: result.app.name,
    machineName: result.app.machineName,
    serviceKind: result.app.serviceKind,
    endpoint: result.endpoint,
    requestedModel: result.requestedModel || null,
    preferenceApplied: result.preferenceApplied,
    videoCount: result.videos.length,
    elapsedMs: Date.now() - routeStartedAt,
  });
  return Response.json({
    ok: true,
    prompt: result.prompt,
    app: result.app,
    endpoint: result.endpoint,
    videos: result.videos,
    rawStatus: result.rawStatus,
  });
}
