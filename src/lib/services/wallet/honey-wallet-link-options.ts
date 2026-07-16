import { isHiveEvmAddress } from "@/lib/config/hive-staking";

type HoneyWalletInfo = {
  address: string;
  name?: string;
  network: string;
};

export type HoneyWalletLinkOption = {
  address: string;
  name: string | null;
};

export function buildHoneyWalletLinkOptions(wallets: HoneyWalletInfo[]): HoneyWalletLinkOption[] {
  const walletsByAddress = new Map<string, HoneyWalletLinkOption>();

  for (const wallet of wallets) {
    const address = wallet.address.trim().toLowerCase();
    if (!wallet.network.startsWith("eip155") || !isHiveEvmAddress(address) || walletsByAddress.has(address)) continue;
    walletsByAddress.set(address, {
      address,
      name: wallet.name?.trim() || null,
    });
  }

  return [...walletsByAddress.values()].sort((left, right) => {
    if (Boolean(left.name) !== Boolean(right.name)) return left.name ? -1 : 1;
    return (left.name ?? left.address).localeCompare(right.name ?? right.address);
  });
}
