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

if (failures.length) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nPASS: buy-stock xStocks allowlist is structurally sound" + (liveSkipped ? "" : " and fully routable") + ".");
