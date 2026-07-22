// guard:allow-hive-action-route - dashboard-only price research dispatch/poll; not an
// agent-invokable Hive action.
import { NextRequest } from "next/server";

import { errorJson, okJson } from "@/lib/utils/api-response";
import { readMarketplaceResearchJob, startMarketplacePriceResearch } from "@/lib/services/marketplace/marketplace-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  if (!jobId) return errorJson("jobId is required");
  try {
    const job = await readMarketplaceResearchJob(jobId);
    if (!job) return errorJson(`Unknown research job: ${jobId}`, 404);
    return okJson({ job });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : String(error), 500);
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorJson("Invalid JSON body");
  }
  const listingId = typeof body.listingId === "string" ? body.listingId.trim() : "";
  if (!listingId) return errorJson("listingId is required");
  try {
    const job = await startMarketplacePriceResearch({
      listingId,
      ...(typeof body.globalComparison === "boolean" ? { globalComparison: body.globalComparison } : {}),
    });
    return okJson({ job });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : String(error), 500);
  }
}
