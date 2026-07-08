import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export type NativePersonalWalletsPayload = {
  ok?: boolean;
  source?: string;
  wallets?: Array<Record<string, unknown>>;
  error?: string;
};

export async function readNativePersonalWallets(input: {
  vaultPath?: string;
} = {}): Promise<NativePersonalWalletsPayload | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<NativePersonalWalletsPayload>("obsidian_personal_wallets", {
      vaultPath: input.vaultPath,
    });
  } catch {
    return null;
  }
}

function personalWalletRecordKey(wallet: Record<string, unknown>): string {
  const network = String(wallet.network || "").trim();
  const address = String(wallet.address || "").trim().toLowerCase();
  return network && address ? `${network}:${address}` : "";
}

function isGenericPersonalWalletName(name: unknown): boolean {
  const normalized = String(name || "").trim().toLowerCase();
  return normalized === "my wallet"
    || normalized === "my wallet base"
    || normalized === "my wallet solana"
    || normalized === "my base wallet"
    || normalized === "my solana wallet"
    || /^my (?:base(?: mainnet)?|base sepolia|solana(?: mainnet)?|solana devnet|robinhood chain(?: testnet)?|evm \d+) wallet$/.test(normalized)
    || /^my wallet (?:base(?: mainnet)?|base sepolia|solana(?: mainnet)?|solana devnet|robinhood chain(?: testnet)?|evm \d+)$/.test(normalized);
}

function personalWalletRecordTime(wallet: Record<string, unknown>): number {
  return Math.max(Number(wallet.updatedAt ?? 0) || 0, Number(wallet.lastOnchainSyncAt ?? 0) || 0);
}

function preferredPersonalWalletName(base: Record<string, unknown>, next: Record<string, unknown>): string {
  const baseName = String(base.name || "").trim();
  const nextName = String(next.name || "").trim();
  if (nextName && !isGenericPersonalWalletName(nextName)) return nextName;
  if (baseName && !isGenericPersonalWalletName(baseName)) return baseName;
  return nextName || baseName;
}

function mergePersonalWalletRecord(base: Record<string, unknown> | undefined, next: Record<string, unknown>): Record<string, unknown> {
  if (!base) return next;
  const baseTime = personalWalletRecordTime(base);
  const nextTime = personalWalletRecordTime(next);
  const preferNextBalance = nextTime >= baseTime || Number(base.currentBalanceUsd ?? 0) <= 0;
  const custodyMode = base.custodyMode === "local" || next.custodyMode === "local" ? "local" : next.custodyMode || base.custodyMode;
  const importedFrom = base.importedFrom !== "watch" ? base.importedFrom : next.importedFrom || base.importedFrom;
  return {
    ...base,
    ...next,
    id: base.id || next.id,
    agentId: base.agentId || next.agentId,
    name: preferredPersonalWalletName(base, next),
    custodyMode,
    importedFrom,
    currentBalanceUsd: preferNextBalance && Number(next.currentBalanceUsd ?? 0) > 0
      ? Number(next.currentBalanceUsd)
      : Number(base.currentBalanceUsd ?? 0) || Number(next.currentBalanceUsd ?? 0) || 0,
    nativeBalance: preferNextBalance && Number(next.nativeBalance ?? 0) > 0
      ? Number(next.nativeBalance)
      : Number(base.nativeBalance ?? 0) || Number(next.nativeBalance ?? 0) || 0,
    tokens: Array.isArray(next.tokens) && next.tokens.length ? next.tokens : Array.isArray(base.tokens) ? base.tokens : [],
    lastOnchainSyncAt: Math.max(Number(base.lastOnchainSyncAt ?? 0) || 0, Number(next.lastOnchainSyncAt ?? 0) || 0),
    updatedAt: Math.max(baseTime, nextTime),
  };
}

function mergePersonalWalletRecords(...sources: Array<Array<Record<string, unknown>> | null | undefined>): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  for (const wallets of sources) {
    for (const wallet of wallets ?? []) {
      const key = personalWalletRecordKey(wallet);
      if (!key) continue;
      merged.set(key, mergePersonalWalletRecord(merged.get(key), wallet));
    }
  }
  return [...merged.values()];
}

