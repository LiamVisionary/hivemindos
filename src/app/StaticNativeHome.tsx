"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import DashboardApp, { type DashboardVaultPanelMode } from "@/features/dashboard/DashboardApp";
import type { DashboardView } from "@/features/dashboard/dashboard-types";

const DASHBOARD_VIEWS = new Set<DashboardView>([
  "agents",
  "kanban",
  "scheduler",
  "swarm",
  "history",
  "wallet",
  "vault",
  "integrations",
  "maintenance",
  "memory",
  "files",
  "notifications",
  "chat",
  "more",
  "env",
  "my-apps",
  "phone",
  "aeon",
]);

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
    return view && DASHBOARD_VIEWS.has(view as DashboardView) ? view as DashboardView : undefined;
  }, [searchParams]);
  const initialVaultPanelMode = useMemo(() => {
    const vaultPanel = searchParams.get("vaultPanel");
    return vaultPanel && DASHBOARD_VAULT_PANEL_MODES.has(vaultPanel as DashboardVaultPanelMode)
      ? vaultPanel as DashboardVaultPanelMode
      : undefined;
  }, [searchParams]);

  return <DashboardApp initialView={initialView} initialVaultPanelMode={initialVaultPanelMode} />;
}
