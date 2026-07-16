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
  paidFeatures,
  treasuryPrograms,
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
  read("docs/for-investors/paid-features/index.md"),
  read("docs/for-investors/treasury-reserve-and-seasonal-programs.md"),
]);

assert.match(investor, /one product relationship with two compounding revenue engines/i);
assert.match(investor, /Cloud revenue is the nearer-term recurring base; transaction revenue is the asymmetric upside/i);
assert.match(investor, /Cloud Pro \| \$39\/month \| Design-partner validation/);
assert.match(investor, /Cloud Team \| \$299\/month \| Design-partner validation/);
assert.match(investor, /Enterprise \| \$30,000\/year minimum/);
assert.match(investor, /Managed Agent Operations Pilot/);
assert.match(investor, /DEX swaps \| 0\.20% \| Live platform fee/);
assert.match(investor, /Paid x402 and Veil private-payment execution \| 0\.50% \| Live platform fee/);
assert.match(investor, /Eligible local Hyperliquid perp fills \| 0\.005% \| Live builder fee/);
assert.match(investor, /Base Builder Codes.*are attribution infrastructure, not a contractual fee/i);
assert.match(investor, /Illustrative gross platform-fee sensitivity—not a forecast/i);
assert.match(investor, /Bankr-mediated swaps, cross-chain actions, token launches, prediction markets, NFTs, and automations/i);
assert.doesNotMatch(investor, /one monetization engine|trading fees.*after the core managed-service business/i);
assert.match(sequence, /marketplace liquidity/i);
assert.match(sequence, /evidence-gated/i);
assert.match(sequence, /Agent Economy Transaction Expansion/);
assert.match(sequence, /Base x402 transaction \| Builder Code attribution; rewards are contingent rather than guaranteed/);
assert.match(paidFeatures, /One Platform, Two Revenue Engines/);
assert.match(paidFeatures, /Base x402 Builder Code \| Attribution and potential rewards \| Live attribution; rewards not guaranteed/);

for (const document of [investor, sequence, honey, staking, paidFeatures, treasuryPrograms]) {
  assert.doesNotMatch(document, /HIVE represents ownership|HIVE is the ownership layer|revenue-backed momentum|reward season|reward pool|reward distributor|buy-and-burn|Every `\$1,000,000` in eligible/i);
}
assert.match(honey, /Honey does not automatically convert to HIVE/);
assert.match(honey, /non-transferable, non-spendable/i);
assert.match(staking, /does not grant company ownership, binding governance, treasury control[\s\S]*yield, revenue share/i);

// The six staking tiers keep all three product-benefit curves while exact
// service pricing and both revenue allocations remain separate hosted policy.
assert.match(staking, /## Member Pricing: Up To 61% Off/);
assert.match(staking, /This is consumption pricing:[\s\S]*no tier receives a payout/);
assert.match(staking, /Staking does not grant company ownership, binding governance, treasury control/i);
assert.match(honey, /member pricing of up to 61% off/i);
assert.match(paidFeatures, /member usage pricing/i);
assert.match(staking, /Revenue Policy Is Separate From Staking/);
assert.match(staking, /up to 61% off/i);
assert.match(staking, /Exact service prices, cost floors, eligible products, and tier-level discount calculations remain server-owned/i);
assert.doesNotMatch(staking, /\$0\.99|\$0\.39/);
assert.match(staking, /15% of recognized platform revenue/i);
assert.match(staking, /separate exact 15% goes to the company treasury/i);
assert.match(staking, /treasury does not fund buybacks/i);
assert.match(honey, /15% of recognized platform revenue/i);
assert.match(honey, /separate exact 15% of recognized platform revenue goes to the company treasury/i);
assert.match(honey, /treasury does not fund HIVE buybacks/i);
assert.match(honey, /Purchased credits are recognized only when consumed/i);
assert.match(honey, /Marketplace gross merchandise value is not platform revenue/i);
assert.match(honey, /HivemindOS does not burn HIVE/i);
assert.match(honey, /treasury allocation remains company property/i);
assert.match(honey, /no holder or staker ownership, redemption right, revenue share, governance right, or claim on treasury assets/i);
assert.match(honey, /## Tokenomics Policy Changes/);
assert.match(honey, /not an immutable promise/i);
assert.match(honey, /Completed on-chain actions and historical receipts remain part of the public record/i);
assert.match(staking, /Publish material benefit or policy changes prospectively with an effective date/i);
assert.match(investor, /Tokenomics policies may change, pause, or end/i);
assert.match(paidFeatures, /HIVE buyback allocation/);
assert.match(investor, /15% of recognized platform revenue/i);
assert.match(investor, /separate 15% to the company treasury/i);
assert.doesNotMatch(investor, /up to 15%/i);
assert.match(investor, /HIVE Buyback Ledger/);
assert.match(investor, /tokenomics policy assigns no fixed use to the remaining 70%/i);
assert.doesNotMatch(stakingConfig, /rewardWeight|rewardBoostLabel|seasonal rewards/i);
await assert.rejects(access(new URL("src/app/api/hive/stake/rewards/route.ts", root)));
await assert.rejects(access(new URL("src/lib/services/hive-staking-rewards.ts", root)));
assert.match(marketplace, /not a near-term revenue assumption/i);
assert.match(marketplace, /Evidence Gates/i);
assert.match(treasuryPrograms, /HIVE buybacks \| 15% of recognized platform revenue/i);
assert.match(treasuryPrograms, /Company treasury \| 15% of recognized platform revenue/i);
assert.match(treasuryPrograms, /Outside tokenomics allocation \| 70% of recognized platform revenue/i);
assert.match(treasuryPrograms, /treasury is not the source of HIVE purchases/i);
assert.match(treasuryPrograms, /HivemindOS does not burn HIVE/i);

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
