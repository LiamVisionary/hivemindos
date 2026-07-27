import { planContentStudioRequest, type ContentStudioBrainRequest } from "@/lib/services/local-app-content-studio";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as ContentStudioBrainRequest | null;
  if (!body) return errorJson("Expected a JSON planning request.");
  try {
    return okJson({ plan: await planContentStudioRequest(body) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Content Studio planning failed.";
    if (/enter what|selected brain|invalid production plan|did not return/i.test(message)) return errorJson(message);
    return upstreamErrorJson("Content Studio planning failed", error);
  }
}
