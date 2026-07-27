import { NextRequest } from "next/server";
import { readOutcomeRoutingRecords, recordOutcomeRoutingResult } from "@/lib/services/outcome-router";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const records = await readOutcomeRoutingRecords().catch(() => []);
  return okJson({ records });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json().catch(() => ({}));
    const record = await recordOutcomeRoutingResult(body);
    return okJson({ record });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not record the outcome.");
  }
}
