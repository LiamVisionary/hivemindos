"use client";

import {
  HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
  isFreeHivemindosWalletPaidModel,
} from "@/lib/config/hivemindos-wallet-paid-models";
import {
  agentContainerStateFromStatus,
  buildAgentColdStartProcessEvent,
  inferredModalColdStartProcessEvent,
  inferredRecentSuccessColdStartProcessEvent,
  recordAgentRuntimeWarm,
  type AgentColdStartProcessEvent,
} from "@/lib/services/chat/agent-cold-start";

type FreeModelContainerState = "cold" | "warm" | "unknown" | "unavailable";

function isFreeHivemindosModelAgent(agent: any) {
  const provider = String(agent?.provider ?? "").trim().toLowerCase();
  return provider === HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER
    && isFreeHivemindosWalletPaidModel(agent?.model);
}

export async function agentColdStartProcessEvent(agent: any): Promise<AgentColdStartProcessEvent | null> {
  if (isFreeHivemindosModelAgent(agent)) {
    const containerState = await freeHivemindosModelContainerState(agent);
    if (containerState === "warm") {
      recordAgentRuntimeWarm(agent);
      return null;
    }
    if (containerState === "cold") {
      return buildAgentColdStartProcessEvent(
        agent,
        "Hosted gateway reports the model container is not warm yet.",
      );
    }
    const detail = containerState === "unknown"
      ? "Free model status did not include container metadata and no recent warm completion is recorded in this app session."
      : "Free model status did not confirm a warm container and no recent warm completion is recorded in this app session.";
    return inferredRecentSuccessColdStartProcessEvent(agent, detail);
  }
  return inferredModalColdStartProcessEvent(agent);
}

export { recordAgentRuntimeWarm };

async function freeHivemindosModelContainerState(agent: any): Promise<FreeModelContainerState> {
  const abortController = new AbortController();
  const timeout = window.setTimeout(() => abortController.abort("agent-cold-status-timeout"), 2_500);
  try {
    const params = new URLSearchParams({ model: String(agent?.model ?? "") });
    const response = await fetch(`/api/hivemindos/models/chat/completions?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: abortController.signal,
    });
    if (!response.ok) return "unavailable";
    const payload = await response.json().catch(() => null);
    return agentContainerStateFromStatus(payload, response.headers);
  } catch {
    return "unavailable";
  } finally {
    window.clearTimeout(timeout);
  }
}
