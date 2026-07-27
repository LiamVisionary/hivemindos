import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  getCompanyAutonomyDriverStatus,
  rememberCompanyDriverSelfBase,
  runCompanyDriverTickNow,
  startCompanyAutonomyDriver,
  stopCompanyAutonomyDriver,
} from "@/lib/services/company-autonomy-driver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Control surface for the perpetual company-autonomy driver. The driver keeps
// autonomous (launched, non-frozen) companies working toward their apex goal.
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  // Requests reach us on a real, working loopback address even when PORT env
  // is unset — record it so the driver's self-fetches (fleet snapshot,
  // dispatch) use a door that actually answers.
  rememberCompanyDriverSelfBase(request.headers.get("host"));
  return NextResponse.json({ ok: true, ...getCompanyAutonomyDriverStatus() });
}

type Body = { action?: string };

export async function POST(request: NextRequest) {
  // The boot autostart (instrumentation.ts) self-POSTs action=start over loopback;
  // allow that unauthenticated path, but require auth for any other caller.
  const body = (await request.json().catch(() => ({}))) as Body;
  const action = body.action ?? "status";
  rememberCompanyDriverSelfBase(request.headers.get("host"));

  if (action === "start" || action === "tick") {
    // The boot self-POST is direct loopback (no forwarded-for). If the request
    // arrived via a proxy from a non-loopback origin, require auth — don't let a
    // remote caller poke the driver even if the server is ever bound beyond localhost.
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const external = forwarded && !["127.0.0.1", "::1", "localhost"].includes(forwarded);
    if (external) {
      const unauthorized = await requireAuth(request);
      if (unauthorized) return unauthorized;
    }
    if (action === "tick") {
      // Runs ONE tick through THIS request's freshly-compiled code (lease-gated).
      // This is what lets driver fixes land with no server restart: the loop
      // prefers this route, and any local caller can also drive a tick.
      const result = await runCompanyDriverTickNow();
      return NextResponse.json({ ok: true, ...getCompanyAutonomyDriverStatus(), ...result });
    }
    const status = await startCompanyAutonomyDriver();
    return NextResponse.json({ ok: true, ...status });
  }

  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  if (action === "stop") {
    const status = await stopCompanyAutonomyDriver();
    return NextResponse.json({ ok: true, ...status });
  }
  return NextResponse.json({ ok: true, ...getCompanyAutonomyDriverStatus() });
}
