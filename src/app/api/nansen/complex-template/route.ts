import { NextRequest } from "next/server";
import { buildNansenComplexTemplateBrief, type NansenComplexTemplateInput } from "@/lib/services/nansen";
import { okJson } from "@/lib/utils/api-response";
import { nansenRouteError, readNansenBody, requireNansenRouteAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const unauthorized = await requireNansenRouteAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await readNansenBody<NansenComplexTemplateInput & Record<string, unknown>>(request);
    const brief = await buildNansenComplexTemplateBrief(body);
    return okJson({ brief });
  } catch (error) {
    return nansenRouteError("Nansen complex template failed", error);
  }
}
