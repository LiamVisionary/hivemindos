#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const root = process.cwd();
const chainWallet = await import("../src/lib/services/wallet/chain-wallet.ts");
const { refreshWalletUntilAssetBalance } = await import("../src/lib/services/wallet/post-send-balance-refresh.ts");

const staleRecipient = {
  address: "0x3333000000000000000000000000000000003333",
  network: "eip155:8453",
  nativeBalance: 0.00001,
  tokens: [{ symbol: "ETH", balance: 0.00001, network: "eip155:8453", isNative: true }],
};
const refreshedRecipient = {
  ...staleRecipient,
  nativeBalance: 0.01001,
  tokens: [{ symbol: "ETH", balance: 0.01001, network: "eip155:8453", isNative: true }],
};
const balanceReads = [[staleRecipient], [refreshedRecipient]];
const persistedBalanceBatches = [];
let invalidatedRecipient = false;
const refreshResult = await refreshWalletUntilAssetBalance({
  asset: "ETH",
  address: staleRecipient.address,
  network: staleRecipient.network,
  minimumBalance: 0.01001,
  retryDelaysMs: [0, 1],
  read: async () => balanceReads.shift() ?? [],
  persist: async (wallets) => persistedBalanceBatches.push(wallets),
  invalidate: async () => { invalidatedRecipient = true; },
  wait: async () => undefined,
});
assert.equal(refreshResult.synced, true, "post-send refresh must retry when the first RPC response is stale");
assert.equal(persistedBalanceBatches.length, 1, "a stale pre-transfer balance must never be stamped fresh");
assert.equal(persistedBalanceBatches[0][0]?.nativeBalance, 0.01001);
assert.equal(invalidatedRecipient, false);

let exhaustedInvalidation = false;
const exhaustedResult = await refreshWalletUntilAssetBalance({
  asset: "ETH",
  address: staleRecipient.address,
  network: staleRecipient.network,
  minimumBalance: 0.01001,
  retryDelaysMs: [0, 1],
  read: async () => [staleRecipient],
  persist: async () => assert.fail("an unobserved recipient balance must not be persisted as fresh"),
  invalidate: async () => { exhaustedInvalidation = true; },
  wait: async () => undefined,
});
assert.equal(exhaustedResult.synced, false);
assert.equal(exhaustedInvalidation, true, "an exhausted refresh must invalidate the recipient cache so reload retries it");

assert.equal(typeof chainWallet.walletAssetAtomicAmount, "function", "wallet transfers need one exact decimal-to-atomic conversion helper");
assert.equal(chainWallet.walletAssetAtomicAmount(1.25, 6), 1_250_000n);
assert.equal(chainWallet.walletAssetAtomicAmount(0.000000001, 9), 1n);
assert.throws(() => chainWallet.walletAssetAtomicAmount(0, 6), /greater than zero/i);
assert.throws(() => chainWallet.walletAssetAtomicAmount(1.0000001, 6), /decimal places/i);

assert.equal(typeof chainWallet.resolveWalletTransferAsset, "function", "the server must resolve the requested asset from a fresh wallet balance");
const liveBalance = {
  tokens: [
    { symbol: "ETH", balance: 0.2, network: "eip155:8453", priceUsd: 2500, isNative: true },
    { symbol: "HIVE", balance: 42, network: "eip155:8453", priceUsd: 0.1, tokenAddress: "0x1111000000000000000000000000000000001111" },
    { symbol: "HIVE", balance: 3, network: "eip155:8453", priceUsd: 0.2, tokenAddress: "0x2222000000000000000000000000000000002222" },
  ],
};
assert.equal(chainWallet.resolveWalletTransferAsset(liveBalance, "ETH")?.isNative, true);
assert.equal(
  chainWallet.resolveWalletTransferAsset(liveBalance, "hive", "0x1111000000000000000000000000000000001111")?.balance,
  42,
);
assert.throws(() => chainWallet.resolveWalletTransferAsset(liveBalance, "HIVE"), /multiple HIVE tokens/i);
assert.throws(() => chainWallet.resolveWalletTransferAsset(liveBalance, "DOGE"), /does not hold DOGE/i);

const sendRoute = readFileSync(join(root, "src/app/api/wallet/send/route.ts"), "utf8");
assert.match(sendRoute, /assetAmount\?: string \| number/);
assert.match(sendRoute, /executePersonalWalletAssetSend/);
assert.match(sendRoute, /confirmation !== "SEND_TOKEN"/);
assert.match(sendRoute, /approval\.asset === normalizeAssetSymbol/);

process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET = "s".repeat(40);
process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN = "t".repeat(32);
const { POST: sendWallet } = await import("../src/app/api/wallet/send/route.ts");
const headers = { "content-type": "application/json", "x-hivemindos-device-token": process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN };
const approvalResponse = await sendWallet(new Request("http://unit.test/api/wallet/send", {
  method: "POST",
  headers,
  body: JSON.stringify({
    action: "approve",
    agentId: "user:test:eip155-8453",
    toAddress: "0x3333000000000000000000000000000000003333",
    asset: "HIVE",
    assetAmount: "1.5",
    tokenAddress: "0x1111000000000000000000000000000000001111",
    confirmation: "SEND_TOKEN",
  }),
}));
const approval = await approvalResponse.json();
assert.equal(approvalResponse.status, 200, approval.error);
const tamperedAmountResponse = await sendWallet(new Request("http://unit.test/api/wallet/send", {
  method: "POST",
  headers,
  body: JSON.stringify({
    action: "send",
    agentId: "user:test:eip155-8453",
    toAddress: "0x3333000000000000000000000000000000003333",
    asset: "HIVE",
    assetAmount: "1.6",
    tokenAddress: "0x1111000000000000000000000000000000001111",
    confirmation: "SEND_TOKEN",
    approvalToken: approval.approvalToken,
  }),
}));
assert.equal(tamperedAmountResponse.status, 400, "the one-time approval must bind the exact token amount");

const chainWalletSource = readFileSync(join(root, "src/lib/services/wallet/chain-wallet.ts"), "utf8");
assert.match(chainWalletSource, /export async function sendWalletAsset/);
assert.match(chainWalletSource, /SystemProgram\.transfer/);
assert.match(chainWalletSource, /functionName: "transfer"/);
assert.match(chainWalletSource, /TOKEN_2022_PROGRAM_ID/);

const personalSendSource = readFileSync(join(root, "src/lib/services/wallet/personal-wallet-asset-send.ts"), "utf8");
assert.match(personalSendSource, /agentId\.startsWith\("user:"\)/);
assert.match(personalSendSource, /getWalletBalance/);
assert.match(personalSendSource, /resolveWalletTransferAsset/);
assert.match(personalSendSource, /sendWalletAsset/);

console.log("Personal wallet arbitrary-token send checks passed.");
