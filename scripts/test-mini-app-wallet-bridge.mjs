#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bridge = await import(new URL("../src/lib/services/mini-app-wallet-bridge.ts", import.meta.url));
const signing = await import(new URL("../src/lib/services/wallet/mini-app-wallet-signing.ts", import.meta.url));

const request = {
  source: bridge.MINI_APP_WALLET_BRIDGE_SOURCE,
  version: bridge.MINI_APP_WALLET_BRIDGE_VERSION,
  type: "wallet-rpc-request",
  requestId: "request-1",
  method: "personal_sign",
  params: [
    "0x686976656d696e646f732e6170702077616e747320796f7520746f207369676e20696e3a",
    "0x1111111111111111111111111111111111111111",
  ],
};

assert.deepEqual(bridge.parseMiniAppWalletRequest(request), request, "the parent should accept the versioned wallet RPC request contract");
assert.equal(bridge.parseMiniAppWalletRequest({ ...request, source: "untrusted" }), null, "untrusted message sources must be ignored");
const malformedTransaction = { ...request, method: "eth_sendTransaction" };
assert.deepEqual(bridge.parseMiniAppWalletRequest(malformedTransaction), malformedTransaction, "the envelope may carry the one guarded transaction method");
assert.equal(bridge.parseRobinhoodUsdgTransferParams(malformedTransaction.params), null, "non-transaction parameters must never reach the send rail");
const faucetRequest = {
  ...request,
  method: "hivemindos_requestTestnetFaucet",
  params: [{
    network: "base-sepolia",
    asset: "eth",
    recipient: "0x2222222222222222222222222222222222222222",
    idempotencyKey: "mini-faucet-request-1",
  }],
};
assert.deepEqual(bridge.parseMiniAppWalletRequest(faucetRequest), faucetRequest, "the envelope may carry the scoped faucet action");
assert.deepEqual(bridge.parseTestnetFaucetRequestParams(faucetRequest.params), faucetRequest.params[0], "valid bounded faucet inputs should parse");
assert.equal(
  bridge.parseTestnetFaucetRequestParams([{ ...faucetRequest.params[0], network: "https://evil.example" }]),
  null,
  "faucet routing inputs must not carry a URL",
);
const recipient = "0x2222222222222222222222222222222222222222";
const usdgTransfer = [{
  from: "0x1111111111111111111111111111111111111111",
  to: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  value: "0x0",
  data: `0xa9059cbb${recipient.slice(2).padStart(64, "0")}${(5_000_000n).toString(16).padStart(64, "0")}`,
}];
assert.deepEqual(bridge.parseRobinhoodUsdgTransferParams(usdgTransfer), {
  from: "0x1111111111111111111111111111111111111111",
  tokenAddress: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
  recipient,
  amountAtomic: "5000000",
  amountUsdg: "5",
}, "only a bounded canonical Robinhood USDG transfer should parse");
assert.deepEqual(
  bridge.parsePersonalSignParams(request.params),
  {
    address: "0x1111111111111111111111111111111111111111",
    message: "hivemindos.app wants you to sign in:",
  },
  "personal_sign should decode the EIP-1193 hex message without exposing a wallet secret",
);
assert.equal(bridge.isOfficialMiniAppOrigin("https://hivemindos.app"), true);
assert.equal(bridge.isOfficialMiniAppOrigin("https://evil.example"), false);

const signInAddress = "0x1111111111111111111111111111111111111111";
const signInMessage = [
  "hivemindos.app wants you to sign in with your Ethereum account:",
  signInAddress,
  "",
  "Link this wallet to HivemindOS.",
  "",
  "URI: https://hivemindos.app/image",
  "Version: 1",
  "Chain ID: 8453",
  "Nonce: bridge-test",
].join("\n");
assert.doesNotThrow(() => signing.validateMiniAppSignInMessage(signInMessage, signInAddress));
assert.throws(
  () => signing.validateMiniAppSignInMessage(signInMessage, "0x2222222222222222222222222222222222222222"),
  /selected wallet/i,
);
assert.throws(
  () => signing.validateMiniAppSignInMessage(signInMessage.replaceAll("hivemindos.app", "evil.example"), signInAddress),
  /official HivemindOS/i,
);

