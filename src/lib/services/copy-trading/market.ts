import "server-only";

/* Tiny, self-contained price/liquidity helpers for copy-trading. Kept separate
   from src/lib/services/trading/market-data.ts so the watcher/engine bundle into
   the standalone daemon without dragging the full Next market stack. Both calls
   are best-effort with short caches; failures degrade (null) rather than throw. */

import type { CopyTradeNetwork } from "@/lib/types/copy-trading";

type Cached<T> = { value: T; at: number };
const NATIVE_TTL_MS = 60_000;
const LIQ_TTL_MS = 60_000;

const nativeCache = new Map<string, Cached<number | null>>();
const liqCache = new Map<string, Cached<number | null>>();

function dexScreenerChain(network: CopyTradeNetwork): string {
  return network === "solana:mainnet" ? "solana" : "base";
}

/** USD price of the chain's native gas/quote asset (ETH on Base, SOL on Solana). */
export async function nativeUsdPrice(network: CopyTradeNetwork): Promise<number | null> {
  const id = network === "solana:mainnet" ? "solana" : "ethereum";
  const cached = nativeCache.get(id);
  if (cached && Date.now() - cached.at < NATIVE_TTL_MS) return cached.value;
  let value: number | null = null;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    const json = (await res.json().catch(() => null)) as Record<string, { usd?: number }> | null;
    const usd = json?.[id]?.usd;
    if (typeof usd === "number" && usd > 0) value = usd;
  } catch {
    value = null;
  }
  nativeCache.set(id, { value, at: Date.now() });
  return value;
}

/** Deepest-pool liquidity (USD) for a token via DexScreener, or null if unknown. */
export async function tokenLiquidityUsd(network: CopyTradeNetwork, tokenAddress: string): Promise<number | null> {
  const key = `${network}:${tokenAddress.toLowerCase()}`;
  const cached = liqCache.get(key);
  if (cached && Date.now() - cached.at < LIQ_TTL_MS) return cached.value;
  let value: number | null = null;
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/${dexScreenerChain(network)}/${tokenAddress}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    const pairs = (await res.json().catch(() => null)) as Array<{ liquidity?: { usd?: number } }> | null;
    if (Array.isArray(pairs)) {
      const deepest = pairs.reduce((max, p) => Math.max(max, Number(p?.liquidity?.usd) || 0), 0);
      value = deepest > 0 ? deepest : null;
    }
  } catch {
    value = null;
  }
  liqCache.set(key, { value, at: Date.now() });
  return value;
}
