import { NextRequest } from "next/server";
import { buildNansenHyperliquidBrief, type NansenHyperliquidBriefInput } from "@/lib/services/nansen";
import { okJson } from "@/lib/utils/api-response";
import { nansenRouteError, readNansenBody, requireNansenRouteAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  const unauthorized = await requireNansenRouteAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await readNansenBody<NansenHyperliquidBriefInput & Record<string, unknown>>(request);
    const brief = await buildNansenHyperliquidBrief(body);
    return okJson({ brief });
  } catch (error) {
    return nansenRouteError("Nansen Hyperliquid brief failed", error);
  }
}
