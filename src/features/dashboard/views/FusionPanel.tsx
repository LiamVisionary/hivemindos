"use client";

import { FusionShowcase } from "@/features/dashboard/views/fusion-showcase";
import { FusionBlindCompareTool } from "@/features/dashboard/views/FusionBlindCompareTool";
import type { SharedVaultConfig } from "@/lib/types/agent-runtime";

export function FusionPanel({ sharedVault }: { sharedVault?: SharedVaultConfig }) {
  return (
    <>
      <FusionBlindCompareTool />
      <FusionShowcase embedded vaultPath={sharedVault?.enabled ? sharedVault.vaultPath : undefined} />
    </>
  );
}
