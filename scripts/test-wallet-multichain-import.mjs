#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-multichain-import-"));
const tempVault = join(tempHome, "vault");
await mkdir(tempVault, { recursive: true });
process.env.HOME = tempHome;
process.env.HIVEMINDOS_WALLET_VAULT_KEY = "isolated-multichain-import-test-key".repeat(2);
process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET = "s".repeat(40);
process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN = "t".repeat(32);

const { POST: importWallet } = await import("../src/app/api/wallet/import/route.ts");
const { POST: sendWallet } = await import("../src/app/api/wallet/send/route.ts");
const { GET: listPersonalWallets, POST: savePersonalWallets } = await import("../src/app/api/wallet/personal/route.ts");
const { LOCAL_WALLET_VAULT_DIR, listWalletInfos } = await import("../src/lib/services/wallet/local-wallet-vault.ts");
const { importRecoveryPhraseWallets, resolveEvmSigningAccount } = await import("../src/lib/services/wallet/chain-wallet.ts");
const { AGENT_FUNDING_GAS_RESERVE_WEI, requiredAgentFundingGasTopUpWei } = await import("../src/lib/services/wallet/agent-funding-gas.ts");
const { buildGroupedPersonalWallets } = await import("../src/lib/utils/personal-wallet-grouping.ts");

const authHeaders = {
  "content-type": "application/json",
  "x-hivemindos-device-token": process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN,
};

async function importAccount(agentId, name, accountIndex) {
  const response = await importWallet(new Request("http://unit.test/api/wallet/import", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      agentId,
      secret: TEST_MNEMONIC,
      importKind: "recovery-phrase",
      importTarget: "multi-chain",
      accountIndex,
      name,
      vaultPath: tempVault,
    }),
  }));
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  assert.equal(data.ok, true);
  assert.equal(data.accountIndex, accountIndex);
  return data;
}

try {
  await importAccount("user:original:account-0", "Original wallet", 0);
  await importAccount("user:duplicate:account-0", "New import name", 0);
  const ninth = await importAccount("user:ninth:account-8", "Account 9 wallet", 8);

  const expectedNinth = importRecoveryPhraseWallets(TEST_MNEMONIC, 8);
  const ninthEvmWallet = expectedNinth.find((wallet) => wallet.network === "eip155:8453");
  assert(ninthEvmWallet, "Account 9 must include an EVM wallet");
  assert.equal(
    resolveEvmSigningAccount(TEST_MNEMONIC, ninthEvmWallet.address).address.toLowerCase(),
    ninthEvmWallet.address.toLowerCase(),
    "the transfer signer must resolve the imported Phantom account instead of always using Account 1",
  );
  assert.equal(requiredAgentFundingGasTopUpWei(0n), AGENT_FUNDING_GAS_RESERVE_WEI);
  assert.equal(requiredAgentFundingGasTopUpWei(AGENT_FUNDING_GAS_RESERVE_WEI), 0n);

  const approvalResponse = await sendWallet(new Request("http://unit.test/api/wallet/send", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      action: "approve",
      agentId: "user:ninth:account-8:eip155-8453",
      toAddress: ninthEvmWallet.address,
      amountUsd: 1,
      maxPaymentUsd: 1,
      confirmation: "SEND_USDC",
      gasSponsorAgentId: "agent:expected-sponsor",
    }),
  }));
  const approval = await approvalResponse.json();
  assert.equal(approvalResponse.status, 200, approval.error);
  const tamperedSponsorResponse = await sendWallet(new Request("http://unit.test/api/wallet/send", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      action: "send",
      agentId: "user:ninth:account-8:eip155-8453",
      toAddress: ninthEvmWallet.address,
      amountUsd: 1,
      maxPaymentUsd: 1,
      confirmation: "SEND_USDC",
      gasSponsorAgentId: "agent:changed-sponsor",
      approvalToken: approval.approvalToken,
    }),
  }));
  assert.equal(tamperedSponsorResponse.status, 400, "the server approval must bind the exact gas sponsor");
  assert.deepEqual(
    ninth.wallets.map(({ network, address, derivationPath }) => ({ network, address, derivationPath })),
    expectedNinth.map(({ network, address, derivationPath }) => ({ network, address, derivationPath })),
    "the route must persist the selected Phantom bip44Change account",
  );

  const response = await listPersonalWallets(new Request(`http://unit.test/api/wallet/personal?vaultPath=${encodeURIComponent(tempVault)}`, {
    headers: authHeaders,
  }));
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  assert.equal(data.ok, true);
  assert.equal(data.wallets.length, 6, "duplicate account-0 imports must collapse while account 9 remains distinct");
  assert(data.wallets.every((wallet) => !String(wallet.name).includes("New import name")), "a duplicate import must not rename the established wallet");

  const grouped = buildGroupedPersonalWallets(data.wallets);
  assert.equal(grouped.length, 2);
  assert(grouped.some((wallet) => wallet.name === "Original wallet" && wallet.network === "3 chains"));
  assert(grouped.some((wallet) => wallet.name === "Account 9 wallet" && wallet.network === "3 chains"));

  const establishedRows = data.wallets
    .filter((wallet) => String(wallet.id).startsWith("user:original:account-0:"))
    .map((wallet) => ({ ...wallet, name: "Restored original wallet" }));
  const renameResponse = await savePersonalWallets(new Request("http://unit.test/api/wallet/personal", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ vaultPath: tempVault, wallets: establishedRows }),
  }));
  assert.equal(renameResponse.status, 200);
  const renamedResponse = await listPersonalWallets(new Request(`http://unit.test/api/wallet/personal?vaultPath=${encodeURIComponent(tempVault)}`, {
    headers: authHeaders,
  }));
  const renamed = await renamedResponse.json();
  const renamedGrouped = buildGroupedPersonalWallets(renamed.wallets);
  assert(renamedGrouped.some((wallet) => wallet.name === "Restored original wallet"), "the established identity's newest rename must win");
  assert(renamedGrouped.every((wallet) => wallet.name !== "New import name"), "the duplicate identity must still be ignored after a legitimate rename");

  const rejected = await importWallet(new Request("http://unit.test/api/wallet/import", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      agentId: "user:raw-key",
      secret: `0x${"1".repeat(64)}`,
      importKind: "private-key",
      importTarget: "multi-chain",
      vaultPath: tempVault,
    }),
  }));
  assert.equal(rejected.status, 400);
  assert.equal((await listWalletInfos({ agentIdPrefix: "user:raw-key" })).length, 0);

  console.log("Wallet multichain import route checks passed.");
} finally {
  await rm(LOCAL_WALLET_VAULT_DIR, { recursive: true, force: true });
  await rm(tempHome, { recursive: true, force: true });
}