async function fetchHttpPersonalWalletRecords(vaultPath?: string): Promise<Array<Record<string, unknown>>> {
  const query = vaultPath ? `?vaultPath=${encodeURIComponent(vaultPath)}` : "";
  const response = await fetch(`/api/wallet/personal${query}`, { headers: { accept: "application/json" }, cache: "no-store" }).catch(() => null);
  const data = (await response?.json().catch(() => null)) as { ok?: boolean; wallets?: Array<Record<string, unknown>> } | null;
  return response?.ok && data?.ok && Array.isArray(data.wallets) ? data.wallets : [];
}

/**
 * Load personal (user) wallets the same way the Wallets screen does: the native
 * Tauri bridge first (static desktop has no /api server), merged with the HTTP
 * route when available so ledger names can repair older native vault metadata.
 * Returns [] when neither source has wallets.
 */
export async function fetchPersonalWalletRecords(vaultPath?: string): Promise<Array<Record<string, unknown>>> {
  const native = await readNativePersonalWallets({ vaultPath });
  const nativeWallets = native?.ok && Array.isArray(native.wallets) ? native.wallets : null;
  const httpWallets = await fetchHttpPersonalWalletRecords(vaultPath);
  return nativeWallets ? mergePersonalWalletRecords(nativeWallets, httpWallets) : httpWallets;
}

export type PersonalWalletBalance = {
  currentBalanceUsd: number;
  nativeBalance: number;
  tokens: Array<Record<string, unknown>>;
  lastOnchainSyncAt: number;
};

/**
 * Live on-chain balance for one personal wallet, the same way the Wallets screen
 * refreshes (POST /api/wallet/balance). Stored ledger records can be stale or
 * zero until the Wallets view has refreshed+persisted them, so any surface that
 * shows a balance (e.g. the Trade wallet picker) should refresh through here
 * rather than trusting the persisted `currentBalanceUsd`. Returns null on any
 * failure (e.g. no /api server in a static desktop build) so callers fall back
 * to the stored value.
 */
export type PersonalWalletBalanceResult =
  | { ok: true; balance: PersonalWalletBalance }
  | { ok: false; error: string };

/**
 * Error-aware variant of {@link fetchPersonalWalletBalance}. Surfaces WHY a read
 * failed (RPC timeout, rate limit, no /api server, …) so a caller can show a real
 * error + retry instead of silently rendering a $0.00 that's indistinguishable
 * from an empty wallet. The route already returns a friendly `error` string.
 */
export async function fetchPersonalWalletBalanceResult(address: string, network: string): Promise<PersonalWalletBalanceResult> {
  if (!address.trim() || !network.trim()) return { ok: false, error: "This wallet has no address to read an on-chain balance from." };
  const response = await fetch("/api/wallet/balance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, network }),
  }).catch(() => null);
  if (!response) return { ok: false, error: "Could not reach the wallet balance service." };
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    balance?: { tokenBalance: number; nativeBalance: number; totalValueUsd?: number | null; tokens?: Array<Record<string, unknown>>; fetchedAt: number };
  } | null;
  if (!response.ok || !data?.ok || !data.balance) {
    return { ok: false, error: (data?.error && String(data.error).trim()) || `Balance read failed (HTTP ${response.status}).` };
  }
  const totalValueUsd = Number(data.balance.totalValueUsd);
  return {
    ok: true,
    balance: {
      currentBalanceUsd: Number.isFinite(totalValueUsd) && totalValueUsd >= 0 ? totalValueUsd : Number(data.balance.tokenBalance) || 0,
      nativeBalance: Number(data.balance.nativeBalance) || 0,
      tokens: Array.isArray(data.balance.tokens) ? data.balance.tokens : [],
      lastOnchainSyncAt: Number(data.balance.fetchedAt) || Date.now(),
    },
  };
}

export async function fetchPersonalWalletBalance(address: string, network: string): Promise<PersonalWalletBalance | null> {
  const result = await fetchPersonalWalletBalanceResult(address, network);
  return result.ok ? result.balance : null;
}
