#!/usr/bin/env node
// Guards the wallet-aware hive-chat context (Trade desk / Wallets screen acting
// wallet). The formatted screen context is PREPENDED to the user's message before
// the executing agent's natural-language send/swap interceptors parse it, so this
// asserts the context can never corrupt money parsing:
//   • the FULL wallet address never appears in prose (truncated only),
//   • the capability briefing has no "$<n>"/"<n> usd"/private/veil/shield/http
//     tokens that would hijack the send amount or make the interceptor bail,
//   • a real "send 10 usdc to 0x…" still parses with the right recipient/amount
//     and no false source, and explicit "from my … wallet" is still honored.
// No network, no money — pure module behavior.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { coerceDashboardScreenContext, formatDashboardScreenContextForPrompt, mergeDashboardScreenContext } =
  await import("../src/features/dashboard/screen-context.ts");
const { parseSendRequest, parseSwapRequest } =
  await import("../src/lib/services/chat/wallet-action-intents.ts");
const { TRADE_ROUTE_CAPABILITY_LINES, WALLET_ROUTE_CAPABILITY_LINES } =
  await import("../src/lib/services/chat/trade-route-context.ts");

const FULL_ADDR = "0xC0ffee254729296a45a3885639AC7E10F9d54979";
const RECIPIENT = "0x1111111111111111111111111111111111111111";

// The interceptor bail/hijack tokens that must never appear in the prepended prose.
const FORBIDDEN = /\b(private|privately|veil|shield|shielded)\b|https?:\/\/|\$\s*\d|\d\s*(?:usdc|usd|dollars?|bucks)\b/i;

for (const line of [...TRADE_ROUTE_CAPABILITY_LINES, ...WALLET_ROUTE_CAPABILITY_LINES]) {
  assert.ok(!FORBIDDEN.test(line), `capability line must not contain interceptor-tripping tokens: ${line}`);
}

const ctx = coerceDashboardScreenContext({
  view: "trade",
  section: { kind: "section", id: "trade-desk", label: "Trade desk" },
  actingWallet: {
    id: "bankr", label: "Bankr trading wallet", kind: "bankr", provider: "bankr",
    network: "eip155:8453", networkLabel: "Base", address: FULL_ADDR,
    custody: "Bankr-managed", capUsd: 250,
  },
  capabilities: [...TRADE_ROUTE_CAPABILITY_LINES],
});
assert.ok(ctx, "context should coerce");
assert.equal(ctx.actingWallet?.address, FULL_ADDR, "full address carried structurally");
assert.equal(ctx.capabilities?.length, TRADE_ROUTE_CAPABILITY_LINES.length, "capabilities carried");

const prose = formatDashboardScreenContextForPrompt(ctx);
assert.ok(/Acting wallet — the default owner\/source/.test(prose), "acting-wallet directive present");
assert.ok(prose.includes("Bankr trading wallet"), "acting wallet name present");
assert.ok(prose.includes("0xC0ff…4979"), "truncated address present");
assert.ok(/Capabilities available from this screen/.test(prose), "capability briefing present");
assert.ok(!prose.includes(FULL_ADDR), "FULL address must not appear in prose");
assert.ok(!/0x[a-fA-F0-9]{40}/.test(prose), "no 40-hex address anywhere in prose");
assert.ok(!FORBIDDEN.test(prose), "no interceptor-tripping tokens in the full prose");

// A real send parses correctly with the context prepended.
const send = parseSendRequest(`${prose}\n\nUser request: send 10 usdc to ${RECIPIENT}`);
assert.ok(send, "send should parse through the prepended context");
assert.equal(send.recipient.toLowerCase(), RECIPIENT.toLowerCase(), "recipient is the user's, not the acting wallet");
assert.equal(send.amountUsd, 10, "amount is the user's 10, not a context figure");
assert.equal(send.source.address, undefined, "no source address captured from the context prose");
assert.equal(send.source.personal, undefined, "no personal source falsely inferred");

// Explicit "from my … wallet" is still honored through the context.
const sendFrom = parseSendRequest(`${prose}\n\nUser request: send 5 usdc to ${RECIPIENT} from my base wallet`);
assert.ok(sendFrom, "explicit-from send should parse");
assert.equal(sendFrom.source.personal, true, "explicit personal source honored");
assert.equal(sendFrom.source.chain, "base", "explicit chain honored");

// Swap not corrupted by the prepended context.
const swap = parseSwapRequest(`${prose}\n\nUser request: swap 5 USDC to ETH`);
assert.ok(swap, "swap should parse");
assert.equal(swap.sellToken, "USDC");
assert.equal(swap.buyToken, "ETH");
assert.equal(swap.source.address, undefined, "no swap source captured from context prose");

// merge (PersistentHiveChat merges live openModals on send) preserves the wallet/capabilities.
const merged = mergeDashboardScreenContext(ctx, { openModals: [{ kind: "dialog", label: "Bee Pilot" }] });
assert.equal(merged?.actingWallet?.address, FULL_ADDR, "merge preserves acting wallet");
assert.equal(merged?.capabilities?.length, TRADE_ROUTE_CAPABILITY_LINES.length, "merge preserves capabilities");

// Wallets-view acting wallet (agent kind, solana) also formats without a full address.
const walletCtx = coerceDashboardScreenContext({
  view: "wallet",
  actingWallet: { id: "agent-7", label: "Scout", kind: "agent", provider: "x402", network: "solana:mainnet", address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" },
  capabilities: [...WALLET_ROUTE_CAPABILITY_LINES],
});
const walletProse = formatDashboardScreenContextForPrompt(walletCtx);
assert.ok(!/[1-9A-HJ-NP-Za-km-z]{32,44}/.test(walletProse), "no full base58 address in wallet-view prose");
assert.ok(/9xQeWv…/.test(walletProse), "truncated solana address present");

console.log("✅ acting-wallet context safety: all assertions passed.");
