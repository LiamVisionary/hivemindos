import "server-only";

import type { NextRequest } from "next/server";

export const MANAGED_X_API_BASE_URL_ENV = "HIVEMINDOS_X_API_GATEWAY_BASE_URL";
export const MANAGED_X_API_PUBLIC_BASE_URL_ENV = "NEXT_PUBLIC_HIVEMINDOS_X_API_GATEWAY_BASE_URL";
export const MANAGED_X_API_ALLOW_INSECURE_ENV = "HIVEMINDOS_X_API_GATEWAY_ALLOW_INSECURE";
export const DEFAULT_MANAGED_X_API_BASE_URL = "https://hivemindos-x-api-gateway.hivemindos.workers.dev";

const STATUS_TIMEOUT_MS = 8_000;
const PROXY_TIMEOUT_MS = 120_000;

type ManagedXBaseResolution = {
  raw: string;
  url?: URL;
  error?: string;
};

export type ManagedXGatewayStatus = {
  configured: boolean;
  mode: "official-hosted-client";
  baseUrlSet: boolean;
  baseUrlHost: string;
  missing: string[];
  errors: string[];
  upstreamReachable: boolean;
  upstreamStatus?: number;
  upstream?: unknown;
};

export type ManagedXProxyInput = {
  connectionId?: string;
  method?: string;
  path?: string;
  query?: Record<string, unknown>;
  json?: unknown;
  confirmation?: string;
};

export async function getManagedXGatewayStatus(): Promise<ManagedXGatewayStatus> {
  const resolution = resolveManagedXBaseUrl();
  const baseStatus = managedXStatusBase(resolution);
  if (!resolution.url) return baseStatus;

  try {
    const response = await fetch(new URL("/health", resolution.url), {
      method: "GET",
      headers: { Accept: "application/json", "X-HivemindOS-Managed-X-Client": "status" },
      cache: "no-store",
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    return {
      ...baseStatus,
      upstreamReachable: response.ok,
      upstreamStatus: response.status,
      upstream: await parseResponseBody(response),
    };
  } catch (error) {
    return {
      ...baseStatus,
      upstreamReachable: false,
      errors: [...baseStatus.errors, errorMessage(error, "Managed X gateway is not reachable.")],
    };
  }
}

export async function getManagedXBalance(creditToken: string, slug?: string): Promise<Response> {
  return managedXRequest("GET", "/api/x/credits/balance", creditToken, { slug });
}

export async function getManagedXConnections(creditToken: string, slug?: string): Promise<Response> {
  return managedXRequest("GET", "/api/x/connections", creditToken, { slug });
}

export async function startManagedXOAuth(input: {
  request: NextRequest;
  creditToken: string;
  slug?: string;
  returnUrl?: string;
  scopes?: string;
}): Promise<Response> {
  return managedXRequest("POST", "/api/x/oauth/start", input.creditToken, {
    slug: input.slug,
    body: {
      returnUrl: input.returnUrl || defaultReturnUrl(input.request),
      scopes: input.scopes,
    },
  });
}

export async function proxyManagedXApiCall(input: {
  request: NextRequest;
  creditToken: string;
  slug?: string;
  body: ManagedXProxyInput;
}): Promise<Response> {
  return managedXRequest("POST", "/api/x/proxy", input.creditToken, {
    slug: input.slug,
    body: {
      connectionId: input.body.connectionId,
      method: input.body.method,
      path: input.body.path,
      query: input.body.query,
      json: input.body.json,
    },
    idempotencyKey: input.request.headers.get("idempotency-key") || input.request.headers.get("x-idempotency-key") || undefined,
  });
}

export async function proxyManagedXMcpRequest(input: {
  request: NextRequest;
  creditToken: string;
  slug?: string;
  connectionId?: string;
}): Promise<Response> {
  const resolution = resolveManagedXBaseUrl();
  if (!resolution.url) return notConfiguredResponse(resolution);
  const target = new URL("/api/x/mcp", resolution.url);
  if (input.slug) target.searchParams.set("slug", input.slug);
  const headers = new Headers({
    Accept: input.request.headers.get("accept") || "application/json, text/event-stream",
    "Content-Type": input.request.headers.get("content-type") || "application/json",
    "X-HivemindOS-Credit-Token": input.creditToken,
    "X-HivemindOS-Managed-X-Client": "downloaded-app-proxy",
  });
  if (input.connectionId) headers.set("X-HivemindOS-X-Connection-Id", input.connectionId);
  const idempotencyKey = input.request.headers.get("idempotency-key") || input.request.headers.get("x-idempotency-key");
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  try {
    const response = await fetch(target, {
      method: "POST",
      headers,
      body: await input.request.arrayBuffer(),
      cache: "no-store",
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    return forwardManagedXResponse(response);
  } catch (error) {
    return jsonResponse({ ok: false, error: errorMessage(error, "Managed X MCP request failed.") }, 502);
  }
}

function managedXRequest(
  method: "GET" | "POST",
  path: string,
  creditToken: string,
  options: { slug?: string; body?: Record<string, unknown>; idempotencyKey?: string } = {},
) {
  const resolution = resolveManagedXBaseUrl();
  if (!resolution.url) return notConfiguredResponse(resolution);
  const target = new URL(path, resolution.url);
  if (options.slug) target.searchParams.set("slug", options.slug);
  const headers = new Headers({
    Accept: "application/json",
    "X-HivemindOS-Credit-Token": creditToken,
    "X-HivemindOS-Managed-X-Client": "downloaded-app-proxy",
  });
  const body = method === "POST" ? JSON.stringify(options.body ?? {}) : undefined;
  if (body) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);

  return fetch(target, {
    method,
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
  }).then(forwardManagedXResponse, (error: unknown) => (
    jsonResponse({ ok: false, error: errorMessage(error, "Managed X gateway request failed.") }, 502)
  ));
}

function forwardManagedXResponse(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    headers: forwardedResponseHeaders(response.headers),
  });
}

function managedXStatusBase(resolution: ManagedXBaseResolution): ManagedXGatewayStatus {
  return {
    configured: Boolean(resolution.url),
    mode: "official-hosted-client",
    baseUrlSet: Boolean(resolution.raw),
    baseUrlHost: resolution.url?.host ?? "",
    missing: resolution.raw ? [] : [MANAGED_X_API_BASE_URL_ENV],
    errors: resolution.error ? [resolution.error] : [],
    upstreamReachable: false,
  };
}

function resolveManagedXBaseUrl(): ManagedXBaseResolution {
  const raw = (
    process.env[MANAGED_X_API_BASE_URL_ENV]
    || process.env[MANAGED_X_API_PUBLIC_BASE_URL_ENV]
    || DEFAULT_MANAGED_X_API_BASE_URL
    || ""
  ).trim().replace(/\/+$/, "");
  if (!raw) return { raw };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { raw, error: `${MANAGED_X_API_BASE_URL_ENV} must be a valid absolute URL.` };
  }

  const allowInsecure = process.env.NODE_ENV !== "production"
    && booleanEnv(MANAGED_X_API_ALLOW_INSECURE_ENV, false);
  if (!allowInsecure && url.protocol !== "https:") {
    return { raw, error: `${MANAGED_X_API_BASE_URL_ENV} must use https for managed X API traffic.` };
  }
  if (!allowInsecure && isLocalOrPrivateHostname(url.hostname)) {
    return { raw, error: `${MANAGED_X_API_BASE_URL_ENV} must point to public HivemindOS-controlled infrastructure, not localhost or a private network host.` };
  }
  return { raw, url };
}

