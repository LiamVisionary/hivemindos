#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { register } from "node:module";

// The watcher statically imports @/-aliased + server-only modules; register the
// repo's TS-relative loader (which shims "server-only") before importing it.
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { classifyEvmSwaps, classifyEnrichedEvmSwap, classifySolanaSwap, resolveBaseScanWindow } = await import("../src/lib/services/copy-trading/watcher.ts");
const { tokenMarket } = await import("../src/lib/services/copy-trading/market.ts");
const { selectBuyFunding, fundingAssetsFromBalance, fundableSummary } = await import("../src/lib/services/copy-trading/funding.ts");
const { emptyRuntimeState, normalizeConfig } = await import("../src/lib/services/copy-trading/store.ts");
const { emptyPaperLedger, applyPaperBuy, applyPaperSell, paperPositionValue, paperEquityUsd, paperPortfolioSummary } = await import("../src/lib/services/copy-trading/paper.ts");
const { compareCopyTradeEvolution, evaluateEvolutionPromotion, startAgentAnalysisState } = await import("../src/lib/services/copy-trading/evolution.ts");
const { buildAgentAnalysisRequest, parseReviewPayload, readOAuthAgentAnalysisResponse } = await import("../src/lib/services/copy-trading/agent-analysis.ts");
const { calibrateAgentDecision } = await import("../src/lib/services/copy-trading/calibration.ts");
const {
  createCounterfactualRecord,
  dueCounterfactualHorizons,
  markCounterfactualLotsClosed,
  markMissedCounterfactualHorizons,
  observeCounterfactualHorizon,
  observeCounterfactualTargetExit,
} = await import("../src/lib/services/copy-trading/counterfactual.ts");
const { summarizeCounterfactualLearning } = await import("../src/lib/services/copy-trading/retrospective.ts");
const {
  copyTradeRetrospectiveMemory,
  syncCopyTradeRetrospectivesToBrain,
} = await import("../src/lib/services/copy-trading/brain-sync.ts");
const {
  evolveAgentMemory,
  listAgentMemoryRecords,
  rememberAgentMemory,
} = await import("../src/lib/services/obsidian/agent-memory.ts");
const { copyTradeSignalClockMs, isCopyTradeSignalCooldownActive } = await import("../src/lib/services/copy-trading/signal-clock.ts");
const { estimateCopyTradeExecutionCost } = await import("../src/lib/services/copy-trading/execution-costs.ts");
const { buildWalletIntelligence, evaluatePostFillRisk, normalizeGoPlusSecurity } = await import("../src/lib/services/copy-trading/risk-intelligence.ts");
const {
  defaultCopyTradingConfig,
  COPY_TRADE_EVALUATION_BATCH_SIZE,
  COPY_TRADE_EVOLUTION_MODEL,
  COPY_TRADE_EVOLUTION_POLICY_VERSION,
  COPY_TRADE_PROMOTION_MIN_MATURED,
  MAX_COPY_TRADE_USD,
} = await import("../src/lib/types/copy-trading.ts");

const TARGET = "0x1111111111111111111111111111111111111111";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";
const TOKEN = "0xabcabcabcabcabcabcabcabcabcabcabcabcabc0";
const other = "0x2222222222222222222222222222222222222222";

test("paper UI leads with portfolio value and keeps live-wallet funding in details", async () => {
  const panelSource = await readFile(new URL("../src/components/trade/CopyTradingPanel.tsx", import.meta.url), "utf8");
  assert.match(panelSource, /No real money used/);
  assert.match(panelSource, /Portfolio value/);
  assert.match(panelSource, /Profit · \{fmtSignedPercent\(summary\.returnPct\)\}/);
  assert.match(panelSource, /Open positions/);
  assert.match(panelSource, /simulated trades/);
  assert.match(panelSource, /props\.fundable && !config\.dryRun/);
  assert.match(panelSource, /Live wallet · not used in this simulation/);
});

test("zero-review evolved cards place the waiting status below learning evidence", async () => {
  const panelSource = await readFile(new URL("../src/components/trade/CopyTradingPanel.tsx", import.meta.url), "utf8");
  assert.match(panelSource, /comparison != null && comparison\.reviews === 0/);
  assert.match(panelSource, /Agent waiting for next new buy/);
  assert.match(panelSource, /Inherited portfolio baseline/);
  assert.match(panelSource, /Inherited profit ·/);
  assert.match(panelSource, /simulated trades inherited from original/);
  const overviewSource = panelSource.slice(
    panelSource.indexOf("function PaperPortfolioOverview"),
    panelSource.indexOf("function EvolutionComparison"),
  );
  assert.ok(
    overviewSource.indexOf("Agent waiting for next new buy")
      > overviewSource.indexOf("<EvolutionComparison comparison={comparison} />"),
    "waiting status should render below the learning evidence row",
  );
});

function transfer(txHash, token, from, to, valueRaw) {
  return { txHash, blockNumber: "100", token, from, to, valueRaw };
}

