import { NextResponse } from "next/server";
import { listSystemBrowsers } from "@/lib/services/system-browsers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const browsers = await listSystemBrowsers();
    return NextResponse.json({ ok: true, browsers });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not detect installed browsers." },
      { status: 500 },
    );
  }
}
