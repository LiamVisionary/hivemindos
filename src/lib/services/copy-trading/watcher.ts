import "server-only";

/* Target-wallet swap detection for copy-trading — the one genuinely new
   subsystem (the app has no tx-history reader). Two layers on Base so no real
   trade shape is invisible:

   1. ERC-20-quote swaps (classifyEvmSwaps, pure): an IN+OUT token pair in one tx
      where exactly one side is a "quote" ERC-20 (USDC/USDT/WETH):
        out = quote, in = token  → BUY;  in = quote, out = token → SELL.

   2. The shapes a log-only view can't see (classifyEnrichedEvmSwap, pure + a
      per-tx RPC enrichment pass in detectEnrichedBaseSwaps):
        • native-ETH buy  — paid ETH (tx.value) for a token, no WETH leg;
        • native-ETH sell — token routed into a pool and unwrapped to ETH (no
                            quote leg comes back to the wallet);
        • token↔token     — hub-token rotation (e.g. launchpad pairs). The
                            deeper-liquidity leg is the pseudo-quote, so rotating
                            INTO the thin leg = BUY, back to the hub = SELL.

   Plain transfers/airdrops (a single leg to/from an EOA, no ETH paid) and
   quote↔quote stable swaps still never signal. Solana (classifySolanaSwap) reads
   native-SOL + SPL deltas directly, so it already sees SOL-quoted swaps. The
   classify* functions are pure for fixture unit-tests; detectNewSwaps wires them
   to viem (Base) and @solana/web3.js (Solana). */

import { createPublicClient, fallback, http, parseAbiItem, type Log } from "viem";
import { base } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";
import type { CopyTradeNetwork, CopyTradeSignal } from "@/lib/types/copy-trading";
import { nativeUsdPrice, tokenLiquidityUsd } from "./market";

export type { CopyTradeSignal } from "@/lib/types/copy-trading";

export type WatchResult = {
  signals: CopyTradeSignal[];
  cursor: { lastBlock?: string; lastSignature?: string };
};

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const MAX_LOG_RANGE = 2_000n; // public Base RPC rejects wide getLogs ranges
const BASE_CONFIRMATIONS = 2n;
// Deepest backfill a poll will scan (~2s Base blocks → ≈11 hours). A cursor
// further behind is stale or poisoned (a bogus RPC head report once rewound
// every cursor to "0" and sent each poll crawling from genesis), and a trade
// that old is too stale to mirror at today's price anyway — re-anchor at "now",
// the same copy-future-trades-only semantics as a first run.
const MAX_CATCHUP_BLOCKS = 20_000n;
const SOLANA_SIG_LIMIT = 50;
// Per-poll ceiling on enrichment RPC lookups (getTransaction/getCode/liquidity).
// Steady-state polls cover a few blocks → a handful of candidates; this only
// bites on a large backfill, where we keep the NEWEST N (recent trades are what
// a copy-trader wants) and let the cursor move past older ones.
const MAX_ENRICH_PER_POLL = 60;

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

// ── enriched Base classification: native-ETH + token↔token ───────────────────
const ETH_QUOTE = "ETH";

/** Per-tx facts the log-only view lacks, gathered by detectEnrichedBaseSwaps. */
export type EnrichedEvmTx = {
  txHash: string;
  blockNumber: string;
  /** Tx initiator address. */
  txFrom: string;
  /** Native ETH sent by the tx (wei, stringified). */
  valueWei: string;
  /** Non-quote token legs received by the target (to === target). */
  insNonQuote: EvmTransfer[];
  /** Non-quote token legs sent by the target (from === target). */
  outsNonQuote: EvmTransfer[];
  /** True when a quote ERC-20 touched the target here → classifyEvmSwaps owns it. */
  hasHardQuote: boolean;
  /** Does the token-out recipient (the pool) have code — swap vs. plain transfer. */
  outRecipientHasCode: boolean;
  /** Deepest-pool USD liquidity of the in/out token (for token↔token direction). */
  inLiquidityUsd: number | null;
  outLiquidityUsd: number | null;
};

/** Classify the swap shapes classifyEvmSwaps can't see (native-ETH, token↔token).
 *  Pure so it can be unit-tested on fixtures; the RPC lookups live in the caller. */
