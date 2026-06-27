import type { BrainGraph } from "@/features/dashboard/dashboard-types";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { invokeNative } from "@/lib/native/invoke";

export async function getNativeBrainGraph(input: {
  vaultPath?: string;
  force?: boolean;
}): Promise<BrainGraph | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    return await invokeNative<BrainGraph>("brain_graph", {
      vaultPath: input.vaultPath,
      force: input.force,
    });
  } catch {
    return null;
  }
}
