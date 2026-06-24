import assert from "node:assert/strict";
import {
  B20_FACTORY_ADDRESS,
  B20_ISSUER_CHAIN_ID,
  B20_ISSUER_CHAIN_NAME,
  B20_ISSUER_NETWORK,
  buildB20IssuerDraftMessage,
  buildB20IssuerPayload,
  collectB20IssuerDetails,
  parseB20IssuerDraftMessage,
} from "../src/lib/services/crypto/b20-issuer-proof.ts";

const deployer = "0x375B021904D6B8FfA5B6d38366dB2D8A94749908";
const now = new Date("2026-06-24T00:00:00.000Z");

const missing = collectB20IssuerDetails({
  deployerAddress: deployer,
  messages: [{ role: "user", content: "hey make a b20 token" }],
});
assert.equal(missing.ok, false);
assert.match(missing.message, /token name/i);
assert.match(missing.message, /token symbol/i);
assert.match(missing.message, /initial supply/i);

const collected = collectB20IssuerDetails({
  deployerAddress: deployer,
  messages: [
    { role: "user", content: "hey make a b20 token" },
    { role: "user", content: "name Adaptive Test Token, symbol ADAPT, initial supply 1000" },
  ],
});
assert.equal(collected.ok, true);
assert.equal(collected.details.variant, "asset");
assert.equal(collected.details.name, "Adaptive Test Token");
assert.equal(collected.details.symbol, "ADAPT");
assert.equal(collected.details.decimals, 18);
assert.equal(collected.details.initialSupply, "1000");
assert.equal(collected.details.supplyCap, "1000");
assert.equal(collected.details.admin, deployer);
assert.equal(collected.details.recipient, deployer);

const payload = buildB20IssuerPayload(collected.details, deployer, now);
assert.equal(payload.variantId, 0);
assert.equal(payload.initialSupplyRaw.toString(), "1000000000000000000000");
assert.equal(payload.supplyCapRaw.toString(), "1000000000000000000000");
assert.equal(payload.initCalls.length, 6);
assert.match(payload.paramsHash, /^0x[a-fA-F0-9]{64}$/);
assert.match(payload.initCallsHash, /^0x[a-fA-F0-9]{64}$/);
assert.match(payload.calldataHash, /^0x[a-fA-F0-9]{64}$/);

const stable = collectB20IssuerDetails({
  deployerAddress: deployer,
  messages: [{ role: "user", content: "create a b20 stablecoin name Test USD, symbol TUSD, currency USD, initial supply 5000" }],
});
assert.equal(stable.ok, true);
assert.equal(stable.details.variant, "stablecoin");
assert.equal(stable.details.decimals, 6);
assert.equal(stable.details.currency, "USD");
assert.equal(buildB20IssuerPayload(stable.details, deployer, now).variantId, 1);

const draft = {
  ...collected.details,
  version: 1,
  agentId: "hermes-adaptiveagent-ec9dbd",
  network: B20_ISSUER_NETWORK,
  chainId: B20_ISSUER_CHAIN_ID,
  chainName: B20_ISSUER_CHAIN_NAME,
  rpcUrl: "https://sepolia.base.org",
  deployer,
  factory: B20_FACTORY_ADDRESS,
  variantId: payload.variantId,
  salt: payload.salt,
  params: payload.params,
  initCalls: payload.initCalls,
  initCallLabels: payload.initCallLabels,
  initialSupplyRaw: payload.initialSupplyRaw.toString(),
  supplyCapRaw: payload.supplyCapRaw.toString(),
  predictedAddress: "0xb200000000000000000000000000000000000001",
  paramsHash: payload.paramsHash,
  initCallsHash: payload.initCallsHash,
  calldataHash: payload.calldataHash,
  deployerBalanceEth: "0",
  gasEstimate: "250000",
  alreadyInitialized: false,
  createdAt: now.toISOString(),
};
const message = buildB20IssuerDraftMessage(draft);
assert.match(message, /B20 issuer proof ready/);
assert.match(message, /Fund it before confirming/);
assert.match(message, /Reply `confirm`/);
const parsed = parseB20IssuerDraftMessage(message);
assert.ok(parsed);
assert.equal(parsed?.symbol, "ADAPT");
assert.equal(parsed?.predictedAddress.toLowerCase(), "0xb200000000000000000000000000000000000001");

console.log("B20 issuer proof tests passed");
