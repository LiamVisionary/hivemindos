import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { deriveFreeMeter } from "../src/features/dashboard/views/chat/hivemindos-free-meter.ts";

const service = await readFile(new URL("../src/lib/services/wallet/honey-community.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/honey-community/route.ts", import.meta.url), "utf8");
const card = await readFile(new URL("../src/components/wallets-drop-in/HoneyContributionCard.tsx", import.meta.url), "utf8");
const wallets = await readFile(new URL("../src/components/wallets-drop-in/WalletsView.tsx", import.meta.url), "utf8");
const chatRoute = await readFile(new URL("../src/app/api/hivemindos/models/chat/completions/route.ts", import.meta.url), "utf8");
const allowance = await readFile(new URL("../src/lib/services/hivemindos-free-allowance.ts", import.meta.url), "utf8");
const walletLinkService = await readFile(new URL("../src/lib/services/wallet/honey-wallet-link.ts", import.meta.url), "utf8");
const walletPanel = await readFile(new URL("../src/features/dashboard/views/WalletPanel.tsx", import.meta.url), "utf8");
const walletLinkOptionsModule = await import("../src/lib/services/wallet/honey-wallet-link-options.ts").catch(() => ({}));

assert.match(service, /\/community\/status\?workspaceId=/, "status must come from the hosted contribution authority");
assert.match(route, /export async function GET/, "the app route should expose read-only contribution status");
assert.match(card, /one cumulative total/i);
assert.match(card, /every HONEY counts equally/i);
assert.match(card, /free agent usage/i);
assert.match(card, /does not move funds or expose the key/i);
assert.match(card, /Skeleton/, "the contribution panel should use the canonical animated loader");
assert.match(wallets, /HoneyContributionCard/);
assert.match(wallets, /Honey · lifetime contribution record/);
assert.match(wallets, /HONEY attribution by agent/);
assert.doesNotMatch(wallets, /Balances by agent/);
assert.match(chatRoute, /x-hivemindos-free-benefit-tier-label/);
assert.match(allowance, /quotaTierLabel: string \| null/);
assert.match(allowance, /quotaSource: string \| null/);
assert.equal(
  typeof walletLinkOptionsModule.buildHoneyWalletLinkOptions,
  "function",
  "the Honey panel should be able to discover signable wallets already stored in the local vault",
);
assert.deepEqual(
  walletLinkOptionsModule.buildHoneyWalletLinkOptions([
    { address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", name: "Primary", network: "eip155:8453" },
    { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "Duplicate chain", network: "eip155:4663" },
    { address: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", name: undefined, network: "eip155:8453" },
    { address: "not-an-address", name: "Invalid", network: "eip155:8453" },
    { address: "solana-address", name: "Solana", network: "solana:mainnet" },
  ]),
  [
    { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "Primary" },
    { address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", name: null },
  ],
  "eligible EVM wallets should be normalized, deduplicated, labeled, and kept separate from unsupported wallets",
);
assert.match(walletLinkService, /wallets:\s*buildHoneyWalletLinkOptions/, "wallet-link status should include eligible existing wallets");
assert.match(walletPanel, /onLinkHoneyWallet/, "the dashboard should expose the existing signature-proof action to the Honey card");
assert.match(card, /Sign & link wallet/, "the Honey card should offer an in-context wallet verification button");
assert.match(card, /className="fb-select"/, "multiple eligible wallets should use a structured picker");
assert.match(card, /Choose a wallet/, "multiple eligible wallets should require an explicit selection instead of defaulting to the first address");
assert.match(card, /walletVerified/, "Telegram linking should wait for the hosted wallet proof prerequisite");

const contributionSnapshot = {
  remainingRequests: 599,
  remainingTokens: 1_499_000,
  resetAt: "2026-07-14T00:00:00.000Z",
  observedAt: "2026-07-13T12:00:00.000Z",
  highWaterRequests: 599,
  highWaterTokens: 1_499_000,
  quotaTierLabel: "Contributor IV",
  quotaSource: "honey",
  quotaMultiplierBps: 15_000,
};
assert.equal(
  deriveFreeMeter(contributionSnapshot, Date.parse("2026-07-13T12:00:01.000Z"))?.label,
  "599 requests · 1.5M tokens left today · Contributor IV 1.5× HONEY allowance",
);

console.log("HONEY contribution layer client contract passed.");
