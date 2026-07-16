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
// Canonical BIP39 test mnemonic (valid checksum). Shared across every account
// index — exactly the footgun this export path has to defuse.
const sharedMnemonic = "test test test test test test test test test test test junk";

const { storeWalletSecret, LOCAL_WALLET_VAULT_DIR } = await import("../src/lib/services/wallet/local-wallet-vault.ts");
const { renderWalletSecretExport, WALLET_SECRET_EXPORT_CONFIRMATION } = await import("../src/lib/services/wallet/wallet-secret-export.ts");
const { importRecoveryPhraseWallets, deriveEvmAccountFromRecoveryPhrase } = await import("../src/lib/services/wallet/chain-wallet.ts");
const { POST } = await import("../src/app/api/wallet/export/route.ts");

function exportRequest(agentIds, confirmation = WALLET_SECRET_EXPORT_CONFIRMATION) {
  return POST(new Request("http://unit.test/api/wallet/export", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hivemindos-device-token": process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN,
    },
    body: JSON.stringify({ agentIds, confirmation }),
  }));
}

try {
  // --- Raw private-key wallet: exported verbatim. -------------------------
  await storeWalletSecret({
    agentId,
    name: "Export Test",
    address: "0x0000000000000000000000000000000000000002",
    network: "eip155:8453",
    secret: fakeSecret,
  });

  const response = await exportRequest([agentId]);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.exportedCount, 1);
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].agentId, agentId);
  assert.equal(data.entries[0].kind, "private-key");
  assert.equal(data.entries[0].secret, fakeSecret);

  const exported = renderWalletSecretExport("Export Test", data.entries);
  assert.match(exported, /HivemindOS wallet secret export/);
  assert.match(exported, /Wallet: Export Test/);
  assert.match(exported, new RegExp(`Agent id: ${agentId}`));
  assert.match(exported, new RegExp(fakeSecret));

  const rejected = await exportRequest([agentId], "EXPORT");
  assert.equal(rejected.status, 400);

  // --- Recovery-phrase-derived EVM wallets: export the per-address key. ----
  // Two different HivemindOS wallets are two account indices of ONE shared
  // recovery phrase. The old export printed the identical phrase for both (no
  // index), so importing either landed the user on Account 1 — the wrong
  // wallet. The fix must export each account's OWN private key instead.
  const [baseAtIndex3] = importRecoveryPhraseWallets(sharedMnemonic, 3);
  const [baseAtIndex0] = importRecoveryPhraseWallets(sharedMnemonic, 0);
  assert.notEqual(baseAtIndex3.address.toLowerCase(), baseAtIndex0.address.toLowerCase());
  assert.equal(baseAtIndex3.secret, sharedMnemonic); // stored secret is the shared phrase
  assert.equal(baseAtIndex0.secret, sharedMnemonic);

  const agentIndex3 = "agent:phrase-index-3";
  const agentIndex0 = "agent:phrase-index-0";
  await storeWalletSecret({ agentId: agentIndex3, name: "Higher Account", address: baseAtIndex3.address, network: "eip155:8453", secret: sharedMnemonic });
  await storeWalletSecret({ agentId: agentIndex0, name: "First Account", address: baseAtIndex0.address, network: "eip155:8453", secret: sharedMnemonic });

  const expected3 = deriveEvmAccountFromRecoveryPhrase(sharedMnemonic, baseAtIndex3.address);
  const expected0 = deriveEvmAccountFromRecoveryPhrase(sharedMnemonic, baseAtIndex0.address);
  assert.equal(expected3.accountIndex, 3);
  assert.equal(expected0.accountIndex, 0);
  assert.equal(expected3.derivationPath, "m/44'/60'/0'/0/3");
  assert.equal(expected0.derivationPath, "m/44'/60'/0'/0/0");
  assert.notEqual(expected3.privateKey, expected0.privateKey);

  const phraseResponse = await exportRequest([agentIndex3, agentIndex0]);
  const phraseData = await phraseResponse.json();
  assert.equal(phraseResponse.status, 200);
  assert.equal(phraseData.ok, true);
  // Distinct per-address private keys → not collapsed by dedupe.
  assert.equal(phraseData.exportedCount, 2);
  const byAgent = Object.fromEntries(phraseData.entries.map((entry) => [entry.agentId, entry]));

  for (const [agent, expected] of [[agentIndex3, expected3], [agentIndex0, expected0]]) {
    const entry = byAgent[agent];
    assert.ok(entry, `expected an export entry for ${agent}`);
    assert.equal(entry.kind, "private-key", "recovery-phrase EVM wallet must export a private key, not the phrase");
    assert.equal(entry.secret, expected.privateKey);
    assert.equal(entry.accountIndex, expected.accountIndex);
    assert.equal(entry.derivationPath, expected.derivationPath);
    // The shared seed phrase must NEVER appear in a derived export.
    assert.notEqual(entry.secret, sharedMnemonic);
  }

  // Crux: the two wallets no longer export the same secret.
  assert.notEqual(byAgent[agentIndex3].secret, byAgent[agentIndex0].secret);

  const phraseExport = renderWalletSecretExport("Shared Phrase", phraseData.entries);
  assert.match(phraseExport, /Account 4 \(m\/44'\/60'\/0'\/0\/3\)/);
  assert.match(phraseExport, /Account 1 \(m\/44'\/60'\/0'\/0\/0\)/);
  assert.match(phraseExport, new RegExp(expected3.privateKey));
  assert.match(phraseExport, new RegExp(expected0.privateKey));
  // The rendered file must not leak the shared recovery phrase.
  assert.doesNotMatch(phraseExport, /test test test/);
  assert.doesNotMatch(phraseExport, /Secret type: Recovery phrase/);

  // --- Fallback: a recovery phrase whose stored address is off-tree. -------
  // If the address does not derive from the phrase in the supported account
  // range, we cannot produce a per-address key, so we fall back to the phrase
  // WITH a loud warning rather than silently exporting the wrong thing.
  const agentOffTree = "agent:phrase-off-tree";
  const offTreeAddress = "0x000000000000000000000000000000000000dEaD";
  await storeWalletSecret({ agentId: agentOffTree, name: "Off Tree", address: offTreeAddress, network: "eip155:8453", secret: sharedMnemonic });
  const offTreeResponse = await exportRequest([agentOffTree]);
  const offTreeData = await offTreeResponse.json();
  assert.equal(offTreeData.ok, true);
  const offTreeEntry = offTreeData.entries[0];
  assert.equal(offTreeEntry.kind, "recovery-phrase");
  assert.equal(offTreeEntry.secret, sharedMnemonic);
  assert.ok(offTreeEntry.derivationNote && offTreeEntry.derivationNote.includes(offTreeAddress), "off-tree fallback must warn with the address");
  const offTreeExport = renderWalletSecretExport("Off Tree", offTreeData.entries);
  assert.match(offTreeExport, /Warning: /);
  assert.match(offTreeExport, /Secret type: Recovery phrase/);

  console.log("Wallet secret export route checks passed");
} finally {
  await rm(LOCAL_WALLET_VAULT_DIR, { recursive: true, force: true });
}
