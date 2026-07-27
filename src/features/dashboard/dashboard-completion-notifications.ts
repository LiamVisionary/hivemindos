import type { FleetActiveApp } from "@/components/fleet/fleet-data";
import type { DashboardRouteTarget } from "@/features/dashboard/dashboard-navigation";
import type { LongRunningProcess } from "@/lib/types/long-running-processes";

export type DashboardCompletionNotification = {
  id: string;
  app?: FleetActiveApp;
  initials?: string;
  message: string;
  title?: string;
  destination?: DashboardRouteTarget;
  agentVoiceSettingsId?: string;
};

export type CompletionNotificationInteraction =
  | { kind: "copy"; text: string }
  | { kind: "navigate"; destination: DashboardRouteTarget }
  | { kind: "agent-voice-settings"; agentId: string };

export function completionNotificationInteraction(
  notification: DashboardCompletionNotification,
): CompletionNotificationInteraction {
  if (notification.agentVoiceSettingsId) {
    return { kind: "agent-voice-settings", agentId: notification.agentVoiceSettingsId };
  }
  if (notification.destination) {
    return { kind: "navigate", destination: { ...notification.destination } };
  }
  return { kind: "copy", text: notification.message };
}

export function processCompletionNotification(
  process: LongRunningProcess,
): DashboardCompletionNotification {
  const failed = process.status === "failed";
  return {
    id: `process-${process.id}-${process.revision}`,
    initials: failed ? "!" : "✓",
    title: process.title,
    message: failed
      ? `${process.title} failed: ${process.error || "Unknown error."}`
      : process.completionMessage || `${process.title} completed.`,
    destination: { ...process.destination },
  };
}
