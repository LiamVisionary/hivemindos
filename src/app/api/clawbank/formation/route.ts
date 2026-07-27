import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  clawbankFormationJurisdictions,
  clawbankFormationOrders,
} from "@/lib/services/clawbank";
import { clawbankRouteError } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ClawBank US LLC formation — read surface.
 *
 *   GET -> { jurisdictions, orders }
 *
 * Formation CHECKOUT files a real legal entity and takes on-chain payment; its
 * payload schema is discovered at runtime (`inspect_formation_payload_schema`)
 * and the `declared_payer_wallet` must match the actual sender. Because the
 * checkout body is account- and quote-specific, the paid step is intentionally
 * NOT a fabricated REST endpoint here — run it through /api/clawbank/run
 * (clawbank_call -> start_formation_checkout, gated by CONFIRM_CLAWBANK_CALL)
 * after inspecting the schema and a quote.
 */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const [jurisdictions, orders] = await Promise.all([
    clawbankFormationJurisdictions(),
    clawbankFormationOrders(),
  ]);
  if (!jurisdictions.ok && !orders.ok) return clawbankRouteError(jurisdictions);
  return NextResponse.json({
    ok: true,
    jurisdictions: jurisdictions.ok ? jurisdictions.data : null,
    orders: orders.ok ? orders.data : null,
    ...(jurisdictions.ok ? {} : { jurisdictionsError: jurisdictions.error }),
    ...(orders.ok ? {} : { ordersError: orders.error }),
    note: "Formation checkout is a discovery-first paid flow. Inspect the payload schema and run start_formation_checkout via /api/clawbank/run.",
  });
}
