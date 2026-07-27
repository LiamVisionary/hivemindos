import { NextRequest } from "next/server";

import {
  normalizeHostedMediaAction,
  normalizeHostedMediaGenerateInput,
  normalizeHostedMediaJobId,
  normalizeHostedMediaQuoteInput,
} from "@/lib/services/hosted-media-generation-domain";
import {
  generateHostedMedia,
  getHostedMediaCatalog,
  getHostedMediaJob,
  quoteHostedMedia,
  type HostedMediaGatewayResult,
} from "@/lib/services/hosted-media-generation";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function GET() {
  return routeResult(await getHostedMediaCatalog());
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  try {
    const action = normalizeHostedMediaAction(body);
    if (action === "quote") return routeResult(await quoteHostedMedia(normalizeHostedMediaQuoteInput(body)));
    if (action === "generate") return routeResult(await generateHostedMedia(normalizeHostedMediaGenerateInput(body)));
    if (!body || typeof body !== "object" || Array.isArray(body)) return errorJson("Hosted media job request must be a JSON object.", 400);
    const record = body as Record<string, unknown>;
    const jobId = normalizeHostedMediaJobId(record.jobId);
    const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
    if (!agentId || agentId.length > 200) return errorJson("A local agent id is required to read a hosted media job.", 400);
    return routeResult(await getHostedMediaJob({ jobId, agentId }));
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Hosted media request is invalid.", 400);
  }
}

function routeResult(result: HostedMediaGatewayResult) {
  const error = result.payload.error;
  const data = { ...result.payload };
  delete data.ok;
  delete data.error;
  if (result.status >= 200 && result.status < 300) return okJson(data, { status: result.status });
  return errorJson(typeof error === "string" ? error : "Hosted media request failed.", result.status, data);
}
