import { NextRequest, NextResponse } from "next/server";
import { VENICE_DEFAULT_KEY_ENV, sanitizeVeniceApiKey, saveVeniceApiKey, validateVeniceApiKey } from "@/lib/services/venice";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as { apiKey?: string; envName?: string };
  // Strip whitespace/newlines a paste may embed before validating or storing.
  const apiKey = sanitizeVeniceApiKey(body.apiKey ?? "");
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Venice API key is required." }, { status: 400 });
  }
  try {
    // Reject a bad key up front (Venice's /models is public, so only an
    // auth-gated check proves the key works). A network failure here is not
    // proof of invalidity, so we save and let the status check surface it.
    const validation = await validateVeniceApiKey(apiKey).catch(() => null);
    if (validation && !validation.valid) {
      return NextResponse.json({ ok: false, error: validation.message }, { status: 400 });
    }
    const envName = await saveVeniceApiKey(apiKey, body.envName ?? VENICE_DEFAULT_KEY_ENV);
    return NextResponse.json({ ok: true, envName });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not save the Venice API key." }, { status: 400 });
  }
}
