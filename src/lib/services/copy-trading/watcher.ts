import "server-only";

/* Target-wallet swap detection for copy-trading — the one genuinely new
   subsystem (the app has no tx-history reader). We detect a swap as an IN+OUT
   token pair in the same transaction where exactly one side is a "quote" asset
   (USDC/USDT/WETH on Base, USDC/USDT/SOL on Solana):

     out = quote, in = token   → BUY of token
     in  = quote, out = token  → SELL of token

   A plain transfer/airdrop (no pair) and quote↔quote stable swaps never signal,
   which keeps us from mirroring non-trades. Native-ETH-only buys (no WETH leg)
   are not detectable in v1 — most Base aggregator routes touch WETH, so this is
   rare. The classify* functions are pure so they can be unit-tested on fixtures;
   detectNewSwaps wires them to viem (Base) and @solana/web3.js (Solana). */

import { createPublicClient, fallback, http, parseAbiItem, type Log } from "viem";
import { base } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";
import type { CopyTradeNetwork } from "@/lib/types/copy-trading";
import { nativeUsdPrice } from "./market";

export type CopyTradeSignal = {
  /** Target's tx hash / signature that triggered this. */
  targetTxRef: string;
  direction: "buy" | "sell";
  /** The non-quote token: 0x address (Base, lowercased) or mint (Solana). */
  token: string;
  /** Quote leg symbol — what the target paid with (buy) or received (sell). */
  quoteSymbol: string;
  /** Target's quote-leg size in USD, when resolvable (for proportional sizing). */
  quoteUsd: number | null;
  /** Block number (Base) or slot (Solana), stringified. */
  blockOrSlot: string;
};

export type WatchResult = {
  signals: CopyTradeSignal[];
  cursor: { lastBlock?: string; lastSignature?: string };
};

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const MAX_LOG_RANGE = 2_000n; // public Base RPC rejects wide getLogs ranges
const BASE_CONFIRMATIONS = 2n;
const SOLANA_SIG_LIMIT = 50;

// ── quote-asset registries (lowercased keys) ────────────────────────────────
type QuoteAsset = { symbol: string; decimals: number; native?: boolean };

const BASE_QUOTES: Record<string, QuoteAsset> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6 },
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": { symbol: "USDT", decimals: 6 },
  "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18, native: true },
};

const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SOLANA_NATIVE = "native-sol";
const SOLANA_QUOTES: Record<string, QuoteAsset> = {
  [SOLANA_USDC.toLowerCase()]: { symbol: "USDC", decimals: 6 },
  [SOLANA_USDT.toLowerCase()]: { symbol: "USDT", decimals: 6 },
  [SOLANA_NATIVE]: { symbol: "SOL", decimals: 9, native: true },
};

const SOL_DUST = 0.002; // ignore fee-sized SOL deltas
const STABLE_DUST = 0.01;

function baseRpcUrls(): string[] {
  const fromEnv = (process.env.BASE_RPC_URL || "")
    .split(/[,\s]+/)
    .map((u) => u.trim())
    .filter(Boolean);
  return Array.from(new Set([...fromEnv, "https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://1rpc.io/base"]));
}

function basePublicClient() {
  return createPublicClient({ chain: base, transport: fallback(baseRpcUrls().map((u) => http(u, { retryCount: 1, timeout: 10_000 }))) });
}

