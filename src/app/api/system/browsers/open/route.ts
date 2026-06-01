import { NextResponse } from "next/server";
import { openUrlInSystemBrowser } from "@/lib/services/system-browsers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { url?: unknown; browserId?: unknown };
    await openUrlInSystemBrowser(body.url, body.browserId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not open the funding page." },
      { status: 400 },
    );
  }
}
