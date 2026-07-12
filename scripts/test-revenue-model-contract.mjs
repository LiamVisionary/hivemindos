#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  investor,
  sequence,
  honey,
  staking,
  managedContract,
  managedPanel,
  rewardsPanel,
  honeyRoute,
  feePolicy,
  companyCockpit,
  companyRoute,
  companyService,
  stakingConfig,
  marketplace,
] = await Promise.all([
  read("docs/for-investors/index.md"),
  read("docs/for-investors/ecosystem-plan.md"),
  read("docs/for-investors/honey-hive-treasury.md"),
  read("docs/for-investors/hive-staking-and-community-tiers.md"),
  read("src/lib/services/managed-cloud-agents-contract.ts"),
  read("src/features/dashboard/views/ManagedCloudAgentsPanel.tsx"),
  read("src/components/wallets-drop-in/WalletRewardsActions.tsx"),
  read("src/app/api/honey-ledger/route.ts"),
  read("src/lib/services/wallet/platform-fees.ts"),
  read("src/features/dashboard/views/zero-human-companies/Cockpit.tsx"),
  read("src/app/api/company-revenue/route.ts"),
  read("src/lib/services/company-revenue-share.ts"),
  read("src/lib/config/hive-staking.ts"),
  read("docs/for-investors/paid-features/hive-compute-marketplace.md"),
]);

assert.match(investor, /one monetization engine/i);
assert.match(investor, /Cloud Pro \| \$39\/month \| Design-partner validation/);
assert.match(investor, /Cloud Team \| \$299\/month \| Design-partner validation/);
assert.match(investor, /Enterprise \| \$30,000\/year minimum/);
assert.match(investor, /Managed Agent Operations Pilot/);
assert.match(sequence, /marketplace liquidity/i);
assert.match(sequence, /evidence-gated/i);

for (const document of [investor, sequence, honey, staking]) {
  assert.doesNotMatch(document, /HIVE represents ownership|HIVE is the ownership layer|revenue-backed momentum|seasonal HIVE reward pool|Every `\$1,000,000` in eligible/i);
}
assert.match(honey, /Honey is not automatically convertible to HIVE/);
assert.match(staking, /not a yield farm/i);
assert.doesNotMatch(stakingConfig, /rewardWeight|rewardBoostLabel|seasonal rewards/i);
await assert.rejects(access(new URL("src/app/api/hive/stake/rewards/route.ts", root)));
await assert.rejects(access(new URL("src/lib/services/hive-staking-rewards.ts", root)));
assert.match(marketplace, /not a near-term revenue assumption/i);
assert.match(marketplace, /Evidence Gates/i);

assert.match(managedContract, /id: "community" \| "cloud-pro" \| "cloud-team" \| "enterprise"/);
assert.match(managedPanel, /Control plane subscription \+ metered managed usage/);
assert.doesNotMatch(rewardsPanel, /Claim Bankr HIVE|Ready to claim/);
assert.match(rewardsPanel, /not cash, company ownership, or automatically convertible to HIVE/);
assert.match(honeyRoute, /HIVEMINDOS_HONEY_HIVE_CONVERSION_ENABLED/);
assert.match(honeyRoute, /status: 403/);

assert.match(feePolicy, /DEFAULT_COMPANY_REVENUE_FEE_BPS = 0/);
assert.match(feePolicy, /No platform fee applies to this action/);
assert.match(feePolicy, /policy\.sourceBasisPoints\?\.\[source\]/);
assert.doesNotMatch(companyCockpit, /Record \+ collect|Collecting agent wallet/);
assert.match(companyCockpit, /external fee · \$0/);
assert.match(companyRoute, /Revenue earned outside HivemindOS carries no platform fee/);
assert.doesNotMatch(companyService, /collectCompanyRevenueFee|COMPANY_REVENUE_FEE_CONFIRMATION/);

console.log("Revenue model contract checks passed.");
