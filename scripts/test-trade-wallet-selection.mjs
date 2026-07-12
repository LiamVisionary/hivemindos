#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { buildGroupedPersonalWallets } = await import(
  new URL("../src/lib/utils/personal-wallet-grouping.ts", import.meta.url)
);
const { groupedUserPickables } = await import(
  new URL("../src/features/dashboard/views/trade/wallet-pickables.ts", import.meta.url)
);

const root = process.cwd();
const recoveryWallets = [
  {
    id: "user:base-default:eip155-4663",
    agentId: "user:base-default:eip155-4663",
    name: "My Base mainnet wallet Robinhood Chain",
    address: "0x4663000000000000000000000000000000004663",
    network: "eip155:4663",
    custodyMode: "local",
    importedFrom: "recovery-phrase",
  },
  {
    id: "user:base-default:solana-mainnet",
    agentId: "user:base-default:solana-mainnet",
    name: "Solana",
    address: "936oBc111111111111111111111111111111111ZSFu",
    network: "solana:mainnet",
    custodyMode: "local",
    importedFrom: "recovery-phrase",
  },
  {
    id: "user:base-default:eip155-8453",
    agentId: "user:base-default:eip155-8453",
    name: "My Base mainnet wallet",
    address: "0x8453000000000000000000000000000000008453",
    network: "eip155:8453",
    custodyMode: "local",
    importedFrom: "recovery-phrase",
  },
];

const [group] = buildGroupedPersonalWallets(recoveryWallets);
assert.equal(group.name, "My Base mainnet wallet", "A chain label must not replace the grouped wallet's Base name.");
assert.equal(group.spendId, "user:base-default:eip155-8453", "Base must be the grouped wallet's default account.");
assert.deepEqual(group.accounts.map((account) => account.chainKey), ["base", "robinhood", "solana"]);

const [pickable] = groupedUserPickables(recoveryWallets);
assert.equal(pickable.id, "user:base-default:eip155-8453", "The wallet picker card body must default to Base.");

const pickerCardSource = readFileSync(join(root, "src/components/wallets-drop-in/WalletPickerCard.tsx"), "utf8");
const walletModalSource = readFileSync(join(root, "src/features/dashboard/views/trade/WalletSelectModal.tsx"), "utf8");
const tradeViewSource = readFileSync(join(root, "src/components/trade/TradeView.tsx"), "utf8");

assert.match(pickerCardSource, /onSelectAccount:\s*\(accountId: string\) => void/);
assert.match(pickerCardSource, /className=\{styles\.chainButton\}/);
assert.match(pickerCardSource, /onSelectAccount\(account\.id\)/);
assert.doesNotMatch(pickerCardSource, /textOverflow:\s*"ellipsis"/, "Wallet names must wrap instead of truncating silently.");
assert.match(walletModalSource, /onSelectAccount=\{setSelectedId\}/);
assert.match(tradeViewSource, /chainBadgeSrc\(chainKeyForNetwork\(wallet\.network\)\)/);

console.log("Trade wallet selection tests passed.");