function solanaRpcUrl(): string {
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

// ── pure classification: Base ───────────────────────────────────────────────
export type EvmTransfer = { txHash: string; blockNumber: string; token: string; from: string; to: string; valueRaw: string };

/** Group same-tx transfers and emit buy/sell signals. `nativePriceUsd` prices WETH legs. */
export function classifyEvmSwaps(targetAddress: string, transfers: EvmTransfer[], nativePriceUsd: number | null): CopyTradeSignal[] {
  const target = targetAddress.toLowerCase();
  const byTx = new Map<string, EvmTransfer[]>();
  for (const t of transfers) {
    const list = byTx.get(t.txHash) ?? [];
    list.push(t);
    byTx.set(t.txHash, list);
  }

  const signals: CopyTradeSignal[] = [];
  for (const [txHash, legs] of byTx) {
    const outs = legs.filter((l) => l.from.toLowerCase() === target);
    const ins = legs.filter((l) => l.to.toLowerCase() === target);
    if (outs.length === 0 || ins.length === 0) continue; // not a swap

    const quoteOut = outs.find((l) => BASE_QUOTES[l.token.toLowerCase()]);
    const quoteIn = ins.find((l) => BASE_QUOTES[l.token.toLowerCase()]);
    const blockOrSlot = legs[0]?.blockNumber ?? "0";

    if (quoteOut && !quoteIn) {
      // paid with a quote → BUY a non-quote token
      const bought = ins.find((l) => !BASE_QUOTES[l.token.toLowerCase()]);
      if (!bought) continue;
      const quote = BASE_QUOTES[quoteOut.token.toLowerCase()]!;
      signals.push({
        targetTxRef: txHash,
        direction: "buy",
        token: bought.token.toLowerCase(),
        quoteSymbol: quote.symbol,
        quoteUsd: evmQuoteUsd(quoteOut.valueRaw, quote, nativePriceUsd),
        blockOrSlot,
      });
    } else if (quoteIn && !quoteOut) {
      // received a quote → SELL a non-quote token
      const sold = outs.find((l) => !BASE_QUOTES[l.token.toLowerCase()]);
      if (!sold) continue;
      const quote = BASE_QUOTES[quoteIn.token.toLowerCase()]!;
      signals.push({
        targetTxRef: txHash,
        direction: "sell",
        token: sold.token.toLowerCase(),
        quoteSymbol: quote.symbol,
        quoteUsd: evmQuoteUsd(quoteIn.valueRaw, quote, nativePriceUsd),
        blockOrSlot,
      });
    }
    // quote↔quote or token↔token → skip (not a directional token bet)
  }
  return signals;
}

function evmQuoteUsd(valueRaw: string, quote: QuoteAsset, nativePriceUsd: number | null): number | null {
  const human = Number(valueRaw) / 10 ** quote.decimals;
  if (!Number.isFinite(human)) return null;
  if (!quote.native) return human; // stablecoin ≈ USD
  return nativePriceUsd != null ? human * nativePriceUsd : null;
}

// ── pure classification: Solana ─────────────────────────────────────────────
export type SolanaDelta = { mint: string; uiDelta: number };

/** From a target's per-mint + native SOL deltas in one tx, emit one signal or null. */
export function classifySolanaSwap(
  signature: string,
  slot: number,
  deltas: SolanaDelta[],
  solPriceUsd: number | null,
): CopyTradeSignal | null {
  const significant = deltas.filter((d) => {
    const dust = d.mint === SOLANA_NATIVE ? SOL_DUST : STABLE_DUST;
    return Math.abs(d.uiDelta) > (SOLANA_QUOTES[d.mint.toLowerCase()] ? dust : 0);
  });
  const bought = significant.filter((d) => d.uiDelta > 0);
  const sold = significant.filter((d) => d.uiDelta < 0);
  if (bought.length === 0 || sold.length === 0) return null;

  const quoteSold = sold.find((d) => SOLANA_QUOTES[d.mint.toLowerCase()]);
  const quoteBought = bought.find((d) => SOLANA_QUOTES[d.mint.toLowerCase()]);

  if (quoteSold && !quoteBought) {
    const token = bought.find((d) => !SOLANA_QUOTES[d.mint.toLowerCase()]);
    if (!token) return null;
    return {
      targetTxRef: signature,
      direction: "buy",
      token: token.mint,
      quoteSymbol: SOLANA_QUOTES[quoteSold.mint.toLowerCase()]!.symbol,
      quoteUsd: solQuoteUsd(quoteSold, solPriceUsd),
      blockOrSlot: String(slot),
    };
  }
  if (quoteBought && !quoteSold) {
    const token = sold.find((d) => !SOLANA_QUOTES[d.mint.toLowerCase()]);
    if (!token) return null;
    return {
      targetTxRef: signature,
      direction: "sell",
      token: token.mint,
      quoteSymbol: SOLANA_QUOTES[quoteBought.mint.toLowerCase()]!.symbol,
      quoteUsd: solQuoteUsd(quoteBought, solPriceUsd),
      blockOrSlot: String(slot),
    };
  }
  return null;
}

function solQuoteUsd(delta: SolanaDelta, solPriceUsd: number | null): number | null {
  const abs = Math.abs(delta.uiDelta);
  const quote = SOLANA_QUOTES[delta.mint.toLowerCase()]!;
  if (!quote.native) return abs;
  return solPriceUsd != null ? abs * solPriceUsd : null;
}

// ── live detection (RPC) ─────────────────────────────────────────────────────
export async function detectNewSwaps(params: {
  network: CopyTradeNetwork;
  targetAddress: string;
  lastBlock?: string;
  lastSignature?: string;
}): Promise<WatchResult> {
  if (params.network === "solana:mainnet") return detectSolana(params.targetAddress, params.lastSignature);
  return detectBase(params.targetAddress, params.lastBlock);
}

async function detectBase(targetAddress: string, lastBlock?: string): Promise<WatchResult> {
  const client = basePublicClient();
  const head = await client.getBlockNumber();
  const safeBlock = head > BASE_CONFIRMATIONS ? head - BASE_CONFIRMATIONS : 0n;
  // First run: start from "now" — copy future trades only, never replay history.
  const fromBlock = lastBlock ? BigInt(lastBlock) + 1n : safeBlock;
  if (fromBlock > safeBlock) return { signals: [], cursor: { lastBlock: safeBlock.toString() } };

  const target = targetAddress as `0x${string}`;
  const transfers: EvmTransfer[] = [];
  for (let start = fromBlock; start <= safeBlock; start += MAX_LOG_RANGE + 1n) {
    const end = start + MAX_LOG_RANGE > safeBlock ? safeBlock : start + MAX_LOG_RANGE;
    const [incoming, outgoing] = await Promise.all([
      client.getLogs({ event: TRANSFER_EVENT, args: { to: target }, fromBlock: start, toBlock: end }),
      client.getLogs({ event: TRANSFER_EVENT, args: { from: target }, fromBlock: start, toBlock: end }),
    ]);
    for (const log of [...incoming, ...outgoing]) pushEvmTransfer(transfers, log);
  }

  const nativePrice = transfers.some((t) => BASE_QUOTES[t.token.toLowerCase()]?.native)
    ? await nativeUsdPrice("eip155:8453")
    : null;
  const signals = classifyEvmSwaps(targetAddress, transfers, nativePrice);
  return { signals, cursor: { lastBlock: safeBlock.toString() } };
}

type TransferLog = Log<bigint, number, false, typeof TRANSFER_EVENT>;
function pushEvmTransfer(out: EvmTransfer[], log: TransferLog) {
  const { from, to, value } = log.args;
  if (!from || !to || value === undefined || value <= 0n || !log.transactionHash) return;
  out.push({
    txHash: log.transactionHash,
    blockNumber: (log.blockNumber ?? 0n).toString(),
    token: log.address.toLowerCase(),
    from,
    to,
    valueRaw: value.toString(),
  });
}

async function detectSolana(targetAddress: string, lastSignature?: string): Promise<WatchResult> {
  const connection = new Connection(solanaRpcUrl(), "confirmed");
  const owner = new PublicKey(targetAddress);
  const sigInfos = await connection.getSignaturesForAddress(owner, { until: lastSignature, limit: SOLANA_SIG_LIMIT });
  if (sigInfos.length === 0) return { signals: [], cursor: { lastSignature } };
  const newest = sigInfos[0]!.signature;
  // First run with no cursor: anchor at newest and copy only future trades.
  if (!lastSignature) return { signals: [], cursor: { lastSignature: newest } };

  const solPrice = await nativeUsdPrice("solana:mainnet");
  const signals: CopyTradeSignal[] = [];
  // Oldest → newest so events stay chronological.
  for (const info of [...sigInfos].reverse()) {
    if (info.err) continue;
    try {
      const tx = await connection.getParsedTransaction(info.signature, { maxSupportedTransactionVersion: 0 });
      if (!tx?.meta) continue;
      const deltas = solanaDeltasForOwner(tx, targetAddress);
      const signal = classifySolanaSwap(info.signature, info.slot, deltas, solPrice);
      if (signal) signals.push(signal);
    } catch {
      // skip un-fetchable tx; cursor still advances so we don't loop on it
    }
  }
  return { signals, cursor: { lastSignature: newest } };
}

type ParsedTx = Awaited<ReturnType<Connection["getParsedTransaction"]>>;
function solanaDeltasForOwner(tx: NonNullable<ParsedTx>, owner: string): SolanaDelta[] {
  const meta = tx.meta!;
  const deltas: SolanaDelta[] = [];

  // Native SOL delta at the owner's account index.
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey.toString()));
  const ownerIdx = keys.findIndex((k) => k === owner);
  if (ownerIdx >= 0 && meta.preBalances[ownerIdx] != null && meta.postBalances[ownerIdx] != null) {
    const lamports = meta.postBalances[ownerIdx]! - meta.preBalances[ownerIdx]!;
    if (lamports !== 0) deltas.push({ mint: SOLANA_NATIVE, uiDelta: lamports / 1e9 });
  }

  // SPL token deltas owned by the target (post - pre, matched by mint).
  const pre = (meta.preTokenBalances ?? []).filter((b) => b.owner === owner);
  const post = (meta.postTokenBalances ?? []).filter((b) => b.owner === owner);
  const mints = new Set([...pre, ...post].map((b) => b.mint));
  for (const mint of mints) {
    const before = pre.find((b) => b.mint === mint)?.uiTokenAmount.uiAmount ?? 0;
    const after = post.find((b) => b.mint === mint)?.uiTokenAmount.uiAmount ?? 0;
    const ui = (after ?? 0) - (before ?? 0);
    if (ui !== 0) deltas.push({ mint, uiDelta: ui });
  }
  return deltas;
}