export function classifyEnrichedEvmSwap(
  targetAddress: string,
  tx: EnrichedEvmTx,
  ethPriceUsd: number | null,
): CopyTradeSignal | null {
  if (tx.hasHardQuote) return null; // owned by classifyEvmSwaps (or a quote↔quote no-op)
  const target = targetAddress.toLowerCase();
  const initiated = tx.txFrom.toLowerCase() === target;
  const value = safeBigInt(tx.valueWei);
  const inTokens = distinctTokens(tx.insNonQuote);
  const outTokens = distinctTokens(tx.outsNonQuote);

  // 1) native-ETH BUY: the target paid ETH for exactly one token and sent none.
  //    tx.from === target + tx.value > 0 excludes airdrops (someone else's tx,
  //    zero value) and NFT/plain-transfer noise.
  if (initiated && value > 0n && inTokens.length === 1 && outTokens.length === 0) {
    const human = Number(value) / 1e18;
    const quoteUsd = ethPriceUsd != null && Number.isFinite(human) ? human * ethPriceUsd : null;
    return enrichedSignal(tx, "buy", inTokens[0]!, ETH_QUOTE, quoteUsd);
  }

  // 2) token↔token rotation: the deeper-liquidity leg is the pseudo-quote (hub).
  //    Received the hub (deeper) → they exited the thin out-token → SELL.
  //    Spent the hub for the thin token (or liquidity unknown) → BUY the in-token.
  if (inTokens.length >= 1 && outTokens.length >= 1) {
    const inLiq = tx.inLiquidityUsd;
    const outLiq = tx.outLiquidityUsd;
    if (inLiq != null && outLiq != null && inLiq > outLiq) {
      return enrichedSignal(tx, "sell", outTokens[0]!, "TOKEN", null);
    }
    return enrichedSignal(tx, "buy", inTokens[0]!, "TOKEN", null);
  }

  // 3) native-ETH SELL: the target routed exactly one token into a pool (a
  //    contract) and nothing came back as a token/quote leg (ETH was unwrapped
  //    to it internally). Recipient-has-code separates a swap from a plain
  //    transfer to a friend's EOA. Size comes from the copied position, not here.
  if (initiated && outTokens.length === 1 && inTokens.length === 0 && tx.outRecipientHasCode) {
    return enrichedSignal(tx, "sell", outTokens[0]!, ETH_QUOTE, null);
  }

  return null;
}

function enrichedSignal(
  tx: EnrichedEvmTx,
  direction: "buy" | "sell",
  token: string,
  quoteSymbol: string,
  quoteUsd: number | null,
): CopyTradeSignal {
  return { targetTxRef: tx.txHash, direction, token: token.toLowerCase(), quoteSymbol, quoteUsd, blockOrSlot: tx.blockNumber };
}

function distinctTokens(legs: EvmTransfer[]): string[] {
  return Array.from(new Set(legs.map((l) => l.token.toLowerCase())));
}

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
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

/** What a Base poll should do given the stored cursor and the reported head.
 *  Pure for unit tests. The cursor must NEVER move backward: one bad head
 *  report must not rewind it and restart history (that exact failure poisoned
 *  every cursor to "0" on 2026-07-16 and turned each poll into a rate-limited
 *  genesis crawl). */
export type BaseScanWindow =
  | { kind: "bogus-head" } // untrustworthy head — keep the cursor, try next poll
  | { kind: "anchor"; lastBlock: string } // nothing to scan — set the cursor here
  | { kind: "scan"; fromBlock: bigint; safeBlock: bigint };

export function resolveBaseScanWindow(lastBlock: string | undefined, head: bigint): BaseScanWindow {
  if (head <= BASE_CONFIRMATIONS) return { kind: "bogus-head" };
  const safeBlock = head - BASE_CONFIRMATIONS;
  const prev = parseBlockCursor(lastBlock);
  // First run (or an unreadable cursor): start from "now" — copy future trades
  // only, never replay history.
  if (prev == null) return { kind: "scan", fromBlock: safeBlock, safeBlock };
  if (prev > safeBlock) return { kind: "bogus-head" }; // head behind our own cursor
  if (prev === safeBlock) return { kind: "anchor", lastBlock: safeBlock.toString() };
  const fromBlock = prev + 1n;
  if (safeBlock - fromBlock > MAX_CATCHUP_BLOCKS) return { kind: "anchor", lastBlock: safeBlock.toString() };
  return { kind: "scan", fromBlock, safeBlock };
}

function parseBlockCursor(lastBlock: string | undefined): bigint | null {
  if (!lastBlock) return null;
  try {
    return BigInt(lastBlock);
  } catch {
    return null;
  }
}

async function detectBase(targetAddress: string, lastBlock?: string): Promise<WatchResult> {
  const client = basePublicClient();
  const head = await client.getBlockNumber();
  const window = resolveBaseScanWindow(lastBlock, head);
  if (window.kind === "bogus-head") return { signals: [], cursor: { lastBlock } };
  if (window.kind === "anchor") return { signals: [], cursor: { lastBlock: window.lastBlock } };
  const { fromBlock, safeBlock } = window;

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

  // ETH price backs both WETH quote legs and native-ETH buys (best-effort, cached).
  const nativePrice = transfers.length ? await nativeUsdPrice("eip155:8453") : null;
  const quoteSignals = classifyEvmSwaps(targetAddress, transfers, nativePrice);
  const handled = new Set(quoteSignals.map((s) => s.targetTxRef));
  const enriched = await detectEnrichedBaseSwaps(client, targetAddress, transfers, handled, nativePrice);

  // One signal per target tx, oldest-first so the engine's cooldown stays ordered.
  const signals = dedupeByTxRef([...quoteSignals, ...enriched]).sort(
    (a, b) => Number(a.blockOrSlot) - Number(b.blockOrSlot),
  );
  return { signals, cursor: { lastBlock: safeBlock.toString() } };
}

