import "server-only";

import type { NextRequest } from "next/server";
import { booleanEnv, optionalEnv } from "@/lib/config/env";

export const BEELINE_BROKER_BASE_URL_ENV = "HIVEMINDOS_BEELINE_BROKER_BASE_URL";
export const BEELINE_BROKER_PUBLIC_BASE_URL_ENV = "NEXT_PUBLIC_HIVEMINDOS_BEELINE_BROKER_BASE_URL";
export const BEELINE_BROKER_ALLOW_INSECURE_ENV = "HIVEMINDOS_BEELINE_BROKER_ALLOW_INSECURE";
export const DEFAULT_BEELINE_BROKER_BASE_URL = "https://hivemindos-beeline-broker.hivemindos.workers.dev";

const STATUS_TIMEOUT_MS = 8_000;
const ACTION_TIMEOUT_MS = 120_000;

type BaseResolution = { raw: string; url?: URL; error?: string };

export type BeelineBrokerStatus = {
  configured: boolean;
  mode: "official-hosted-client";
  baseUrlHost: string;
  upstreamReachable: boolean;
  upstreamStatus?: number;
  upstream?: unknown;
  googleConfigured: boolean;
  mcpConfigured: boolean;
  errors: string[];
};

export async function getBeelineBrokerStatus(): Promise<BeelineBrokerStatus> {
  const resolution = resolveBaseUrl();
  const base = statusBase(resolution);
  if (!resolution.url) return base;
  try {
    const response = await fetch(new URL("/health", resolution.url), {
      headers: { Accept: "application/json", "X-HivemindOS-Beeline-Client": "status" },
      cache: "no-store",
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    const upstream = await parseResponseBody(response);
    const capabilityStatus = recordField(upstream, "capabilityStatus");
    return {
      ...base,
      upstreamReachable: response.ok,
      upstreamStatus: response.status,
      upstream,
      googleConfigured: recordField(capabilityStatus, "googleCalendar")?.configured === true,
      mcpConfigured: recordField(capabilityStatus, "remoteMcp")?.configured === true,
    };
  } catch (error) {
    return { ...base, errors: [...base.errors, errorMessage(error, "Beeline broker is not reachable.")] };
  }
}

export function getBeelineBrokerConnections(creditToken: string, profileId: string, slug = "default") {
  return brokerRequest("GET", "/api/beeline/connections", creditToken, { slug, query: { profileId } });
}

export function startBeelineGoogleOAuth(input: {
  request: NextRequest;
  creditToken: string;
  profileId: string;
  slug?: string;
  returnUrl?: string;
}) {
  return brokerRequest("POST", "/api/beeline/google/oauth/start", input.creditToken, {
    slug: input.slug,
    body: {
      profileId: input.profileId,
      returnUrl: input.returnUrl || defaultReturnUrl(input.request, input.profileId),
    },
  });
}

export function createBeelineMcpConnection(input: {
  creditToken: string;
  profileId: string;
  label: string;
  capability: string;
  endpointUrl: string;
  bearerToken?: string;
  slug?: string;
}) {
  return brokerRequest("POST", "/api/beeline/mcp/connections", input.creditToken, {
    slug: input.slug,
    body: {
      profileId: input.profileId,
      label: input.label,
      capability: input.capability,
      endpointUrl: input.endpointUrl,
      bearerToken: input.bearerToken || "",
    },
  });
}

export function runBeelineCalendarAction(input: {
  request: NextRequest;
  creditToken: string;
  slug?: string;
  idempotencyKey?: string;
  body: Record<string, unknown>;
}) {
  return brokerRequest("POST", "/api/beeline/google/calendar/events", input.creditToken, {
    slug: input.slug,
    body: input.body,
    idempotencyKey: input.idempotencyKey || idempotencyKey(input.request),
  });
}

export function runBeelineMcpAction(input: {
  request: NextRequest;
  creditToken: string;
  slug?: string;
  idempotencyKey?: string;
  body: Record<string, unknown>;
}) {
  return brokerRequest("POST", "/api/beeline/mcp/invoke", input.creditToken, {
    slug: input.slug,
    body: input.body,
    idempotencyKey: input.idempotencyKey || idempotencyKey(input.request),
  });
}

export function revokeBeelineBrokerConnection(
  creditToken: string,
  profileId: string,
  connectionId: string,
  slug = "default",
) {
  return brokerRequest("DELETE", `/api/beeline/connections/${encodeURIComponent(connectionId)}`, creditToken, {
    slug,
    query: { profileId },
  });
}

function brokerRequest(
  method: "GET" | "POST" | "DELETE",
  path: string,
  creditToken: string,
  options: {
    slug?: string;
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    idempotencyKey?: string;
  } = {},
) {
  const resolution = resolveBaseUrl();
  if (!resolution.url) return notConfiguredResponse(resolution);
  const target = new URL(path, resolution.url);
  if (options.slug) target.searchParams.set("slug", options.slug);
  for (const [name, value] of Object.entries(options.query || {})) target.searchParams.set(name, value);
  const headers = new Headers({
    Accept: "application/json",
    "X-HivemindOS-Credit-Token": creditToken,
    "X-HivemindOS-Beeline-Client": "downloaded-app-proxy",
  });
  const body = method === "POST" ? JSON.stringify(options.body || {}) : undefined;
  if (body) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  return fetch(target, {
    method,
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
  }).then(forwardResponse, (error: unknown) => jsonResponse({
    ok: false,
    error: errorMessage(error, "Beeline broker request failed."),
  }, 502));
}

function resolveBaseUrl(): BaseResolution {
  const raw = (
    optionalEnv(BEELINE_BROKER_BASE_URL_ENV)
    || optionalEnv(BEELINE_BROKER_PUBLIC_BASE_URL_ENV)
    || DEFAULT_BEELINE_BROKER_BASE_URL
  ).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { raw, error: `${BEELINE_BROKER_BASE_URL_ENV} must be a valid absolute URL.` };
  }
  const allowInsecure = optionalEnv("NODE_ENV") !== "production"
    && booleanEnv(BEELINE_BROKER_ALLOW_INSECURE_ENV, false);
  if (!allowInsecure && url.protocol !== "https:") {
    return { raw, error: `${BEELINE_BROKER_BASE_URL_ENV} must use HTTPS.` };
  }
  if (!allowInsecure && isLocalOrPrivateHostname(url.hostname)) {
    return { raw, error: `${BEELINE_BROKER_BASE_URL_ENV} must point to public HivemindOS-controlled infrastructure.` };
  }
  return { raw, url };
}

function statusBase(resolution: BaseResolution): BeelineBrokerStatus {
  return {
    configured: Boolean(resolution.url),
    mode: "official-hosted-client",
    baseUrlHost: resolution.url?.host || "",
    upstreamReachable: false,
    googleConfigured: false,
    mcpConfigured: false,
    errors: resolution.error ? [resolution.error] : [],
  };
}

function notConfiguredResponse(resolution: BaseResolution): Response {
  return jsonResponse({
    ok: false,
    error: "Beeline broker is not configured.",
    errors: resolution.error ? [resolution.error] : [],
  }, 424);
}

function forwardResponse(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function defaultReturnUrl(request: NextRequest, profileId: string): string {
  const url = new URL("/", request.url);
  url.searchParams.set("view", "beeline");
  url.searchParams.set("beelineProfile", profileId);
  return url.toString();
}

function idempotencyKey(request: NextRequest): string {
  return request.headers.get("idempotency-key")?.trim()
    || request.headers.get("x-idempotency-key")?.trim()
    || "";
}

async function parseResponseBody(response: Response): Promise<unknown> {
  return response.headers.get("content-type")?.includes("application/json")
    ? response.json().catch(() => null)
    : response.text().catch(() => "");
}

function isLocalOrPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "::1", "0.0.0.0"].includes(host) || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) return true;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const match = host.match(/^172\.(\d{1,2})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return field && typeof field === "object" && !Array.isArray(field)
    ? field as Record<string, unknown>
    : undefined;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
