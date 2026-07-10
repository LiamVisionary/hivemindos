import type { ConnectionProviderKey } from "@/lib/types/integrations";
import type { DashboardRouteTarget } from "@/features/dashboard/dashboard-navigation";

export type IntegrationModalActionId = "slack-channel-download";

export type IntegrationModalAction = {
  id: IntegrationModalActionId;
  label: string;
  description: string;
  icon: string;
};

export type IntegrationModalTarget = {
  providerKey: ConnectionProviderKey;
  tab: "connect" | "actions";
  actionId?: IntegrationModalActionId;
};

const CONNECTION_PROVIDER_KEYS = new Set<ConnectionProviderKey>([
  "github",
  "linear",
  "slack",
  "notion",
  "google",
  "google-cloud",
  "azure",
  "posthog",
  "plausible",
  "clawbank",
]);

const INTEGRATION_MODAL_ACTIONS: Partial<
  Record<ConnectionProviderKey, readonly IntegrationModalAction[]>
> = {
  slack: [
    {
      id: "slack-channel-download",
      label: "Download a channel",
      description: "Save message history, attachments, linked pages, and linked files from a Slack workspace.",
      icon: "sync",
    },
  ],
};

export function integrationModalActionsForProvider(
  providerKey: ConnectionProviderKey,
): readonly IntegrationModalAction[] {
  return INTEGRATION_MODAL_ACTIONS[providerKey] ?? [];
}

export function integrationModalTargetFromDashboardTarget(
  target: DashboardRouteTarget | null | undefined,
): IntegrationModalTarget | null {
  if (target?.view !== "integrations" || !target.integration || !CONNECTION_PROVIDER_KEYS.has(target.integration as ConnectionProviderKey)) {
    return null;
  }
  const providerKey = target.integration as ConnectionProviderKey;
  const tab = target.integrationTab === "actions" ? "actions" : "connect";
  const actionId = tab === "actions"
    ? integrationModalActionsForProvider(providerKey).find((action) => action.id === target.integrationAction)?.id
    : undefined;
  return {
    providerKey,
    tab,
    ...(actionId ? { actionId } : {}),
  };
}
