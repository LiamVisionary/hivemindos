import {
  HIVEMIND_OS_RUNTIME,
  type AgentProfile,
} from "@/lib/types/agent-runtime";

// SHARED CONTRACT — the HivemindOS Mobile app polls the hub against exactly
// these shapes (see /api/phone `agent-host-*` actions). Do not rename fields.
export const MOBILE_AGENT_GATEWAY_PREFIX = "mobile://";
export const DEFAULT_MOBILE_AGENT_MODEL =
  "mlx-community/gemma-3n-E4B-it-lm-4bit";
/** A phone host counts as online when it polled within this window. */
export const MOBILE_AGENT_HOST_FRESH_MS = 30_000;

export type MobileAgentRecord = {
  id: string;
  machineKey: string;
  machineName: string;
  name: string;
  model: string;
  provider: "on-device";
  systemPrompt?: string;
  createdAt: number;
  updatedAt: number;
};

export type MobileAgentHostModel = { id: string; sizeBytes?: number };

export type MobileAgentHostRecord = {
  machineName: string;
  models: MobileAgentHostModel[];
  lastPollAt: number;
};

export type MobileAgentJobStatus = "queued" | "claimed" | "done" | "error";

export type MobileAgentJobMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type MobileAgentJob = {
  id: string;
  agentId: string;
  machineKey: string;
  sessionId: string;
  prompt: string;
  messages: MobileAgentJobMessage[];
  status: MobileAgentJobStatus;
  createdAt: number;
  claimedAt?: number;
  updatedAt: number;
  finishedAt?: number;
  resultText?: string;
  errorReason?: string;
};

/**
 * Normalized phone identity: short name (domain stripped at the first "."),
 * lowercased, runs of non-alphanumerics collapsed to "-", trimmed.
 */
export function mobileAgentMachineKey(value?: string) {
  const shortName = (value ?? "").split(".")[0] ?? "";
  return shortName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isMobileAgentGatewayUrl(value?: string) {
  return (
    typeof value === "string" && value.startsWith(MOBILE_AGENT_GATEWAY_PREFIX)
  );
}

export function machineKeyFromMobileGatewayUrl(value?: string) {
  if (!value || !isMobileAgentGatewayUrl(value)) return "";
  return mobileAgentMachineKey(
    value.slice(MOBILE_AGENT_GATEWAY_PREFIX.length).replace(/\/+$/, ""),
  );
}

/**
 * Hub-stored mobile agents reuse the open-string `hivemind-os` runtime (chat
 * capable, no validation enums to extend); the `mobile://` gateway URL is the
 * discriminator everywhere a mobile-specific path is needed.
 */
export function mobileAgentProfileFromRecord(
  record: MobileAgentRecord,
  overrides?: { machineName?: string; telemetryUrl?: string },
): AgentProfile {
  return {
    id: record.id,
    name: record.name,
    runtime: HIVEMIND_OS_RUNTIME,
    gatewayUrl: `${MOBILE_AGENT_GATEWAY_PREFIX}${record.machineKey}`,
    provider: record.provider,
    model: record.model,
    machineName: overrides?.machineName ?? record.machineName,
    telemetryUrl: overrides?.telemetryUrl,
    beeRole: "worker",
    workerClass: "general",
  };
}
