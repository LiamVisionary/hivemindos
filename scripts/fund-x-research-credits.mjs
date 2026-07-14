#!/usr/bin/env node
// One-shot top-up for the shared "X credit" account (service:hive-research)
// that both X Studio and Hive Research bill against. It decrypts the
// service:hive-research credit token from your LOCAL model-credit vault
// (~/.hivemindos/hivemindos-model-credit-vault.json), asks the paid-agent-gateway
// to open a Stripe card-checkout session for that exact account, and prints
// ONLY the checkout URL + balances. The token stays in-process and is never
// printed. Nothing is charged until you complete payment in the browser.
//
//   node scripts/fund-x-research-credits.mjs <amountUsd>
//   e.g. node scripts/fund-x-research-credits.mjs 50
//
// After you pay, the Stripe webhook credits the account within a few seconds;
// re-run with no amount to just re-read the balance.

import { createDecipheriv, createHash, createSecretKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const GATEWAY = "https://hivemindos-paid-agent-gateway.hivemindos.workers.dev";
const SLUG = "default";
const WALLET_AGENT_ID = "service:hive-research"; // the dedicated X-credit account
const vaultDir = path.join(homedir(), ".hivemindos");
const vaultPath = path.join(vaultDir, "hivemindos-model-credit-vault.json");
const keyPath = path.join(vaultDir, "hivemindos-model-credit-vault.key");

function loadToken() {
  const key = createHash("sha256").update(readFileSync(keyPath, "utf8").trim()).digest();
  const vault = JSON.parse(readFileSync(vaultPath, "utf8"));
  const rec = vault.records?.[`${WALLET_AGENT_ID}::${SLUG}`];
  if (!rec) throw new Error(`No vault record for ${WALLET_AGENT_ID}::${SLUG}`);
  const decipher = createDecipheriv("aes-256-gcm", createSecretKey(key), Buffer.from(rec.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(rec.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(rec.encryptedToken, "base64url")), decipher.final()]).toString("utf8");
}

async function balance(token) {
  const res = await fetch(`${GATEWAY}/api/paid-agents/${SLUG}/credits/balance`, {
    headers: { accept: "application/json", "X-HivemindOS-Credit-Token": token },
  });
  const j = await res.json().catch(() => null);
  return j && typeof j.balanceUsd === "number" ? j.balanceUsd : null;
}

async function checkout(token, amountUsd) {
  const res = await fetch(`${GATEWAY}/api/paid-agents/${SLUG}/credits/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "X-HivemindOS-Credit-Token": token },
    body: JSON.stringify({
      amountUsd,
      successUrl: "https://hivemindos.app/mini-apps?credits=success",
      cancelUrl: "https://hivemindos.app/mini-apps?credits=cancel",
    }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(`checkout failed (HTTP ${res.status}): ${j?.error || "unknown"}`);
  return j;
}

const amountArg = Number(process.argv[2]);
const token = loadToken();
const before = await balance(token);
console.log(`Account: ${WALLET_AGENT_ID} (slug ${SLUG})`);
console.log(`Current balance: ${before === null ? "unknown" : `$${before.toFixed(4)}`}`);

if (!Number.isFinite(amountArg) || amountArg <= 0) {
  console.log("\nPass an amount to add funds, e.g.:  node scripts/fund-x-research-credits.mjs 50");
  process.exit(0);
}

const session = await checkout(token, amountArg);
console.log(`\nOpen this URL and pay with card to add $${session.creditedUsd}:`);
console.log(`\n  ${session.checkoutUrl}\n`);
console.log("After payment, the balance updates within a few seconds. Re-run with no amount to confirm.");
