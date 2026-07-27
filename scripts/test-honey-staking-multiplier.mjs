#!/usr/bin/env node
// Stake-tier Honey multipliers (config ladder + local ledger mint paths).
//
// Hermetic: runs against a temp HOME with the Honey economy kill-switch forced
// OFF (env override, no network) and a pre-warmed multiplier cache, so no RPC
// or gateway call happens. The ladder must stay numerically identical to the
// /stake page (hivemindos-website src/lib/hive-staking.ts rewardWeight) and the
// compute gateway (hivemind-cloud-services workers/compute-gateway).

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

const tempHome = await mkdtemp(join(tmpdir(), "honey-multiplier-test-"));
process.env.HOME = tempHome;
process.env.HONEY_ECONOMY_ENABLED = "false";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  FOUNDING_BEE_ADDRESSES,
  FOUNDING_BEE_BONUS_BPS,
  HIVE_STAKING_TIERS,
  HONEY_MULTIPLIER_BASE_BPS,
  HONEY_MULTIPLIER_MAX_BPS,
  applyHoneyMultiplier,
  combinedHoneyMultiplierBps,
  isFoundingBeeAddress,
} = await import("../src/lib/config/hive-staking.ts");
const { calculateHoneyForTokens } = await import("../src/lib/utils/agent-wallet.ts");

// --- ladder matches the published /stake page rewardWeight values ---

assert.deepEqual(
  HIVE_STAKING_TIERS.map((tier) => [tier.id, tier.rewardMultiplierBps]),
  [
    ["holder", 10_000],
    ["supporter", 11_000],
    ["builder", 12_500],
    ["curator", 14_500],
    ["operator", 17_000],
    ["visionary", 20_000],
  ],
  "tier multiplier ladder must mirror the /stake page rewardWeight 1.00x..2.00x",
);
assert.equal(FOUNDING_BEE_BONUS_BPS, 5_000);
assert.equal(HONEY_MULTIPLIER_BASE_BPS, 10_000);
assert.equal(HONEY_MULTIPLIER_MAX_BPS, 25_000);
assert.equal(FOUNDING_BEE_ADDRESSES.length, 5, "published founding snapshot has five wallets");

// --- founding stacking and cap ---

assert.equal(combinedHoneyMultiplierBps(20_000, true), 25_000, "Founding Queen Bee = 2.5x");
assert.equal(combinedHoneyMultiplierBps(10_000, true), 15_000, "founding with no active tier = 1.0x + 0.5x");
assert.equal(combinedHoneyMultiplierBps(null, true), 15_000, "founding bonus survives unstaking (tier drops, +0.5x persists)");
assert.equal(combinedHoneyMultiplierBps(17_000, false), 17_000);
assert.equal(combinedHoneyMultiplierBps(999_999, false), 25_000, "combined result is capped at 2.5x");
assert.equal(isFoundingBeeAddress("0xEA53F22B387bc3ebabc8a22e6be807e22a817f02"), true, "case-insensitive founding match");
assert.equal(isFoundingBeeAddress("0x0000000000000000000000000000000000000001"), false);

// --- multiplier application rounding ---

assert.equal(applyHoneyMultiplier(1, 25_000), 2.5);
assert.equal(applyHoneyMultiplier(0.201, 15_000), 0.3015);
assert.equal(applyHoneyMultiplier(1, 10_000), 1);
assert.equal(applyHoneyMultiplier(1, 99_999), 1, "out-of-range multiplier falls back to 1.00x, never amplifies");
assert.equal(applyHoneyMultiplier(-4, 20_000), 0);

console.log("PASS config ladder, founding stacking, multiplier math");

// --- local ledger mint paths honor the cached multiplier ---

const { resetHoneyWalletLinkCacheForTests, resolveLocalHoneyMultiplier, writeHoneyWalletLink } =
  await import("../src/lib/services/wallet/honey-staking-multiplier.ts");
const { recordHoneyUsage, recordObservedHoneyUsage } = await import("../src/lib/services/wallet/honey-ledger.ts");

await mkdir(join(tempHome, ".hivemindos"), { recursive: true });
const ledgerSeed = {
  honeyPerThousandTokens: 1,
  tokenPerHoney: 1,
  rewardPoolHive: 1_000_000,
  rewardPoolEmittedHive: 0,
  agentTokenUsage: {},
  agentHoneyExchanged: {},
  agentHiveBalances: {},
  events: [],
};
await writeFile(join(tempHome, ".hivemindos", "honey-ledger.json"), JSON.stringify(ledgerSeed, null, 2));

// Pre-warmed Founding Queen Bee cache: fresh checkedAt means no RPC is attempted.
await writeHoneyWalletLink({
  address: "0xea53f22b387bc3ebabc8a22e6be807e22a817f02",
  linkedAt: new Date().toISOString(),
  gatewayLinked: false,
  cache: {
    multiplierBps: 25_000,
    tierId: "visionary",
    foundingBee: true,
    stakedHive: "1105449798",
    checkedAt: new Date().toISOString(),
  },
});
resetHoneyWalletLinkCacheForTests();

const resolved = await resolveLocalHoneyMultiplier();
assert.equal(resolved.multiplierBps, 25_000, "fresh cache resolves without an RPC read");
assert.equal(resolved.foundingBee, true);

