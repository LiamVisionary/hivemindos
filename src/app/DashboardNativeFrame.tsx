"use client";

import dynamic from "next/dynamic";
import DashboardApp, { type DashboardVaultPanelMode } from "@/features/dashboard/DashboardApp";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import type { WorkHistoryPayload } from "@/lib/types/work-history";

const NativeFirstRunOnboarding = dynamic(
  () => import("@/features/native/NativeFirstRunOnboarding").then((mod) => mod.NativeFirstRunOnboarding),
  { ssr: false },
);

type DashboardNativeFrameProps = {
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
