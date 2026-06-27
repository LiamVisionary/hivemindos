#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-wallet-vault-"));
process.env.HOME = tempHome;
process.env.HIVEMINDOS_WALLET_VAULT_KEY = "test-wallet-vault-key".repeat(4);

const {
  LOCAL_WALLET_VAULT_DIR,
  LOCAL_WALLET_VAULT_PATH,
  getWalletSecret,
  listWalletInfos,
  storeWalletSecret,
} = await import("../src/lib/services/wallet/local-wallet-vault.ts");

try {
  await Promise.all([
    storeWalletSecret({
      agentId: "user:test:eip155-8453",
      address: "0x0000000000000000000000000000000000000001",
      network: "eip155:8453",
      secret: `0x${"1".repeat(64)}`,
    }),
    storeWalletSecret({
      agentId: "user:test:solana-mainnet",
      address: "936oBcwexKy11L9MfMGzb4cfV6rCoQCB5NfyE43AZSFu",
      network: "solana:mainnet",
      secret: "solana-secret",
    }),
  ]);

  const concurrentInfos = await listWalletInfos({ agentIdPrefix: "user:test" });
  assert.equal(concurrentInfos.length, 2, "concurrent wallet imports must keep both chain rows");
  assert(concurrentInfos.some((wallet) => wallet.network === "eip155:8453" && wallet.custodyMode === "local"));
  assert(concurrentInfos.some((wallet) => wallet.network === "solana:mainnet" && wallet.custodyMode === "local"));
  assert.equal((await getWalletSecret("user:test:eip155-8453"))?.info.address, "0x0000000000000000000000000000000000000001");
  assert.equal((await getWalletSecret("user:test:solana-mainnet"))?.info.network, "solana:mainnet");

  await writeFile(LOCAL_WALLET_VAULT_PATH, [
    JSON.stringify({ version: 1, records: { "user:one": vaultRecord("user:one", "0x0000000000000000000000000000000000000002", "eip155:8453") } }),
    JSON.stringify({ version: 1, records: { "user:two": vaultRecord("user:two", "936oBcwexKy11L9MfMGzb4cfV6rCoQCB5NfyE43AZSFu", "solana:mainnet") } }),
  ].join(""), "utf8");

  const recoveredInfos = await listWalletInfos({ agentIdPrefix: "user:" });
  assert.equal(recoveredInfos.length, 2, "concatenated vault snapshots must be recovered instead of treated as empty");
  assert(recoveredInfos.some((wallet) => wallet.agentId === "user:one"));
  assert(recoveredInfos.some((wallet) => wallet.agentId === "user:two"));

  console.log("Wallet vault persistence checks passed");
} finally {
  await rm(LOCAL_WALLET_VAULT_DIR, { recursive: true, force: true });
}

function vaultRecord(agentId, address, network) {
  return {
    agentId,
    address,
    network,
    custodyMode: "local",
    createdAt: "2026-06-17T00:00:00.000Z",
    iv: "test",
    tag: "test",
    encryptedSecret: "test",
  };
}
