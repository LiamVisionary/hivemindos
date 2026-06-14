import { NextRequest, NextResponse } from "next/server";
import { getQmdStatus } from "@/lib/services/brain/qmd";
import type { QmdConfig } from "@/lib/types/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const qmd: Partial<QmdConfig> = {};
    if (params.has("enabled")) qmd.enabled = params.get("enabled") === "true";
    if (params.has("installMode")) qmd.installMode = params.get("installMode") as QmdConfig["installMode"];
    if (params.has("cliPath")) qmd.cliPath = params.get("cliPath") ?? undefined;
    if (params.has("collectionName")) qmd.collectionName = params.get("collectionName") ?? undefined;
    if (params.has("indexName")) qmd.indexName = params.get("indexName") ?? undefined;
    if (params.has("mcpMode")) qmd.mcpMode = params.get("mcpMode") as QmdConfig["mcpMode"];
    if (params.has("httpUrl")) qmd.httpUrl = params.get("httpUrl") ?? undefined;
    if (params.has("searchMode")) qmd.searchMode = params.get("searchMode") as QmdConfig["searchMode"];
    if (params.has("defaultLimit")) qmd.defaultLimit = Number(params.get("defaultLimit"));
    if (params.has("candidateLimit")) qmd.candidateLimit = Number(params.get("candidateLimit"));
    if (params.has("minScore")) qmd.minScore = Number(params.get("minScore"));
    if (params.has("autoEmbed")) qmd.autoEmbed = params.get("autoEmbed") === "true";
    if (params.has("maxDocsPerBatch")) qmd.maxDocsPerBatch = Number(params.get("maxDocsPerBatch"));
    if (params.has("maxBatchMb")) qmd.maxBatchMb = Number(params.get("maxBatchMb"));
    const status = await getQmdStatus({
      vaultPath: params.get("vaultPath") ?? undefined,
      brainServicesFolder: params.get("brainServicesFolder") ?? undefined,
      qmd,
    });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read QMD status.",
    }, { status: 500 });
  }
}
