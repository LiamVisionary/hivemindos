import { NextRequest, NextResponse } from "next/server";
import { getNeo4jStatus } from "@/lib/services/brain/neo4j";
import type { Neo4jBrainConfig } from "@/lib/types/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function inputFromRequest(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const neo4j: Partial<Neo4jBrainConfig> = {};
  for (const key of ["enabled", "installMode", "uriEnvKey", "usernameEnvKey", "passwordEnvKey", "databaseEnvKey", "database", "queryLimit"] as const) {
    const value = params.get(key);
    if (value === null || value === "") continue;
    (neo4j as Record<string, string | boolean | number>)[key] = key === "enabled" ? value === "true" : key === "queryLimit" ? Number(value) : value;
  }
  return {
    vaultPath: params.get("vaultPath") ?? undefined,
    brainServicesFolder: params.get("brainServicesFolder") ?? undefined,
    neo4j,
  };
}

export async function GET(request: NextRequest) {
  try {
    const status = await getNeo4jStatus(inputFromRequest(request));
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not check Neo4j Brain Service status.",
    }, { status: 400 });
  }
}
