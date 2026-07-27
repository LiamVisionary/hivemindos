#!/usr/bin/env node
// Verifies the buy-stock xStocks allowlist safety invariants. The allowlist is
// the load-bearing anti-scam control for the on-chain buy rail: a wrong mint
// sends USDC to a counterfeit token. We assert structural invariants on the
// real config file (no scam copycats slip in), then — when the network allows —
// confirm every verified mint is still live + routable on Jupiter.
//
// Run: node scripts/test-buy-stock-xstocks.mjs
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Documented fix for this machine's network: Node's 250ms happy-eyeballs
// per-attempt connect timeout is shorter than the TCP handshake to many hosts.
try {
  const net = process.getBuiltinModule?.("node:net") ?? (await import("node:net")).default;
  net.setDefaultAutoSelectFamilyAttemptTimeout?.(2500);
} catch {}

const root = join(fileURLToPath(import.meta.url), "..", "..");
const configPath = join(root, "src", "lib", "config", "xstocks-tokens.ts");
const source = await readFile(configPath, "utf8");
const robinhoodConfigPath = join(root, "src", "lib", "config", "robinhood-chain.ts");
const robinhoodSource = await readFile(robinhoodConfigPath, "utf8");

const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

// Parse the XSTOCKS entries straight out of the TS source (no transpile needed).
const entryRe = /\{\s*symbol:\s*"([^"]+)",\s*underlying:\s*"([^"]+)",\s*mint:\s*"([^"]+)",\s*name:\s*"([^"]+)"\s*\}/g;
const entries = [...source.matchAll(entryRe)].map((m) => ({ symbol: m[1], underlying: m[2], mint: m[3], name: m[4] }));

const usdcMatch = source.match(/SOLANA_USDC_MINT\s*=\s*"([^"]+)"/);

assert(entries.length >= 10, `expected >=10 xStocks, found ${entries.length}`);
assert(usdcMatch?.[1] === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "USDC mint constant is wrong");

const base58 = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const seenMint = new Set();
const seenUnderlying = new Set();
for (const e of entries) {
  // Every official xStocks mint uses the "Xs" vanity prefix — a cheap, strong
  // signal that distinguishes the real token from symbol-squatting copycats.
  assert(e.mint.startsWith("Xs"), `${e.symbol}: mint ${e.mint} missing official "Xs" prefix`);
  assert(base58.test(e.mint), `${e.symbol}: mint ${e.mint} is not a valid base58 address`);
  assert(e.symbol.toUpperCase().endsWith("X"), `${e.symbol}: on-chain symbol should end in x`);
  assert(!seenMint.has(e.mint), `duplicate mint ${e.mint}`);
  assert(!seenUnderlying.has(e.underlying), `duplicate underlying ${e.underlying}`);
  seenMint.add(e.mint);
  seenUnderlying.add(e.underlying);
}

console.log(`Structural checks: ${entries.length} verified xStocks parsed.`);

// Robinhood Chain stock-token support carries the same anti-scam invariant:
// only canonical documented contracts are accepted, never symbol search.
const rhEntryRe = /\{\s*symbol:\s*"([^"]+)",\s*address:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*kind:\s*"(stock|etf)",\s*decimals:\s*18\s*\}/g;
const rhEntries = [...robinhoodSource.matchAll(rhEntryRe)].map((m) => ({ symbol: m[1], address: m[2], name: m[3], kind: m[4] }));
const rhNetworkMatch = robinhoodSource.match(/ROBINHOOD_CHAIN_NETWORK\s*=\s*"([^"]+)"/);
const rhTestnetMatch = robinhoodSource.match(/ROBINHOOD_CHAIN_TESTNET_NETWORK\s*=\s*"([^"]+)"/);
assert(rhNetworkMatch?.[1] === "eip155:4663", "Robinhood Chain mainnet CAIP id must be eip155:4663");
assert(rhTestnetMatch?.[1] === "eip155:46630", "Robinhood Chain testnet CAIP id must be eip155:46630");
assert(rhEntries.length >= 20, `expected >=20 Robinhood stock tokens, found ${rhEntries.length}`);
for (const required of ["AAPL", "NVDA", "TSLA", "SPY", "QQQ", "SGOV"]) {
  assert(rhEntries.some((entry) => entry.symbol === required), `missing Robinhood Chain ticker ${required}`);
}
const seenRhAddress = new Set();
const seenRhSymbol = new Set();
for (const entry of rhEntries) {
  assert(/^0x[a-fA-F0-9]{40}$/.test(entry.address), `${entry.symbol}: Robinhood address is not an EVM address`);
  assert(!seenRhAddress.has(entry.address.toLowerCase()), `duplicate Robinhood address ${entry.address}`);
  assert(!seenRhSymbol.has(entry.symbol), `duplicate Robinhood ticker ${entry.symbol}`);
  seenRhAddress.add(entry.address.toLowerCase());
  seenRhSymbol.add(entry.symbol);
}
console.log(`Structural checks: ${rhEntries.length} canonical Robinhood Chain stock tokens parsed.`);

