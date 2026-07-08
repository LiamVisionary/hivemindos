import { NextRequest } from "next/server";
import { buildNansenWalletBrief, type NansenWalletBriefInput } from "@/lib/services/nansen";
import { okJson } from "@/lib/utils/api-response";
import { nansenRouteError, readNansenBody, requireNansenRouteAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  const unauthorized = await requireNansenRouteAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await readNansenBody<NansenWalletBriefInput & Record<string, unknown>>(request);
    const brief = await buildNansenWalletBrief(body);
    return okJson({ brief });
  } catch (error) {
    return nansenRouteError("Nansen wallet brief failed", error);
  }
}
