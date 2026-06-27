import { NextRequest, NextResponse } from "next/server";
import { connectNeo4j } from "@/lib/services/brain/neo4j";
import type { Neo4jBrainConfig } from "@/lib/types/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      vaultPath?: string;
      brainServicesFolder?: string;
      neo4j?: Partial<Neo4jBrainConfig>;
    };
    const result = await connectNeo4j(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not connect Neo4j Brain Service.",
    }, { status: 400 });
  }
}
