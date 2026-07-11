import { NextRequest } from "next/server";
import { resolveTradeTokenMetadata } from "@/lib/services/trading/token-metadata";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TokenLookupBody = {
  network?: string;
  address?: string;
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json().catch(() => ({}))) as TokenLookupBody;
    const network = body.network?.trim();
    const address = body.address?.trim();
    if (!network) return errorJson("A network is required.");
    if (!address) return errorJson("A token address is required.");
    return okJson({ token: await resolveTradeTokenMetadata(network, address) });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Token lookup failed.");
  }
}
