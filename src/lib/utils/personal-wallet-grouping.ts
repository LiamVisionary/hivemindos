/* personal-wallet-grouping.ts — the SINGLE source of truth for turning raw
   personal ("user:") wallet records into grouped, multi-chain wallet cards.
   Both the Wallets screen (WalletPanel → My wallets) and the Trade / x402 wallet
   selector consume this, so there is exactly one place that decides how a seed's
   per-chain records collapse into one wallet, how it's named, and which chains it
   spans. Pure functions only (no React/DOM) so server routes can reuse the
   helpers too. This module is intentionally import-free so the hermetic wallet
   test suites can load it under bare `node` type-stripping (no alias loader). */

export type PersonalChainKey = "base" | "solana" | "robinhood" | "other";

export type PersonalWalletTransferAsset = {
  symbol: string;
  balance: number;
  priceUsd?: number;
  isNative?: boolean;
  tokenAddress?: string;
};

export type PersonalWalletAccount = {
  /** Executable per-chain record id (e.g. "user:abc:eip155-8453"). The backend
   *  resolves the signing wallet by THIS id, so a grouped/seed-root id is never
   *  used for execution — always an account id. */
  id: string;
  chainKey: PersonalChainKey;
  /** CAIP network, e.g. "eip155:8453" / "solana:mainnet". */
  network: string;
  networkLabel: string;
  address: string;
  custodyMode: "local" | "watch";
  currentBalanceUsd: number;
  assets: PersonalWalletTransferAsset[];
};

export type GroupedPersonalWallet = {
  id: string;
  spendId: string;
  name: string;
  icon: "shield" | "eye";
  kind: "Local wallet" | "Watch wallet";
  canSpend: boolean;
  network: string;
  token: string;
  addr: string;
  primary: boolean;
  gas: number;
  source: string;
  holdings: Array<[string, number]>;
  addresses: Array<[string, string]>;
  /** Per-chain executable accounts for this wallet (Base, Solana, …). */
  accounts: PersonalWalletAccount[];
};

export type PersonalWalletTransferTarget = {
  key: string;
  wallet: GroupedPersonalWallet;
  account: PersonalWalletAccount;
};

export function personalWalletSpendAccountForAsset(wallet: GroupedPersonalWallet | null | undefined, asset: string): PersonalWalletAccount | null {
  const accounts = Array.isArray(wallet?.accounts) ? wallet.accounts : [];
  const localAccounts = accounts.filter((account) => account.custodyMode === "local"
    && account.assets.some((candidate) => candidate.symbol === asset && candidate.balance > 0));
  return localAccounts.find((account) => account.id === wallet?.spendId) ?? localAccounts[0] ?? null;
}

export function personalWalletTransferTargets(source: GroupedPersonalWallet | null | undefined, asset: string, wallets: GroupedPersonalWallet[]) {
  const sourceAccount = personalWalletSpendAccountForAsset(source, asset);
  if (!sourceAccount) return { sourceAccount: null, targets: [] as PersonalWalletTransferTarget[] };
  const sourceAddress = sourceAccount.address.toLowerCase();
  const targets = wallets.flatMap((wallet) => wallet.accounts
    .filter((account) => account.network === sourceAccount.network)
    .filter((account) => account.address.toLowerCase() !== sourceAddress)
    .map((account) => ({ key: `${wallet.id}:${account.id}`, wallet, account })));
  return { sourceAccount, targets };
}

export const RECOVERY_PHRASE_PERSONAL_WALLET_SUFFIX = /:(?:eip155-\d+|solana-[a-z0-9-]+)$/i;
const RECOVERY_PHRASE_ACCOUNT_SUFFIX = /:account-(\d+)$/i;

export function recoveryPhraseAccountIndexFromWalletId(id: unknown): number {
  const groupId = String(id || "").replace(RECOVERY_PHRASE_PERSONAL_WALLET_SUFFIX, "");
  const accountIndex = Number(groupId.match(RECOVERY_PHRASE_ACCOUNT_SUFFIX)?.[1]);
  return Number.isInteger(accountIndex) && accountIndex >= 0 ? accountIndex : 0;
}