const inputText = "i".repeat(400);
const outputText = "o".repeat(399);
const usage = await recordHoneyUsage({ agentId: "agent-a", inputText, outputText });
assert.ok(usage.event, "usage event minted");
const tokensUsed = usage.event.tokensUsed;
const baseHoney = calculateHoneyForTokens(tokensUsed, 1);
assert.equal(usage.event.multiplierBps, 25_000, "event records the applied multiplier");
assert.equal(usage.event.honeyDelta, applyHoneyMultiplier(baseHoney, 25_000), "minted Honey = base x 2.5");
assert.ok(usage.event.honeyDelta > baseHoney, "multiplied mint exceeds base");

const observed = await recordObservedHoneyUsage({
  eventId: "observed-multiplier-1",
  agentId: "agent-b",
  source: "observed-runtime-usage",
  model: "local/test",
  tokensUsed: 1000,
});
assert.ok(observed.event, "observed event minted");
assert.equal(observed.event.honeyDelta, applyHoneyMultiplier(calculateHoneyForTokens(1000, 1), 25_000));
assert.equal(observed.event.multiplierBps, 25_000);

console.log("PASS local mint paths apply the Founding Queen Bee 2.5x");

// --- founding-only wallet (no active tier) mints at 1.5x ---

await writeHoneyWalletLink({
  address: "0x4f89c07321ae91cc98aae986317e927875898bc9",
  linkedAt: new Date().toISOString(),
  gatewayLinked: false,
  cache: {
    multiplierBps: 15_000,
    tierId: null,
    foundingBee: true,
    stakedHive: "0",
    checkedAt: new Date().toISOString(),
  },
});
resetHoneyWalletLinkCacheForTests();
await resolveLocalHoneyMultiplier();
const foundingOnly = await recordObservedHoneyUsage({
  eventId: "observed-multiplier-2",
  agentId: "agent-b",
  source: "observed-runtime-usage",
  model: "local/test",
  tokensUsed: 1000,
});
assert.equal(foundingOnly.event.honeyDelta, applyHoneyMultiplier(calculateHoneyForTokens(1000, 1), 15_000), "unstaked founding wallet keeps +0.5x on the 1.0x base");

// --- no link resolves to base 1.00x ---

await writeFile(join(tempHome, ".hivemindos", "honey-wallet-link.json"), "not json");
resetHoneyWalletLinkCacheForTests();
const unlinked = await resolveLocalHoneyMultiplier();
assert.equal(unlinked.multiplierBps, 10_000, "unreadable link file fails closed to base");
assert.equal(unlinked.address, null);

console.log("PASS founding-only 1.5x and base fallback");

// --- potential Honey summary (local-model usage, private, claim-path message) ---

const { localPotentialHoneySummary } = await import("../src/lib/services/wallet/honey-ledger.ts");
const potential = await localPotentialHoneySummary();
assert.ok(potential.tokensTracked >= 1000, `local usage tokens tracked (got ${potential.tokensTracked})`);
assert.ok(potential.honey > 0, "potential honey derived from tracked tokens");
assert.match(potential.message, /verified compute/i, "claim message names the cloud path");
assert.match(potential.message, /TEE-attested/i, "claim message names the TEE path");
console.log("PASS potential-Honey summary with claim-path message");

// --- verified-compute reroute resolution (opt-in, cloud-only, fail-closed) ---

const { resolveVerifiedComputeRoute, resetVerifiedComputeCacheForTests } =
  await import("../src/lib/services/wallet/verified-compute.ts");

process.env.HIVEMINDOS_VERIFIED_COMPUTE = "0";
resetVerifiedComputeCacheForTests();
assert.equal(
  await resolveVerifiedComputeRoute({ provider: "openai", token: "sk-proj-abcdef1234567890", gatewayUrl: "https://api.openai.com/v1" }),
  null,
  "toggle off means no reroute",
);

process.env.HIVEMINDOS_VERIFIED_COMPUTE = "1";
resetVerifiedComputeCacheForTests();
const route = await resolveVerifiedComputeRoute({
  provider: "openai",
  token: "sk-proj-abcdef1234567890",
  gatewayUrl: "https://api.openai.com/v1",
  agentId: "agent-a",
  agentName: "Agent A",
});
assert.ok(route, "enabled cloud provider reroutes");
assert.match(route.url, /\/v1\/chat\/completions$/);
assert.equal(route.headers["X-Hivemind-Provider"], "openai");
assert.ok(route.headers["X-Hivemind-Workspace-Id"], "workspace identity header attached");
assert.equal(route.headers["X-Hivemind-Agent-Id"], "agent-a");

assert.equal(
  await resolveVerifiedComputeRoute({ provider: "lm-studio", token: "sk-local-abcdef123456", gatewayUrl: "http://127.0.0.1:1234" }),
  null,
  "local runtimes are never rerouted (local-first)",
);
assert.equal(
  await resolveVerifiedComputeRoute({ provider: "openai", token: "", gatewayUrl: "https://api.openai.com/v1" }),
  null,
  "no key means nothing to bring (managed shared key is never used)",
);
assert.equal(
  await resolveVerifiedComputeRoute({ provider: "openai", token: "sk-proj-abcdef1234567890", gatewayUrl: route.url }),
  null,
  "already-gateway calls are not double-rerouted",
);
delete process.env.HIVEMINDOS_VERIFIED_COMPUTE;
console.log("PASS verified-compute reroute: opt-in, cloud-only, loop-safe");

console.log("honey staking multiplier tests passed");
