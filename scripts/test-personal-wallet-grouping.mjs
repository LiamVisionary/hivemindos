#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The grouping helpers were extracted from WalletPanel into a real module —
// import the shipped code directly (Node strips the types) instead of
// vm-compiling a source slice of the panel.
const { buildGroupedPersonalWallets: buildDropInPersonalWallets, mergePersonalWalletSources } = await import(
  new URL("../src/lib/utils/personal-wallet-grouping.ts", import.meta.url)
);
const { walletSecretExportLabel } = await import(
  new URL("../src/lib/services/wallet/wallet-secret-export.ts", import.meta.url)
);

const root = process.cwd();

const wallets = [
  {
    id: "user:recovery-wallet:eip155-8453",
    agentId: "user:recovery-wallet:eip155-8453",
    name: "My wallet Base",
    address: "0xC42e000000000000000000000000000000007bE9",
    network: "eip155:8453",
    custodyMode: "local",
    importedFrom: "recovery-phrase",
    nativeBalance: 0.25,
    tokens: [{ symbol: "USDC", balance: 12, valueUsd: 12 }],
  },
  {
    id: "user:recovery-wallet:solana-mainnet",
    agentId: "user:recovery-wallet:solana-mainnet",
    name: "My wallet Solana",
    address: "936oBc111111111111111111111111111111111ZSFu",
    network: "solana:mainnet",
    custodyMode: "local",
    importedFrom: "recovery-phrase",
    nativeBalance: 1.5,
    tokens: [{ symbol: "USDC", balance: 8, valueUsd: 8 }],
  },
  {
    id: "user:private-key-wallet",
    agentId: "user:private-key-wallet",
    name: "My Base wallet",
    address: "0x3333000000000000000000000000000000003333",
    network: "eip155:8453",
    custodyMode: "local",
    importedFrom: "private-key",
    tokens: [{ symbol: "USDC", balance: 2, valueUsd: 2 }],
  },
];

const cards = buildDropInPersonalWallets(wallets);
assert.equal(cards.length, 2, "Base and Solana records from one recovery phrase should collapse into one card.");

const grouped = cards.find((wallet) => wallet.id === "user:recovery-wallet");
assert.ok(grouped, "Grouped recovery phrase card should use the root user wallet id.");
assert.equal(grouped.name, "My wallet");
assert.equal(grouped.spendId, "user:recovery-wallet:eip155-8453");
assert.equal(grouped.network, "2 chains");
assert.equal(grouped.addr, "0xC42e000000000000000000000000000000007bE9");
assert.equal(JSON.stringify(grouped.addresses), JSON.stringify([
  ["Base mainnet", "0xC42e000000000000000000000000000000007bE9"],
  ["Solana mainnet", "936oBc111111111111111111111111111111111ZSFu"],
]));
assert.equal(JSON.stringify(grouped.holdings), JSON.stringify([["USDC", 20]]));

const separate = cards.find((wallet) => wallet.id === "user:private-key-wallet");
assert.ok(separate, "Unrelated personal wallets should remain separate cards.");
assert.equal(separate.addresses.length, 1);
assert.equal(walletSecretExportLabel([{ kind: "private-key" }, { kind: "recovery-phrase" }]), "wallet secret");
assert.equal(walletSecretExportLabel([{ kind: "private-key" }]), "private key");
assert.equal(walletSecretExportLabel([{ kind: "recovery-phrase" }]), "recovery phrase");

const staleSignerRows = [
  { id: "user:rich:eip155-8453", agentId: "user:rich:eip155-8453", name: "My wallet Base", address: "0xC42e000000000000000000000000000000007bE9", network: "eip155:8453", custodyMode: "local", importedFrom: "recovery-phrase", currentBalanceUsd: 0, nativeBalance: 0, tokens: [] },
  { id: "user:rich:solana-mainnet", agentId: "user:rich:solana-mainnet", name: "My wallet Solana", address: "936oBc111111111111111111111111111111111ZSFu", network: "solana:mainnet", custodyMode: "local", importedFrom: "recovery-phrase", currentBalanceUsd: 0, nativeBalance: 0, tokens: [] },
];
const mergedCards = buildDropInPersonalWallets(mergePersonalWalletSources(staleSignerRows, {
  "user:rich:eip155-8453": { walletAddress: "0xC42e000000000000000000000000000000007bE9", network: "eip155:8453", tokenSymbol: "ETH", currentBalanceUsd: 2226.59, onchainBalanceUsd: 2226.59, nativeBalance: 0.1979414256200372, custodyMode: "local", updatedAt: 1781699042563, lastOnchainSyncAt: 1781699042562 },
  "user:rich:solana-mainnet": { walletAddress: "936oBc111111111111111111111111111111111ZSFu", network: "solana:mainnet", tokenSymbol: "SOL", currentBalanceUsd: 68.28, onchainBalanceUsd: 68.28, nativeBalance: 0.445883515, custodyMode: "local", updatedAt: 1781699040785, lastOnchainSyncAt: 1781699040781 },
}));
const mergedRich = mergedCards.find((wallet) => wallet.id === "user:rich");
assert.ok(mergedRich, "Dashboard wallet state should enrich stale signer-only personal rows.");
assert.equal(JSON.stringify(mergedRich.holdings), JSON.stringify([["ETH", 0.1979414256200372], ["SOL", 0.445883515]]));

