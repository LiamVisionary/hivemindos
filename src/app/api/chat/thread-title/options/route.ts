import { discoverChatThreadTitleCloudRoutes } from "@/lib/services/chat/thread-title-model-options";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as { agents?: unknown } | null;
  if (!Array.isArray(body?.agents)) return errorJson("Agent model hints are required.");
  const hints = body.agents.slice(0, 300).map((agent) => {
    const record = agent && typeof agent === "object" ? agent as { provider?: unknown; model?: unknown } : {};
    return {
      provider: String(record.provider ?? "").slice(0, 120),
      model: String(record.model ?? "").slice(0, 240),
    };
  });
  try {
    const routes = await discoverChatThreadTitleCloudRoutes(hints);
    return okJson({ routes });
  } catch (error) {
    return upstreamErrorJson("Could not scan configured caption models", error);
  }
}
