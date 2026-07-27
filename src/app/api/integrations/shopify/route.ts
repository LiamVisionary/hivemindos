import { readShopify, type ShopifyReadAction } from "@/lib/services/integrations/shopify";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuthContext } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as { action?: unknown; limit?: unknown } | null;
  const action = body?.action === "products" ? "products" : body?.action === "store" ? "store" : null;
  if (!action) return errorJson("Shopify action must be store or products.");
  const limit = typeof body?.limit === "number" ? body.limit : 25;
  try {
    return okJson({ action, data: await readShopify(action as ShopifyReadAction, limit) });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Shopify read failed.", 502);
  }
}
