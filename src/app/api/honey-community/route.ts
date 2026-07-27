// guard:allow-hive-action-route - dashboard-only Wallets → Honey identity linking (status read, tap-to-link intent mint, code redemption); binds the operator's own Telegram, moves no funds, not an agent capability.
import { type NextRequest } from "next/server";

import { createTelegramHoneyLinkIntent, linkTelegramHoney, readHoneyContributionStatus } from "@/lib/services/wallet/honey-community";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return okJson(await readHoneyContributionStatus());
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
    if (status >= 400 && status < 500) return errorJson(error instanceof Error ? error.message : "HONEY contribution status failed.", status);
    return upstreamErrorJson("HONEY contribution status failed", error);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { action?: unknown; code?: unknown } | null;
  if (body?.action === "link-telegram-intent") {
    try {
      return okJson(await createTelegramHoneyLinkIntent());
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
      if (status >= 400 && status < 500) return errorJson(error instanceof Error ? error.message : "Telegram link request failed.", status);
      return upstreamErrorJson("Telegram link request failed", error);
    }
  }
  if (body?.action !== "link-telegram") return errorJson("Unsupported HONEY community action.", 400);
  if (typeof body.code !== "string") return errorJson("A Telegram HONEY link code is required.", 400);
  try {
    return okJson(await linkTelegramHoney(body.code));
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
    if (status >= 400 && status < 500) return errorJson(error instanceof Error ? error.message : "Telegram HONEY link failed.", status);
    return upstreamErrorJson("Telegram HONEY link failed", error);
  }
}
