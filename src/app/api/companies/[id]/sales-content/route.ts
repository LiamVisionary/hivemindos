// guard:allow-hive-action-route - local-only analysis snapshot and signal-event append with a dynamic [id] segment; outward delivery stays behind provider approval gates.
import { NextRequest } from "next/server";

import { getCompany } from "@/lib/services/companies-store";
import { readSalesContentMachine, recordSalesContentEvent } from "@/lib/services/sales-content";
import { okJson, errorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function companyFromContext(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return { unauthorized };
  const { id } = await context.params;
  const companyId = id?.trim();
  if (!companyId) return { response: errorJson("Company id is required.", 400) };
  const company = await getCompany(companyId);
  if (!company) return { response: errorJson("Company not found.", 404) };
  return { company };
}

// Sales/content machine snapshot. This is local analysis only: it reads existing
// company sources, writes normalized local signal events, and never sends,
// publishes, spends, or writes CRM records.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolved = await companyFromContext(request, context);
  if (resolved.unauthorized) return resolved.unauthorized;
  if (resolved.response) return resolved.response;

  const params = request.nextUrl.searchParams;
  const refresh = params.get("refresh") !== "0";
  const days = Number(params.get("days")) || 30;
  try {
    const machine = await readSalesContentMachine(resolved.company, {
      refresh,
      analyticsRangeDays: Math.max(1, Math.min(365, Math.round(days))),
    });
    return okJson({ machine });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Failed to load the sales/content machine.", 400);
  }
}

// Local event append for adapters or agents that already have evidence. This does
// not deliver anything outward; write-capable providers stay behind their own
// approval/receipt gates.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolved = await companyFromContext(request, context);
  if (resolved.unauthorized) return resolved.unauthorized;
  if (resolved.response) return resolved.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "record-event";
  try {
    if (action === "refresh") {
      const machine = await readSalesContentMachine(resolved.company, { refresh: true });
      return okJson({ machine });
    }
    if (action !== "record-event") return errorJson("Unsupported sales/content action.", 400);
    const result = await recordSalesContentEvent(resolved.company, body.event && typeof body.event === "object" ? body.event as Record<string, unknown> : body);
    return okJson({ event: result.event, eventCount: result.events.length });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Failed to update the sales/content machine.", 400);
  }
}
