import type { AgentWalletTokenBalance } from "@/lib/types/agent-wallet";

type StakeWalletLinkInput = {
  id: string;
  name: string;
  address: string;
  network: string;
  custodyMode: "local" | "watch";
  importedFrom: "generated" | "private-key" | "recovery-phrase" | "browser" | "watch";
};

type StakeTokenLinkInput = AgentWalletTokenBalance & {
  walletId: string;
  walletName: string;
};

type CustodySummaryWallet = {
  custodyMode: "local" | "watch";
};

function pluralizeChain(count: number) {
  return `${count} ${count === 1 ? "chain" : "chains"}`;
}

export function walletCustodySummary(wallets: CustodySummaryWallet[]) {
  const localCount = wallets.filter((wallet) => wallet.custodyMode === "local").length;
  const watchCount = wallets.length - localCount;
  if (!localCount) return `View-only · ${pluralizeChain(wallets.length)}`;
  if (!watchCount) return `Spendable · ${pluralizeChain(wallets.length)}`;
  return `${localCount} spendable · ${watchCount} view-only`;
}

export function stakeHrefForPersonalToken(wallet: StakeWalletLinkInput, token: StakeTokenLinkInput) {
  const params = new URLSearchParams({
    walletId: wallet.id,
    walletName: wallet.name,
    address: wallet.address,
    network: wallet.network,
    custodyMode: wallet.custodyMode,
    importedFrom: wallet.importedFrom,
    tokenSymbol: token.symbol,
    tokenName: token.name,
    tokenBalance: String(token.balance),
  });
  if (token.tokenAddress) params.set("tokenAddress", token.tokenAddress);
  if (token.valueUsd != null) params.set("tokenValueUsd", String(token.valueUsd));
  if (token.priceUsd != null) params.set("tokenPriceUsd", String(token.priceUsd));
  if (token.priceChange24hPct != null) params.set("tokenPriceChange24hPct", String(token.priceChange24hPct));
  if (token.iconUrl) params.set("tokenIconUrl", token.iconUrl);
  return `/stake?${params.toString()}`;
}
