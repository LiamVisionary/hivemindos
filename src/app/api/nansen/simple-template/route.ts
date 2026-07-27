import { NextRequest } from "next/server";
import { buildNansenSimpleTemplateBrief, type NansenSimpleTemplateInput } from "@/lib/services/nansen";
import { okJson } from "@/lib/utils/api-response";
import { nansenRouteError, readNansenBody, requireNansenRouteAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const unauthorized = await requireNansenRouteAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await readNansenBody<NansenSimpleTemplateInput & Record<string, unknown>>(request);
    const brief = await buildNansenSimpleTemplateBrief(body);
    return okJson({ brief });
  } catch (error) {
    return nansenRouteError("Nansen simple template failed", error);
  }
}
