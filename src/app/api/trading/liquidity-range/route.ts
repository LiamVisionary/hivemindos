import type { NextRequest } from "next/server";
import { runLiquidityRangeConfig } from "@/lib/services/trading/liquidity-range-engine";
import { readBaseUniswapV3Position } from "@/lib/services/trading/liquidity-range-onchain";
import { evaluateLiquidityRangePolicy } from "@/lib/services/trading/liquidity-range-policy";
import {
  readLiquidityRangeConfigs,
  readLiquidityRangeEngineStatus,
  readLiquidityRangeStates,
  removeLiquidityRangeConfig,
  setLiquidityRangeConfigEnabled,
  upsertLiquidityRangeConfig,
} from "@/lib/services/trading/liquidity-range-store";
import {
  LIQUIDITY_RANGE_ENGINE_OFFLINE_AFTER_MS,
  defaultLiquidityRangeConfig,
  type LiquidityRangeConfig,
} from "@/lib/types/liquidity-range-manager";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  action?: "inspect" | "upsert" | "start" | "stop" | "delete" | "run-once";
  id?: string;
  tokenId?: string;
  config?: Partial<LiquidityRangeConfig>;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const [configs, states, engine] = await Promise.all([
      readLiquidityRangeConfigs(),
      readLiquidityRangeStates(),
      readLiquidityRangeEngineStatus(),
    ]);
    const online = Boolean(engine && Date.now() - engine.heartbeatMs < LIQUIDITY_RANGE_ENGINE_OFFLINE_AFTER_MS);
    return okJson({ configs, states, engine, online, safety: { execution: "shadow-only", signsTransactions: false } });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not read liquidity range manager state.", 500);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as Body;
  switch (body.action) {
    case "inspect":
      return inspectPosition(body);
    case "upsert":
      return upsertPosition(body);
    case "start":
      return setEnabled(body.id, true);
    case "stop":
      return setEnabled(body.id, false);
    case "delete":
      if (!body.id) return errorJson("A monitor id is required.");
      return (await removeLiquidityRangeConfig(body.id)) ? okJson() : errorJson("No such liquidity monitor.", 404);
    case "run-once":
      return runOnce(body.id);
    default:
      return errorJson("Unknown liquidity range manager action.");
  }
}

async function inspectPosition(body: Body) {
  const tokenId = String(body.tokenId ?? body.config?.tokenId ?? "").trim();
  if (!isValidTokenId(tokenId)) return errorJson("Position NFT ID must be a positive uint256 integer.");
  try {
    const snapshot = await readBaseUniswapV3Position(tokenId);
    const config = defaultLiquidityRangeConfig({ id: "inspection", tokenId });
    const normalized = { ...config, ...body.config, id: "inspection", tokenId, mode: "shadow" as const };
    const decision = evaluateLiquidityRangePolicy({
      config: normalized,
      currentTick: snapshot.currentTick,
      tickLower: snapshot.tickLower,
      tickUpper: snapshot.tickUpper,
      tickSpacing: snapshot.tickSpacing,
      positionValueUsd: snapshot.positionValueUsd,
      lastRebalancedAt: null,
    });
    return okJson({ snapshot, decision });
  } catch (error) {
    return upstreamErrorJson("Could not inspect the Base Uniswap v3 position", error);
  }
}

async function upsertPosition(body: Body) {
  const input = body.config ?? {};
  if (input.mode && input.mode !== "shadow") return errorJson("Live liquidity execution is not available. This manager is shadow-only.");
  const tokenId = String(input.tokenId ?? body.tokenId ?? "").trim();
  if (!isValidTokenId(tokenId)) return errorJson("Position NFT ID must be a positive uint256 integer.");
  try {
    const snapshot = await readBaseUniswapV3Position(tokenId);
    const id = String(input.id || newId());
    const config = await upsertLiquidityRangeConfig({
      ...input,
      id,
      tokenId,
      label: input.label || `${snapshot.token0.symbol}/${snapshot.token1.symbol} · #${tokenId}`,
      mode: "shadow",
    });
    return okJson({ config, snapshot });
  } catch (error) {
    return upstreamErrorJson("Could not verify and save the Base Uniswap v3 position", error);
  }
}

async function setEnabled(id: string | undefined, enabled: boolean) {
  if (!id) return errorJson("A monitor id is required.");
  const config = await setLiquidityRangeConfigEnabled(id, enabled);
  return config ? okJson({ config }) : errorJson("No such liquidity monitor.", 404);
}

async function runOnce(id: string | undefined) {
  if (!id) return errorJson("A monitor id is required.");
  const config = (await readLiquidityRangeConfigs()).find((candidate) => candidate.id === id);
  if (!config) return errorJson("No such liquidity monitor.", 404);
  const state = await runLiquidityRangeConfig(config);
  return state.error ? errorJson(state.error, 502, { state }) : okJson({ state });
}

function newId(): string {
  return `lrm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function isValidTokenId(value: string): boolean {
  if (!/^[0-9]{1,78}$/.test(value)) return false;
  const tokenId = BigInt(value);
  return tokenId > 0n && tokenId < 2n ** 256n;
}
