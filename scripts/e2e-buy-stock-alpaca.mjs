#!/usr/bin/env node
// End-to-end check of the Alpaca paper-trading buy path used by the buy-stock
// rail. Mirrors executeAlpaca() in src/lib/services/trading/buy-stock.ts: reads
// the SAME shared-hive env var names, hits the SAME paper endpoint, and places a
// real (simulated) market order, then reads it back to confirm acceptance.
//
// Paper trading only — never points at the live brokerage. Defaults to a $1
// notional buy of AAPL. Override with: TICKER=NVDA NOTIONAL=2 node scripts/e2e-buy-stock-alpaca.mjs
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

try {
  const net = process.getBuiltinModule?.("node:net") ?? (await import("node:net")).default;
  net.setDefaultAutoSelectFamilyAttemptTimeout?.(2500);
} catch {}

const KEY_ENV = "ALPACA_API_KEY_ID";
const SECRET_ENV = "ALPACA_API_SECRET_KEY";
const PAPER_BASE = "https://paper-api.alpaca.markets";
const TICKER = (process.env.TICKER || "AAPL").toUpperCase();
const NOTIONAL = Number(process.env.NOTIONAL || "1");

async function readSharedEnv(key) {
  if (process.env[key]?.trim()) return process.env[key].trim();
  const raw = await readFile(join(homedir(), ".hivemindos", ".env"), "utf8").catch(() => "");
  const m = raw.match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)\\s*$`, "m"));
  if (!m) return "";
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v.replace(/\s+#.*$/, "").trim();
}

const apiKey = await readSharedEnv(KEY_ENV);
const apiSecret = await readSharedEnv(SECRET_ENV);

if (!apiKey || !apiSecret) {
  console.log(`SKIP: Alpaca paper keys not found (${KEY_ENV} / ${SECRET_ENV}).`);
  console.log("To run this E2E:");
  console.log("  1. Create a free Alpaca account, open the Paper Trading dashboard, and generate API keys.");
  console.log(`  2. Add them to ~/.hivemindos/.env as:`);
  console.log(`       ${KEY_ENV}=<paper key id>`);
  console.log(`       ${SECRET_ENV}=<paper secret>`);
  console.log("  3. Re-run: npm run e2e:buy-stock-alpaca");
  process.exit(0); // soft skip — not a failure.
}

const headers = {
  "APCA-API-KEY-ID": apiKey,
  "APCA-API-SECRET-KEY": apiSecret,
  "Content-Type": "application/json",
};

function fail(msg) { console.error(`\nFAIL: ${msg}`); process.exit(1); }

// 1. Confirm the account is reachable and is a paper account.
const acct = await fetch(`${PAPER_BASE}/v2/account`, { headers, signal: AbortSignal.timeout(20000) })
  .then((r) => r.ok ? r.json() : r.text().then((t) => fail(`account read HTTP ${r.status}: ${t}`)))
  .catch((e) => fail(`account read errored: ${e.message}`));
console.log(`Account ${acct.account_number} · status ${acct.status} · buying power $${acct.buying_power} (paper).`);

// 2. Place the same market order shape the service builds.
const order = { symbol: TICKER, notional: NOTIONAL.toFixed(2), side: "buy", type: "market", time_in_force: "day" };
console.log(`Placing paper order: ${JSON.stringify(order)}`);
const placed = await fetch(`${PAPER_BASE}/v2/orders`, {
  method: "POST", headers, body: JSON.stringify(order), signal: AbortSignal.timeout(20000),
}).then(async (r) => {
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.id) fail(`order rejected HTTP ${r.status}: ${j?.message || "no id"}`);
  return j;
}).catch((e) => fail(`order POST errored: ${e.message}`));
console.log(`Order accepted: id ${placed.id} · status ${placed.status}`);

// 3. Read it back to confirm it persisted on Alpaca's side.
const fetched = await fetch(`${PAPER_BASE}/v2/orders/${placed.id}`, { headers, signal: AbortSignal.timeout(20000) })
  .then((r) => r.ok ? r.json() : fail(`order read HTTP ${r.status}`))
  .catch((e) => fail(`order read errored: ${e.message}`));
console.log(`Order readback: status ${fetched.status} · filled_qty ${fetched.filled_qty} · filled_avg_price ${fetched.filled_avg_price ?? "—"}`);

const okStatuses = new Set(["accepted", "new", "pending_new", "filled", "partially_filled", "accepted_for_bidding"]);
if (!okStatuses.has(fetched.status)) fail(`unexpected order status: ${fetched.status}`);

console.log(`\nPASS: Alpaca paper buy of $${NOTIONAL.toFixed(2)} ${TICKER} executed end-to-end (order ${placed.id}, status ${fetched.status}).`);
