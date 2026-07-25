import { type NextRequest } from "next/server";

import { executeMiniAppTestnetFaucet } from "@/lib/services/wallet/mini-app-testnet-faucet";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || body.kind !== "local") return errorJson("Choose a local Base wallet for this faucet payment.", 400);
  const required = ["walletId", "address", "network", "asset", "recipient", "idempotencyKey", "confirmation"] as const;
  if (required.some((field) => typeof body[field] !== "string")) {
    return errorJson("Wallet, route, recipient, idempotency, and confirmation fields are required.", 400);
  }

  try {
    const faucet = await executeMiniAppTestnetFaucet({
      walletId: String(body.walletId),
      address: String(body.address),
      network: String(body.network),
      asset: String(body.asset),
      recipient: String(body.recipient),
      idempotencyKey: String(body.idempotencyKey),
      confirmation: String(body.confirmation),
    });
    return okJson({ faucet });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Mini faucet request failed.";
    if (/invalid|confirm|choose|selected|local|base wallet|not currently available|valid .* recipient/i.test(message)) {
      return errorJson(message, 400);
    }
    return upstreamErrorJson("The Mini faucet request failed", error);
  }
}
