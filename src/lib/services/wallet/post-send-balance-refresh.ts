type WalletTokenBalanceLike = {
  symbol?: unknown;
  balance?: unknown;
};

export type WalletBalanceRecordLike = {
  address?: unknown;
  network?: unknown;
  nativeBalance?: unknown;
  tokens?: WalletTokenBalanceLike[];
};

type RefreshWalletUntilAssetBalanceOptions<T extends WalletBalanceRecordLike> = {
  asset: string;
  address: string;
  network: string;
  minimumBalance: number;
  read: () => Promise<T[]>;
  persist: (wallets: T[]) => Promise<void>;
  invalidate: () => Promise<void>;
  retryDelaysMs?: number[];
  wait?: (delayMs: number) => Promise<void>;
};

const DEFAULT_RETRY_DELAYS_MS = [0, 500, 1_500, 3_000];
const BALANCE_EPSILON = 1e-12;

function walletAssetBalance(wallet: WalletBalanceRecordLike, assetInput: string): number {
  const asset = assetInput.trim().toUpperCase();
  const tokenBalance = (Array.isArray(wallet.tokens) ? wallet.tokens : [])
    .filter((token) => String(token?.symbol || "").trim().toUpperCase() === asset)
    .reduce((total, token) => total + Math.max(0, Number(token?.balance) || 0), 0);
  if (tokenBalance > 0) return tokenBalance;
  if (asset === "ETH" || asset === "SOL") return Math.max(0, Number(wallet.nativeBalance) || 0);
  return 0;
}

function matchesExpectedBalance(
  wallet: WalletBalanceRecordLike,
  expected: Pick<RefreshWalletUntilAssetBalanceOptions<WalletBalanceRecordLike>, "asset" | "address" | "network" | "minimumBalance">,
) {
  const sameAddress = String(wallet.address || "").trim().toLowerCase() === expected.address.trim().toLowerCase();
  const sameNetwork = String(wallet.network || "").trim() === expected.network.trim();
  return sameAddress && sameNetwork && walletAssetBalance(wallet, expected.asset) + BALANCE_EPSILON >= expected.minimumBalance;
}

export async function refreshWalletUntilAssetBalance<T extends WalletBalanceRecordLike>(
  options: RefreshWalletUntilAssetBalanceOptions<T>,
): Promise<{ synced: boolean; wallets: T[] }> {
  const retryDelays = options.retryDelaysMs?.length ? options.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS;
  const wait = options.wait ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  let wallets: T[] = [];

  for (const delayMs of retryDelays) {
    if (delayMs > 0) await wait(delayMs);
    wallets = await options.read().catch(() => []);
    if (!wallets.some((wallet) => matchesExpectedBalance(wallet, options))) continue;
    await options.persist(wallets);
    return { synced: true, wallets };
  }

  await options.invalidate();
  return { synced: false, wallets };
}
