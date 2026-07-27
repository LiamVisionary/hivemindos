import { NextResponse } from "next/server";

import { dashboardDeviceTokenConfigured, requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hands the fleet's shared dashboard device token to an AUTHENTICATED dashboard
// user so the "Connect phone" QR can provision it into the companion app. The
// phone stores it and sends it as `x-hivemindos-device-token` on every `/api`
// call, so a paired phone authenticates to this same auth gate (src/proxy.ts)
// without ever prompting the user for a token.
//
// Gated by requireAuth (and the proxy gate): only someone already authenticated
// to this dashboard can mint a pairing QR — i.e. provision their own device. The
// token appears in the QR by design; that is the transfer channel, shown only to
// the authenticated user, the same way a Wi-Fi or TOTP setup QR carries a secret.
export async function GET(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  // Auth off (or only half-configured) → nothing to provision; the phone works
  // tokenless in that mode, so report null rather than an error.
  if (!dashboardDeviceTokenConfigured()) {
    return NextResponse.json({ ok: true, token: null });
  }

  const token = process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN?.trim() || null;
  return NextResponse.json({ ok: true, token });
}
