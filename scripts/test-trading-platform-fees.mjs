#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const ROOT = new URL("../", import.meta.url);

const files = {
  fees: "src/lib/services/wallet/platform-fees.ts",
  workerBoundary: "workers/README.md",
  ledger: "src/lib/services/wallet/spend-ledger.ts",
  send: "src/lib/services/wallet/governed-send.ts",
  sendRoute: "src/app/api/wallet/send/route.ts",
  x402: "src/lib/services/wallet/x402-agent-fetch.ts",
  x402Route: "src/app/api/wallet/x402/route.ts",
  companyRevenue: "src/lib/services/company-revenue-share.ts",
  companyRevenueRoute: "src/app/api/company-revenue/route.ts",
  veilTransferRoute: "src/app/api/wallet/veil/transfer/route.ts",
  veilX402Route: "src/app/api/wallet/veil/x402/route.ts",
  swap: "src/lib/services/trading/dex-swap.ts",
  stocks: "src/lib/services/trading/buy-stock.ts",
  cryptoRouter: "src/lib/services/crypto-capability-router.ts",
  tradeApi: "src/features/dashboard/views/trade/trade-api.ts",
  tradeView: "src/components/trade/CapabilityRail.tsx",
  walletPanel: "src/features/dashboard/views/WalletPanel.tsx",
  docs: "docs/for-users/features/wallets-honey-and-x402.md",
  zhcDocs: "docs/for-users/features/zero-human-companies.md",
  env: ".env.example",
  contextIndex: "src/lib/services/context-index.ts",
};

const contents = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, path]) => [
    key,
    await readFile(new URL(path, ROOT), "utf8"),
  ])),
);

assert.match(contents.fees, /HIVEMINDOS_TRADING_PLATFORM_FEES_ENABLED/);
assert.match(contents.fees, /HIVEMINDOS_PLATFORM_FEE_RECIPIENT_EVM/);
assert.match(contents.fees, /HIVEMINDOS_PLATFORM_FEE_RECIPIENT_SOLANA/);
assert.match(contents.fees, /DEFAULT_COMPANY_REVENUE_FEE_BPS = 200/);
assert.match(contents.fees, /HIVEMINDOS_COMPANY_REVENUE_SHARE_BPS/);
assert.match(contents.fees, /DEFAULT_OFFICIAL_POLICY_URL/);
assert.match(contents.fees, /fetchHostedPolicy/);
assert.match(contents.fees, /hostedPlatformFeePolicy/);
assert.match(contents.fees, /collectTradingPlatformFee/);
assert.match(contents.fees, /quoteTradingPlatformFee/);
assert.match(contents.fees, /assertTradingPlatformFeeReady/);
assert.match(contents.fees, /sendUsdStable/);

assert.match(contents.ledger, /"platform-fee"/);
assert.match(contents.walletPanel, /Platform fee/);

assert.match(contents.send, /collectTradingPlatformFee/);
assert.match(contents.send, /assertTradingPlatformFeeReady/);
assert.match(contents.send, /source: "wallet-send"/);
assert.match(contents.sendRoute, /platformFee: result\.platformFee/);

assert.match(contents.swap, /quoteTradingPlatformFee/);
assert.match(contents.swap, /collectTradingPlatformFee/);
assert.match(contents.swap, /assertTradingPlatformFeeReady/);
assert.match(contents.swap, /source: "dex-swap"/);
assert.match(contents.swap, /platformFeeDetail/);
assert.match(contents.swap, /platformFeeReceiptDetail/);

assert.match(contents.stocks, /source: "xstocks"/);
assert.match(contents.stocks, /source: "alpaca-live"/);
assert.match(contents.stocks, /assertTradingPlatformFeeReady/);
assert.match(contents.stocks, /platformFeeDetail/);
assert.match(contents.stocks, /platformFeeReceiptDetail/);

assert.match(contents.x402, /source: "x402-paid-api"/);
assert.match(contents.x402, /assertTradingPlatformFeeReady/);
assert.match(contents.x402, /collectTradingPlatformFee/);
assert.match(contents.x402, /platformFee/);
assert.match(contents.x402Route, /fromAddress: stored\.info\.address/);
assert.match(contents.fees, /"company-revenue"/);
assert.match(contents.companyRevenue, /source: "company-revenue"/);
assert.match(contents.companyRevenue, /COMPANY_REVENUE_FEE_CONFIRMATION/);
assert.match(contents.companyRevenue, /collectTradingPlatformFee/);
assert.match(contents.companyRevenueRoute, /\/api\/company-revenue|recordCompanyRevenue/);

assert.match(contents.veilTransferRoute, /source: "veil-transfer"/);
assert.match(contents.veilTransferRoute, /quoteTradingPlatformFee/);
assert.match(contents.veilTransferRoute, /collectTradingPlatformFee/);
assert.match(contents.veilTransferRoute, /platformFee/);

assert.match(contents.veilX402Route, /source: "veil-x402"/);
assert.match(contents.veilX402Route, /quoteTradingPlatformFee/);
assert.match(contents.veilX402Route, /collectTradingPlatformFee/);
assert.match(contents.veilX402Route, /platformFee/);

assert.match(contents.cryptoRouter, /preparedPlatformFee/);
assert.match(contents.cryptoRouter, /source: "wallet-send"/);
assert.match(contents.tradeApi, /platformFee/);
assert.match(contents.tradeView, /Platform fee/);

assert.match(contents.workerBoundary, /Official platform-fee/);
assert.match(contents.workerBoundary, /fee-recipient/);
assert.match(contents.workerBoundary, /HivemindOS-controlled infrastructure/);

assert.match(contents.env, /HIVEMINDOS_PLATFORM_FEE_POLICY_URL=https:\/\/hivemindos-paid-agent-gateway\.hivemindos\.workers\.dev\/api\/platform-fees\/config/);
assert.match(contents.env, /HIVEMINDOS_TRADING_PLATFORM_FEE_BPS=100/);
assert.match(contents.env, /HIVEMINDOS_COMPANY_REVENUE_SHARE_BPS=200/);
assert.match(contents.env, /HIVEMINDOS_PLATFORM_FEE_RECIPIENT_EVM=/);
assert.match(contents.docs, /Trading Platform Fees/);
assert.match(contents.docs, /HivemindOS-hosted infrastructure by default/);
assert.match(contents.docs, /official HivemindOS-wide revenue enforcement/);
assert.match(contents.zhcDocs, /Revenue Share/);
assert.match(contents.zhcDocs, /2% of recorded company revenue/);
assert.match(contents.contextIndex, /Official trading platform fee policy is fetched from the hosted HivemindOS policy endpoint/);

console.log("Trading platform fee checks passed.");