const panel = readFileSync(new URL("../src/features/dashboard/views/MiniAppsPanel.tsx", import.meta.url), "utf8");
const selector = readFileSync(new URL("../src/features/dashboard/views/trade/WalletSelectModal.tsx", import.meta.url), "utf8");
const importer = readFileSync(new URL("../src/components/wallets-drop-in/CreateImportWalletModal.tsx", import.meta.url), "utf8");
const hostBridge = readFileSync(new URL("../src/features/dashboard/views/mini-apps/MiniAppWalletBridge.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/app/api/mini-apps/wallet/sign/route.ts", import.meta.url), "utf8");
const faucetRoute = readFileSync(new URL("../src/app/api/mini-apps/testnet-faucet/route.ts", import.meta.url), "utf8");
const faucetService = readFileSync(new URL("../src/lib/services/wallet/mini-app-testnet-faucet.ts", import.meta.url), "utf8");
const bankrActions = readFileSync(new URL("../src/lib/services/bankr-actions.ts", import.meta.url), "utf8");

assert.match(panel, /MiniAppWalletBridge/, "the embedded mini-app view should mount the host wallet bridge");
assert.match(hostBridge, /selectionConfirmedRef/, "confirming a wallet must not be followed by the modal's close callback sending a cancellation");
assert.match(hostBridge, /selectedWalletRef/, "the selected signer should be available before the iframe's immediate follow-up signature request");
assert.match(hostBridge, /sendApprovedPersonalWalletAsset/, "the guarded USDG relay should use the governed personal-wallet send route");
assert.match(hostBridge, /window\.confirm/, "the host must show the exact USDG transfer before funds move");
assert.match(hostBridge, /api\/payments\/robinhood-usdg/, "the host must verify the current official payment recipient");
assert.match(hostBridge, /hivemindos_requestTestnetFaucet/, "the bridge should expose only the named faucet purchase action");
assert.match(hostBridge, /api\/mini-apps\/testnet-faucet/, "the bridge should keep faucet spending behind the authenticated same-origin route");
assert.match(hostBridge, /window\.confirm/, "the host must show the exact faucet route and price before paying");
assert.match(faucetRoute, /requireAuth/, "the faucet purchase route must authenticate before reading a local wallet");
assert.match(faucetRoute, /executeMiniAppTestnetFaucet/, "the API route should delegate the commercial flow to its focused service");
assert.match(faucetService, /getWalletSecret/, "the service should resolve only a locally stored signer");
assert.match(faucetService, /executeX402Fetch/, "the service should use the governed x402 rail");
assert.match(faucetService, /skipPlatformFee:\s*true/, "the official faucet fee must not receive a second local platform fee");
assert.match(faucetService, /confirmation !== "TESTNET_FAUCET"/, "the route should require its exact reviewed confirmation token");
assert.match(faucetService, /priceUsd/, "the per-call x402 cap should come from the official live asset catalog");
assert.match(selector, /New wallet/, "wallet section add menus should offer one-click wallet creation");
assert.match(selector, /Import from private key/, "wallet section add menus should offer private-key import");
assert.match(selector, /Import recovery phrase/, "wallet section add menus should offer recovery-phrase import");
assert.match(importer, /initialImportKind/, "the shared import modal should open directly in the selected import flow");
assert.match(route, /signMiniAppWalletMessage/, "mini-app signatures should stay behind a same-origin authenticated API route");
assert.match(bankrActions, /export async function signBankrPersonalMessage/, "Bankr wallet linking should use the Wallet API personal_sign capability");

console.log("Mini-app wallet bridge and wallet-section action contracts passed.");
