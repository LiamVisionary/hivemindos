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
