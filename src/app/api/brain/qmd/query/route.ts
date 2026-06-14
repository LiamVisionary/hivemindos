import { NextRequest, NextResponse } from "next/server";
import { queryQmd } from "@/lib/services/brain/qmd";
import type { QmdConfig } from "@/lib/types/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      vaultPath?: string;
      brainServicesFolder?: string;
      qmd?: Partial<QmdConfig>;
      query?: string;
      mode?: QmdConfig["searchMode"];
      limit?: number;
    };
    const result = await queryQmd(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not query QMD.",
    }, { status: 500 });
  }
}
