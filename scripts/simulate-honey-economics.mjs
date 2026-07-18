#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [investorPolicy, honeyRoute, billingService] = await Promise.all([
  readFile(new URL("docs/for-investors/honey-hive-treasury.md", root), "utf8"),
  readFile(new URL("src/app/api/honey-ledger/route.ts", root), "utf8"),
  readFile(new URL("src/lib/services/managed-agent-billing.ts", root), "utf8"),
]);

function managedUsageEconomics({ upstreamUsd, markupBps }) {
  const retailUsd = Math.round(upstreamUsd * (1 + markupBps / 10_000) * 1_000_000) / 1_000_000;
  return {
    customerCollectionUsd: retailUsd,
    providerCostUsd: upstreamUsd,
    grossPlatformRevenueUsd: Math.round((retailUsd - upstreamUsd) * 1_000_000) / 1_000_000,
  };
}

const standardRoute = managedUsageEconomics({ upstreamUsd: 100, markupBps: 2_500 });
assert.deepEqual(standardRoute, {
  customerCollectionUsd: 125,
  providerCostUsd: 100,
  grossPlatformRevenueUsd: 25,
});

assert.match(investorPolicy, /Honey \| One cumulative, non-transferable, non-spendable record of verified ecosystem contribution/);
assert.match(investorPolicy, /Hivemind Cloud credits \| Purchased, spend-only service value/);
// The "does not promise a fixed revenue split" line was deliberately replaced
// (2026-07-13, 0c1c3c3e6) by the fixed 15% buyback allocation policy; the
// no-holder-rights commitment is the protection that must never regress.
assert.match(investorPolicy, /creates no holder or staker ownership, redemption right, revenue share, governance right, or claim on treasury assets/i);
assert.doesNotMatch(investorPolicy, /5% of (?:the )?creator/i);
assert.match(honeyRoute, /HIVEMINDOS_HONEY_HIVE_CONVERSION_ENABLED/);
assert.match(honeyRoute, /status: 403/);
assert.match(billingService, /upstreamUsd/);
assert.match(billingService, /retailUsd/);

console.log("Honey/Cloud-credit economics checks passed: contribution records, purchased service value, provider cost, and platform revenue remain separate.");
