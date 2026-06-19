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
