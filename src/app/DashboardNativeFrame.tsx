"use client";

import DashboardApp, { type DashboardVaultPanelMode } from "@/features/dashboard/DashboardApp";
import { NativeFirstRunOnboarding } from "@/features/native/NativeFirstRunOnboarding";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import type { WorkHistoryPayload } from "@/lib/types/work-history";

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