// Optional live check — confirm each mint still quotes against USDC on Jupiter.
// Network failures are a soft skip (offline / restricted), NOT a test failure.
const JUP = process.env.JUPITER_API_BASE || "https://lite-api.jup.ag";
const USDC = usdcMatch?.[1];
let liveChecked = 0;
let liveSkipped = false;
for (const e of entries) {
  try {
    const url = `${JUP}/swap/v1/quote?inputMint=${USDC}&outputMint=${e.mint}&amount=1000000&slippageBps=100`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) { assert(false, `${e.symbol}: Jupiter quote HTTP ${res.status}`); continue; }
    const quote = await res.json();
    assert(quote?.outAmount && Number(quote.outAmount) > 0, `${e.symbol}: no routable quote (outAmount empty)`);
    liveChecked += 1;
  } catch {
    liveSkipped = true;
    break; // network unreachable — stop probing, treat the live phase as skipped.
  }
}
console.log(liveSkipped
  ? `Live routability check: SKIPPED (network unreachable after ${liveChecked} ok).`
  : `Live routability check: ${liveChecked}/${entries.length} mints routable on Jupiter.`);

// Sell-path coverage. The trade rail is side-aware: a buy is USDC->mint ExactIn,
// a sell is mint->USDC ExactOut. Assert the side-aware API + confirmation tokens
// are present in source (deterministic), then best-effort probe the sell route.
const tradeSource = await readFile(join(root, "src", "lib", "services", "trading", "buy-stock.ts"), "utf8");
assert(/BUY_STOCK_CONFIRMATION\s*=\s*"CONFIRM_BUY"/.test(tradeSource), "BUY_STOCK_CONFIRMATION must be CONFIRM_BUY");
assert(/SELL_STOCK_CONFIRMATION\s*=\s*"CONFIRM_SELL"/.test(tradeSource), "SELL_STOCK_CONFIRMATION must be CONFIRM_SELL");
assert(/export async function executeStockTrade/.test(tradeSource), "executeStockTrade must be exported");
assert(/export async function discoverStockTradeQuote/.test(tradeSource), "discoverStockTradeQuote must be exported");
assert(/export async function executeBuyStock/.test(tradeSource), "executeBuyStock wrapper must remain for the chat runtime");
assert(/function quoteXStocksLeg/.test(tradeSource), "quoteXStocksLeg must size both trade directions");
assert(/function executeRobinhoodChainSwap/.test(tradeSource), "Robinhood Chain execution must have a concrete swap adapter");
assert(/zeroExFetch\(robinhoodZeroExPath\("quote"/.test(tradeSource), "Robinhood Chain execution must request a firm 0x quote");
assert(/executeEvmZeroExSwap/.test(tradeSource), "Robinhood Chain execution must sign through the local EVM 0x signer");
assert(/source:\s*"robinhood-chain"/.test(tradeSource), "Robinhood Chain trades must carry their own platform-fee source");
assert(/ROBINHOOD_USDG_DECIMALS\s*=\s*6/.test(tradeSource), "Robinhood Chain trades must size USDG as a 6-decimal stablecoin");
assert(/resolveRobinhoodStockToken/.test(tradeSource), "Robinhood Chain quote path must resolve through the canonical allowlist");
console.log("Sell-path source checks: side-aware trade API + CONFIRM_SELL + Robinhood 0x adapter present.");

const routeSource = await readFile(join(root, "src", "app", "api", "trading", "route.ts"), "utf8");
assert(/robinhoodChain:\s*\{/.test(routeSource), "/api/trading GET must expose Robinhood Chain readiness metadata");
assert(/checkRobinhoodChainTradingReadiness/.test(routeSource), "Robinhood Chain readiness must use the live 0x route check");
assert(/executable:\s*robinhoodReadiness\.executable/.test(routeSource), "Robinhood Chain readiness must expose the live route-check result");

if (!liveSkipped && entries[0] && USDC) {
  // Mirror the real sell path: size the position from the USDC->mint price, then
  // confirm the mint->USDC ExactIn leg routes (the reliable tokenized-equity path).
  try {
    const e = entries[0];
    const priceRes = await fetch(`${JUP}/swap/v1/quote?inputMint=${USDC}&outputMint=${e.mint}&amount=1000000&slippageBps=100&swapMode=ExactIn`, { signal: AbortSignal.timeout(15000) });
    const price = priceRes.ok ? await priceRes.json() : null;
    const mintAtomic = Math.floor(Number(price?.outAmount) || 0);
    if (mintAtomic > 0) {
      const sellRes = await fetch(`${JUP}/swap/v1/quote?inputMint=${e.mint}&outputMint=${USDC}&amount=${mintAtomic}&slippageBps=100&swapMode=ExactIn`, { signal: AbortSignal.timeout(15000) });
      const sell = sellRes.ok ? await sellRes.json() : null;
      assert(sell?.outAmount && Number(sell.outAmount) > 0, `${e.symbol}: sell (mint->USDC ExactIn) did not route`);
      console.log(`Sell routability check: ${e.symbol} -> USDC ExactIn routable.`);
    } else {
      console.log("Sell routability check: SKIPPED (no price quote).");
    }
  } catch {
    console.log("Sell routability check: SKIPPED (network unreachable).");
  }
}

if (failures.length) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nPASS: buy-stock xStocks allowlist is structurally sound" + (liveSkipped ? "" : " and fully routable") + ".");
