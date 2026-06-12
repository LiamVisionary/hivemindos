import { NextRequest, NextResponse } from "next/server";
import { VENICE_DEFAULT_KEY_ENV, saveVeniceApiKey } from "@/lib/services/venice";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as { apiKey?: string; envName?: string };
  try {
    const envName = await saveVeniceApiKey(body.apiKey ?? "", body.envName ?? VENICE_DEFAULT_KEY_ENV);
    return NextResponse.json({ ok: true, envName });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not save the Venice API key." }, { status: 400 });
  }
}