export function recoveryPhraseWalletGroupId(baseId: string, accountIndex: number): string {
  const normalizedIndex = Number.isInteger(accountIndex) && accountIndex >= 0 ? accountIndex : 0;
  return `${baseId.replace(RECOVERY_PHRASE_ACCOUNT_SUFFIX, "")}:account-${normalizedIndex}`;
}

/** Public path to the circular chain badge for a chain key (versioned so the
 *  immutable-cached public asset refetches when the art changes). */
export const CHAIN_BADGE_SRC: Record<string, string> = {
  base: "/icons/wallet/chains/base.svg?v=2",
  solana: "/icons/wallet/chains/solana.svg?v=2",
  robinhood: "/icons/wallet/chains/robinhood.svg?v=1",
};

export function chainBadgeSrc(chainKey: string): string | null {
  return CHAIN_BADGE_SRC[chainKey] ?? null;
}

export function chainKeyForNetwork(network: string): PersonalChainKey {
  const value = String(network || "").trim().toLowerCase();
  if (value.startsWith("solana")) return "solana";
  if (value === "eip155:4663" || value === "eip155:46630") return "robinhood";
  // Only real Base networks get the Base badge — other EVM chains are "other"
  // (generic glyph) rather than mislabelled as Base.
  if (value === "eip155:8453" || value === "eip155:84532" || value === "base" || value === "base-sepolia") return "base";
  return "other";
}

export function chainShortLabel(chainKey: PersonalChainKey, fallback = ""): string {
  if (chainKey === "solana") return "Solana";
  if (chainKey === "robinhood") return "Robinhood";
  if (chainKey === "base") return "Base";
  return fallback;
}

/** Human label for a CAIP network. Known chains get friendly names; an
 *  unrecognised EVM chain becomes "EVM <chainId>" (NOT collapsed to Base) and
 *  anything else passes through — so a chain dropdown built from these labels
 *  reflects exactly the chains the user holds, never a hardcoded set. */
export function chainLabelForNetwork(network: string): string {
  const value = String(network || "").trim();
  if (!value) return "";
  const lower = value.toLowerCase();
  if (lower === "eip155:8453") return "Base";
  if (lower === "eip155:84532") return "Base Sepolia";
  if (lower === "eip155:4663") return "Robinhood Chain";
  if (lower === "eip155:46630") return "Robinhood Chain Testnet";
  if (lower === "eip155:1") return "Ethereum";
  if (lower === "eip155:42161") return "Arbitrum";
  if (lower === "eip155:10") return "Optimism";
  if (lower === "eip155:137") return "Polygon";
  if (lower.startsWith("solana")) return "Solana";
  if (lower.startsWith("eip155:")) return `EVM ${value.slice("eip155:".length)}`;
  return value;
}

/** Block-explorer name for a CAIP network — used to label a "View on <name>"
 *  link so the affordance names where it goes rather than a bare glyph. */
export function txExplorerName(network: string): string {
  const lower = String(network || "").trim().toLowerCase();
  if (lower.startsWith("solana")) return "Solscan";
  if (lower === "eip155:4663" || lower === "eip155:46630") return "Blockscout";
  return "Basescan";
}

/** Absolute block-explorer transaction URL for a `{network, hash}` pair, or ""
 *  when the network or hash is unknown so callers can conditionally render the
 *  link. Base/Base-Sepolia → Basescan, Robinhood → its Blockscout (single-sourced
 *  from ROBINHOOD_CHAIN config), Solana → Solscan (devnet gets the cluster param).
 *  Kept beside the chain-label helpers so there is one place that maps a CAIP
 *  network to its explorer. */
