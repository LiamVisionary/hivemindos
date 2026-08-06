import "server-only";

import type { XCommandIntent, XCommandTradeRequest } from "@/lib/types/x-command";

export const X_COMMAND_GATEWAY_BASE_URL = (
  process.env.HIVEMINDOS_X_COMMAND_GATEWAY_BASE_URL?.trim()
  || "https://hivemindos-x-command-gateway.hivemindos.workers.dev"
).replace(/\/+$/, "");

export type XCommandDeviceJob = {
  id: string;
  kind: "queen.read" | "trade.execute";
  intent: XCommandIntent;
  prompt?: string;
  tradeRequest?: XCommandTradeRequest;
  sourceTweetId: string;
  xUsername?: string;
  createdAt: string;
};

async function request(path: string, init: RequestInit, headers: Record<string, string>): Promise<Response> {
  return fetch(`${X_COMMAND_GATEWAY_BASE_URL}${path}`, {
    ...init,
    headers: { accept: "application/json", ...headers, ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
}

export function getXCommandHealth(): Promise<Response> {
  return request("/health", { method: "GET" }, {});
}

export function getXCommandAccount(creditToken: string): Promise<Response> {
  return request("/v1/account", { method: "GET" }, { "X-HivemindOS-Credit-Token": creditToken });
}

export function configureXCommandAccount(creditToken: string, body: Record<string, unknown>): Promise<Response> {
  return request("/v1/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, { "X-HivemindOS-Credit-Token": creditToken });
}

export function pairXCommandDevice(creditToken: string, name: string): Promise<Response> {
  return request("/v1/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }, { "X-HivemindOS-Credit-Token": creditToken });
}

export function revokeXCommandDevice(creditToken: string, deviceId: string): Promise<Response> {
  return request(`/v1/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" }, {
    "X-HivemindOS-Credit-Token": creditToken,
  });
}

export function pollXCommandDevice(deviceToken: string, capabilities: { tradeExecutionEnabled: boolean }): Promise<Response> {
  return request("/v1/device/poll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(capabilities),
  }, { "X-HivemindOS-X-Command-Device": deviceToken });
}

export function completeXCommandDeviceJob(deviceToken: string, jobId: string, body: { resultText?: string; error?: string }): Promise<Response> {
  return request(`/v1/device/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, { "X-HivemindOS-X-Command-Device": deviceToken });
}

export async function responseObject(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}
