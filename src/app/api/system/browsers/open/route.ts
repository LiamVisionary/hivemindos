import { NextResponse } from "next/server";
import { openUrlInSystemBrowser } from "@/lib/services/system-browsers";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as { url?: unknown; browserId?: unknown };
    await openUrlInSystemBrowser(body.url, body.browserId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not open the external link." },
      { status: 400 },
    );
  }
}
