import { NextRequest, NextResponse } from "next/server";
import { initializeSynto } from "@/lib/services/brain/synto";
import type { SyntoConfig } from "@/lib/types/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { vaultPath?: string; synthesisFolder?: string; brainServicesFolder?: string; synto?: Partial<SyntoConfig> };
    const result = await initializeSynto(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not initialize Syntho.",
    }, { status: 500 });
  }
}
