"use client";

import { FusionShowcase } from "@/features/dashboard/views/fusion-showcase";
import { FusionBlindCompareTool } from "@/features/dashboard/views/FusionBlindCompareTool";
import type { SharedVaultConfig } from "@/lib/types/agent-runtime";
import styles from "./FusionPanel.module.css";

export function FusionPanel({ sharedVault }: { sharedVault?: SharedVaultConfig }) {
  return (
    <section className={styles.root} aria-label="Hive Fusion">
      <FusionBlindCompareTool />
      <FusionShowcase embedded vaultPath={sharedVault?.enabled ? sharedVault.vaultPath : undefined} />
    </section>
  );
}
