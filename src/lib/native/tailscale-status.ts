type TailnetHealth = {
  state?: "ok" | "peer-traffic-stalled" | "status-unavailable" | "not-running";
  detail?: string;
};

type TailscaleStatusPayload = {
  ok?: boolean;
  backendState?: string;
  error?: string;
  tailnetHealth?: TailnetHealth;
};

export type TailscaleStatusPresentation = {
  label: string;
  detail: string;
  requiresAttention: boolean;
};

export function tailscaleStatusPresentation(
  data: TailscaleStatusPayload | null | undefined,
): TailscaleStatusPresentation {
  if (data?.tailnetHealth?.state === "status-unavailable") {
    return {
      label: "Tailscale needs attention",
      detail:
        "Tailscale did not respond. HivemindOS is continuing locally; restart or reconnect Tailscale to restore Fleet, sync, and phone access.",
      requiresAttention: true,
    };
  }
  if (data?.tailnetHealth?.state === "not-running") {
    return {
      label: "Tailscale needs attention",
      detail: `Tailscale is ${data.backendState || "not running"}. HivemindOS is continuing locally; reconnect Tailscale to restore Fleet, sync, and phone access.`,
      requiresAttention: true,
    };
  }
  if (data?.tailnetHealth?.state === "peer-traffic-stalled") {
    return {
      label: "Tailscale traffic stalled",
      detail:
        "Tailscale is connected but peer traffic is stalled. HivemindOS remains available locally while you reconnect Tailscale.",
      requiresAttention: true,
    };
  }
  if (data?.ok) {
    return {
      label: `Tailscale ${data.backendState || "Running"}`,
      detail: "",
      requiresAttention: false,
    };
  }
  return {
    label: "Tailscale not configured",
    detail: "HivemindOS is running locally.",
    requiresAttention: false,
  };
}
