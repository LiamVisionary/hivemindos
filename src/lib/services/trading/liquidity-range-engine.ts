import "server-only";

import { readBaseUniswapV3Position } from "@/lib/services/trading/liquidity-range-onchain";
import {
  applyLiquidityRangePaperDecision,
  markLiquidityRangePaperState,
} from "@/lib/services/trading/liquidity-range-paper";
import { evaluateLiquidityRangePolicy } from "@/lib/services/trading/liquidity-range-policy";
import {
  emptyLiquidityRangeRuntimeState,
  readLiquidityRangeConfigs,
  readLiquidityRangeStates,
  updateLiquidityRangeRuntimeState,
  writeLiquidityRangeEngineStatus,
} from "@/lib/services/trading/liquidity-range-store";
import {
  LIQUIDITY_RANGE_MODE,
  type LiquidityPositionSnapshot,
  type LiquidityRangeConfig,
  type LiquidityRangeEngineStatus,
  type LiquidityRangeRuntimeState,
} from "@/lib/types/liquidity-range-manager";

type EngineDependencies = {
  readPosition?: (tokenId: string) => Promise<LiquidityPositionSnapshot>;
  now?: () => number;
};

let timer: ReturnType<typeof setInterval> | null = null;
let runningPulse = false;
let engineStatus: LiquidityRangeEngineStatus | null = null;

export async function runLiquidityRangeConfig(
  config: LiquidityRangeConfig,
  dependencies: EngineDependencies = {},
): Promise<LiquidityRangeRuntimeState> {
  const now = dependencies.now?.() ?? Date.now();
  const readPosition = dependencies.readPosition ?? readBaseUniswapV3Position;
  const states = await readLiquidityRangeStates();
  const previous = states[config.id] ?? emptyLiquidityRangeRuntimeState(config.id);
  try {
    const snapshot = await readPosition(config.tokenId);
    const effectiveRange = previous.paper
      ? { tickLower: previous.paper.tickLower, tickUpper: previous.paper.tickUpper }
      : previous.shadowRange ?? { tickLower: snapshot.tickLower, tickUpper: snapshot.tickUpper };
    const markedPaper = markLiquidityRangePaperState({
      previous: previous.paper ?? null,
      config,
      snapshot,
      tickLower: effectiveRange.tickLower,
      tickUpper: effectiveRange.tickUpper,
      now,
    });
    const decision = evaluateLiquidityRangePolicy({
      config,
      currentTick: snapshot.currentTick,
      tickLower: effectiveRange.tickLower,
      tickUpper: effectiveRange.tickUpper,
      tickSpacing: snapshot.tickSpacing,
      positionValueUsd: markedPaper?.totalUsd ?? snapshot.positionValueUsd,
      lastRebalancedAt: markedPaper?.lastRebalancedAt ?? previous.lastRebalancedAt,
      now,
    });
    const shadowRebalanced = decision.action === "propose-rebalance";
    const paper = markedPaper
      ? applyLiquidityRangePaperDecision({ state: markedPaper, config, snapshot, decision, now })
      : null;
    const event = shadowRebalanced
      ? {
          at: now,
          kind: "shadow-rebalance" as const,
          action: decision.action,
          status: decision.status,
          message: `Shadow range moved to ticks ${decision.targetTickLower}–${decision.targetTickUpper}. No transaction was signed.`,
        }
      : {
          at: now,
          kind: "observation" as const,
          action: decision.action,
          status: decision.status,
          message: decision.reasons[0] ?? "Position observed.",
        };
    return updateLiquidityRangeRuntimeState(config.id, (current) => ({
      ...current,
      lastCheckedAt: now,
      lastRebalancedAt: shadowRebalanced ? now : current.lastRebalancedAt,
      lastDecision: decision,
      lastSnapshot: snapshot,
      shadowRange: shadowRebalanced
        ? { tickLower: decision.targetTickLower, tickUpper: decision.targetTickUpper, rebalancedAt: now }
        : current.shadowRange,
      paper,
      events: shouldAppendEvent(current, event) ? [...current.events, event] : current.events,
      error: null,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Liquidity position check failed.";
    return updateLiquidityRangeRuntimeState(config.id, (current) => ({
      ...current,
      lastCheckedAt: now,
      error: message,
      events: shouldAppendError(current, message, now)
        ? [...current.events, { at: now, kind: "error", message }]
        : current.events,
    }));
  }
}

export async function runLiquidityRangePulse(dependencies: EngineDependencies = {}): Promise<void> {
  if (runningPulse) return;
  runningPulse = true;
  try {
    const now = dependencies.now?.() ?? Date.now();
    const [configs, states] = await Promise.all([readLiquidityRangeConfigs(), readLiquidityRangeStates()]);
    const active = configs.filter((config) => config.enabled && config.mode === LIQUIDITY_RANGE_MODE);
    for (const config of active) {
      const lastCheckedAt = states[config.id]?.lastCheckedAt ?? 0;
      if (now - lastCheckedAt < config.pollIntervalMs) continue;
      await runLiquidityRangeConfig(config, dependencies);
    }
    if (engineStatus) {
      engineStatus = { ...engineStatus, heartbeatMs: now, activeConfigs: active.length };
      await writeLiquidityRangeEngineStatus(engineStatus);
    }
  } finally {
    runningPulse = false;
  }
}

export async function startLiquidityRangeEngine(
  options: { host?: LiquidityRangeEngineStatus["host"]; intervalMs?: number } = {},
): Promise<LiquidityRangeEngineStatus> {
  if (timer && engineStatus) return engineStatus;
  const now = Date.now();
  const configs = await readLiquidityRangeConfigs();
  engineStatus = {
    host: options.host ?? "manual",
    pid: process.pid,
    startedAt: now,
    heartbeatMs: now,
    activeConfigs: configs.filter((config) => config.enabled).length,
    mode: LIQUIDITY_RANGE_MODE,
  };
  await writeLiquidityRangeEngineStatus(engineStatus);
  await runLiquidityRangePulse();
  timer = setInterval(() => void runLiquidityRangePulse(), Math.max(10_000, options.intervalMs ?? 30_000));
  timer.unref?.();
  return engineStatus;
}

export async function stopLiquidityRangeEngine(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  engineStatus = null;
  await writeLiquidityRangeEngineStatus(null);
}

export function getLiquidityRangeEngineStatus(): LiquidityRangeEngineStatus | null {
  return engineStatus;
}

function shouldAppendEvent(
  current: LiquidityRangeRuntimeState,
  event: { at: number; kind: "observation" | "shadow-rebalance"; action: string; status: string; message: string },
): boolean {
  if (event.kind === "shadow-rebalance") return true;
  const previous = current.events.at(-1);
  if (!previous) return true;
  return previous.action !== event.action || previous.status !== event.status || event.at - previous.at >= 15 * 60_000;
}

function shouldAppendError(current: LiquidityRangeRuntimeState, message: string, now: number): boolean {
  const previous = current.events.at(-1);
  return !previous || previous.kind !== "error" || previous.message !== message || now - previous.at >= 15 * 60_000;
}