export function txExplorerUrl(network: string, hash: string): string {
  const tx = String(hash || "").trim();
  if (!tx) return "";
  const lower = String(network || "").trim().toLowerCase();
  if (lower.startsWith("solana")) {
    const cluster = lower.includes("devnet") ? "?cluster=devnet" : lower.includes("testnet") ? "?cluster=testnet" : "";
    return `https://solscan.io/tx/${tx}${cluster}`;
  }
  if (lower === "eip155:4663" || lower === "eip155:46630") {
    // Mirrors ROBINHOOD_CHAIN.explorerUrl (src/lib/config/robinhood-chain.ts).
    // Inlined so this module stays import-free for the bare-node wallet tests.
    return `https://robinhoodchain.blockscout.com/tx/${tx}`;
  }
  if (lower === "eip155:84532") return `https://sepolia.basescan.org/tx/${tx}`;
  // Base mainnet and any unlabeled EVM default to Basescan — every send in this
  // app settles on Base unless an explicit non-Base network says otherwise.
  return `https://basescan.org/tx/${tx}`;
}

export function isRecoveryPhrasePersonalWallet(wallet: any): boolean {
  const id = String(wallet?.id || wallet?.agentId || "");
  return wallet?.importedFrom === "recovery-phrase" || RECOVERY_PHRASE_PERSONAL_WALLET_SUFFIX.test(id);
}

export function isGenericPersonalWalletName(name: unknown): boolean {
  const normalized = String(name || "").trim().toLowerCase();
  return normalized === "base"
    || normalized === "base mainnet"
    || normalized === "base sepolia"
    || normalized === "robinhood"
    || normalized === "robinhood chain"
    || normalized === "robinhood chain testnet"
    || normalized === "solana"
    || normalized === "solana mainnet"
    || normalized === "solana devnet"
    || normalized === "my wallet"
    || normalized === "my wallet base"
    || normalized === "my wallet solana"
    || normalized === "my base wallet"
    || normalized === "my solana wallet"
    || /^my (?:base(?: mainnet)?|base sepolia|solana(?: mainnet)?|solana devnet|robinhood chain(?: testnet)?|evm \d+) wallet$/.test(normalized)
    || /^my wallet (?:base(?: mainnet)?|base sepolia|solana(?: mainnet)?|solana devnet|robinhood chain(?: testnet)?|evm \d+)$/.test(normalized);
}

export function personalWalletNetworkLabel(network: string): string {
  if (network.includes("solana")) return "Solana mainnet";
  if (network.includes("46630")) return "Robinhood Chain Testnet";
  if (network.includes("4663")) return "Robinhood Chain";
  if (network.includes("84532")) return "Base Sepolia";
  if (network.includes("eip155")) return "Base mainnet";
  return network || "Base mainnet";
}

export function nativeSymbolForWallet(network: string): string {
  return network.includes("solana") ? "SOL" : "ETH";
}

