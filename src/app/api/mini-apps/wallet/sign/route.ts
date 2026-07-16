import { type NextRequest } from "next/server";

import {
  signMiniAppWalletMessage,
  type MiniAppWalletSigningKind,
} from "@/lib/services/wallet/mini-app-wallet-signing";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null) as {
    walletId?: unknown;
    kind?: unknown;
    address?: unknown;
    message?: unknown;
  } | null;
  if (!body || typeof body.walletId !== "string" || typeof body.address !== "string" || typeof body.message !== "string") {
    return errorJson("A wallet id, address, and sign-in message are required.", 400);
  }
  if (body.kind !== "local" && body.kind !== "bankr") return errorJson("That wallet cannot sign mini-app messages.", 400);

  try {
    return okJson(await signMiniAppWalletMessage({
      walletId: body.walletId,
      kind: body.kind as MiniAppWalletSigningKind,
      address: body.address,
      message: body.message,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not sign the mini-app wallet message.";
    if (/invalid|required|match|unsupported|official|missing|no signing key|requires an EVM wallet/i.test(message)) {
      return errorJson(message, 400);
    }
    return upstreamErrorJson("Mini-app wallet signing failed", error);
  }
}
