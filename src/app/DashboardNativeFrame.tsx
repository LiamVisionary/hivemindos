"use client";

import dynamic from "next/dynamic";
import { DashboardHiveLoader } from "@/features/dashboard/DashboardHiveLoader";
import type { DashboardVaultPanelMode } from "@/features/dashboard/DashboardApp";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import type { WorkHistoryPayload } from "@/lib/types/work-history";

const DashboardApp = dynamic(() => import("@/features/dashboard/DashboardApp"), {
  ssr: false,
  loading: () => <DashboardFrameLoading />,
});

const NativeFirstRunOnboarding = dynamic(
  () => import("@/features/native/NativeFirstRunOnboarding").then((mod) => mod.NativeFirstRunOnboarding),
  { ssr: false },
);

const DASHBOARD_FRAME_ROUTE_LABELS: Record<string, string> = {
  agents: "Fleet",
  kanban: "Work",
  scheduler: "Scheduler",
  swarm: "Swarm",
  history: "Work History",
  wallet: "Wallets",
  vault: "Brain",
  integrations: "Integrations",
  maintenance: "Diagnostics",
  sessions: "Sessions",
  tools: "Tools",
  memory: "Memory",
  files: "Files",
  notifications: "Alerts",
  messaging: "Messaging",
  chat: "Agent Chat",
  more: "More",
  env: "Env",
  "my-apps": "Apps & Services",
  phone: "Phone",
  aeon: "Aeon",
  fusion: "Hive Fusion",
};

type DashboardNativeFrameProps = {
  initialChatAgentId?: string;
  initialChatLeaf?: string;
  initialView?: DashboardView;
  initialVaultPanelMode?: DashboardVaultPanelMode;
  initialWorkHistory?: WorkHistoryPayload;
};

export default function DashboardNativeFrame(props: DashboardNativeFrameProps) {
  return (
    <>
      <DashboardApp {...props} />
      <NativeFirstRunOnboarding />
    </>
  );
}

function DashboardFrameLoading() {
  const routeLabel = dashboardFrameRouteLabel();
  const routeTitle = routeLabel === "dashboard view" ? "Loading dashboard view" : `Loading ${routeLabel}`;
  const routeDetail = routeLabel === "dashboard view" ? "Opening the selected control surface" : `Opening ${routeLabel}`;

  return (
    <main
      data-hivemindos-route-loading="true"
      aria-busy="true"
      aria-live="polite"
      style={{
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        padding: 24,
        background: "#080a0f",
        color: "#f4f7fb",
        fontFamily: "Geist, system-ui, sans-serif",
      }}
    >
      <DashboardHiveLoader compact title={routeTitle} detail={routeDetail} />
    </main>
  );
}

function dashboardFrameRouteLabel() {
  if (typeof window === "undefined") return "dashboard view";
  const rawView = new URLSearchParams(window.location.search).get("view") ?? "";
  return DASHBOARD_FRAME_ROUTE_LABELS[rawView] ?? "dashboard view";
}
