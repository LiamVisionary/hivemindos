#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// The watcher statically imports @/-aliased + server-only modules; register the
// repo's TS-relative loader (which shims "server-only") before importing it.
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { classifyEvmSwaps, classifySolanaSwap } = await import("../src/lib/services/copy-trading/watcher.ts");
const { normalizeConfig } = await import("../src/lib/services/copy-trading/store.ts");
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

// ── config normalization clamps ───────────────────────────────────────────────
test("normalizeConfig clamps maxCopyUsd to the $10 rail cap", () => {
  const base = defaultCopyTradingConfig({ id: "x", agentId: "a", walletAddress: "0xabc", network: "eip155:8453" });
  const normalized = normalizeConfig({ ...base, maxCopyUsd: 500 });
  assert.equal(normalized.maxCopyUsd, MAX_COPY_TRADE_USD);
});

console.log("copy-trading watcher + store tests passed.");
