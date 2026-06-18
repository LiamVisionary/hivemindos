#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS,
  HIVE_STAKING_TIERS,
  hiveStakingContractAddress,
  hiveTierForStakedHive,
  hiveTierForStakedRaw,
  scaleHiveAmount,
  isHiveEvmAddress,
} = await import("../src/lib/services/hive-staking.ts");
const { stakeHrefForPersonalToken } = await import("../src/features/dashboard/views/personal-stake-link.ts");
const { mergeStakeWalletsByAccount } = await import("../src/app/stake/stake-wallets.ts");
const { evmAccountFromLocalSecret } = await import("../src/lib/services/hive-staking-local.ts");

let passed = 0;
function check(label, condition) {
  assert.ok(condition, label);
  passed += 1;
}

check("tier table starts with holder", HIVE_STAKING_TIERS[0].id === "holder");
check("tier table ends with visionary", HIVE_STAKING_TIERS.at(-1).id === "visionary");
check("below holder has no tier", hiveTierForStakedHive(999_999n) === null);
check("holder threshold resolves holder", hiveTierForStakedHive(1_000_000n)?.id === "holder");
check("supporter threshold resolves supporter", hiveTierForStakedHive(10_000_000n)?.id === "supporter");
check("builder threshold resolves builder", hiveTierForStakedHive(50_000_000n)?.id === "builder");
check("curator threshold resolves curator", hiveTierForStakedHive(100_000_000n)?.id === "curator");
check("operator threshold resolves operator", hiveTierForStakedHive(250_000_000n)?.id === "operator");
check("visionary threshold resolves visionary", hiveTierForStakedHive(1_000_000_000n)?.id === "visionary");
check("higher values keep highest tier", hiveTierForStakedHive(5_000_000_000n)?.id === "visionary");

check("18 decimal raw holder resolves holder", hiveTierForStakedRaw(scaleHiveAmount(1_000_000n, 18), 18)?.id === "holder");
check("6 decimal raw supporter resolves supporter", hiveTierForStakedRaw(scaleHiveAmount(10_000_000n, 6), 6)?.id === "supporter");
check("pending/raw below threshold resolves null", hiveTierForStakedRaw(scaleHiveAmount(1_000_000n, 18) - 1n, 18) === null);
check("valid evm address accepted", isHiveEvmAddress("0x0000000000000000000000000000000000000001"));
check("invalid evm address rejected", !isHiveEvmAddress("0x123"));
check("public Base staking vault default is configured", hiveStakingContractAddress() === DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS);

const oversizedIconUrl = `data:image/svg+xml;base64,${"A".repeat(500_000)}`;
const stakeHref = stakeHrefForPersonalToken(
  {
    id: "wallet-1",
    name: "My wallet Base",
    address: "0x0000000000000000000000000000000000000001",
    network: "eip155:8453",
    custodyMode: "local",
    importedFrom: "private-key",
  },
  {
    walletId: "wallet-1",
    walletName: "My wallet Base",
    symbol: "HIVE",
    name: "HIVE",
    balance: 1_000_000,
    network: "eip155:8453",
    tokenAddress: "0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3",
    valueUsd: 42,
    priceUsd: 0.000042,
    priceChange24hPct: 1.5,
    iconUrl: oversizedIconUrl,
    isNative: false,
  },
);
check("stake token route omits token icon payload", !stakeHref.includes("tokenIconUrl=") && !stakeHref.includes("data:image"));
check("stake token route stays compact with oversized icon metadata", stakeHref.length < 500);

const hiveToken = {
  symbol: "HIVE",
  name: "HIVE",
  balance: 123,
  network: "eip155:8453",
  tokenAddress: "0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3",
  isNative: false,
};
const staleWatchWallet = {
  id: "user:watch",
  name: "My wallet Base",
  address: "0x0000000000000000000000000000000000000002",
  network: "eip155:8453",
  custodyMode: "watch",
  importedFrom: "watch",
  tokens: [hiveToken],
  lastOnchainSyncAt: 100,
};
const importedLocalSigner = {
  id: "user:local:eip155-8453",
  name: "My wallet Base",
  address: "0x0000000000000000000000000000000000000002",
  network: "eip155:8453",
  custodyMode: "local",
  importedFrom: "recovery-phrase",
  tokens: [],
  lastOnchainSyncAt: 0,
};
const mergedStakeWallets = mergeStakeWalletsByAccount([importedLocalSigner], staleWatchWallet);
check("stake wallet merge keeps one matching account row", mergedStakeWallets.length === 1);
check("stake wallet merge prefers imported Base signer", mergedStakeWallets[0]?.id === importedLocalSigner.id && mergedStakeWallets[0]?.custodyMode === "local");
check("stake wallet merge keeps HIVE token balance from stale row", mergedStakeWallets[0]?.tokens?.[0]?.balance === hiveToken.balance);

const hardhatPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const hardhatMnemonic = "test test test test test test test test test test test junk";
const hardhatAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
check("local staking accepts EVM private keys", evmAccountFromLocalSecret(hardhatPrivateKey).address.toLowerCase() === hardhatAddress);
check("local staking accepts recovery phrases", evmAccountFromLocalSecret(hardhatMnemonic).address.toLowerCase() === hardhatAddress);

let invalidSecretError = "";
try {
  evmAccountFromLocalSecret("not a private key or recovery phrase");
} catch (error) {
  invalidSecretError = error instanceof Error ? error.message : String(error);
}
check("local staking rejects unsupported secret formats clearly", invalidSecretError.includes("private key or recovery phrase"));

let threw = false;
try {
  scaleHiveAmount(1n, -1);
} catch {
  threw = true;
}
check("invalid decimals throw", threw);

console.log(`ok: ${passed} HIVE staking assertions passed`);
