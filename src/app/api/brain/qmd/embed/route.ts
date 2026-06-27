import { NextRequest, NextResponse } from "next/server";
import { embedQmd } from "@/lib/services/brain/qmd";
import type { QmdConfig } from "@/lib/types/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { vaultPath?: string; brainServicesFolder?: string; qmd?: Partial<QmdConfig> };
    const result = await embedQmd(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not refresh QMD embeddings.",
    }, { status: 500 });
  }
}
