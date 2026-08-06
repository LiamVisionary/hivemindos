import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const directory = await mkdtemp(join(tmpdir(), "hivemindos-x-policy-"));
process.env.HIVEMINDOS_X_COMMAND_POLICY_PATH = join(directory, "policy.json");

try {
  const {
    completeXCommandTradeReceipt,
    readXCommandWalletPolicy,
    reserveXCommandTrade,
    saveXCommandWalletPolicy,
  } = await import("../src/lib/services/x-command/x-command-wallet-policy.ts");

  const saved = await saveXCommandWalletPolicy({
    enabled: true,
    walletId: "wallet:base",
    walletName: "Main wallet",
    address: "0x1111111111111111111111111111111111111111",
    network: "eip155:8453",
    accounts: [
      { walletId: "wallet:base", address: "0x1111111111111111111111111111111111111111", network: "eip155:8453" },
      { walletId: "wallet:solana", address: "11111111111111111111111111111111", network: "solana:mainnet" },
    ],
    maxTradeUsd: 5,
    dailyTradeLimitUsd: 8,
    slippageBps: 100,
  });
  assert.equal(saved.walletId, "wallet:base");
  assert.ok(saved.revision);
  assert.equal((await readXCommandWalletPolicy()).enabled, true);

  const first = await reserveXCommandTrade({
    jobId: "xjob_1",
    amountUsd: 4,
    expectedPolicyRevision: saved.revision,
    accountWalletId: "wallet:solana",
    network: "solana:mainnet",
    now: 1_800_000_000_000,
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.receipt.status, "started");
  assert.equal(first.receipt.authorizationWalletId, "wallet:base");
  assert.equal(first.receipt.walletId, "wallet:solana");
  assert.equal(first.receipt.network, "solana:mainnet");

  const duplicate = await reserveXCommandTrade({
    jobId: "xjob_1",
    amountUsd: 4,
    expectedPolicyRevision: saved.revision,
    accountWalletId: "wallet:solana",
    network: "solana:mainnet",
    now: 1_800_000_000_100,
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.receipt.id, first.receipt.id);

  await assert.rejects(
    reserveXCommandTrade({ jobId: "xjob_2", amountUsd: 5, expectedPolicyRevision: saved.revision, accountWalletId: "wallet:base", network: "eip155:8453", now: 1_800_000_000_200 }),
    /daily HivemindOSBot limit/i,
  );

  const completed = await completeXCommandTradeReceipt("xjob_1", {
    status: "complete",
    reference: "0xabc",
    resultText: "Bought ETH.",
    valueUsd: 4,
  });
  assert.equal(completed.status, "complete");
  assert.equal(completed.reference, "0xabc");

  await assert.rejects(
    reserveXCommandTrade({ jobId: "xjob_stale", amountUsd: 1, expectedPolicyRevision: "stale-policy-revision", accountWalletId: "wallet:base", network: "eip155:8453", now: 1_800_000_000_250 }),
    /authorization changed while the trade was being quoted/i,
  );

  await assert.rejects(
    reserveXCommandTrade({ jobId: "xjob_too_large", amountUsd: 6, expectedPolicyRevision: saved.revision, accountWalletId: "wallet:base", network: "eip155:8453", now: 1_800_000_000_300 }),
    /per-trade HivemindOSBot limit/i,
  );
} finally {
  delete process.env.HIVEMINDOS_X_COMMAND_POLICY_PATH;
  await rm(directory, { recursive: true, force: true });
}

console.log("test-x-command-wallet-policy: authorization revisions, limits, compatible accounts, and duplicate receipts are enforced");
