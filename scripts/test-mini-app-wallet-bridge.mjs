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
assert.equal(bridge.parseMiniAppWalletRequest({ ...request, method: "eth_sendTransaction" }), null, "the bridge must reject transaction RPC methods");
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
const bankrActions = readFileSync(new URL("../src/lib/services/bankr-actions.ts", import.meta.url), "utf8");

assert.match(panel, /MiniAppWalletBridge/, "the embedded mini-app view should mount the host wallet bridge");
assert.match(hostBridge, /selectionConfirmedRef/, "confirming a wallet must not be followed by the modal's close callback sending a cancellation");
assert.match(hostBridge, /selectedWalletRef/, "the selected signer should be available before the iframe's immediate follow-up signature request");
assert.match(selector, /New wallet/, "wallet section add menus should offer one-click wallet creation");
assert.match(selector, /Import from private key/, "wallet section add menus should offer private-key import");
assert.match(selector, /Import recovery phrase/, "wallet section add menus should offer recovery-phrase import");
assert.match(importer, /initialImportKind/, "the shared import modal should open directly in the selected import flow");
assert.match(route, /signMiniAppWalletMessage/, "mini-app signatures should stay behind a same-origin authenticated API route");
assert.match(bankrActions, /export async function signBankrPersonalMessage/, "Bankr wallet linking should use the Wallet API personal_sign capability");

console.log("Mini-app wallet bridge and wallet-section action contracts passed.");
