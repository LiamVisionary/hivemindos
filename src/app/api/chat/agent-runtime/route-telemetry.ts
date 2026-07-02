import { NextRequest } from "next/server";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { recordTelemetryBatch } from "@/lib/services/telemetry/local-telemetry";

export type RuntimeRouteTelemetry = {
  request: NextRequest;
  routeStartedAt: number;
  runtimeSessionId?: string;
  chatStorageKey?: string;
};

export function telemetryPayloadForProfile(profile?: AgentProfile) {
  if (!profile) return {};
  return {
    agentId: profile.id,
    agentName: profile.name,
    runtime: profile.runtime,
    runtimeKind: profile.runtimeKind ?? null,
    hasGatewayUrl: Boolean(profile.gatewayUrl?.trim()),
    hasTelemetryUrl: Boolean(profile.telemetryUrl?.trim()),
    hasToken: Boolean(profile.token?.trim()),
    machineName: profile.machineName ?? null,
  };
}

export async function recordRouteTelemetry(request: NextRequest, type: string, payload: Record<string, unknown> = {}) {
  const runId = typeof payload.runtimeSessionId === "string" && payload.runtimeSessionId
    ? payload.runtimeSessionId
    : request.headers.get("x-hivemind-run-id");
  const threadId = typeof payload.chatStorageKey === "string" && payload.chatStorageKey
    ? payload.chatStorageKey
    : request.headers.get("x-hivemind-chat-storage-key");
  await recordTelemetryBatch([{
    source: "route",
    type,
    threadId,
    runId,
    payload,
  }]).catch(() => undefined);
}

export function recordRuntimeTelemetry(telemetry: RuntimeRouteTelemetry | undefined, type: string, payload: Record<string, unknown> = {}) {
  if (!telemetry) return;
  void recordRouteTelemetry(telemetry.request, type, {
    runtimeSessionId: telemetry.runtimeSessionId ?? null,
    chatStorageKey: telemetry.chatStorageKey ?? null,
    ...payload,
    elapsedMs: Date.now() - telemetry.routeStartedAt,
  });
}