const namedAfterReloadCards = buildDropInPersonalWallets(mergePersonalWalletSources([{
  id: "user:miro:eip155-8453",
  agentId: "user:miro:eip155-8453",
  name: "MiroShark payment Base",
  address: "0x4444000000000000000000000000000000004444",
  network: "eip155:8453",
  custodyMode: "local",
  importedFrom: "recovery-phrase",
  updatedAt: 100,
}, {
  id: "user:miro:solana-mainnet",
  agentId: "user:miro:solana-mainnet",
  name: "MiroShark payment Solana",
  address: "936oBc444444444444444444444444444444444ZSFu",
  network: "solana:mainnet",
  custodyMode: "local",
  importedFrom: "recovery-phrase",
  updatedAt: 100,
}], {
  "user:miro:eip155-8453": {
    walletAddress: "0x4444000000000000000000000000000000004444",
    network: "eip155:8453",
    custodyMode: "local",
    name: "My Base mainnet wallet",
    updatedAt: 200,
  },
  "user:miro:solana-mainnet": {
    walletAddress: "936oBc444444444444444444444444444444444ZSFu",
    network: "solana:mainnet",
    custodyMode: "local",
    name: "My Solana mainnet wallet",
    updatedAt: 200,
  },
}));
assert.equal(namedAfterReloadCards[0]?.name, "MiroShark payment", "Generated reload names such as My Base mainnet wallet must not overwrite a custom wallet name.");

const walletViewSource = readFileSync(join(root, "src/components/wallets-drop-in/WalletsView.tsx"), "utf8");
assert.match(walletViewSource, /setTimeout\(\(\) => setOpen\(true\), 200\)/);
assert.match(walletViewSource, /title=\{multi \? "Hover for all chain addresses" : undefined\}/);
assert.match(walletViewSource, /w\.addresses!?\.map\(\(\[chain, addr\]\)/);
assert.match(walletViewSource, /primaryHolding = sendHoldings\[0\] \|\| top\[0\]/);
assert.match(walletViewSource, /frFmtAmount\(primaryHolding\.sym, primaryHolding\.amount\)/);
assert.match(walletViewSource, /maxHeight: top\.length > 5 \? 245/);
assert.match(walletViewSource, /overflowY: top\.length > 5 \? "auto"/);
assert.match(walletViewSource, /onExportPersonalWallet\?: \(walletId: string, confirmation: string\)/);
assert.match(walletViewSource, /WalletSecretExportSheet[\s\S]+onExportPersonalWallet\?\.\(w\.id, confirmation\)/);
assert.match(walletViewSource, /<BIcon name="key" size=\{14\} \/> Export keys/);
assert.match(walletViewSource, /onRefreshPersonalWallet\?: \(source: GroupedPersonalWallet\)/);
assert.match(walletViewSource, /function SendToMyWalletModal/);
assert.match(walletViewSource, /Send to my wallet/);
assert.match(walletViewSource, /personalWalletTransferTargets\(w, sendSym\)\.targets/);
assert.match(walletViewSource, /className="fw-split-menu"/);
assert.match(walletViewSource, /actions\.onRefreshPersonalWallet\(w\)/);

const walletPanelSource = readFileSync(join(root, "src/features/dashboard/views/WalletPanel.tsx"), "utf8");
assert.match(walletPanelSource, /exportPersonalWalletGroupSecret/);
assert.match(walletPanelSource, /buildGroupedPersonalWallets\(mergedPersonalWallets\)\.find\(\(wallet\) => wallet\.id === walletId \|\| wallet\.spendId === walletId\)/);
assert.match(walletPanelSource, /onRefreshPersonalWallet: async \(source: any\) => refreshPersonalWalletSourceBalance\(source\)/);
assert.match(walletPanelSource, /input\.recipient \? refreshPersonalWalletSourceBalance\(input\.recipient\) : undefined/);
assert.match(walletPanelSource, /onRefreshBankrWallet: loadBankrWallet/);

const walletExportActionsSource = readFileSync(join(root, "src/features/dashboard/views/wallet-secret-export-actions.ts"), "utf8");
assert.match(walletExportActionsSource, /const localWallets = group\.accounts\.filter\(\(wallet\) => wallet\.custodyMode === "local"\)/);
assert.match(walletExportActionsSource, /confirmation: options\.confirmation/);

const walletNativeExportSource = readFileSync(join(root, "src-tauri/src/wallet_export.rs"), "utf8");
assert.match(walletNativeExportSource, /async fn wallet_secret_export_save/);
assert.match(walletNativeExportSource, /\.save_file\(move \|file_path\|/);
assert.doesNotMatch(walletNativeExportSource, /blocking_save_file/);

const nativePersonalWalletSource = readFileSync(join(root, "src/lib/native/personal-wallets.ts"), "utf8");
const apiPersonalWalletSource = readFileSync(join(root, "src/app/api/wallet/personal/route.ts"), "utf8");
const tauriObsidianSource = readFileSync(join(root, "src-tauri/src/obsidian.rs"), "utf8");
assert.match(nativePersonalWalletSource, /base sepolia/);
assert.match(apiPersonalWalletSource, /base sepolia/);
assert.match(tauriObsidianSource, /base sepolia/);

console.log("Personal wallet grouping tests passed.");
