import type { BrainSkillInventory } from "@/features/dashboard/dashboard-types";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { invokeNative } from "@/lib/native/invoke";

export async function getNativeBrainSkillInventory(input: {
  vaultPath?: string;
  sharedOnly?: boolean;
}): Promise<BrainSkillInventory | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    return await invokeNative<BrainSkillInventory>("brain_skill_inventory", {
      vaultPath: input.vaultPath,
      sharedOnly: input.sharedOnly,
    });
  } catch {
    return null;
  }
}
