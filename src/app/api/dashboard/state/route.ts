import { NextResponse } from "next/server";

import { readDashboardState, updateDashboardState } from "@/lib/services/dashboard-state";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const state = await readDashboardState();
    return NextResponse.json({ ok: true, values: state.values, updatedAt: state.updatedAt });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read dashboard state.",
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as {
      values?: Record<string, string>;
      remove?: string[];
    };
    const state = await updateDashboardState({
      values: body.values,
      remove: Array.isArray(body.remove) ? body.remove : [],
    });
    return NextResponse.json({ ok: true, values: state.values, updatedAt: state.updatedAt });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not write dashboard state.",
    }, { status: 500 });
  }
}
