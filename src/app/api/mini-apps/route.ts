import type { NextRequest } from "next/server";

import { fetchMiniAppCatalog, miniAppCatalogSourceUrl } from "@/lib/services/mini-app-catalog";
import { okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const sourceUrl = miniAppCatalogSourceUrl();
    const catalog = await fetchMiniAppCatalog({ sourceUrl, signal: AbortSignal.timeout(10_000) });
    return okJson({ catalog, sourceUrl });
  } catch (error) {
    return upstreamErrorJson("Could not load the HivemindOS Mini Apps catalog", error);
  }
}
