import { readMedusa, type MedusaReadAction } from "@/lib/services/integrations/medusa";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuthContext } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as { action?: unknown; limit?: unknown } | null;
  const action = body?.action === "products" || body?.action === "regions" ? body.action : null;
  if (!action) return errorJson("Medusa action must be products or regions.");
  const limit = typeof body?.limit === "number" ? body.limit : 25;
  try {
    return okJson({ action, data: await readMedusa(action as MedusaReadAction, limit) });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Medusa read failed.", 502);
  }
}
