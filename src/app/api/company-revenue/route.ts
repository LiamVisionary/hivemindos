import { NextRequest } from "next/server";

import {
  companyRevenueRollup,
  listCompanyRevenueRecords,
  quoteCompanyRevenueShare,
  recordCompanyRevenue,
} from "@/lib/services/company-revenue-share";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompanyRevenueBody = {
  action?: "quote" | "record" | "collect-fee";
  companyId?: string;
  eventId?: string;
  amountUsd?: number;
  source?: string;
  externalId?: string;
  customerLabel?: string;
  description?: string;
  receivedAt?: string;
  network?: string;
  collectFee?: boolean;
  collectingAgentId?: string;
  confirmation?: string;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const companyId = request.nextUrl.searchParams.get("companyId")?.trim() || "";
  if (!companyId) return errorJson("companyId is required", 400);
  const records = await listCompanyRevenueRecords(companyId);
  const rollup = await companyRevenueRollup(companyId, records);
  return okJson({ records: records.slice(0, 100), rollup });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as CompanyRevenueBody;
  const action = body.action ?? "record";

  try {
    if (action === "quote") {
      return okJson({
        fee: await quoteCompanyRevenueShare({
          amountUsd: Number(body.amountUsd),
          network: body.network,
        }),
      });
    }

    if (action === "collect-fee") {
      return errorJson("Revenue earned outside HivemindOS carries no platform fee. Marketplace or managed-billing fees settle through their hosted transaction policy.", 409);
    }

    const result = await recordCompanyRevenue({
      companyId: body.companyId ?? "",
      amountUsd: Number(body.amountUsd),
      source: body.source,
      externalId: body.externalId,
      customerLabel: body.customerLabel,
      description: body.description,
      receivedAt: body.receivedAt,
      network: body.network,
      collectFee: false,
    });
    if (result.feeError) return errorJson(result.feeError, 424, { record: result.record, rollup: result.rollup });
    return okJson(result);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Company revenue action failed", 400);
  }
}
