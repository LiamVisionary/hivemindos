"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import DashboardNativeFrame from "@/app/DashboardNativeFrame";
import type { DashboardVaultPanelMode } from "@/features/dashboard/DashboardApp";
import { isDashboardView } from "@/features/dashboard/dashboard-navigation";

const DASHBOARD_VAULT_PANEL_MODES = new Set<DashboardVaultPanelMode>([
  "hive-vault",
  "shared-skills",
  "brain-services",
  "env",
  "config",
]);

export default function StaticNativeHome() {
  const searchParams = useSearchParams();
  const initialView = useMemo(() => {
    const view = searchParams.get("view");
    return view && isDashboardView(view) ? view : undefined;
  }, [searchParams]);
  const initialVaultPanelMode = useMemo(() => {
    const vaultPanel = searchParams.get("vaultPanel");
    return vaultPanel && DASHBOARD_VAULT_PANEL_MODES.has(vaultPanel as DashboardVaultPanelMode)
      ? vaultPanel as DashboardVaultPanelMode
      : undefined;
  }, [searchParams]);
  const initialChatAgentId = initialView === "chat" ? searchParams.get("agent") ?? undefined : undefined;
  const initialChatLeaf = initialView === "chat" ? searchParams.get("chatLeaf") ?? undefined : undefined;

  return (
    <DashboardNativeFrame
      initialChatAgentId={initialChatAgentId}
      initialChatLeaf={initialChatLeaf}
      initialView={initialView}
      initialVaultPanelMode={initialVaultPanelMode}
    />
  );
}
