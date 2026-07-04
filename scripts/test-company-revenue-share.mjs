#!/usr/bin/env node
// Hermetic coverage for Zero Human Company revenue-share accounting:
// - external revenue events land in a separate local ledger, not spend caps
// - the HivemindOS share quotes through the platform-fee policy source
// - external ids dedupe repeated webhook/report submissions
// - missing fee-collection confirmation does not mutate the ledger
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-company-revenue-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-company-revenue-vault-"));

process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;
process.env.HIVEMINDOS_TRADING_PLATFORM_FEES_ENABLED = "true";
delete process.env.HIVEMINDOS_TRADING_PLATFORM_FEE_BPS;
delete process.env.HIVEMINDOS_PLATFORM_FEE_BPS;
delete process.env.HIVEMINDOS_COMPANY_REVENUE_SHARE_BPS;
delete process.env.HIVEMINDOS_ZHC_REVENUE_SHARE_BPS;
process.env.HIVEMINDOS_TRADING_PLATFORM_MIN_FEE_USD = "0.01";
process.env.HIVEMINDOS_PLATFORM_FEE_RECIPIENT_EVM = "0x1111111111111111111111111111111111111111";
process.env.HIVEMINDOS_PLATFORM_FEE_POLICY_URL = "disabled";

const {
  COMPANY_REVENUE_LEDGER_PATH,
  COMPANY_REVENUE_FEE_CONFIRMATION,
  companyRevenueRollup,
  quoteCompanyRevenueShare,
  readCompanyRevenueLedger,
  recordCompanyRevenue,
} = await import("../src/lib/services/company-revenue-share.ts");
const { upsertCompany } = await import("../src/lib/services/companies-store.ts");
const { quoteTradingPlatformFee } = await import("../src/lib/services/wallet/platform-fees.ts");
const { readSpendLedger } = await import("../src/lib/services/wallet/spend-ledger.ts");

try {
  const company = await upsertCompany({
    name: "Revenue Share Co",
    members: [{ agentId: "hermes-alpha", roleInCompany: "Queen" }],
    apexGoal: { title: "Reach $10k MRR", metric: "MRR", target: "10000", unit: "currency" },
  });

  const walletQuote = await quoteTradingPlatformFee({ source: "wallet-send", amountUsd: 125, network: "eip155:8453" });
  assert.equal(walletQuote.amountUsd, 1.25, "ordinary wallet platform fee remains 1%");
  assert.equal(walletQuote.basisPoints, 100);

  const quote = await quoteCompanyRevenueShare({ amountUsd: 125, network: "eip155:8453" });
  assert.equal(quote.status, "quoted");
  assert.equal(quote.amountUsd, 2.5);
  assert.equal(quote.basisPoints, 200);
  assert.equal(quote.recipient, "0x1111111111111111111111111111111111111111");

  const first = await recordCompanyRevenue({
    companyId: company.id,
    amountUsd: 125,
    source: "invoice",
    externalId: "inv-001",
    customerLabel: "Customer A",
    receivedAt: "2026-07-04T00:00:00.000Z",
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.record.status, "fee-pending");
  assert.equal(first.record.fee.amountUsd, 2.5);
  assert.equal(first.rollup.eventCount, 1);
  assert.equal(first.rollup.totalRevenueUsd, 125);
  assert.equal(first.rollup.sharePendingUsd, 2.5);
  assert.match(await readFile(COMPANY_REVENUE_LEDGER_PATH, "utf8"), /inv-001/);

  const duplicate = await recordCompanyRevenue({
    companyId: company.id,
    amountUsd: 125,
    source: "invoice",
    externalId: "inv-001",
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.rollup.eventCount, 1, "externalId dedupes repeated submissions");

  await assert.rejects(
    () => recordCompanyRevenue({
      companyId: company.id,
      amountUsd: 20,
      source: "stripe",
      externalId: "pi-missing-confirmation",
      collectFee: true,
      collectingAgentId: "hermes-alpha",
    }),
    new RegExp(COMPANY_REVENUE_FEE_CONFIRMATION),
  );
  assert.equal((await readCompanyRevenueLedger()).length, 1, "missing confirmation does not write a failed event");

  const tiny = await recordCompanyRevenue({
    companyId: company.id,
    amountUsd: 0.25,
    source: "marketplace",
    externalId: "market-001",
  });
  assert.equal(tiny.record.fee.amountUsd, 0.01, "minimum fee applies to tiny revenue");
  assert.equal(tiny.rollup.eventCount, 2);
  assert.equal(tiny.rollup.totalRevenueUsd, 125.25);
  assert.equal(tiny.rollup.sharePendingUsd, 2.51);

  const rollup = await companyRevenueRollup(company.id);
  assert.equal(rollup.shareCollectedUsd, 0);
  assert.equal(rollup.shareQuotedUsd, 2.51);
  assert.deepEqual(await readSpendLedger(), [], "recording external revenue does not count as company spend");

  console.log("company revenue-share suite passed");
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);
