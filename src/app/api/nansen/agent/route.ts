import { NextRequest } from "next/server";
import { runNansenAgentResearch, type NansenAgentResearchInput } from "@/lib/services/nansen";
import { okJson } from "@/lib/utils/api-response";
import { nansenRouteError, readNansenBody, requireNansenRouteAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const unauthorized = await requireNansenRouteAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await readNansenBody<NansenAgentResearchInput & Record<string, unknown>>(request);
    const result = await runNansenAgentResearch(body);
    return okJson({ result });
  } catch (error) {
    return nansenRouteError("Nansen Agent research failed", error);
  }
}
