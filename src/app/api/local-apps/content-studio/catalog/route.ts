import { contentStudioBrainCatalog } from "@/lib/services/local-app-content-studio";
import { okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return okJson({ providers: await contentStudioBrainCatalog() });
  } catch (error) {
    return upstreamErrorJson("Content Studio brain catalog failed", error);
  }
}
