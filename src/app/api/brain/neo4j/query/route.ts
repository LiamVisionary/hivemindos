import { NextRequest, NextResponse } from "next/server";
import { queryNeo4jBrain } from "@/lib/services/brain/neo4j";
import type { Neo4jBrainConfig } from "@/lib/types/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      vaultPath?: string;
      brainServicesFolder?: string;
      neo4j?: Partial<Neo4jBrainConfig>;
      query?: string;
    };
    const result = await queryNeo4jBrain(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not query Neo4j Brain Service.",
    }, { status: 400 });
  }
}