test("market: GeckoTerminal prices a token when DexScreener has no indexed pair", async () => {
  const token = "0xadf9e8b63a82e27c60aefaa19d1bc3ef425bb445";
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("api.dexscreener.com")) {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("api.geckoterminal.com")) {
      return Response.json({
        data: {
          attributes: {
            address: token,
            symbol: "LAGO",
            price_usd: "0.000003674718793",
            fdv_usd: "3674.7187927932",
            market_cap_usd: null,
            total_reserve_in_usd: "2878.641757644555",
            volume_usd: { h24: "370.8182758729" },
          },
        },
      });
    }
    throw new Error(`Unexpected market URL: ${url}`);
  };

  try {
    const market = await tokenMarket("eip155:8453", token);
    assert.equal(market.priceUsd, 0.000003674718793);
    assert.equal(market.symbol, "LAGO");
    assert.equal(market.liquidityUsd, 2878.641757644555);
    assert.equal(market.volume24hUsd, 370.8182758729);
    assert.equal(market.fdvUsd, 3674.7187927932);
    assert.equal(market.marketCapUsd, null);
    assert.equal(market.source, "geckoterminal");
    assert.deepEqual(requested, [
      `https://api.dexscreener.com/token-pairs/v1/base/${token}`,
      `https://api.geckoterminal.com/api/v2/networks/base/tokens/${token}`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("market: an unpriced result expires quickly so a newly available quote is retried", async () => {
  const token = "0xadf9e8b63a82e27c60aefaa19d1bc3ef425bb446";
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = 1_000;
  let priceAvailable = false;
  let geckoRequests = 0;
  Date.now = () => now;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("api.dexscreener.com")) return Response.json([]);
    geckoRequests += 1;
    return Response.json(priceAvailable
      ? { data: { attributes: { address: token, symbol: "LATER", price_usd: "0.25" } } }
      : { data: null });
  };

  try {
    assert.equal((await tokenMarket("eip155:8453", token)).priceUsd, null);
    priceAvailable = true;
    now += 5_001;
    assert.equal((await tokenMarket("eip155:8453", token)).priceUsd, 0.25);
    assert.equal(geckoRequests, 2);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

test("pending signals: a retryable price miss stays durable and unconsumed until success", async () => {
  const {
    completePendingSignal,
    duePendingSignals,
    queuePendingSignal,
  } = await import("../src/lib/services/copy-trading/pending-signals.ts");
  const state = emptyRuntimeState("config-1");
  const signal = {
    targetTxRef: "0xprice-later",
    direction: "buy",
    token: TOKEN,
    quoteSymbol: "TOKEN",
    quoteUsd: null,
    blockOrSlot: "100",
  };

  const first = queuePendingSignal(state, signal, "market price unavailable", 1_000);
  assert.equal(first.attempts, 1);
  assert.equal(first.nextAttemptAt, 6_000);
  assert.deepEqual(state.consumedTxRefs, []);
  assert.deepEqual(duePendingSignals(state, 5_999), []);
  assert.equal(duePendingSignals(state, 6_000)[0]?.targetTxRef, signal.targetTxRef);

  const second = queuePendingSignal(state, signal, "market price unavailable", 6_000);
  assert.equal(second.attempts, 2);
  assert.equal(second.nextAttemptAt, 16_000);
  assert.equal(state.pendingSignals?.length, 1);

  completePendingSignal(state, signal.targetTxRef);
  assert.deepEqual(state.pendingSignals, []);
  assert.deepEqual(state.consumedTxRefs, [signal.targetTxRef]);
});

// ── Base / EVM classification ────────────────────────────────────────────────
test("EVM: USDC out + token in (same tx) → BUY with USD quote", () => {
  const transfers = [
    transfer("0xaa", USDC, TARGET, other, "10000000"), // 10 USDC out
    transfer("0xaa", TOKEN, other, TARGET, "5000000000000000000"), // token in
  ];
  const [sig] = classifyEvmSwaps(TARGET, transfers, null);
  assert.equal(sig.direction, "buy");
  assert.equal(sig.token, TOKEN);
  assert.equal(sig.quoteSymbol, "USDC");
  assert.equal(sig.quoteUsd, 10);
});

test("EVM: token out + USDC in → SELL", () => {
  const transfers = [
    transfer("0xbb", TOKEN, TARGET, other, "5000000000000000000"),
    transfer("0xbb", USDC, other, TARGET, "12000000"), // 12 USDC in
  ];
  const [sig] = classifyEvmSwaps(TARGET, transfers, null);
  assert.equal(sig.direction, "sell");
  assert.equal(sig.token, TOKEN);
  assert.equal(sig.quoteUsd, 12);
});

test("EVM: WETH quote priced via nativePrice", () => {
  const transfers = [
    transfer("0xcc", WETH, TARGET, other, "1000000000000000000"), // 1 WETH out
    transfer("0xcc", TOKEN, other, TARGET, "9000000000000000000"),
  ];
  const [sig] = classifyEvmSwaps(TARGET, transfers, 3000);
  assert.equal(sig.direction, "buy");
  assert.equal(sig.quoteUsd, 3000);
});

test("EVM: plain inbound transfer (no out leg) → no signal", () => {
  const transfers = [transfer("0xdd", TOKEN, other, TARGET, "5000000000000000000")];
  assert.deepEqual(classifyEvmSwaps(TARGET, transfers, null), []);
});

test("EVM: quote↔quote (USDC out, WETH in) → no signal", () => {
  const transfers = [
    transfer("0xee", USDC, TARGET, other, "10000000"),
    transfer("0xee", WETH, other, TARGET, "3000000000000000"),
  ];
  assert.deepEqual(classifyEvmSwaps(TARGET, transfers, 3000), []);
});

// ── Base scan window (cursor safety) ─────────────────────────────────────────
// One bogus eth_blockNumber response must never rewind the cursor: on
// 2026-07-16 a head≈0 report reset every config's cursor to "0" and turned each
// poll into a rate-limited genesis crawl for ten days.
const HEAD = 33_000_000n;

test("scan window: normal advance scans from cursor+1 to head-confirmations", () => {
  const w = resolveBaseScanWindow((HEAD - 10n).toString(), HEAD);
  assert.deepEqual(w, { kind: "scan", fromBlock: HEAD - 9n, safeBlock: HEAD - 2n });
});

test("scan window: first run (no cursor) anchors at now and scans only the head block", () => {
  const w = resolveBaseScanWindow(undefined, HEAD);
  assert.deepEqual(w, { kind: "scan", fromBlock: HEAD - 2n, safeBlock: HEAD - 2n });
});

test("scan window: head 0 (bogus RPC response) keeps the cursor untouched", () => {
  assert.deepEqual(resolveBaseScanWindow("123456", 0n), { kind: "bogus-head" });
  assert.deepEqual(resolveBaseScanWindow(undefined, 0n), { kind: "bogus-head" });
});

test("scan window: head behind our own cursor keeps the cursor untouched", () => {
  assert.deepEqual(resolveBaseScanWindow(HEAD.toString(), HEAD - 100n), { kind: "bogus-head" });
});

test("scan window: cursor at safe head → anchor in place, nothing to scan", () => {
  const w = resolveBaseScanWindow((HEAD - 2n).toString(), HEAD);
  assert.deepEqual(w, { kind: "anchor", lastBlock: (HEAD - 2n).toString() });
});

test("scan window: poisoned \"0\" cursor re-anchors at now instead of crawling from genesis", () => {
  const w = resolveBaseScanWindow("0", HEAD);
  assert.deepEqual(w, { kind: "anchor", lastBlock: (HEAD - 2n).toString() });
});

test("scan window: catch-up cap — within cap scans, beyond cap re-anchors at now", () => {
  const cap = 20_000n;
  const atCap = resolveBaseScanWindow((HEAD - 2n - cap - 1n).toString(), HEAD);
  assert.deepEqual(atCap, { kind: "scan", fromBlock: HEAD - 2n - cap, safeBlock: HEAD - 2n });
  const beyondCap = resolveBaseScanWindow((HEAD - 2n - cap - 2n).toString(), HEAD);
  assert.deepEqual(beyondCap, { kind: "anchor", lastBlock: (HEAD - 2n).toString() });
});

test("scan window: unreadable cursor falls back to first-run semantics", () => {
  const w = resolveBaseScanWindow("not-a-number", HEAD);
  assert.deepEqual(w, { kind: "scan", fromBlock: HEAD - 2n, safeBlock: HEAD - 2n });
});

// ── enriched Base classification (native-ETH + token↔token) ──────────────────
const TOKEN2 = "0xdefdefdefdefdefdefdefdefdefdefdefdefdef0";
const pool = "0x3333333333333333333333333333333333333333";

function enrichedTx(overrides = {}) {
  return {
    txHash: "0xef",
    blockNumber: "200",
    txFrom: TARGET,
    valueWei: "0",
    insNonQuote: [],
    outsNonQuote: [],
    hasHardQuote: false,
    outRecipientHasCode: false,
    inLiquidityUsd: null,
    outLiquidityUsd: null,
    ...overrides,
  };
}

test("enriched: native-ETH buy (paid ETH, one token in) → BUY priced in USD", () => {
  const sig = classifyEnrichedEvmSwap(TARGET, enrichedTx({
    txFrom: TARGET,
    valueWei: "1000000000000000000", // 1 ETH
    insNonQuote: [transfer("0xef", TOKEN, pool, TARGET, "5000000000000000000")],
  }), 3000);
  assert.ok(sig);
  assert.equal(sig.direction, "buy");
  assert.equal(sig.token, TOKEN);
  assert.equal(sig.quoteSymbol, "ETH");
  assert.equal(sig.quoteUsd, 3000);
});

test("enriched: native-ETH buy with no price → BUY, quoteUsd null (sizes at fixedUsd)", () => {
  const sig = classifyEnrichedEvmSwap(TARGET, enrichedTx({
    valueWei: "500000000000000000",
    insNonQuote: [transfer("0xef", TOKEN, pool, TARGET, "1")],
  }), null);
  assert.ok(sig);
  assert.equal(sig.direction, "buy");
  assert.equal(sig.quoteUsd, null);
});

test("enriched: token IN but tx initiated by someone else (airdrop) → no signal", () => {
  const sig = classifyEnrichedEvmSwap(TARGET, enrichedTx({
    txFrom: other, // distributor, not the target
    valueWei: "0",
    insNonQuote: [transfer("0xef", TOKEN, other, TARGET, "5000000000000000000")],
  }), 3000);
  assert.equal(sig, null);
});

test("enriched: token↔token, spent the deeper hub for the thin token → BUY the in-token", () => {
  const sig = classifyEnrichedEvmSwap(TARGET, enrichedTx({
    insNonQuote: [transfer("0xef", TOKEN, pool, TARGET, "9")], // thin token bought
    outsNonQuote: [transfer("0xef", TOKEN2, TARGET, pool, "7")], // hub token spent
    inLiquidityUsd: 20_000, // thin
    outLiquidityUsd: 500_000, // hub (deeper) sold
  }), null);
  assert.ok(sig);
  assert.equal(sig.direction, "buy");
  assert.equal(sig.token, TOKEN);
  assert.equal(sig.quoteUsd, null);
});

test("enriched: token↔token, received the deeper hub → SELL the thin out-token", () => {
  const sig = classifyEnrichedEvmSwap(TARGET, enrichedTx({
    insNonQuote: [transfer("0xef", TOKEN2, pool, TARGET, "7")], // hub received
    outsNonQuote: [transfer("0xef", TOKEN, TARGET, pool, "9")], // thin token exited
    inLiquidityUsd: 500_000, // hub (deeper) received
    outLiquidityUsd: 20_000, // thin
  }), null);
  assert.ok(sig);
  assert.equal(sig.direction, "sell");
  assert.equal(sig.token, TOKEN);
});

test("enriched: native-ETH sell (token → pool contract, nothing back) → SELL", () => {
  const sig = classifyEnrichedEvmSwap(TARGET, enrichedTx({
    outsNonQuote: [transfer("0xef", TOKEN, TARGET, pool, "5000000000000000000")],
    outRecipientHasCode: true, // recipient is a pool, not an EOA
  }), 3000);
  assert.ok(sig);
  assert.equal(sig.direction, "sell");
  assert.equal(sig.token, TOKEN);
  assert.equal(sig.quoteSymbol, "ETH");
});

test("enriched: token sent to an EOA (no code) → plain transfer, no signal", () => {
  const sig = classifyEnrichedEvmSwap(TARGET, enrichedTx({
    outsNonQuote: [transfer("0xef", TOKEN, TARGET, other, "5000000000000000000")],
    outRecipientHasCode: false,
  }), 3000);
  assert.equal(sig, null);
});

test("enriched: a hard-quote leg present → deferred to classifyEvmSwaps (null here)", () => {
  const sig = classifyEnrichedEvmSwap(TARGET, enrichedTx({
    valueWei: "1000000000000000000",
    insNonQuote: [transfer("0xef", TOKEN, pool, TARGET, "9")],
    hasHardQuote: true,
  }), 3000);
  assert.equal(sig, null);
});

// ── Solana classification ─────────────────────────────────────────────────────
const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_TOKEN = "MintMintMintMintMintMintMintMintMintMint11";

test("Solana: USDC down + token up → BUY", () => {
  const sig = classifySolanaSwap("sigA", 5, [
    { mint: SOL_USDC, uiDelta: -10 },
    { mint: SOL_TOKEN, uiDelta: 1000 },
  ], null);
  assert.ok(sig);
  assert.equal(sig.direction, "buy");
  assert.equal(sig.token, SOL_TOKEN);
  assert.equal(sig.quoteUsd, 10);
});

test("Solana: token down + SOL up (priced) → SELL", () => {
  const sig = classifySolanaSwap("sigB", 6, [
    { mint: SOL_TOKEN, uiDelta: -1000 },
    { mint: "native-sol", uiDelta: 0.5 },
  ], 150);
  assert.ok(sig);
  assert.equal(sig.direction, "sell");
  assert.equal(sig.quoteUsd, 75);
});

test("Solana: token received with only a fee-sized SOL delta → no signal", () => {
  const sig = classifySolanaSwap("sigC", 7, [
    { mint: "native-sol", uiDelta: -0.000005 }, // below SOL dust → ignored
    { mint: SOL_TOKEN, uiDelta: 1000 },
  ], 150);
  assert.equal(sig, null);
});

// ── buy funding selection (USDC/USDT first, then native ETH/SOL) ──────────────
test("funding: prefers USDC when it covers the buy", () => {
  const f = selectBuyFunding("eip155:8453", 5, [
    { symbol: "USDC", availableUsd: 20, isStable: true, priceUsd: 1 },
    { symbol: "ETH", availableUsd: 100, isStable: false, priceUsd: 3000 },
  ]);
  assert.equal(f.sellToken, "USDC");
  assert.equal(f.amountHuman, 5); // stable ≈ 1:1 USD
});

test("funding: falls back to native ETH when no stable, sized by price", () => {
  const f = selectBuyFunding("eip155:8453", 6, [
    { symbol: "ETH", availableUsd: 30, isStable: false, priceUsd: 3000 },
  ]);
  assert.equal(f.sellToken, "ETH");
  assert.equal(f.amountHuman, 0.002); // 6 / 3000
});

test("funding: Solana falls back to SOL", () => {
  const f = selectBuyFunding("solana:mainnet", 5, [
    { symbol: "SOL", availableUsd: 40, isStable: false, priceUsd: 200 },
  ]);
  assert.equal(f.sellToken, "SOL");
  assert.equal(f.amountHuman, 0.025); // 5 / 200
});

test("funding: sizes down when the best asset can't cover the full buy", () => {
  const f = selectBuyFunding("eip155:8453", 10, [
    { symbol: "USDC", availableUsd: 3.5, isStable: true, priceUsd: 1 },
  ]);
  assert.equal(f.sellToken, "USDC");
  assert.equal(f.amountHuman, 3.5);
  assert.equal(f.estValueUsd, 3.5);
});

test("funding: no spendable balance → null", () => {
  assert.equal(selectBuyFunding("eip155:8453", 5, []), null);
  assert.equal(selectBuyFunding("eip155:8453", 5, [{ symbol: "ETH", availableUsd: 0, isStable: false, priceUsd: 3000 }]), null);
});

test("funding: native without a price can't be sized → null", () => {
  assert.equal(selectBuyFunding("eip155:8453", 5, [{ symbol: "ETH", availableUsd: 30, isStable: false, priceUsd: null }]), null);
});

test("funding: fundingAssetsFromBalance applies a native gas reserve", () => {
  // 0.0001 ETH * $3000 = $0.30, below the $0.50 Base reserve → native excluded.
  const low = fundingAssetsFromBalance("eip155:8453", { nativeBalance: 0.0001, tokens: [] }, 3000);
  assert.equal(low.find((a) => a.symbol === "ETH"), undefined);
  // 0.01 ETH * $3000 = $30 − $0.50 reserve = $29.50 spendable.
  const ok = fundingAssetsFromBalance("eip155:8453", { nativeBalance: 0.01, tokens: [] }, 3000);
  const eth = ok.find((a) => a.symbol === "ETH");
  assert.ok(eth && Math.abs(eth.availableUsd - 29.5) < 1e-6);
});

test("funding: fundableSummary reports raw amounts + total USD", () => {
  const s = fundableSummary("eip155:8453", {
    nativeBalance: 0.01,
    tokens: [{ symbol: "USDC", balance: 10, valueUsd: 10, tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }],
  }, 3000);
  assert.equal(s.assets.length, 2);
  assert.ok(Math.abs(s.totalUsd - 40) < 1e-6); // $30 ETH + $10 USDC
});

// ── config normalization clamps ───────────────────────────────────────────────
test("normalizeConfig clamps maxCopyUsd to the $10 rail cap", () => {
  const base = defaultCopyTradingConfig({ id: "x", agentId: "a", walletAddress: "0xabc", network: "eip155:8453" });
  const normalized = normalizeConfig({ ...base, maxCopyUsd: 500 });
  assert.equal(normalized.maxCopyUsd, MAX_COPY_TRADE_USD);
});

test("normalizeConfig: paperStartUsd defaults null, clamps to >= 0", () => {
  const base = defaultCopyTradingConfig({ id: "x", agentId: "a", walletAddress: "0xabc", network: "eip155:8453" });
  assert.equal(base.paperStartUsd, null);
  assert.equal(normalizeConfig({ ...base, paperStartUsd: undefined }).paperStartUsd, null);
  assert.equal(normalizeConfig({ ...base, paperStartUsd: 250 }).paperStartUsd, 250);
  assert.equal(normalizeConfig({ ...base, paperStartUsd: -50 }).paperStartUsd, 0);
});

test("normalizeConfig preserves a bounded, explicit evolved-config contract", () => {
  const base = defaultCopyTradingConfig({ id: "evolved", agentId: "agent", walletAddress: TARGET, network: "eip155:8453" });
  const normalized = normalizeConfig({
    ...base,
    evolution: {
      sourceConfigId: "source",
      model: COPY_TRADE_EVOLUTION_MODEL,
      reasoningEffort: "medium",
      minCloseConfidence: 99,
      policyVersion: "tampered-policy",
      createdAt: 123,
    },
  });
  assert.deepEqual(normalized.evolution, {
    sourceConfigId: "source",
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    minCloseConfidence: 1,
    policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION,
    createdAt: 123,
  });
});

test("normalizeConfig can preserve source timestamps while cloning", () => {
  const base = defaultCopyTradingConfig({ id: "source", agentId: "agent", walletAddress: TARGET, network: "eip155:8453" });
  base.updatedAt = 123;
  assert.equal(normalizeConfig(base, false).updatedAt, 123);
  assert.ok(normalizeConfig(base).updatedAt > 123);
});

test("agent analysis request uses GPT-5.6 Sol, web search, strict output, and no response storage", () => {
  const config = defaultCopyTradingConfig({ id: "evolved", agentId: "agent", walletAddress: TARGET, network: "eip155:8453" });
  config.targetAddress = other;
  config.evolution = {
    sourceConfigId: "source",
    model: COPY_TRADE_EVOLUTION_MODEL,
    reasoningEffort: "medium",
    minCloseConfidence: 0.7,
    policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION,
    createdAt: 123,
  };
  const request = buildAgentAnalysisRequest({
    config,
    signal: { direction: "buy", token: TOKEN, quoteSymbol: "USDC", quoteUsd: 5, targetTxRef: "0xtarget", at: 123 },
    token: TOKEN,
    symbol: "TOKEN",
    spentUsd: 5,
    market: { priceUsd: 1, liquidityUsd: 50_000, symbol: "TOKEN", priceChange24hPct: 3, volume24hUsd: 20_000, marketCapUsd: 1_000_000, fdvUsd: 1_200_000, pairUrl: "https://dexscreener.com/base/pair", pairCreatedAt: 100, buys24h: 90, sells24h: 40 },
    intelligence: {
      security: { provider: "goplus", coverage: "complete", hardRiskFlags: [], cautionFlags: ["mintable"], holderConcentrationPct: 22, buyTaxPct: 0, sellTaxPct: 0 },
      wallet: { maturedTrades: 20, winRatePct: 60, meanReturnPct: 4, maxDrawdownPct: 8 },
    },
    riskGate: { path: "sol-adjudication", score: 28, reasons: ["Token remains mintable."], hardClose: false },
    calibration: { rawConfidence: 0, calibratedConfidence: 0, closeThreshold: 0.78, sampleSize: 20 },
    recentReviews: [],
  });
  assert.equal(request.model, "gpt-5.6-sol");
  assert.equal(request.reasoning.effort, "medium");
  assert.deepEqual(request.tools, [{ type: "web_search", search_context_size: "medium" }]);
  assert.deepEqual(request.include, ["web_search_call.action.sources"]);
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.deepEqual(request.text.format.schema.properties.decision.enum, ["keep", "close", "uncertain"]);
  assert.match(request.input, /holderConcentrationPct/);
  assert.match(request.input, /closeThreshold/);
  assert.match(request.instructions, /evidence packet/);
});

test("risk intelligence normalizes explicit Base and Solana security failures", () => {
  const base = normalizeGoPlusSecurity("eip155:8453", TOKEN, {
    code: 1,
    result: { [TOKEN]: { is_honeypot: "1", cannot_sell_all: "1", buy_tax: "0.02", sell_tax: "0.15", holders: [{ percent: "0.42" }] } },
  });
  assert.equal(base.coverage, "complete");
  assert.deepEqual(base.hardRiskFlags, ["honeypot", "cannot-sell-all"]);
  assert.equal(base.sellTaxPct, 15);
  assert.equal(base.holderConcentrationPct, 42);

  const mint = "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3";
  const solana = normalizeGoPlusSecurity("solana:mainnet", mint, {
    code: 1,
    result: { [mint]: { closable: { status: "1" }, freezable: { status: "1" }, non_transferable: "1", creators: [{ malicious_address: "1" }], trusted_token: 0 } },
  });
  assert.deepEqual(solana.hardRiskFlags, ["non-transferable", "malicious-creator"]);
  assert.deepEqual(solana.cautionFlags, ["closable-authority", "freeze-authority"]);
});

test("fast post-fill gate closes only on objective hard failures and otherwise sends evidence to Sol", () => {
  const market = { priceUsd: 1, liquidityUsd: 50_000, symbol: "TOKEN", priceChange24hPct: 0, volume24hUsd: 20_000, marketCapUsd: 1_000_000, fdvUsd: 1_000_000, pairUrl: null, pairCreatedAt: Date.now() - 86_400_000, buys24h: 100, sells24h: 80 };
  const hard = evaluatePostFillRisk({ spentUsd: 5, market, security: { provider: "goplus", coverage: "complete", hardRiskFlags: ["honeypot"], cautionFlags: [], holderConcentrationPct: null, buyTaxPct: null, sellTaxPct: null } });
  assert.equal(hard.path, "risk-close");
  assert.equal(hard.hardClose, true);

  const unknown = evaluatePostFillRisk({ spentUsd: 5, market: { ...market, liquidityUsd: null }, security: { provider: "goplus", coverage: "unavailable", hardRiskFlags: [], cautionFlags: [], holderConcentrationPct: null, buyTaxPct: null, sellTaxPct: null } });
  assert.equal(unknown.path, "sol-adjudication");
  assert.equal(unknown.hardClose, false);
  assert.ok(unknown.score > 0);
});

test("wallet intelligence is precomputed from matured cost-aware outcomes", () => {
  const records = [
    promotionRecord(0, 0, 0, { sourceReturnPct: 4 }),
    promotionRecord(1, 0, 0, { sourceReturnPct: -2 }),
    promotionRecord(2, 0, 0, { sourceReturnPct: 8 }),
  ];
  const profile = buildWalletIntelligence(records);
  assert.equal(profile.maturedTrades, 3);
  assert.equal(profile.winRatePct, 66.67);
  assert.equal(profile.meanReturnPct, 3.33);
  assert.ok(profile.maxDrawdownPct > 0);
});

test("wallet intelligence cannot read outcomes from the current frozen batch", () => {
  const prior = promotionRecord(0, 0, 0, { sourceReturnPct: 4 });
  const current = promotionRecord(50, 0, 1, { sourceReturnPct: -90 });
  const profile = buildWalletIntelligence([prior, current], 1);
  assert.equal(profile.maturedTrades, 1);
  assert.equal(profile.meanReturnPct, 4);
});

test("target-chain cooldown is deterministic across model latency", () => {
  const signal = { blockOrSlot: "100" };
  assert.equal(copyTradeSignalClockMs("eip155:8453", signal), 200_000);
  assert.equal(isCopyTradeSignalCooldownActive({
    network: "eip155:8453",
    signal,
    lastActionClockMs: 198_000,
    cooldownMs: 5_000,
  }), true);
  assert.equal(isCopyTradeSignalCooldownActive({
    network: "eip155:8453",
    signal: { blockOrSlot: "103" },
    lastActionClockMs: 198_000,
    cooldownMs: 5_000,
  }), false);
});

test("execution cost model charges fixed network cost, venue/slippage, and liquidity impact", () => {
  const deep = estimateCopyTradeExecutionCost({ network: "eip155:8453", notionalUsd: 5, liquidityUsd: 100_000, maxSlippageBps: 100 });
  const thin = estimateCopyTradeExecutionCost({ network: "eip155:8453", notionalUsd: 5, liquidityUsd: 500, maxSlippageBps: 100 });
  assert.ok(deep.fixedUsd > 0);
  assert.ok(deep.variableBps >= 30);
  assert.ok(thin.priceImpactBps > deep.priceImpactBps);
  assert.ok(thin.totalUsd > deep.totalUsd);
});

test("paper fills deduct modeled buy and sell costs", () => {
  const ledger = emptyPaperLedger(100);
  const buy = applyPaperBuy(ledger, {
    token: TOKEN, symbol: "TOKEN", priceUsd: 1, wantUsd: 10, minCopyUsd: 1, at: 1,
    executionCost: { fixedUsd: 0.1, variableBps: 100 },
  });
  assert.equal(buy.ok, true);
  assert.equal(Number(buy.executionCostUsd.toFixed(2)), 0.2);
  assert.equal(Number(ledger.cashUsd.toFixed(2)), 89.9);
  assert.equal(Number(ledger.positions[TOKEN].amount.toFixed(2)), 9.9);
  const sell = applyPaperSell(ledger, TOKEN, 1, 2, { fixedUsd: 0.1, variableBps: 100 });
  assert.equal(sell.ok, true);
  assert.equal(Number(sell.proceedsUsd.toFixed(3)), 9.701);
  assert.equal(sell.positionCostUsd, 10.1);
  assert.equal(sell.soldAmount, 9.9);
  assert.equal(sell.grossProceedsUsd, 9.9);
  assert.equal(Number(ledger.executionCostsUsd.toFixed(3)), 0.399);
});

test("confidence calibration is conservative when sparse and excludes the current frozen batch", () => {
  const historical = Array.from({ length: 30 }, (_, index) => promotionRecord(index, index < 6 ? 1 : -1, 0, { confidence: 0.9 }));
  const poisonedCurrentBatch = Array.from({ length: 30 }, (_, index) => promotionRecord(100 + index, 10, 1, { confidence: 0.9 }));
  const calibrated = calibrateAgentDecision({
    rawConfidence: 0.9,
    baseThreshold: 0.7,
    riskScore: 20,
    securityCoverage: "complete",
    currentBatch: 1,
    counterfactuals: [...historical, ...poisonedCurrentBatch],
  });
  assert.equal(calibrated.sampleSize, 30);
  assert.ok(calibrated.calibratedConfidence < 0.75);
  assert.ok(calibrated.closeThreshold >= 0.7);

  const sparse = calibrateAgentDecision({ rawConfidence: 0.8, baseThreshold: 0.7, riskScore: 0, securityCoverage: "unavailable", currentBatch: 0, counterfactuals: [] });
  assert.equal(sparse.sampleSize, 0);
  assert.ok(sparse.closeThreshold >= 0.84);
});

test("counterfactual records mature at fixed horizons with both hold and immediate-close paths", () => {
  const record = createCounterfactualRecord({
    sequence: 50,
    policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION,
    targetTxRef: "0xtrade",
    token: TOKEN,
    symbol: "TOKEN",
    entryAt: 1_000,
    entryPriceUsd: 1,
    spentUsd: 10,
    decision: "close",
    confidence: 0.9,
    calibratedConfidence: 0.82,
    closeThreshold: 0.75,
    closePriceUsd: 0.99,
    closeExecuted: true,
    buyCost: { fixedUsd: 0.1, variableBps: 100 },
    sellCost: { fixedUsd: 0.1, variableBps: 100 },
  });
  assert.equal(record.evaluationBatch, 1);
  assert.equal(record.horizons["5m"].dueAt, 301_000);
  const observed = observeCounterfactualHorizon(record, "5m", 0.8, 302_000);
  assert.ok(observed.holdReturnPct < -20);
  assert.ok(observed.closeReturnPct > observed.holdReturnPct);
  assert.equal(observed.evolvedReturnPct, observed.closeReturnPct);
  assert.equal(observed.pairedDeltaPct, observed.evolvedReturnPct - observed.holdReturnPct);
});

test("whole-position closes mark every copied lot and preserve actual per-lot amount", () => {
  const first = createCounterfactualRecord({
    sequence: 0, policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION, targetTxRef: "0xbuy1", token: TOKEN, symbol: "TOKEN",
    entryAt: 1_000, entryPriceUsd: 1, spentUsd: 10, acquiredAmount: 9, decision: "keep", confidence: 0.8,
    calibratedConfidence: 0.8, closeThreshold: 0.7, closeExecuted: false,
    buyCost: { fixedUsd: 0, variableBps: 0 }, sellCost: { fixedUsd: 0, variableBps: 0 },
  });
  const second = createCounterfactualRecord({
    sequence: 1, policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION, targetTxRef: "0xbuy2", token: TOKEN, symbol: "TOKEN",
    entryAt: 2_000, entryPriceUsd: 2, spentUsd: 10, acquiredAmount: 4, decision: "close", confidence: 0.9,
    calibratedConfidence: 0.9, closeThreshold: 0.7, closeExecuted: false,
    buyCost: { fixedUsd: 0, variableBps: 0 }, sellCost: { fixedUsd: 0, variableBps: 0 },
  });
  assert.equal(markCounterfactualLotsClosed([first, second], {
    token: TOKEN, decisionTargetTxRef: "0xbuy2", priceUsd: 1.5, closedAt: 3_000,
  }), 2);
  assert.equal(first.closeDecisionTargetTxRef, "0xbuy2");
  assert.equal(second.closeExecuted, true);
  const observed = observeCounterfactualHorizon(first, "24h", 1, first.horizons["24h"].dueAt);
  assert.equal(observed.closeReturnPct, 35);
});

test("24h and target-exit outcomes create durable notes that only later batches can consume", () => {
  const prior = createCounterfactualRecord({
    sequence: 0, policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION, targetTxRef: "0xprior", token: TOKEN, symbol: "TOKEN",
    entryAt: 1_000, entryPriceUsd: 1, spentUsd: 5, acquiredAmount: 5, decision: "keep", confidence: 0.8,
    calibratedConfidence: 0.8, closeThreshold: 0.7, closeExecuted: false,
    entryContext: { liquidityUsd: 2_000, priceChange24hPct: -20, volume24hUsd: 100, securityCoverage: "partial", riskScore: 55, riskFlags: ["mintable"] },
    buyCost: { fixedUsd: 0, variableBps: 0 }, sellCost: { fixedUsd: 0, variableBps: 0 },
  });
  observeCounterfactualHorizon(prior, "24h", 0.5, prior.horizons["24h"].dueAt);
  observeCounterfactualTargetExit(prior, "0xsell", 0.4, prior.horizons["24h"].dueAt + 1);
  assert.deepEqual(prior.retrospectives.map((note) => note.horizon), ["24h", "target-exit"]);
  assert.equal(prior.retrospectives[0].outcome, "loss-held");
  assert.ok(prior.retrospectives[0].causeTags.includes("low-liquidity"));
  assert.equal(summarizeCounterfactualLearning([prior], 0).total, 0);
  const later = summarizeCounterfactualLearning([prior], 1);
  assert.equal(later.total, 2);
  assert.ok(later.promptLessons.some((lesson) => /prior-batch notes/.test(lesson)));
});

test("copy-trading retrospectives sync locally first and evolve one canonical Shared Brain learning", async () => {
  const config = defaultCopyTradingConfig({ id: "evolved", agentId: "agent", walletAddress: TARGET, network: "eip155:8453" });
  config.targetAddress = other;
  config.evolution = {
    sourceConfigId: "source",
    model: COPY_TRADE_EVOLUTION_MODEL,
    reasoningEffort: "medium",
    minCloseConfidence: 0.7,
    policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION,
    createdAt: 1,
  };
  const state = emptyRuntimeState(config.id);
  state.agentAnalysis = startAgentAnalysisState({ sourceConfigId: "source", sourceState: undefined, evolvedState: state, startedAt: 1 });
  const record = createCounterfactualRecord({
    sequence: 0, policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION, targetTxRef: "0xbrain", token: TOKEN, symbol: "TOKEN",
    entryAt: 1_000, entryPriceUsd: 1, spentUsd: 5, acquiredAmount: 5, decision: "keep", reviewPath: "sol-adjudication",
    confidence: 0.8, calibratedConfidence: 0.75, closeThreshold: 0.7, closeExecuted: false,
    entryContext: {
      liquidityUsd: 2_000, priceChange24hPct: -20, volume24hUsd: 100, securityCoverage: "partial", riskScore: 55,
      riskFlags: ["mintable"], reviewSummary: "Thin liquidity and incomplete security coverage; keep only in paper mode.",
    },
    buyCost: { fixedUsd: 0, variableBps: 0 }, sellCost: { fixedUsd: 0, variableBps: 0 },
  });
  observeCounterfactualHorizon(record, "24h", 0.5, record.horizons["24h"].dueAt);
  state.agentAnalysis.counterfactuals.push(record);
  state.agentAnalysis.reviews.push({
    reviewedAt: 1_000, targetTxRef: record.targetTxRef, token: TOKEN, symbol: "TOKEN", spentUsd: 5,
    model: COPY_TRADE_EVOLUTION_MODEL, decision: "keep", reviewPath: "sol-adjudication", confidence: 0.8,
    calibratedConfidence: 0.75, closeThreshold: 0.7, summary: "Thin liquidity.", risks: ["liquidity"],
    sources: [{ title: "Market source", url: "https://example.com/token" }], researchUsed: true, closeExecuted: false,
  });

  const order = [];
  let remembered = null;
  let evolved = null;
  const dependencies = {
    now: () => 100_000_000,
    persistState: async (nextState) => {
      assert.ok(nextState.agentAnalysis.counterfactuals[0].retrospectives.length >= 1);
      order.push("local");
    },
    remember: async (input) => {
      order.push("brain");
      remembered = input;
      return { record: { id: "mem-copy-1", content: input.content } };
    },
    evolve: async (input) => {
      order.push("evolve");
      evolved = input;
      return { record: { id: "mem-copy-2", content: input.content } };
    },
  };
  const first = await syncCopyTradeRetrospectivesToBrain(config, state, dependencies);
  assert.equal(order[0], "local", "the local retrospective must persist before the external Brain write");
  assert.equal(first.synced, 1);
  assert.equal(remembered.type, "learning");
  assert.match(remembered.content, /24h/);
  assert.match(remembered.content, /Thin liquidity/);
  assert.match(remembered.content, /https:\/\/example\.com\/token/);
  assert.doesNotMatch(remembered.content, new RegExp(TARGET, "i"));
  assert.doesNotMatch(remembered.content, new RegExp(other, "i"));

  order.length = 0;
  const unchanged = await syncCopyTradeRetrospectivesToBrain(config, state, dependencies);
  assert.equal(unchanged.unchanged, 1);
  assert.equal(order.includes("brain"), false);

  observeCounterfactualTargetExit(record, "0xsell", 0.4, record.horizons["24h"].dueAt + 1);
  dependencies.remember = async () => ({
    blocked: true,
    canonicalHeadConflict: { id: "mem-copy-1", content: remembered.content },
  });
  const updated = await syncCopyTradeRetrospectivesToBrain(config, state, dependencies);
  assert.equal(updated.synced, 1);
  assert.equal(evolved.memoryId, "mem-copy-1");
  assert.match(evolved.content, /target-exit/);
  const receipts = Object.values(state.agentAnalysis.brainSync);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].status, "synced");
  assert.equal(receipts[0].memoryId, "mem-copy-2");
});

test("a Shared Brain outage keeps the local retrospective and records a bounded retry", async () => {
  const config = defaultCopyTradingConfig({ id: "evolved-failure", agentId: "agent", walletAddress: TARGET, network: "eip155:8453" });
  config.evolution = {
    sourceConfigId: "source", model: COPY_TRADE_EVOLUTION_MODEL, reasoningEffort: "medium", minCloseConfidence: 0.7,
    policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION, createdAt: 1,
  };
  const state = emptyRuntimeState(config.id);
  state.agentAnalysis = startAgentAnalysisState({ sourceConfigId: "source", sourceState: undefined, evolvedState: state, startedAt: 1 });
  const record = createCounterfactualRecord({
    sequence: 0, policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION, targetTxRef: "0xfailure", token: TOKEN, symbol: "TOKEN",
    entryAt: 1_000, entryPriceUsd: 1, spentUsd: 5, decision: "keep", confidence: 0.8, calibratedConfidence: 0.8,
    closeThreshold: 0.7, closeExecuted: false, buyCost: { fixedUsd: 0, variableBps: 0 }, sellCost: { fixedUsd: 0, variableBps: 0 },
  });
  observeCounterfactualHorizon(record, "24h", 0.5, record.horizons["24h"].dueAt);
  state.agentAnalysis.counterfactuals.push(record);
  let persisted = 0;
  const result = await syncCopyTradeRetrospectivesToBrain(config, state, {
    now: () => 1_000_000,
    persistState: async () => { persisted += 1; },
    remember: async () => { throw new Error("brain offline"); },
    evolve: async () => { throw new Error("unexpected evolve"); },
  });
  assert.equal(result.failed, 1);
  assert.ok(persisted >= 3);
  assert.equal(record.retrospectives.length, 1);
  const receipt = Object.values(state.agentAnalysis.brainSync)[0];
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.error, "brain offline");
  assert.ok(receipt.nextAttemptAt > 1_000_000);
});

test("Shared Brain copy-trading payload is evidence-only and keyed without wallet addresses", () => {
  const config = defaultCopyTradingConfig({ id: "privacy", agentId: "agent", walletAddress: TARGET, network: "eip155:8453" });
  config.targetAddress = other;
  const record = createCounterfactualRecord({
    sequence: 1, policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION, targetTxRef: "0xprivacy", token: TOKEN, symbol: "TOKEN",
    entryAt: 1_000, entryPriceUsd: 1, spentUsd: 5, decision: "uncertain", confidence: 0.5, calibratedConfidence: 0.4,
    closeThreshold: 0.7, closeExecuted: false, buyCost: { fixedUsd: 0, variableBps: 0 }, sellCost: { fixedUsd: 0, variableBps: 0 },
  });
  observeCounterfactualHorizon(record, "24h", 1, record.horizons["24h"].dueAt);
  const memory = copyTradeRetrospectiveMemory(config, record);
  assert.match(memory.memoryKey, /^copy-trading:retrospective:[a-f0-9]{24}$/);
  assert.doesNotMatch(memory.memoryKey, new RegExp(TARGET, "i"));
  assert.doesNotMatch(memory.memoryKey, new RegExp(other, "i"));
  assert.match(memory.input.content, /not an instruction/);
  assert.match(memory.input.content, /does not authorize policy changes or live trading/);
});

test("copy-trading sync writes and evolves one active learning in an isolated real Shared Brain vault", async () => {
  const vaultPath = await mkdtemp(join(tmpdir(), "hivemindos-copy-brain-"));
  try {
    const config = defaultCopyTradingConfig({ id: "isolated", agentId: "agent", walletAddress: TARGET, network: "eip155:8453" });
    config.evolution = {
      sourceConfigId: "source", model: COPY_TRADE_EVOLUTION_MODEL, reasoningEffort: "medium", minCloseConfidence: 0.7,
      policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION, createdAt: 1,
    };
    const state = emptyRuntimeState(config.id);
    state.agentAnalysis = startAgentAnalysisState({ sourceConfigId: "source", sourceState: undefined, evolvedState: state, startedAt: 1 });
    const record = createCounterfactualRecord({
      sequence: 0, policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION, targetTxRef: "0xisolated", token: TOKEN, symbol: "TOKEN",
      entryAt: 1_000, entryPriceUsd: 1, spentUsd: 5, decision: "keep", confidence: 0.8, calibratedConfidence: 0.8,
      closeThreshold: 0.7, closeExecuted: false, buyCost: { fixedUsd: 0, variableBps: 0 }, sellCost: { fixedUsd: 0, variableBps: 0 },
    });
    observeCounterfactualHorizon(record, "24h", 0.8, record.horizons["24h"].dueAt);
    state.agentAnalysis.counterfactuals.push(record);
    const deps = {
      persistState: async () => {},
      remember: (input) => rememberAgentMemory({ ...input, vaultPath, proof: false }),
      evolve: (input) => evolveAgentMemory({ ...input, vaultPath, proof: false }),
    };

    assert.equal((await syncCopyTradeRetrospectivesToBrain(config, state, deps)).synced, 1);
    observeCounterfactualTargetExit(record, "0xisolated-sell", 0.7, record.horizons["24h"].dueAt + 1);
    assert.equal((await syncCopyTradeRetrospectivesToBrain(config, state, deps)).synced, 1);

    const records = (await listAgentMemoryRecords({ vaultPath })).records;
    const active = records.filter((candidate) => candidate.status === "active" && candidate.tags.includes("copy-trading"));
    const superseded = records.filter((candidate) => candidate.status === "superseded" && candidate.tags.includes("copy-trading"));
    assert.equal(active.length, 1);
    assert.equal(superseded.length, 1);
    assert.match(active[0].content, /24h/);
    assert.match(active[0].content, /target-exit/);
    assert.deepEqual(active[0].supersedes, [superseded[0].id]);
  } finally {
    await rm(vaultPath, { recursive: true, force: true });
  }
});

test("retrospective evidence tags do not invert negated risk findings", () => {
  const record = createCounterfactualRecord({
    sequence: 0, policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION, targetTxRef: "0xnegated", token: TOKEN, symbol: "TOKEN",
    entryAt: 1_000, entryPriceUsd: 1, spentUsd: 5, acquiredAmount: 5, decision: "keep", confidence: 0.8,
    calibratedConfidence: 0.8, closeThreshold: 0.7, closeExecuted: false,
    entryContext: {
      liquidityUsd: 100_000, priceChange24hPct: 1, volume24hUsd: 200_000, securityCoverage: "complete", riskScore: 0,
      riskFlags: [], reviewSummary: "No concrete exploit, liquidity failure, or holder concentration was found; liquidity is substantial.",
    },
    buyCost: { fixedUsd: 0, variableBps: 0 }, sellCost: { fixedUsd: 0, variableBps: 0 },
  });
  observeCounterfactualHorizon(record, "24h", 0.9, record.horizons["24h"].dueAt);
  assert.equal(record.retrospectives[0].causeTags.includes("exploit-or-integrity-history"), false);
  assert.equal(record.retrospectives[0].causeTags.includes("thin-market-evidence"), false);
  assert.equal(record.retrospectives[0].causeTags.includes("concentration-or-overhang"), false);
});

test("counterfactuals reject prices captured too late for their named horizon", () => {
  const record = createCounterfactualRecord({
    sequence: 0, policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION, targetTxRef: "0xlate", token: TOKEN, symbol: "TOKEN",
    entryAt: 1_000, entryPriceUsd: 1, spentUsd: 5, decision: "keep", confidence: 0.8, calibratedConfidence: 0.75,
    closeThreshold: 0.7, closeExecuted: false, buyCost: { fixedUsd: 0, variableBps: 0 }, sellCost: { fixedUsd: 0, variableBps: 0 },
  });
  const lateAt = record.horizons["5m"].dueAt + 3 * 60_000 + 1;
  assert.deepEqual(markMissedCounterfactualHorizons(record, lateAt), ["5m"]);
  assert.equal(record.horizons["5m"].missedAt, lateAt);
  assert.deepEqual(dueCounterfactualHorizons(record, lateAt), []);
});

test("promotion requires 200 matured trades, a frozen 50-trade holdout, positive 95% edge, and no worse drawdown", () => {
  const strong = Array.from({ length: COPY_TRADE_PROMOTION_MIN_MATURED }, (_, index) => promotionRecord(index, 4, Math.floor(index / COPY_TRADE_EVALUATION_BATCH_SIZE)));
  const eligible = evaluateEvolutionPromotion(strong, { bootstrapIterations: 2_000 });
  assert.equal(eligible.status, "eligible");
  assert.equal(eligible.holdoutSamples, COPY_TRADE_EVALUATION_BATCH_SIZE);
  assert.ok(eligible.edgeCi95Pct[0] > 0);
  assert.ok(eligible.evolvedMaxDrawdownPct <= eligible.sourceMaxDrawdownPct);

  const tooSmall = evaluateEvolutionPromotion(strong.slice(0, 199), { bootstrapIterations: 500 });
  assert.equal(tooSmall.status, "collecting");

  const risky = strong.map((record, index) => index >= 150
    ? promotionRecord(index, index % 5 === 0 ? -10 : 10, 3, { sourceReturnPct: 0 })
    : record);
  const rejected = evaluateEvolutionPromotion(risky, { bootstrapIterations: 2_000 });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.gates.drawdown, false);
});

