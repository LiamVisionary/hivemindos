import { NextRequest, NextResponse } from "next/server";
import { getGbrainStatus } from "@/lib/services/brain/gbrain";
import { getNeo4jStatus } from "@/lib/services/brain/neo4j";
import { getQmdStatus } from "@/lib/services/brain/qmd";
import { getSyntoStatus } from "@/lib/services/brain/synto";
import { getTradingBrainStatus } from "@/lib/services/brain/trading-brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every brain service's status in one response, checked in parallel — the
 * phone's Services pane reads this instead of three round-trips (each hop
 * crosses the tailnet / app-proxy path, so round-trips dominate). A failed
 * check reports per-service; only a malformed request fails the route.
 * Service-specific config overrides stay on the per-service routes — this
 * one takes just the shared vault params.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const input = {
      vaultPath: params.get("vaultPath") ?? undefined,
      brainServicesFolder: params.get("brainServicesFolder") ?? undefined,
    };
    const [gbrain, qmd, neo4j, synto, tradingBrain] = await Promise.allSettled([
      getGbrainStatus(input),
      getQmdStatus(input),
      getNeo4jStatus(input),
      getSyntoStatus({ ...input, synthesisFolder: params.get("synthesisFolder") ?? undefined }),
      getTradingBrainStatus(input),
    ]);
    const entry = (result: PromiseSettledResult<unknown>) =>
      result.status === "fulfilled"
        ? { status: result.value }
        : { error: result.reason instanceof Error ? result.reason.message : "Status check failed." };
    return NextResponse.json({
      ok: true,
      services: {
        gbrain: entry(gbrain),
        qmd: entry(qmd),
        neo4j: entry(neo4j),
        synto: entry(synto),
        "trading-brain": entry(tradingBrain),
      },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read brain service status.",
    }, { status: 500 });
  }
}
