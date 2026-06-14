import { NextRequest, NextResponse } from "next/server";
import { listSavedAgentSouls, saveNewAgentSoul } from "@/lib/services/agent-souls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const souls = await listSavedAgentSouls({ includeContent: true });
    return NextResponse.json({ ok: true, souls });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not load saved SOUL.md files.",
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      title?: string;
      content?: string;
    };
    const soul = await saveNewAgentSoul({
      title: String(body.title ?? ""),
      content: String(body.content ?? ""),
    });
    return NextResponse.json({ ok: true, soul });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not save SOUL.md.",
    }, { status: 400 });
  }
}
