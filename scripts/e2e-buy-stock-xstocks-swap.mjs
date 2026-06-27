#!/usr/bin/env node
// End-to-end check of the on-chain xStocks buy path (executeXStocksSwap in
// src/lib/services/trading/buy-stock.ts): USDC -> verified xStock mint via
// Jupiter, signed with a local-vault Solana wallet.
//
// SAFETY:
//   - Dry run is the DEFAULT (quote + balances only, NO broadcast, NO decrypt).
//   - LIVE=1 broadcasts a REAL, irreversible swap spending REAL USDC + SOL fees.
//   - The wallet secret is decrypted in-memory only in LIVE mode and is NEVER
//     printed. We verify the derived pubkey matches the expected address first.
//
// Usage:
//   AGENT_ID=<vault agentId> [TICKER=AAPL] [NOTIONAL=1] node scripts/e2e-buy-stock-xstocks-swap.mjs
//   AGENT_ID=<vault agentId> LIVE=1 node scripts/e2e-buy-stock-xstocks-swap.mjs   # really buys
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, createDecipheriv, createSecretKey } from "node:crypto";

try { const net = process.getBuiltinModule("node:net"); net.setDefaultAutoSelectFamilyAttemptTimeout(2500); } catch {}

const AGENT_ID = process.env.AGENT_ID;
const TICKER = (process.env.TICKER || "AAPL").toUpperCase();
const NOTIONAL = Number(process.env.NOTIONAL || "1");
const LIVE = process.env.LIVE === "1";
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS || "100");
const JUP = process.env.JUPITER_API_BASE || "https://lite-api.jup.ag";
const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const root = join(import.meta.dirname, "..");
const die = (m) => { console.error(`\nFAIL: ${m}`); process.exit(1); };
if (!AGENT_ID) die("set AGENT_ID=<vault agentId> (run the vault list helper to find it).");

// Resolve the ticker against the SAME verified allowlist the app uses.
const cfg = await readFile(join(root, "src", "lib", "config", "xstocks-tokens.ts"), "utf8");
const entries = [...cfg.matchAll(/\{\s*symbol:\s*"([^"]+)",\s*underlying:\s*"([^"]+)",\s*mint:\s*"([^"]+)"/g)]
  .map((m) => ({ symbol: m[1], underlying: m[2], mint: m[3] }));
const token = entries.find((e) => e.underlying === TICKER || e.symbol.toUpperCase() === TICKER);
if (!token) die(`${TICKER} is not a verified xStock. Supported: ${entries.map((e) => e.underlying).join(", ")}`);

// Read the vault record (public fields only here).
const vault = JSON.parse(await readFile(join(homedir(), ".hivemindos", "wallet-vault.json"), "utf8"));
const record = vault.records?.[AGENT_ID];
if (!record) die(`no vault record for agentId ${AGENT_ID}`);
if (record.network !== "solana:mainnet") die(`agent ${AGENT_ID} is on ${record.network}, not solana:mainnet`);
const address = record.address;

async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  return (await r.json()).result;
}

const solLamports = (await rpc("getBalance", [address]))?.value ?? 0;
const ta = await rpc("getTokenAccountsByOwner", [address, { mint: USDC }, { encoding: "jsonParsed" }]);
let usdc = 0; for (const a of (ta?.value || [])) usdc += a.account.data.parsed.info.tokenAmount.uiAmount || 0;

console.log(`Wallet ${AGENT_ID}`);
console.log(`  address ${address}`);
console.log(`  SOL ${solLamports / 1e9}   USDC ${usdc}`);
console.log(`Plan: buy ~$${NOTIONAL.toFixed(2)} of ${token.symbol} (${token.mint}) via Jupiter, slippage ${SLIPPAGE_BPS}bps`);

if (usdc < NOTIONAL) die(`insufficient USDC: have ${usdc}, need ${NOTIONAL}`);
if (solLamports < 3_000_000) die(`insufficient SOL for fees + token-2022 ATA rent (have ${solLamports / 1e9}, want >= ~0.003)`);

// Live quote (same endpoint/params as the service).
const amountAtomic = Math.round(NOTIONAL * 1_000_000);
const quote = await fetch(`${JUP}/swap/v1/quote?inputMint=${USDC}&outputMint=${token.mint}&amount=${amountAtomic}&slippageBps=${SLIPPAGE_BPS}`, { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
if (!quote?.outAmount) die("Jupiter returned no route for this swap.");
console.log(`Quote: in ${quote.inAmount} USDC atoms -> out ${quote.outAmount} ${token.symbol} atoms`);
console.log(`  priceImpact ${quote.priceImpactPct}  swapUsdValue ${quote.swapUsdValue}  route hops ${quote.routePlan?.length ?? "?"}`);

if (!LIVE) {
  console.log("\nDRY RUN complete. No transaction sent. Re-run with LIVE=1 to broadcast a real swap.");
  process.exit(0);
}

// ---- LIVE broadcast ----
const { Connection, Keypair, VersionedTransaction } = await import("@solana/web3.js");
const { base58 } = await import("@scure/base");

const { readFileSync } = await import("node:fs");
const keyBuf = (() => {
  const envKey = process.env.HIVEMINDOS_WALLET_VAULT_KEY?.trim();
  const material = envKey || readFileSync(join(homedir(), ".hivemindos", "wallet-vault.key"), "utf8").trim();
  return createHash("sha256").update(material).digest();
})();
const decipher = createDecipheriv("aes-256-gcm", createSecretKey(keyBuf), Buffer.from(record.iv, "base64url"));
decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
const secret = Buffer.concat([decipher.update(Buffer.from(record.encryptedSecret, "base64url")), decipher.final()]).toString("utf8");

const keypair = Keypair.fromSecretKey(base58.decode(secret));
if (keypair.publicKey.toBase58() !== address) die("decrypted key does not match the vault address — aborting.");

const swap = await fetch(`${JUP}/swap/v1/swap`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: keypair.publicKey.toBase58(),
    dynamicComputeUnitLimit: true,
    dynamicSlippage: true,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "high" } },
  }),
  signal: AbortSignal.timeout(20000),
}).then((r) => r.json());
if (!swap?.swapTransaction) die(`Jupiter swap build failed: ${swap?.error || "no transaction"}`);

const tx = VersionedTransaction.deserialize(new Uint8Array(Buffer.from(swap.swapTransaction, "base64")));
tx.sign([keypair]);
const connection = new Connection(RPC, "confirmed");
console.log("\nBroadcasting swap...");
const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3, skipPreflight: false });
const latest = await connection.getLatestBlockhash("confirmed");
await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
console.log(`\nPASS: swap confirmed. Tx ${sig}`);
console.log(`  https://solscan.io/tx/${sig}`);
