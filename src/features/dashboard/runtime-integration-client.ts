import type { RuntimeIntegrationStatus } from "@/features/dashboard/dashboard-types";
import type { AgentProfile } from "@/lib/types/agent-runtime";

export type RuntimeIntegrationActionResult = {
  ok?: boolean;
  message?: string;
  error?: string;
  logPath?: string;
  output?: string;
};

export async function requestRuntimeIntegrationStatus(agent: AgentProfile) {
  const response = await fetch(`/api/runtimes/${agent.runtime}/integrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent }),
  }).catch(() => null);
  const data = await response?.json().catch(() => null) as {
    ok?: boolean;
    status?: RuntimeIntegrationStatus;
    error?: string;
  } | null;
  if (!response?.ok || !data?.ok || !data.status) {
    throw new Error(data?.error ?? "Could not read runtime integrations.");
  }
  return data.status;
}

export async function requestRuntimeIntegrationAction(
  agent: AgentProfile,
  action: string,
  input: Record<string, unknown> = {},
): Promise<RuntimeIntegrationActionResult> {
  const response = await fetch(`/api/runtimes/${agent.runtime}/integrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, action, input }),
  }).catch(() => null);
  const data = await response?.json().catch(() => null) as RuntimeIntegrationActionResult | null;
  if (!response?.ok || !data?.ok) {
    throw new Error(data?.error ?? "Runtime action failed.");
  }
  return data;
}