function dedupeByTxRef(signals: CopyTradeSignal[]): CopyTradeSignal[] {
  const seen = new Set<string>();
  const out: CopyTradeSignal[] = [];
  for (const s of signals) {
    if (seen.has(s.targetTxRef)) continue;
    seen.add(s.targetTxRef);
    out.push(s);
  }
  return out;
}

/** Enrich the txs classifyEvmSwaps couldn't classify (no quote leg) with per-tx
 *  RPC facts, then run the pure native-ETH / token↔token classifier over them. */
async function detectEnrichedBaseSwaps(
  client: ReturnType<typeof basePublicClient>,
  targetAddress: string,
  transfers: EvmTransfer[],
  handled: Set<string>,
  ethPrice: number | null,
): Promise<CopyTradeSignal[]> {
  const target = targetAddress.toLowerCase();
  const byTx = new Map<string, EvmTransfer[]>();
  for (const t of transfers) {
    if (handled.has(t.txHash)) continue;
    const list = byTx.get(t.txHash) ?? [];
    list.push(t);
    byTx.set(t.txHash, list);
  }

  type Candidate = { txHash: string; blockNumber: string; ins: EvmTransfer[]; outs: EvmTransfer[] };
  const candidates: Candidate[] = [];
  for (const [txHash, legs] of byTx) {
    const hasHardQuote = legs.some(
      (l) => BASE_QUOTES[l.token.toLowerCase()] && (l.from.toLowerCase() === target || l.to.toLowerCase() === target),
    );
    if (hasHardQuote) continue; // classifyEvmSwaps owns it (or it's a quote↔quote no-op)
    const ins = legs.filter((l) => l.to.toLowerCase() === target && !BASE_QUOTES[l.token.toLowerCase()]);
    const outs = legs.filter((l) => l.from.toLowerCase() === target && !BASE_QUOTES[l.token.toLowerCase()]);
    if (ins.length === 0 && outs.length === 0) continue;
    candidates.push({ txHash, blockNumber: legs[0]?.blockNumber ?? "0", ins, outs });
  }

  candidates.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));
  const budget = candidates.length > MAX_ENRICH_PER_POLL ? candidates.slice(-MAX_ENRICH_PER_POLL) : candidates;

  const signals: CopyTradeSignal[] = [];
  for (const c of budget) {
    let meta: Awaited<ReturnType<typeof client.getTransaction>>;
    try {
      meta = await client.getTransaction({ hash: c.txHash as `0x${string}` });
    } catch {
      continue; // can't enrich this tx this round; leave it unsignaled
    }
    const bothSides = c.ins.length >= 1 && c.outs.length >= 1;
    const sellShape = c.ins.length === 0 && c.outs.length === 1;
    let outRecipientHasCode = false;
    let inLiquidityUsd: number | null = null;
    let outLiquidityUsd: number | null = null;
    if (sellShape) {
      outRecipientHasCode = await addressHasCode(client, c.outs[0]!.to);
    } else if (bothSides) {
      [inLiquidityUsd, outLiquidityUsd] = await Promise.all([
        tokenLiquidityUsd("eip155:8453", c.ins[0]!.token),
        tokenLiquidityUsd("eip155:8453", c.outs[0]!.token),
      ]);
    }
    const sig = classifyEnrichedEvmSwap(
      targetAddress,
      {
        txHash: c.txHash,
        blockNumber: c.blockNumber,
        txFrom: (meta.from ?? "").toLowerCase(),
        valueWei: (meta.value ?? 0n).toString(),
        insNonQuote: c.ins,
        outsNonQuote: c.outs,
        hasHardQuote: false,
        outRecipientHasCode,
        inLiquidityUsd,
        outLiquidityUsd,
      },
      ethPrice,
    );
    if (sig) signals.push(sig);
  }
  return signals;
}

// Contract-code lookups are stable per address (pools/routers repeat) → cache them.
const codeCache = new Map<string, boolean>();
async function addressHasCode(client: ReturnType<typeof basePublicClient>, address: string): Promise<boolean> {
  const key = address.toLowerCase();
  const cached = codeCache.get(key);
  if (cached !== undefined) return cached;
  let has = false;
  try {
    const code = await client.getCode({ address: address as `0x${string}` });
    has = Boolean(code && code !== "0x");
  } catch {
    has = false;
  }
  if (codeCache.size > 5_000) codeCache.clear();
  codeCache.set(key, has);
  return has;
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
