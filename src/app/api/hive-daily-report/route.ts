import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  buildHiveDailyReport,
  formatHiveDailyReportText,
} from "@/lib/services/company-daily-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The operator's daily business digest across their OWN companies (revenue,
 * spend, activity, and — with ?email=1 — inbox volume). Reads the local company
 * store, so it is inherently per-user. `?format=text` returns the read-aloud
 * markdown the daily brief writer folds into DAILY-BRIEF.md; default is JSON.
 */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const params = request.nextUrl.searchParams;
  const truthy = (value: string | null) => value === "1" || value === "true";
  const report = await buildHiveDailyReport({
    includeEmail: truthy(params.get("email")),
    includeIntegrations: params.get("integrations") !== "0",
    onlyLocalMachine: truthy(params.get("localOnly")),
  });

  if (params.get("format") === "text") {
    return new NextResponse(formatHiveDailyReportText(report), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.json({ ok: true, report });
}
