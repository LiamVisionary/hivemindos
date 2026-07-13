import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { deriveFreeMeter } from "../src/features/dashboard/views/chat/hivemindos-free-meter.ts";

const service = await readFile(new URL("../src/lib/services/wallet/honey-community.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/honey-community/route.ts", import.meta.url), "utf8");
const card = await readFile(new URL("../src/components/wallets-drop-in/HoneyContributionCard.tsx", import.meta.url), "utf8");
const wallets = await readFile(new URL("../src/components/wallets-drop-in/WalletsView.tsx", import.meta.url), "utf8");
const chatRoute = await readFile(new URL("../src/app/api/hivemindos/models/chat/completions/route.ts", import.meta.url), "utf8");
const allowance = await readFile(new URL("../src/lib/services/hivemindos-free-allowance.ts", import.meta.url), "utf8");

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
