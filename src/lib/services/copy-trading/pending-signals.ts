import type {
  CopyTradePendingSignal,
  CopyTradeRuntimeState,
  CopyTradeSignal,
} from "@/lib/types/copy-trading";

const BASE_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;
const MAX_PENDING_SIGNALS = 100;

export function queuePendingSignal(
  state: CopyTradeRuntimeState,
  signal: CopyTradeSignal,
  reason: string,
  now: number,
): CopyTradePendingSignal {
  const pendingSignals = state.pendingSignals ?? [];
  const existing = pendingSignals.find((pending) => pending.targetTxRef === signal.targetTxRef);
  const attempts = (existing?.attempts ?? 0) + 1;
  const retryMs = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.min(attempts - 1, 10));
  const pending: CopyTradePendingSignal = {
    targetTxRef: signal.targetTxRef,
    direction: signal.direction,
    token: signal.token,
    quoteSymbol: signal.quoteSymbol,
    quoteUsd: signal.quoteUsd,
    blockOrSlot: signal.blockOrSlot,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastAttemptAt: now,
    nextAttemptAt: now + retryMs,
    attempts,
    reason,
  };
  state.pendingSignals = [...pendingSignals.filter((item) => item.targetTxRef !== signal.targetTxRef), pending]
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
    .slice(-MAX_PENDING_SIGNALS);
  return pending;
}

export function duePendingSignals(state: CopyTradeRuntimeState, now: number): CopyTradePendingSignal[] {
  return (state.pendingSignals ?? [])
    .filter((signal) => signal.nextAttemptAt <= now)
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt);
}

export function completePendingSignal(state: CopyTradeRuntimeState, targetTxRef: string): void {
  state.pendingSignals = (state.pendingSignals ?? []).filter((signal) => signal.targetTxRef !== targetTxRef);
  if (!state.consumedTxRefs.includes(targetTxRef)) state.consumedTxRefs.push(targetTxRef);
}

export function isPendingSignal(state: CopyTradeRuntimeState, targetTxRef: string): boolean {
  return (state.pendingSignals ?? []).some((signal) => signal.targetTxRef === targetTxRef);
}
