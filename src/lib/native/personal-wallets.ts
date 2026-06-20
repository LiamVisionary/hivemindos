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

/**
 * Load personal (user) wallets the same way the Wallets screen does: the native
 * Tauri bridge first (static desktop has no /api server), then the HTTP route.
 * Returns [] when neither source has wallets.
 */
export async function fetchPersonalWalletRecords(vaultPath?: string): Promise<Array<Record<string, unknown>>> {
  const native = await readNativePersonalWallets({ vaultPath });
  if (native?.ok && Array.isArray(native.wallets)) return native.wallets;
  const query = vaultPath ? `?vaultPath=${encodeURIComponent(vaultPath)}` : "";
  const response = await fetch(`/api/wallet/personal${query}`, { headers: { accept: "application/json" }, cache: "no-store" }).catch(() => null);
  const data = (await response?.json().catch(() => null)) as { ok?: boolean; wallets?: Array<Record<string, unknown>> } | null;
  return response?.ok && data?.ok && Array.isArray(data.wallets) ? data.wallets : [];
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
export async function fetchPersonalWalletBalance(address: string, network: string): Promise<PersonalWalletBalance | null> {
  if (!address.trim() || !network.trim()) return null;
  const response = await fetch("/api/wallet/balance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, network }),
  }).catch(() => null);
  const data = (await response?.json().catch(() => null)) as {
    ok?: boolean;
    balance?: { tokenBalance: number; nativeBalance: number; totalValueUsd?: number | null; tokens?: Array<Record<string, unknown>>; fetchedAt: number };
  } | null;
  if (!response?.ok || !data?.ok || !data.balance) return null;
  const totalValueUsd = Number(data.balance.totalValueUsd);
  return {
    currentBalanceUsd: Number.isFinite(totalValueUsd) && totalValueUsd >= 0 ? totalValueUsd : Number(data.balance.tokenBalance) || 0,
    nativeBalance: Number(data.balance.nativeBalance) || 0,
    tokens: Array.isArray(data.balance.tokens) ? data.balance.tokens : [],
    lastOnchainSyncAt: Number(data.balance.fetchedAt) || Date.now(),
  };
}
