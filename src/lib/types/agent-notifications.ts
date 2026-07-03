export type AgentNotificationPriority = "low" | "normal" | "high" | "urgent";

export type AgentNotificationKind = "message" | "decision" | "task" | "alert" | "system";

export type AgentNotificationResolutionStatus = "in-progress" | "resolved";

/**
 * Lifecycle of the CONDITION a notification reported, stamped by whatever is
 * remediating it (escalation bridge, autonomy driver): "in-progress" while a
 * self-heal is actively retrying/re-dispatching, "resolved" once the condition
 * cleared. Absent = still active (or the producer doesn't track lifecycle).
 */
export type AgentNotificationResolution = {
  status: AgentNotificationResolutionStatus;
  note?: string;
  updatedAt: string;
  by?: string;
};

export type AgentNotification = {
  id: string;
  title: string;
  body: string;
  priority: AgentNotificationPriority;
  kind: AgentNotificationKind;
  agentName: string;
  agentId?: string;
  source?: string;
  createdAt: string;
  filePath: string;
  read: boolean;
  readAt?: string;
  tags: string[];
  resolution?: AgentNotificationResolution;
};

export type AgentNotificationSettings = {
  highPriorityMessagingEnabled: boolean;
  messagingHandledBy: string;
  updatedAt: string;
};

export type AgentNotificationSummary = {
  total: number;
  unread: number;
  highUnread: number;
  urgentUnread: number;
  folder: string;
  settings: AgentNotificationSettings;
};
