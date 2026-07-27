#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { buildNansenComplexTemplateBrief } = await import("../src/lib/services/nansen.ts");

const ETHEREUM_USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const PUBLIC_WALLET = "0x28c6c06298d514db089934071355e5743bf21d60";

const cases = [
  {
    name: "token tracking + Smart Money",
    input: {
      template: "token-tracking-smart-money",
      chain: "ethereum",
      chains: ["ethereum"],
      tokenAddress: ETHEREUM_USDC,
      tokenSymbol: "USDC",
    },
    expectedEndpoints: [
      "/api/v1/search/general",
      "/api/v1/token-screener",
      "/api/v1/smart-money/netflow",
      "/api/v1/tgm/pnl-leaderboard",
    ],
  },
  {
    name: "Hyperliquid wallet discovery",
    input: {
      template: "hyperliquid-wallet-discovery",
      address: PUBLIC_WALLET,
    },
    expectedEndpoints: [
      "/api/v1/perp-leaderboard",
      "/api/v1/profiler/perp-positions",
      "/api/v1/profiler/perp-trades",
    ],
  },
  {
    name: "related wallets at scale",
    input: {
      template: "related-wallets-scale",
      chain: "ethereum",
      address: PUBLIC_WALLET,
      includeLabels: true,
    },
    expectedEndpoints: [
      "/api/v1/profiler/address/premium-labels",
      "/api/v1/profiler/address/related-wallets",
      "/api/v1/profiler/address/counterparties",
      "/api/v1/profiler/address/historical-balances",
      "/api/v1/profiler/address/transactions",
    ],
  },
  {
    name: "top wallet token research",
    input: {
      template: "top-wallet-copytrade-research",
      chain: "ethereum",
      chains: ["ethereum"],
      tokenAddress: ETHEREUM_USDC,
      address: PUBLIC_WALLET,
    },
    expectedEndpoints: [
      "/api/v1/tgm/flow-intelligence",
      "/api/v1/tgm/pnl-leaderboard",
      "/api/v1/smart-money/dex-trades",
      "/api/v1/tgm/holders",
      "/api/v1/profiler/address/pnl-summary",
    ],
  },
  {
    name: "CEX health monitor",
    input: {
      template: "cex-health-monitor",
      entityName: "Coinbase",
      chain: "base",
    },
    expectedEndpoints: [
      "/api/v1/profiler/address/current-balance",
      "/api/v1/profiler/address/counterparties",
    ],
  },
];

for (const testCase of cases) {
  const brief = await buildNansenComplexTemplateBrief(testCase.input);
  assert.ok(["ok", "partial"].includes(brief.status), `${testCase.name} should return ok or partial, got ${brief.status}`);
  assert.equal(brief.kind, "complex-template", `${testCase.name} should return a complex-template brief`);
  assert.ok(brief.sources.length > 0, `${testCase.name} should include successful sources`);
  assert.ok(brief.cards.length > 0, `${testCase.name} should include cards`);
  for (const endpoint of testCase.expectedEndpoints) {
    assert.ok(
      brief.sources.some((source) => source.endpoint === endpoint),
      `${testCase.name} should include successful source ${endpoint}; got ${brief.sources.map((source) => source.endpoint).join(", ")}`,
    );
  }
  console.log(`${testCase.name}: ${brief.status}; sources=${brief.sources.map((source) => source.label).join(", ")}`);
}

console.log("Nansen complex template live E2E checks passed.");
