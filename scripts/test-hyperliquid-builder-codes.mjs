#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const officialPolicyUrl = "https://hivemindos-paid-agent-gateway.hivemindos.workers.dev/api/hyperliquid/builder-policy";
const originalFetch = globalThis.fetch;
const requestedUrls = [];
globalThis.fetch = async (url) => {
  requestedUrls.push(String(url));
  assert.equal(String(url), officialPolicyUrl);
  return Response.json({
    ok: true,
    official: true,
    enabled: true,
    configured: true,
    network: "testnet",
    builderAddress: "0x1234567890ABCDEF1234567890abcdef12345678",
    builderFeeTenthBps: 10,
    maxBuilderFeeTenthBps: 20,
    apiUrl: "https://api.hyperliquid-testnet.xyz",
    missing: [],
    detail: "Test official policy.",
  });
};

const {
  DEFAULT_HYPERLIQUID_BUILDER_POLICY_URL,
  HYPERLIQUID_BUILDER_POLICY_STATUS_KEY,
  HYPERLIQUID_BUILDER_CONFIRMATION,
  HYPERLIQUID_ORDER_CONFIRMATION,
  builderFeeTenthBpsToPercentString,
  formatBuilderFee,
  formatHyperliquidPerpPrice,
  formatHyperliquidSize,
  hyperliquidPolicyPresence,
  readHyperliquidBuilderConfig,
} = await import("../src/lib/services/trading/hyperliquid.ts");
const { listHiveActions } = await import("../src/lib/services/hive-actions/index.ts");

assert.equal(HYPERLIQUID_ORDER_CONFIRMATION, "CONFIRM_HYPERLIQUID_ORDER");
assert.equal(HYPERLIQUID_BUILDER_CONFIRMATION, "CONFIRM_HYPERLIQUID_BUILDER");
assert.equal(builderFeeTenthBpsToPercentString(1), "0.001%");
assert.equal(builderFeeTenthBpsToPercentString(5), "0.005%");
assert.equal(builderFeeTenthBpsToPercentString(10), "0.01%");
assert.equal(builderFeeTenthBpsToPercentString(100), "0.1%");
assert.equal(formatBuilderFee(5), "0.5 bps (0.005%)");
assert.equal(formatBuilderFee(10), "1 bps (0.01%)");
assert.equal(formatHyperliquidSize(0.123456, 3), "0.123");
assert.equal(formatHyperliquidPerpPrice(123.456, 3), "123.46");
assert.equal(formatHyperliquidPerpPrice(12345.678, 3), "12346");

const config = await readHyperliquidBuilderConfig();
assert.equal(config.configured, true);
assert.equal(config.official, true);
assert.equal(config.source, "official-policy");
assert.equal(config.policyUrl, officialPolicyUrl);
assert.equal(config.isTestnet, true);
assert.equal(config.builderAddress, "0x1234567890abcdef1234567890abcdef12345678");
assert.equal(config.builderFeeTenthBps, 10);
assert.equal(config.maxBuilderFeeTenthBps, 20);
assert.equal(config.maxBuilderFeeRate, "0.02%");
assert.equal(config.apiUrl, "https://api.hyperliquid-testnet.xyz");
assert.deepEqual(requestedUrls, [officialPolicyUrl]);
assert.equal(DEFAULT_HYPERLIQUID_BUILDER_POLICY_URL, officialPolicyUrl);
assert.equal(HYPERLIQUID_BUILDER_POLICY_STATUS_KEY, "official-hivemindos-hyperliquid-builder-policy");
assert.deepEqual(await hyperliquidPolicyPresence(), [{
  key: "official-hivemindos-hyperliquid-builder-policy",
  present: true,
  source: "official-policy",
}]);
assert.deepEqual(requestedUrls, [officialPolicyUrl]);

const hyperliquidAction = listHiveActions().find((action) => action.mcp?.toolName === "hyperliquid_trade");
assert.ok(hyperliquidAction, "hyperliquid_trade should be registered");
assert.equal(hyperliquidAction.contextIndex?.route, "/api/trading/hyperliquid");
assert.deepEqual(hyperliquidAction.confirmation?.tokens, [
  "CONFIRM_HYPERLIQUID_ORDER",
  "CONFIRM_HYPERLIQUID_BUILDER",
  "CONFIRM_HYPERLIQUID_CANCEL",
  "CONFIRM_HYPERLIQUID_ACCOUNT",
  "CONFIRM_HYPERLIQUID_TRANSFER",
  "CONFIRM_HYPERLIQUID_TWAP",
]);

const serviceSource = fs.readFileSync(new URL("../src/lib/services/trading/hyperliquid.ts", import.meta.url), "utf8");
const routeSource = fs.readFileSync(new URL("../src/app/api/trading/hyperliquid/route.ts", import.meta.url), "utf8");
const envExample = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const workerSource = fs.readFileSync(new URL("../workers/paid-agent-gateway/src/index.ts", import.meta.url), "utf8");
assert.match(serviceSource, /client\.maxBuilderFee/);
assert.match(serviceSource, /client\.approvedBuilders/);
assert.match(serviceSource, /approveBuilderFee/);
assert.match(serviceSource, /builder:\s*draft\.builder/);
assert.match(serviceSource, /DEFAULT_HYPERLIQUID_BUILDER_POLICY_URL/);
assert.doesNotMatch(serviceSource, /hiveEnvValue|HIVEMINDOS_HYPERLIQUID_BUILDER_ADDRESS/);
assert.doesNotMatch(routeSource, /body\.(builder|builderAddress|builderFee|builderFeeTenthBps|maxBuilderFee)/);
assert.match(routeSource, /getWalletSecret\(agentId\)/);
assert.match(routeSource, /loadGovernanceWallet\(agentId\)/);
assert.doesNotMatch(envExample, /HIVEMINDOS_HYPERLIQUID_BUILDER_ADDRESS/);
assert.match(workerSource, /\/api\/hyperliquid\/builder-policy/);

globalThis.fetch = originalFetch;

console.log("Hyperliquid builder-code tests passed.");
