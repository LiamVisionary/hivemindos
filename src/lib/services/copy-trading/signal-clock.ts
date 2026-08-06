import type { CopyTradeNetwork, CopyTradeSignal } from "@/lib/types/copy-trading";

const BASE_BLOCK_MS = 2_000;
const SOLANA_SLOT_MS = 400;

/** A deterministic ordering clock derived from the target chain. It is not a
 *  wall-clock timestamp; its purpose is to make paired configs reach the same
 *  cooldown decision even when one waits on a model response. */
export function copyTradeSignalClockMs(network: CopyTradeNetwork, signal: Pick<CopyTradeSignal, "blockOrSlot">): number | null {
  let height: bigint;
  try {
    height = BigInt(signal.blockOrSlot);
  } catch {
    return null;
  }
  if (height < 0n || height > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(height) * (network === "solana:mainnet" ? SOLANA_SLOT_MS : BASE_BLOCK_MS);
}

export function isCopyTradeSignalCooldownActive(input: {
  network: CopyTradeNetwork;
  signal: Pick<CopyTradeSignal, "blockOrSlot">;
  lastActionClockMs?: number;
  cooldownMs: number;
}): boolean {
  if (input.lastActionClockMs == null || input.cooldownMs <= 0) return false;
  const current = copyTradeSignalClockMs(input.network, input.signal);
  if (current == null) return false;
  return current >= input.lastActionClockMs && current - input.lastActionClockMs < input.cooldownMs;
}
