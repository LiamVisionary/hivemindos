#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-wallet-export-"));
process.env.HOME = tempHome;
process.env.HIVEMINDOS_WALLET_VAULT_KEY = "test-wallet-export-key".repeat(4);
process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET = "s".repeat(40);
process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN = "t".repeat(32);

const fakeSecret = `0x${"2".repeat(64)}`;
const agentId = "agent:export-test";

const { storeWalletSecret, LOCAL_WALLET_VAULT_DIR } = await import("../src/lib/services/wallet/local-wallet-vault.ts");
const { renderWalletSecretExport, WALLET_SECRET_EXPORT_CONFIRMATION } = await import("../src/lib/services/wallet/wallet-secret-export.ts");
const { POST } = await import("../src/app/api/wallet/export/route.ts");

try {
  await storeWalletSecret({
    agentId,
    name: "Export Test",
    address: "0x0000000000000000000000000000000000000002",
    network: "eip155:8453",
    secret: fakeSecret,
  });

  const response = await POST(new Request("http://unit.test/api/wallet/export", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hivemindos-device-token": process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN,
    },
    body: JSON.stringify({
      agentIds: [agentId],
      confirmation: WALLET_SECRET_EXPORT_CONFIRMATION,
    }),
  }));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.exportedCount, 1);
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].agentId, agentId);
  assert.equal(data.entries[0].secret, fakeSecret);

  const exported = renderWalletSecretExport("Export Test", data.entries);
  assert.match(exported, /HivemindOS wallet secret export/);
  assert.match(exported, /Wallet: Export Test/);
  assert.match(exported, new RegExp(`Agent id: ${agentId}`));
  assert.match(exported, new RegExp(fakeSecret));

  const rejected = await POST(new Request("http://unit.test/api/wallet/export", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hivemindos-device-token": process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN,
    },
    body: JSON.stringify({ agentIds: [agentId], confirmation: "EXPORT" }),
  }));
  assert.equal(rejected.status, 400);

  console.log("Wallet secret export route checks passed");
} finally {
  await rm(LOCAL_WALLET_VAULT_DIR, { recursive: true, force: true });
}
