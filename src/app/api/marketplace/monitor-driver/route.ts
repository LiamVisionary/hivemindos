// guard:allow-hive-action-route - dashboard and loopback boot control for the local marketplace monitor, not an agent-invocable marketplace action.
// Control surface for the marketplace monitor driver (company-driver pattern):
// the boot autostart (instrumentation.ts) self-POSTs action=start over loopback
// unauthenticated; everything else requires auth.
import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/utils/server-auth";
import {
  getMarketplaceMonitorDriverStatus,
  runMarketplaceMonitorTickNow,
  startMarketplaceMonitorDriver,
  stopMarketplaceMonitorDriver,
} from "@/lib/services/marketplace/marketplace-monitor-driver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({ ok: true, ...(await getMarketplaceMonitorDriverStatus()) });
}

type Body = { action?: string };

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const action = body.action ?? "status";

  if (action === "start" || action === "tick") {
    // Boot self-POST is direct loopback (no forwarded-for); a proxied external
    // origin still needs auth even if the server is ever bound beyond localhost.
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const external = forwarded && !["127.0.0.1", "::1", "localhost"].includes(forwarded);
    if (external) {
      const unauthorized = await requireAuth(request);
      if (unauthorized) return unauthorized;
    }
    if (action === "tick") {
      const result = await runMarketplaceMonitorTickNow();
      return NextResponse.json({ ok: true, ...(await getMarketplaceMonitorDriverStatus()), ...result });
    }
    const status = startMarketplaceMonitorDriver();
    return NextResponse.json({ ok: true, ...status });
  }

  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  if (action === "stop") {
    const status = await stopMarketplaceMonitorDriver();
    return NextResponse.json({ ok: true, ...status });
  }
  return NextResponse.json({ ok: true, ...(await getMarketplaceMonitorDriverStatus()) });
}
