import { HIVEMINDOS_FREE_MODEL_ID } from "@/lib/config/hivemindos-wallet-paid-models";
import type { AgentProfile } from "@/lib/types/agent-runtime";

export const AGENT_COLD_START_EVENT_LABEL = "Agent cold start";
export const AGENT_COLD_START_EVENT_TYPE = "chat.cold_start";
export const DEFAULT_COLD_START_WARM_WINDOW_SECONDS = 60;

export type AgentColdStartProcessEvent = {
  label: string;
  detail: string;
  status: "running";
  type?: string;
};

type AgentColdStartLike = Partial<Pick<
  AgentProfile,
  "agentEnv" | "chatPath" | "gatewayUrl" | "id" | "model" | "name" | "provider" | "runtime" | "statusPath"
>>;

type HeaderGetter = {
  get(name: string): string | null;
};

const runtimeWarmSuccessByKey = new Map<string, number>();

export function agentWakeStatusText(agent?: AgentColdStartLike | null) {
  return `waking up ${agentColdStartDisplayName(agent)}`;
}

export function buildAgentColdStartProcessEvent(
  agent?: AgentColdStartLike | null,
  detail?: string,
): AgentColdStartProcessEvent {
  return {
    type: AGENT_COLD_START_EVENT_TYPE,
    label: AGENT_COLD_START_EVENT_LABEL,
    detail: detail || `${agentColdStartDisplayName(agent)} is starting from a cold container.`,
    status: "running",
  };
}

export function isAgentColdStartProcessEvent(event: { label?: unknown; type?: unknown } = {}) {
  const type = clean(event.type).toLowerCase();
  if (type === AGENT_COLD_START_EVENT_TYPE) return true;
  const label = clean(event.label).toLowerCase();
  return label === AGENT_COLD_START_EVENT_LABEL.toLowerCase()
    || label === "swarm scout cold start"
    || /\bcold start\b/.test(label);
}

export function agentContainerStateFromStatus(payload: any, headers: HeaderGetter) {
  const modalContainer = payload?.model?.modalContainer ?? payload?.modalContainer;
  const headerState = clean(headers.get("x-hivemindos-free-model-container-state")).toLowerCase();
  const bodyState = clean(modalContainer?.state).toLowerCase();
  const bodyWarm = typeof modalContainer?.warm === "boolean" ? modalContainer.warm : undefined;
  if (bodyWarm === false || bodyState === "cold" || headerState === "cold") return "cold";
  if (bodyWarm === true || bodyState === "warm" || headerState === "warm") return "warm";
  return "unknown";
}

export function inferredModalColdStartProcessEvent(
  agent?: AgentColdStartLike | null,
  now = Date.now(),
): AgentColdStartProcessEvent | null {
  if (!isLikelyModalHostedAgent(agent)) return null;
  return inferredRecentSuccessColdStartProcessEvent(
    agent,
    "Modal-hosted agent has no recent warm completion in this app session.",
    now,
  );
}

export function inferredRecentSuccessColdStartProcessEvent(
  agent?: AgentColdStartLike | null,
  detail?: string,
  now = Date.now(),
): AgentColdStartProcessEvent | null {
  const key = agentColdStartCacheKey(agent);
  if (!key) return null;
  const warmWindowMs = coldStartWarmWindowSeconds(agent) * 1000;
  const lastSuccessAt = runtimeWarmSuccessByKey.get(key) ?? 0;
  if (lastSuccessAt && now - lastSuccessAt <= warmWindowMs) return null;
  return buildAgentColdStartProcessEvent(
    agent,
    detail || "No recent warm completion is recorded in this app session.",
  );
}

export function recordAgentRuntimeWarm(agent?: AgentColdStartLike | null, at = Date.now()) {
  const key = agentColdStartCacheKey(agent);
  if (key) runtimeWarmSuccessByKey.set(key, at);
}

export function isLikelyModalHostedAgent(agent?: AgentColdStartLike | null) {
  const urls = [agent?.gatewayUrl, agent?.chatPath, agent?.statusPath].map(clean).filter(Boolean);
  if (urls.some((url) => /(?:^|[./-])modal\.run(?:[/:]|$)/i.test(url) || /\.modal\.run(?:[/:]|$)/i.test(url))) return true;
  const providerRuntime = [agent?.provider, agent?.runtime].map(clean).join(" ").toLowerCase();
  if (/\bmodal\b/.test(providerRuntime)) return true;
  const envKeys = Object.keys(agent?.agentEnv ?? {}).join(" ").toLowerCase();
  return /\bmodal\b/.test(envKeys);
}

function agentColdStartDisplayName(agent?: AgentColdStartLike | null) {
  const name = clean(agent?.name);
  const model = clean(agent?.model);
  if (model === HIVEMINDOS_FREE_MODEL_ID || /swarm[\s_-]*(?:sovereign[\s_-]*)?scout/i.test(`${name} ${model}`)) {
    return "swarm scout";
  }
  return name || model.split("/").filter(Boolean).at(-1) || clean(agent?.runtime) || "agent";
}

function agentColdStartCacheKey(agent?: AgentColdStartLike | null) {
  const gatewayUrl = clean(agent?.gatewayUrl).replace(/\/+$/, "");
  const chatPath = clean(agent?.chatPath);
  if (gatewayUrl) return `${gatewayUrl}${chatPath ? `:${chatPath}` : ""}`;
  const providerModel = [agent?.provider, agent?.model].map(clean).filter(Boolean).join(":");
  if (providerModel) return providerModel;
  return clean(agent?.id);
}

function coldStartWarmWindowSeconds(agent?: AgentColdStartLike | null) {
  const env = agent?.agentEnv ?? {};
  const configured = [
    env.MODAL_WARM_WINDOW_SECONDS,
    env.SWARM_SCOUT_WARM_WINDOW_SECONDS,
    env.SWARM_SCOUT_SCALEDOWN_WINDOW_SECONDS,
  ].map((value) => Number(value)).find((value) => Number.isFinite(value) && value > 0);
  return configured ? Math.round(configured) : DEFAULT_COLD_START_WARM_WINDOW_SECONDS;
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}