test("promotion rejects a strategy that beats the baseline while still losing absolutely", () => {
  const losingLess = Array.from({ length: COPY_TRADE_PROMOTION_MIN_MATURED }, (_, index) => (
    promotionRecord(index, 5, Math.floor(index / COPY_TRADE_EVALUATION_BATCH_SIZE), { sourceReturnPct: -10 })
  ));
  const result = evaluateEvolutionPromotion(losingLess, { bootstrapIterations: 1_000 });
  assert.equal(result.gates.positiveCi, true);
  assert.equal(result.gates.positiveAbsoluteCi, false);
  assert.equal(result.status, "rejected");
});

test("agent analysis parser rejects malformed decisions", () => {
  assert.deepEqual(parseReviewPayload('{"decision":"close","confidence":0.8,"summary":"Material exploit report.","risks":["Exploit"]}'), {
    decision: "close",
    confidence: 0.8,
    summary: "Material exploit report.",
    risks: ["Exploit"],
  });
  assert.throws(() => parseReviewPayload('{"decision":"buy-more","confidence":1,"summary":"No","risks":[]}'), /invalid decision/);
});

test("ChatGPT OAuth review parser retains structured JSON and web sources", async () => {
  const json = '{"decision":"keep","confidence":0.82,"summary":"Evidence supports holding.","risks":[]}';
  const frames = [
    { type: "response.output_item.done", item: { type: "web_search_call", action: { sources: [{ title: "Project", url: "https://example.com/project" }] } } },
    { type: "response.output_text.delta", delta: json },
    { type: "response.completed", response: { id: "resp_oauth", output: [] } },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  const result = await readOAuthAgentAnalysisResponse(new Response(frames, { headers: { "content-type": "text/event-stream" } }));
  assert.equal(result.id, "resp_oauth");
  assert.equal(result.text, json);
  assert.deepEqual(result.sources, [{ title: "Project", url: "https://example.com/project" }]);
});

test("paired evolution comparison measures return after cloning, not lifetime source P&L", () => {
  const source = { configId: "source", consumedTxRefs: [], openPositions: {}, stats: { polls: 0, mirrored: 0, skipped: 0, errors: 0 }, paper: emptyPaperLedger(100), lastError: null, lastPollAt: null, running: true, events: [] };
  const evolved = { configId: "evolved", consumedTxRefs: [], openPositions: {}, stats: { polls: 0, mirrored: 0, skipped: 0, errors: 0 }, paper: emptyPaperLedger(100), lastError: null, lastPollAt: null, running: true, events: [] };
  evolved.agentAnalysis = startAgentAnalysisState({ sourceConfigId: "source", sourceState: source, evolvedState: evolved, startedAt: 1 });
  source.paper.cashUsd = 110;
  evolved.paper.cashUsd = 120;
  evolved.agentAnalysis.reviews.push({
    reviewedAt: 2, targetTxRef: "0x1", token: TOKEN, symbol: "TOKEN", spentUsd: 5,
    model: COPY_TRADE_EVOLUTION_MODEL, decision: "keep", confidence: 0.8, summary: "Keep", risks: [], sources: [], researchUsed: false, closeExecuted: false,
  });
  const comparison = compareCopyTradeEvolution(evolved, source);
  assert.equal(comparison.status, "ready");
  assert.equal(comparison.sourceReturnPct, 10);
  assert.equal(comparison.evolvedReturnPct, 20);
  assert.equal(comparison.returnDeltaPct, 10);
  assert.equal(comparison.kept, 1);
});

test("evolved UI and engine expose the paired review while valuing only config-owned live positions", async () => {
  const [panelSource, engineSource, routeSource] = await Promise.all([
    readFile(new URL("../src/components/trade/CopyTradingPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/services/copy-trading/engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/trading/copy-trade/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(panelSource, /Create agent-analyzed copy/);
  assert.match(panelSource, /Original vs agent-analyzed/);
  assert.match(panelSource, /GPT-5\.6 Sol reviews/);
  assert.match(engineSource, /priceUsd \* position\.amount/);
  assert.doesNotMatch(engineSource, /const valueUsd = held\?\.valueUsd/);
  assert.match(engineSource, /config\.dryRun && source\.paper\?\.initialized/);
  assert.match(engineSource, /positions: Object\.fromEntries/);
  assert.match(routeSource, /case "evolve"/);
});

test("engine wires precomputed evidence through the fast gate, calibrated Sol review, and counterfactual maturation", async () => {
  const engineSource = await readFile(new URL("../src/lib/services/copy-trading/engine.ts", import.meta.url), "utf8");
  assert.match(engineSource, /warmCopyTradeIntelligence/);
  assert.match(engineSource, /evaluatePostFillRisk/);
  assert.match(engineSource, /calibrateAgentDecision/);
  assert.match(engineSource, /createCounterfactualRecord/);
  assert.match(engineSource, /dueCounterfactualHorizons/);
  assert.match(engineSource, /observeCounterfactualHorizon/);
  assert.match(engineSource, /queueRetrospectiveBrainSync/);
  assert.match(engineSource, /syncCopyTradeRetrospectivesToBrain/);
});

test("engine persists retryable price misses without consuming the target transaction", async () => {
  const [engineSource, storeSource] = await Promise.all([
    readFile(new URL("../src/lib/services/copy-trading/engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/services/copy-trading/store.ts", import.meta.url), "utf8"),
  ]);
  const handleSignalSource = engineSource.slice(
    engineSource.indexOf("async function handleSignal"),
    engineSource.indexOf("async function handleBuy"),
  );
  assert.doesNotMatch(handleSignalSource, /consumedTxRefs\.push/);
  assert.match(engineSource, /duePendingSignals\(state,/);
  assert.match(engineSource, /queuePendingSignal\(state, signal,/);
  assert.match(engineSource, /completePendingSignal\(state, signal\.targetTxRef\)/);
  assert.match(engineSource, /status: "retry"/);
  assert.match(storeSource, /pendingSignals: state\.pendingSignals/);
});

test("EVO and the dashboard expose the conservative statistical promotion gate", async () => {
  const [benchmarkSource, panelSource] = await Promise.all([
    readFile(new URL("./benchmark-copy-trading-evolution.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/components/trade/CopyTradingPanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(benchmarkSource, /promotion\.status === "eligible"/);
  assert.match(benchmarkSource, /positive 95% confidence edge/);
  assert.doesNotMatch(benchmarkSource, /returnDeltaPct - errorRate/);
  assert.match(panelSource, /Learning evidence/);
  assert.match(panelSource, /95% edge/);
  assert.match(panelSource, /Eligible for promotion/);
  assert.match(panelSource, /Execution costs/);
});

// ── paper-trading ledger (dry-run simulation) ────────────────────────────────
const PTOKEN = "0xabcabcabcabcabcabcabcabcabcabcabcabcabc0";

test("paper: empty ledger seeds cash = start bankroll", () => {
  const L = emptyPaperLedger(500);
  assert.equal(L.cashUsd, 500);
  assert.equal(L.startCashUsd, 500);
  assert.equal(L.mirrored, 0);
  assert.deepEqual(L.positions, {});
});

test("paper: buy fills at market price, debits cash, opens a position, counts a fill", () => {
  const L = emptyPaperLedger(100);
  const r = applyPaperBuy(L, { token: PTOKEN, symbol: "PEP", priceUsd: 2, wantUsd: 5, minCopyUsd: 1, at: 1000 });
  assert.equal(r.ok, true);
  assert.equal(r.spentUsd, 5);
  assert.equal(r.boughtAmount, 2.5); // 5 / 2
  assert.equal(L.cashUsd, 95);
  assert.equal(L.mirrored, 1);
  const pos = L.positions[PTOKEN];
  assert.equal(pos.symbol, "PEP");
  assert.equal(pos.spentUsd, 5);
  assert.equal(pos.amount, 2.5);
  assert.equal(pos.markUsd, 5); // cost basis until revalued
});

test("paper: buy sizes down to available simulated cash", () => {
  const L = emptyPaperLedger(3);
  const r = applyPaperBuy(L, { token: PTOKEN, symbol: "PEP", priceUsd: 1, wantUsd: 5, minCopyUsd: 1, at: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.spentUsd, 3); // capped at cash
  assert.equal(L.cashUsd, 0);
});

test("paper: buy below minCopyUsd worth of cash → skipped, cash untouched", () => {
  const L = emptyPaperLedger(0.5);
  const r = applyPaperBuy(L, { token: PTOKEN, symbol: "PEP", priceUsd: 1, wantUsd: 5, minCopyUsd: 1, at: 1 });
  assert.equal(r.ok, false);
  assert.equal(L.cashUsd, 0.5);
  assert.equal(L.mirrored, 0);
});

test("paper: buy with no market price → skipped", () => {
  const L = emptyPaperLedger(100);
  const r = applyPaperBuy(L, { token: PTOKEN, symbol: null, priceUsd: null, wantUsd: 5, minCopyUsd: 1, at: 1 });
  assert.equal(r.ok, false);
  assert.equal(L.cashUsd, 100);
});

test("paper: second buy adds to the position (weighted average cost)", () => {
  const L = emptyPaperLedger(100);
  applyPaperBuy(L, { token: PTOKEN, symbol: "PEP", priceUsd: 2, wantUsd: 5, minCopyUsd: 1, at: 1 }); // 2.5 @ $2
  applyPaperBuy(L, { token: PTOKEN, symbol: "PEP", priceUsd: 4, wantUsd: 4, minCopyUsd: 1, at: 2 }); // 1.0 @ $4
  const pos = L.positions[PTOKEN];
  assert.equal(pos.spentUsd, 9);
  assert.equal(pos.amount, 3.5); // 2.5 + 1.0
  assert.equal(L.cashUsd, 91);
});

test("paper: sell closes at market, credits proceeds + books realized P&L", () => {
  const L = emptyPaperLedger(100);
  applyPaperBuy(L, { token: PTOKEN, symbol: "PEP", priceUsd: 2, wantUsd: 10, minCopyUsd: 1, at: 1 }); // 5 tokens, $10
  const r = applyPaperSell(L, PTOKEN, 3, 5); // price doubled+; 5 tokens * $3 = $15
  assert.equal(r.ok, true);
  assert.equal(r.proceedsUsd, 15);
  assert.equal(r.pnlUsd, 5); // 15 - 10
  assert.equal(L.cashUsd, 105); // 90 + 15
  assert.equal(L.realizedPnlUsd, 5);
  assert.equal(L.mirrored, 2); // buy + sell
  assert.equal(L.positions[PTOKEN], undefined);
});

test("paper: sell with no position or no price → fail, ledger untouched", () => {
  const L = emptyPaperLedger(100);
  assert.equal(applyPaperSell(L, PTOKEN, 2, 1).ok, false);
  applyPaperBuy(L, { token: PTOKEN, symbol: "PEP", priceUsd: 2, wantUsd: 5, minCopyUsd: 1, at: 1 });
  const cashBefore = L.cashUsd;
  assert.equal(applyPaperSell(L, PTOKEN, null, 2).ok, false);
  assert.equal(L.cashUsd, cashBefore);
  assert.ok(L.positions[PTOKEN]); // still open
});

test("paper: paperPositionValue marks to market", () => {
  const pos = { token: PTOKEN, symbol: "PEP", spentUsd: 10, amount: 5, openedAt: 0, lastActionAt: 0 };
  const v = paperPositionValue(pos, 3); // 5 * 3 = 15
  assert.equal(v.valueUsd, 15);
  assert.equal(v.pnlUsd, 5);
  assert.equal(v.pnlPct, 50);
});

test("paper: equity = cash + marked positions; total P&L = realized + unrealized", () => {
  const L = emptyPaperLedger(100);
  applyPaperBuy(L, { token: PTOKEN, symbol: "PEP", priceUsd: 2, wantUsd: 10, minCopyUsd: 1, at: 1 });
  // Mark the open position up to $15 (as runPaperExits would each tick).
  L.positions[PTOKEN].markUsd = 15;
  const equity = paperEquityUsd(L); // 90 cash + 15 mark
  assert.equal(equity, 105);
  const totalPnl = equity - L.startCashUsd; // +5 unrealized
  assert.equal(totalPnl, 5);
  assert.equal(L.realizedPnlUsd + (15 - 10), totalPnl); // realized(0) + unrealized(5)
});

test("paper: portfolio summary reports the user-facing bankroll, value, profit, and return", () => {
  const L = emptyPaperLedger(100);
  applyPaperBuy(L, { token: PTOKEN, symbol: "PEP", priceUsd: 2, wantUsd: 10, minCopyUsd: 1, at: 1 });
  L.positions[PTOKEN].markUsd = 15; // +$5 unrealized

  const soldToken = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  applyPaperBuy(L, { token: soldToken, symbol: "SOLD", priceUsd: 2, wantUsd: 10, minCopyUsd: 1, at: 2 });
  applyPaperSell(L, soldToken, 1.6, 3); // -$2 realized

  assert.deepEqual(paperPortfolioSummary(L), {
    startCashUsd: 100,
    cashUsd: 88,
    positionCostUsd: 10,
    positionValueUsd: 15,
    equityUsd: 103,
    realizedPnlUsd: -2,
    executionCostsUsd: 0,
    unrealizedPnlUsd: 5,
    totalPnlUsd: 3,
    returnPct: 3,
  });
});

function promotionRecord(sequence, pairedDeltaPct, evaluationBatch, options = {}) {
  const sourceReturnPct = options.sourceReturnPct ?? -2;
  const evolvedReturnPct = sourceReturnPct + pairedDeltaPct;
  const decision = options.decision ?? "close";
  return {
    sequence,
    evaluationBatch,
    policyVersion: COPY_TRADE_EVOLUTION_POLICY_VERSION,
    targetTxRef: `0x${sequence}`,
    token: TOKEN,
    symbol: "TOKEN",
    entryAt: sequence,
    entryPriceUsd: 1,
    spentUsd: 5,
    decision,
    confidence: options.confidence ?? 0.8,
    calibratedConfidence: options.confidence ?? 0.8,
    closeThreshold: 0.7,
    closeExecuted: decision === "close",
    closePriceUsd: 1,
    buyCost: { fixedUsd: 0, variableBps: 0 },
    sellCost: { fixedUsd: 0, variableBps: 0 },
    horizons: {
      "5m": { dueAt: 0 },
      "30m": { dueAt: 0 },
      "4h": { dueAt: 0 },
      "24h": {
        dueAt: 0,
        observedAt: sequence + 1,
        priceUsd: 1,
        holdReturnPct: sourceReturnPct,
        closeReturnPct: decision === "close" ? evolvedReturnPct : sourceReturnPct - pairedDeltaPct,
        evolvedReturnPct,
        pairedDeltaPct,
      },
    },
  };
}

console.log("copy-trading watcher + store + paper tests passed.");
