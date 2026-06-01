import { NextResponse } from "next/server";
import { appendSkillAnalyticsEvent, readSkillAnalytics } from "@/lib/services/skills/skill-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 200);
  const events = await readSkillAnalytics(Number.isFinite(limit) ? limit : 200);
  return NextResponse.json({ ok: true, events });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const event = await appendSkillAnalyticsEvent(body);
    return NextResponse.json({ ok: true, event });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not record skill analytics." }, { status: 400 });
  }
}
