import { discoverLocalTtsCandidates, manageLocalTtsModel, readLocalTtsLaunchCandidates, startLocalTtsService } from "@/lib/services/phone/local-tts";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function GET(request: Request) {
  try {
    const origin = request.url ? new URL(request.url).origin : "";
    const runningCandidates = origin ? await discoverLocalTtsCandidates(origin).catch(() => []) : [];
    const launchCandidates = await readLocalTtsLaunchCandidates(origin, runningCandidates);
    return okJson({ launchCandidates });
  } catch (error) {
    return upstreamErrorJson("Local TTS launch candidate discovery failed", error);
  }
}

export async function POST(request: Request) {
  const body = asRecord(await request.json().catch(() => null));
  if (body?.action === "load-model" || body?.action === "unload-model") {
    const appId = typeof body.appId === "string" ? body.appId.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : undefined;
    const providerId = typeof body.providerId === "string" ? body.providerId.trim() : undefined;
    if (!appId) return errorJson("An appId is required for Local TTS model actions.", 400);
    const result = await manageLocalTtsModel({
      origin: request.url ? new URL(request.url).origin : "",
      appId,
      action: body.action,
      model,
      providerId,
    });
    if (!result.ok) return errorJson(result.message, 502, result.detail ? { detail: result.detail } : undefined);
    return okJson(result);
  }

  if (body?.action !== "start-service") return errorJson("Unsupported Local TTS action.", 400);
  const collectorUrl = typeof body.collectorUrl === "string" ? body.collectorUrl.trim() : "";
  if (!collectorUrl) return errorJson("A collectorUrl is required to start Local TTS.", 400);

  const result = await startLocalTtsService({ collectorUrl });
  if (!result.ok) return errorJson(result.message, 502, result.output ? { output: result.output } : undefined);
  return okJson(result);
}
