#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// The watcher statically imports @/-aliased + server-only modules; register the
// repo's TS-relative loader (which shims "server-only") before importing it.
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { classifyEvmSwaps, classifyEnrichedEvmSwap, classifySolanaSwap } = await import("../src/lib/services/copy-trading/watcher.ts");
const { selectBuyFunding, fundingAssetsFromBalance, fundableSummary } = await import("../src/lib/services/copy-trading/funding.ts");
const { normalizeConfig } = await import("../src/lib/services/copy-trading/store.ts");
const { emptyPaperLedger, applyPaperBuy, applyPaperSell, paperPositionValue, paperEquityUsd } = await import("../src/lib/services/copy-trading/paper.ts");
const { defaultCopyTradingConfig, MAX_COPY_TRADE_USD } = await import("../src/lib/types/copy-trading.ts");

const TARGET = "0x1111111111111111111111111111111111111111";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";
const TOKEN = "0xabcabcabcabcabcabcabcabcabcabcabcabcabc0";
const other = "0x2222222222222222222222222222222222222222";

function transfer(txHash, token, from, to, valueRaw) {
  return { txHash, blockNumber: "100", token, from, to, valueRaw };
}

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

console.log("copy-trading watcher + store + paper tests passed.");
