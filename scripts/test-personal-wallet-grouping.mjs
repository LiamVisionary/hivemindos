#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

import ts from "typescript";

const root = process.cwd();
const sourcePath = join(root, "src/features/dashboard/views/WalletPanel.tsx");
const source = readFileSync(sourcePath, "utf8");
const helperEnd = source.indexOf("function hasUsePodSetupEvidence");
if (helperEnd < 0) throw new Error("Could not locate WalletPanel helper boundary.");

const helperSource = source
  .slice(0, helperEnd)
  .replace(/^import[\s\S]*?;\n/gm, "")
  + "\nglobalThis.__walletHelpers = { buildDropInPersonalWallets, mergePersonalWalletSources };";

const compiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
  fileName: sourcePath,
}).outputText;

const context = { console, URL, globalThis: {} };
context.globalThis = context;
vm.runInNewContext(compiled, context, { filename: sourcePath });

const { buildDropInPersonalWallets, mergePersonalWalletSources } = context.__walletHelpers;

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

const walletViewSource = readFileSync(join(root, "src/components/wallets-drop-in/WalletsView.tsx"), "utf8");
assert.match(walletViewSource, /setTimeout\(\(\) => setOpen\(true\), 200\)/);
assert.match(walletViewSource, /title=\{multi \? "Hover for all chain addresses" : undefined\}/);
assert.match(walletViewSource, /w\.addresses\.map\(\(\[chain, addr\]\)/);
assert.match(walletViewSource, /primaryHolding = sendHoldings\[0\] \|\| top\[0\]/);
assert.match(walletViewSource, /frFmtAmount\(primaryHolding\.sym, primaryHolding\.amount\)/);
assert.match(walletViewSource, /maxHeight: top\.length > 5 \? 245/);
assert.match(walletViewSource, /overflowY: top\.length > 5 \? "auto"/);

console.log("Personal wallet grouping tests passed.");
