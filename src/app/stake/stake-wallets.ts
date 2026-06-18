import type { AgentWalletTokenBalance } from "@/lib/types/agent-wallet";

export type StakePersonalWallet = {
  id: string;
  name?: string;
  address: string;
  network: string;
  custodyMode?: "local" | "watch";
  importedFrom?: "generated" | "private-key" | "recovery-phrase" | "browser" | "watch";
  currentBalanceUsd?: number;
  nativeBalance?: number;
  tokens?: AgentWalletTokenBalance[];
  lastOnchainSyncAt?: number;
};

export function stakeWalletKey(wallet: Pick<StakePersonalWallet, "network" | "address">) {
  return `${wallet.network}:${wallet.address.toLowerCase()}`;
}

export function mergeStakeWalletsByAccount(wallets: StakePersonalWallet[], seed: StakePersonalWallet | null) {
  const grouped = new Map<string, StakePersonalWallet[]>();
  const orderedKeys: string[] = [];
  for (const wallet of seed ? [seed, ...wallets] : wallets) {
    const key = stakeWalletKey(wallet);
    if (!grouped.has(key)) {
      grouped.set(key, []);
      orderedKeys.push(key);
    }
    grouped.get(key)!.push(wallet);
  }
  return orderedKeys.map((key) => mergeAccountWallets(grouped.get(key)!));
}

function mergeAccountWallets(wallets: StakePersonalWallet[]) {
  const signerWallet = wallets.find((wallet) => wallet.custodyMode === "local");
  const baseWallet = signerWallet ?? wallets[0]!;
  const latestBalanceWallet = newestWalletWithNumber(wallets, "currentBalanceUsd");
  const latestNativeWallet = newestWalletWithNumber(wallets, "nativeBalance");
  return {
    ...wallets[0],
    ...baseWallet,
    name: baseWallet.name || wallets.find((wallet) => wallet.name)?.name,
    currentBalanceUsd: latestBalanceWallet?.currentBalanceUsd ?? baseWallet.currentBalanceUsd,
    nativeBalance: latestNativeWallet?.nativeBalance ?? baseWallet.nativeBalance,
    tokens: mergeWalletTokens(wallets),
    lastOnchainSyncAt: Math.max(...wallets.map(walletSyncTimestamp), 0),
  };
}

function newestWalletWithNumber(wallets: StakePersonalWallet[], key: "currentBalanceUsd" | "nativeBalance") {
  return wallets
    .filter((wallet) => Number.isFinite(wallet[key]))
    .sort((left, right) => walletSyncTimestamp(right) - walletSyncTimestamp(left))[0];
}

function mergeWalletTokens(wallets: StakePersonalWallet[]) {
  const tokens = new Map<string, { token: AgentWalletTokenBalance; wallet: StakePersonalWallet }>();
  for (const wallet of wallets) {
    for (const token of wallet.tokens ?? []) {
      const key = walletTokenKey(token);
      const existing = tokens.get(key);
      if (!existing || shouldReplaceToken(existing.wallet, wallet, existing.token, token)) {
        tokens.set(key, { token, wallet });
      }
    }
  }
  return [...tokens.values()].map((entry) => entry.token);
}

function shouldReplaceToken(
  currentWallet: StakePersonalWallet,
  nextWallet: StakePersonalWallet,
  currentToken: AgentWalletTokenBalance,
  nextToken: AgentWalletTokenBalance,
) {
  const currentTimestamp = walletSyncTimestamp(currentWallet);
  const nextTimestamp = walletSyncTimestamp(nextWallet);
  if (nextTimestamp !== currentTimestamp) return nextTimestamp > currentTimestamp;
  if ((nextWallet.custodyMode === "local") !== (currentWallet.custodyMode === "local")) {
    return nextWallet.custodyMode === "local";
  }
  return nextToken.balance > currentToken.balance;
}

function walletTokenKey(token: AgentWalletTokenBalance) {
  const identifier = token.isNative
    ? "native"
    : token.tokenAddress?.trim().toLowerCase() || token.symbol.trim().toUpperCase();
  return `${token.network}:${identifier}`;
}

function walletSyncTimestamp(wallet: StakePersonalWallet) {
  return Number(wallet.lastOnchainSyncAt) || 0;
}