export function personalWalletOptionalNumber(value: unknown): number | undefined {
  if (value == null || (typeof value === "string" && !value.trim())) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function personalWalletHoldings(wallet: any): Array<[string, number]> {
  const tokens = Array.isArray(wallet?.tokens) ? wallet.tokens : [];
  const rows = tokens
    .map((token: any): [string, number] => [String(token?.symbol || "").toUpperCase(), Number(token?.balance ?? 0) || 0])
    .filter((row: [string, number]) => Boolean(row[0]) && row[1] > 0);
  if (rows.length) return rows;
  if (Number(wallet?.nativeBalance) > 0) return [[nativeSymbolForWallet(String(wallet?.network || "")), Number(wallet.nativeBalance)]];
  if (Number(wallet?.currentBalanceUsd) > 0) return [["USDC", Number(wallet.currentBalanceUsd)]];
  return [];
}

export function personalWalletTransferAssets(wallet: any): PersonalWalletTransferAsset[] {
  return (Array.isArray(wallet?.tokens) ? wallet.tokens : [])
    .map((token: any): PersonalWalletTransferAsset | null => {
      const symbol = String(token?.symbol || "").trim().toUpperCase();
      const balance = Number(token?.balance ?? 0) || 0;
      if (!symbol || balance <= 0) return null;
      const explicitPrice = personalWalletOptionalNumber(token?.priceUsd);
      const valueUsd = personalWalletOptionalNumber(token?.valueUsd);
      const priceUsd = explicitPrice != null && explicitPrice > 0
        ? explicitPrice
        : valueUsd != null && valueUsd > 0
          ? valueUsd / balance
          : undefined;
      return {
        symbol,
        balance,
        ...(priceUsd == null ? {} : { priceUsd }),
        ...(token?.isNative === true ? { isNative: true } : {}),
        ...(String(token?.tokenAddress || "").trim() ? { tokenAddress: String(token.tokenAddress).trim() } : {}),
      };
    })
    .filter((asset: PersonalWalletTransferAsset | null): asset is PersonalWalletTransferAsset => asset !== null);
}

export function combinePersonalWalletHoldings(wallets: any[]): Array<[string, number]> {
  const totals = new Map<string, number>();
  wallets.flatMap(personalWalletHoldings).forEach(([symbol, amount]) => {
    totals.set(symbol, (totals.get(symbol) ?? 0) + amount);
  });
  return [...totals.entries()].filter(([, amount]) => amount > 0);
}

export function recoveryPhraseWalletName(wallet: any, count: number): string {
  const fallback = `My ${personalWalletNetworkLabel(String(wallet?.network || ""))} wallet`;
  const name = String(wallet?.name || fallback).trim();
  return count > 1 && isRecoveryPhrasePersonalWallet(wallet)
    ? name.replace(/\s+(?:Base|Robinhood Chain|Solana)$/i, "") || "My wallet"
    : name;
}

export function personalWalletGroupKey(wallet: any, index: number): string {
  const id = String(wallet?.id || wallet?.agentId || "");
  if (isRecoveryPhrasePersonalWallet(wallet)) return id.replace(RECOVERY_PHRASE_PERSONAL_WALLET_SUFFIX, "") || id;
  return id || `${String(wallet?.network || "wallet")}:${String(wallet?.address || index)}`;
}

export function personalWalletChainRank(wallet: any): number {
  const chainKey = chainKeyForNetwork(String(wallet?.network || ""));
  if (chainKey === "base") return 0;
  if (chainKey === "robinhood") return 1;
  if (chainKey === "solana") return 2;
  return 3;
}

/** Group raw personal wallet records into one card per seed (Base + Robinhood Chain + Solana from
 *  the same recovery phrase collapse into a single multi-chain wallet). */
export function buildGroupedPersonalWallets(wallets: any[] | null): GroupedPersonalWallet[] {
  if (!Array.isArray(wallets)) return [];
  const groups = new Map<string, any[]>();
  wallets.forEach((wallet, index) => {
    const key = personalWalletGroupKey(wallet, index);
    groups.set(key, [...(groups.get(key) ?? []), wallet]);
  });
  return [...groups.entries()].map(([groupId, group], index) => {
    const sorted = [...group].sort((a, b) => personalWalletChainRank(a) - personalWalletChainRank(b));
    const primary = sorted[0] ?? {};
    const nameWallet = sorted.find((wallet) => !isGenericPersonalWalletName(recoveryPhraseWalletName(wallet, sorted.length))) ?? primary;
    const addressRows = sorted
      .map((wallet) => [personalWalletNetworkLabel(String(wallet.network || "")), wallet.address || ""] as [string, string])
      .filter(([, address], rowIndex, rows) => address && rows.findIndex(([chain, existing]) => chain === rows[rowIndex][0] && existing === address) === rowIndex);
    const spendWallet = sorted.find((wallet) => wallet.custodyMode === "local" && String(wallet.network || "").includes("eip155")) ?? sorted.find((wallet) => wallet.custodyMode === "local") ?? primary;
    const accounts: PersonalWalletAccount[] = sorted
      .map((wallet) => ({
        id: String(wallet.id || wallet.agentId || ""),
        chainKey: chainKeyForNetwork(String(wallet.network || "")),
        network: String(wallet.network || ""),
        networkLabel: personalWalletNetworkLabel(String(wallet.network || "")),
        address: String(wallet.address || ""),
        custodyMode: wallet.custodyMode === "local" ? "local" as const : "watch" as const,
        currentBalanceUsd: Number(wallet.currentBalanceUsd) || 0,
        assets: personalWalletTransferAssets(wallet),
      }))
      .filter((account, accountIndex, rows) => account.id && account.address && rows.findIndex((other) => other.id === account.id) === accountIndex);
    return {
      id: groupId || primary.id || primary.agentId || `user-wallet-${index}`,
      spendId: spendWallet.id || spendWallet.agentId || groupId,
      name: recoveryPhraseWalletName(nameWallet, sorted.length),
      icon: sorted.some((wallet) => wallet.custodyMode === "local") ? "shield" : "eye",
      kind: sorted.some((wallet) => wallet.custodyMode === "local") ? "Local wallet" : "Watch wallet",
      canSpend: sorted.some((wallet) => wallet.custodyMode === "local"),
      network: addressRows.length > 1 ? `${addressRows.length} chains` : personalWalletNetworkLabel(String(primary.network || "")),
      token: nativeSymbolForWallet(String(primary.network || "")),
      addr: primary.address || addressRows[0]?.[1] || "",
      primary: index === 0,
      gas: Number(primary.nativeBalance ?? 0) || 0,
      source: primary.importedFrom || primary.custodyMode || "wallet ledger",
      holdings: combinePersonalWalletHoldings(sorted),
      addresses: addressRows.length ? addressRows : [[personalWalletNetworkLabel(String(primary.network || "")), primary.address || ""]],
      accounts,
    };
  });
}

// ── source-merge layer (ledger records + dashboard-state wallets) ──────────────

export function personalWalletAccountKey(wallet: any): string {
  const network = String(wallet?.network || "").trim();
  const address = String(wallet?.address || "").trim().toLowerCase();
  return network && address ? `${network}:${address}` : "";
}

function personalWalletIdentity(wallet: any): string {
  return String(wallet?.id || wallet?.agentId || "").trim();
}

function personalWalletCreatedAt(wallet: any): number {
  const createdAt = typeof wallet?.createdAt === "string" ? Date.parse(wallet.createdAt) : Number(wallet?.createdAt);
  return Number.isFinite(createdAt) && createdAt > 0 ? createdAt : 0;
}

function establishedPersonalWalletRecord(base: any, next: any): any {
  const baseId = personalWalletIdentity(base);
  const nextId = personalWalletIdentity(next);
  if (!baseId || !nextId || baseId === nextId) return base;
  const baseCreatedAt = personalWalletCreatedAt(base);
  const nextCreatedAt = personalWalletCreatedAt(next);
  return nextCreatedAt > 0 && (baseCreatedAt <= 0 || nextCreatedAt < baseCreatedAt) ? next : base;
}

export function preferredPersonalWalletRecordName(base: any, next: any): string {
  const baseName = String(base?.name || "").trim();
  const nextName = String(next?.name || "").trim();
  const baseId = personalWalletIdentity(base);
  const nextId = personalWalletIdentity(next);
  if (baseId && nextId && baseId !== nextId) {
    return String(establishedPersonalWalletRecord(base, next)?.name || "").trim() || baseName || nextName;
  }
  if (nextName && !isGenericPersonalWalletName(nextName)) return nextName;
  if (baseName && !isGenericPersonalWalletName(baseName)) return baseName;
  return nextName || baseName;
}

export function mergePersonalWalletRecord(base: any, next: any): any {
  if (!base) return next;
  const baseUpdated = Number(base.updatedAt ?? base.lastOnchainSyncAt ?? 0) || 0;
  const nextUpdated = Number(next.updatedAt ?? next.lastOnchainSyncAt ?? 0) || 0;
  const preferNextBalance = nextUpdated >= baseUpdated || Number(base.currentBalanceUsd ?? 0) <= 0;
  const nextHasTokenRows = Array.isArray(next.tokens);
  const identity = establishedPersonalWalletRecord(base, next);
  return {
    ...base,
    ...next,
    id: identity?.id || identity?.agentId || base.id || next.id,
    agentId: identity?.agentId || identity?.id || base.agentId || next.agentId,
    name: preferredPersonalWalletRecordName(base, next),
    custodyMode: base.custodyMode === "local" || next.custodyMode === "local" ? "local" : "watch",
    importedFrom: base.importedFrom !== "watch" ? base.importedFrom : next.importedFrom,
    currentBalanceUsd: preferNextBalance ? Math.max(0, Number(next.currentBalanceUsd ?? 0) || 0) : Number(base.currentBalanceUsd ?? 0) || Number(next.currentBalanceUsd ?? 0) || 0,
    nativeBalance: preferNextBalance ? Math.max(0, Number(next.nativeBalance ?? 0) || 0) : Number(base.nativeBalance ?? 0) || Number(next.nativeBalance ?? 0) || 0,
    tokens: preferNextBalance && nextHasTokenRows ? next.tokens : Array.isArray(base.tokens) ? base.tokens : [],
    lastOnchainSyncAt: Math.max(Number(base.lastOnchainSyncAt ?? 0) || 0, Number(next.lastOnchainSyncAt ?? 0) || 0),
    createdAt: identity?.createdAt ?? base.createdAt ?? next.createdAt,
    updatedAt: Math.max(baseUpdated, nextUpdated),
  };
}

export function mergePersonalWalletList(wallets: any[]): any[] {
  const merged = new Map<string, any>();
  wallets.forEach((wallet) => {
    const key = personalWalletAccountKey(wallet);
    if (key) merged.set(key, mergePersonalWalletRecord(merged.get(key), wallet));
  });
  return [...merged.values()];
}

export function personalWalletFromDashboardState(agentId: string, wallet: any): any | null {
  if (!agentId.startsWith("user:")) return null;
  const address = String(wallet?.walletAddress || wallet?.vaultAddress || wallet?.address || "").trim();
  const network = String(wallet?.network || "").trim();
  if (!address || !network) return null;
  const custodyMode = wallet?.custodyMode === "watch" ? "watch" : "local";
  return {
    agentId,
    id: agentId,
    name: recoveryPhraseWalletName({ id: agentId, agentId, name: wallet?.name, network }, 1),
    address,
    network,
    custodyMode,
    importedFrom: isRecoveryPhrasePersonalWallet({ id: agentId, agentId }) ? "recovery-phrase" : custodyMode === "local" ? "private-key" : "watch",
    currentBalanceUsd: Number(wallet?.currentBalanceUsd ?? wallet?.onchainBalanceUsd ?? 0) || 0,
    nativeBalance: Number(wallet?.nativeBalance ?? 0) || 0,
    tokens: Array.isArray(wallet?.tokens) ? wallet.tokens : [],
    portfolioVersion: 0,
    lastOnchainSyncAt: Number(wallet?.lastOnchainSyncAt ?? 0) || 0,
    createdAt: Number(wallet?.createdAt ?? 0) || 0,
    updatedAt: Number(wallet?.updatedAt ?? 0) || 0,
  };
}

export function mergePersonalWalletSources(wallets: any[] | null, walletsByAgent: Record<string, any> | undefined): any[] {
  const merged = new Map<string, any>();
  const add = (wallet: any) => {
    const key = personalWalletAccountKey(wallet);
    if (!key) return;
    merged.set(key, mergePersonalWalletRecord(merged.get(key), wallet));
  };
  (Array.isArray(wallets) ? wallets : []).forEach(add);
  Object.entries(walletsByAgent ?? {})
    .map(([agentId, wallet]) => personalWalletFromDashboardState(agentId, wallet))
    .filter(Boolean)
    .forEach(add);
  return [...merged.values()];
}
