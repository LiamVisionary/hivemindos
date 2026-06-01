import type { BrainGraph } from "@/features/dashboard/dashboard-types";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export async function getNativeBrainGraph(input: {
  vaultPath?: string;
  force?: boolean;
}): Promise<BrainGraph | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<BrainGraph>("brain_graph", {
      vaultPath: input.vaultPath,
      force: input.force,
    });
  } catch {
    return null;
  }
}