function notConfiguredResponse(resolution: ManagedXBaseResolution): Response {
  return jsonResponse({
    ok: false,
    error: "Managed X API gateway is not configured.",
    mode: "official-hosted-client",
    missing: resolution.raw ? [] : [MANAGED_X_API_BASE_URL_ENV],
    errors: resolution.error ? [resolution.error] : [],
  }, 424);
}

function forwardedResponseHeaders(source: Headers) {
  const headers = new Headers();
  for (const [name, value] of source.entries()) {
    const lower = name.toLowerCase();
    if (
      lower === "content-type"
      || lower === "cache-control"
      || lower.startsWith("x-hivemindos-x-")
      || lower === "x-hivemindos-credit-balance-usd"
    ) {
      headers.set(name, value);
    }
  }
  headers.set("Cache-Control", headers.get("Cache-Control") || "no-store");
  return headers;
}

function defaultReturnUrl(request: NextRequest) {
  const url = new URL("/", request.url);
  url.searchParams.set("view", "integrations");
  url.searchParams.set("tab", "mcp");
  return url.toString();
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json().catch(() => null);
  return response.text().catch(() => "");
}

function isLocalOrPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  if (host === "0.0.0.0" || host.startsWith("127.") || host.startsWith("169.254.")) return true;
  if (host.startsWith("10.") || host.startsWith("192.168.")) return true;
  const match = host.match(/^172\.(\d{1,2})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function booleanEnv(key: string, fallback: boolean) {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
