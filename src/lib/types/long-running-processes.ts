import type { DashboardRouteTarget } from "@/features/dashboard/dashboard-navigation";

export type LongRunningProcessStatus = "running" | "succeeded" | "failed";

export type LongRunningProcessProgress = {
  stage: string;
  label: string;
  completed?: number;
  total?: number;
  detail?: string;
};

export type LongRunningProcess = {
  id: string;
  kind: string;
  title: string;
  status: LongRunningProcessStatus;
  progress: LongRunningProcessProgress | null;
  completionMessage: string | null;
  error: string | null;
  destination: DashboardRouteTarget;
  revision: number;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type LongRunningProcessSnapshot = {
  revision: number;
  processes: LongRunningProcess[];
};
