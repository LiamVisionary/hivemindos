import { NextRequest, NextResponse } from "next/server";
import { getSyntoStatus } from "@/lib/services/brain/synto";
import type { SyntoConfig } from "@/lib/types/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const synto: Partial<SyntoConfig> = {};
    if (params.has("enabled")) synto.enabled = params.get("enabled") === "true";
    if (params.has("installMode")) synto.installMode = params.get("installMode") as SyntoConfig["installMode"];
    if (params.has("cliPath")) synto.cliPath = params.get("cliPath") ?? undefined;
    if (params.has("mcpMode")) synto.mcpMode = params.get("mcpMode") as SyntoConfig["mcpMode"];
    if (params.has("sourceAccessMode")) synto.sourceAccessMode = params.get("sourceAccessMode") as SyntoConfig["sourceAccessMode"];
    if (params.has("modelRoute")) synto.modelRoute = params.get("modelRoute") as SyntoConfig["modelRoute"];
    if (params.has("cloudProvider")) synto.cloudProvider = params.get("cloudProvider") as SyntoConfig["cloudProvider"];
    if (params.has("cloudModel")) synto.cloudModel = params.get("cloudModel") ?? undefined;
    if (params.has("cloudRequireZdr")) synto.cloudRequireZdr = params.get("cloudRequireZdr") === "true";
    if (params.has("localProvider")) synto.localProvider = params.get("localProvider") as SyntoConfig["localProvider"];
    if (params.has("localModelId")) synto.localModelId = params.get("localModelId") ?? undefined;
    if (params.has("localLoadedModelKey")) synto.localLoadedModelKey = params.get("localLoadedModelKey") ?? undefined;
    if (params.has("compareHeavyModel")) synto.compareHeavyModel = params.get("compareHeavyModel") ?? undefined;
    if (params.has("autoApprove")) synto.autoApprove = params.get("autoApprove") === "true";
    if (params.has("minConfidence")) synto.minConfidence = Number(params.get("minConfidence"));
    const status = await getSyntoStatus({
      vaultPath: params.get("vaultPath") ?? undefined,
      synthesisFolder: params.get("synthesisFolder") ?? undefined,
      brainServicesFolder: params.get("brainServicesFolder") ?? undefined,
      synto,
    });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read Syntho status.",
    }, { status: 500 });
  }
}
