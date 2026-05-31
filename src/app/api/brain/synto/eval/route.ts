import { NextRequest, NextResponse } from "next/server";
import { evaluateSynto } from "@/lib/services/brain/synto";
import type { SyntoConfig } from "@/lib/types/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { vaultPath?: string; synthesisFolder?: string; brainServicesFolder?: string; synto?: Partial<SyntoConfig> };
    const result = await evaluateSynto(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not evaluate Syntho.",
    }, { status: 500 });
  }
}
