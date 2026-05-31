import type { BrainSkillInventory } from "@/features/dashboard/dashboard-types";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export async function getNativeBrainSkillInventory(input: {
  vaultPath?: string;
  sharedOnly?: boolean;
}): Promise<BrainSkillInventory | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<BrainSkillInventory>("brain_skill_inventory", {
      vaultPath: input.vaultPath,
      sharedOnly: input.sharedOnly,
    });
  } catch {
    return null;
  }
}
