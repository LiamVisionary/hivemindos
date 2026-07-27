#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { buildNansenSimpleTemplateBrief } = await import("../src/lib/services/nansen.ts");

const ETHEREUM_USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const PUBLIC_WALLET = "0x28c6c06298d514db089934071355e5743bf21d60";

const cases = [
  {
    name: "DeFi positions",
    input: {
      template: "defi-positions",
      address: PUBLIC_WALLET,
    },
    expectedEndpoints: ["/api/v1/portfolio/defi-holdings"],
  },
  {
    name: "Smart Money holdings",
    input: {
      template: "smart-money-holdings",
      chains: ["ethereum", "base", "solana"],
    },
    expectedEndpoints: ["/api/v1/smart-money/holdings"],
  },
  {
    name: "token top holders",
    input: {
      template: "token-top-holders",
      chain: "ethereum",
      tokenAddress: ETHEREUM_USDC,
      labelType: "all_holders",
      premiumLabels: false,
    },
    expectedEndpoints: ["/api/v1/tgm/holders"],
  },
  {
    name: "token screener discovery",
    input: {
      template: "token-screener-discovery",
      chains: ["ethereum", "base", "solana"],
      timeframe: "24h",
    },
    expectedEndpoints: ["/api/v1/token-screener"],
  },
];

for (const testCase of cases) {
  const brief = await buildNansenSimpleTemplateBrief(testCase.input);
  assert.ok(["ok", "partial"].includes(brief.status), `${testCase.name} should return ok or partial, got ${brief.status}`);
  assert.equal(brief.kind, "simple-template", `${testCase.name} should return a simple-template brief`);
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

console.log("Nansen simple template live E2E checks passed.");
