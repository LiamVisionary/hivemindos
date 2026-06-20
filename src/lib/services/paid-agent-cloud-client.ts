import "server-only";

import type { NextRequest } from "next/server";

import {
  PAID_AGENT_MODEL_PROVIDER_MATRIX,
  PAID_AGENT_RUNTIME_MATRIX,
} from "@/lib/services/paid-agent-gateway";

export const OFFICIAL_PAID_AGENT_BASE_URL_ENV = "HIVEMINDOS_OFFICIAL_PAID_AGENT_BASE_URL";
export const OFFICIAL_PAID_AGENT_PUBLIC_BASE_URL_ENV = "NEXT_PUBLIC_HIVEMINDOS_OFFICIAL_PAID_AGENT_BASE_URL";
export const OFFICIAL_PAID_AGENT_ALLOW_INSECURE_ENV = "HIVEMINDOS_OFFICIAL_PAID_AGENT_ALLOW_INSECURE";
export const DEFAULT_OFFICIAL_PAID_AGENT_BASE_URL = "https://hivemindos-paid-agent-gateway.hivemindos.workers.dev";

const DEFAULT_SLUG = "default";
const STATUS_TIMEOUT_MS = 8_000;
const PROXY_TIMEOUT_MS = 600_000;

const REQUEST_HEADER_ALLOWLIST = new Set([
  "accept",
  "content-type",
  "user-agent",
  "x-payment",
  "payment",
  "payment-signature",
  "x-payment-signature",
  "x402-version",
  "idempotency-key",
  "x-idempotency-key",
]);

const RESPONSE_HEADER_ALLOWLIST = new Set([
  "content-type",
  "cache-control",
  "payment-required",
  "payment-response",
  "x-payment-required",
  "x-payment-response",
  "www-authenticate",
  "x402-version",
]);

type OfficialBaseResolution = {
  raw: string;
  url?: URL;
  error?: string;
};

type OfficialPaidAgentStatus = {
  configured: boolean;
  mode: "official-hosted-client";
  baseUrlSet: boolean;
  baseUrlHost: string;
  missing: string[];
  errors: string[];
  upstreamReachable: boolean;
  upstreamStatus?: number;
  upstream?: unknown;
  runtimeMatrix: typeof PAID_AGENT_RUNTIME_MATRIX;
  modelProviderMatrix: typeof PAID_AGENT_MODEL_PROVIDER_MATRIX;
};

export async function getOfficialPaidAgentStatus(slug?: string): Promise<OfficialPaidAgentStatus> {
  const resolution = resolveOfficialPaidAgentBaseUrl();
  const baseStatus = officialStatusBase(resolution);
  if (!resolution.url) return baseStatus;

  const target = officialPaidAgentTargetUrl(resolution.url, slug);
  try {
    const response = await fetch(target, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-HivemindOS-Official-Paid-Agent-Client": "status",
      },
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
      errors: [...baseStatus.errors, errorMessage(error, "Official paid-agent endpoint is not reachable.")],
    };
  }
}

export async function proxyOfficialPaidAgentRequest(request: NextRequest, slug: string): Promise<Response> {
  const resolution = resolveOfficialPaidAgentBaseUrl();
  if (!resolution.url) {
    return jsonResponse({
      ok: false,
      error: "Official paid-agent endpoint is not configured.",
      mode: "official-hosted-client",
      missing: resolution.raw ? [] : [OFFICIAL_PAID_AGENT_BASE_URL_ENV],
      errors: resolution.error ? [resolution.error] : [],
      reason: "Downloaded apps must call a hosted HivemindOS paid-agent resource server for official monetization. Self-hosted sellers should use /api/paid-agents/<slug>/chat/completions instead.",
    }, 424);
  }

  const target = officialPaidAgentTargetUrl(resolution.url, slug);
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: forwardedRequestHeaders(request.headers),
      body: await request.arrayBuffer(),
      cache: "no-store",
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    return new Response(response.body, {
      status: response.status,
      headers: forwardedResponseHeaders(response.headers),
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: errorMessage(error, "Official paid-agent request failed."),
      mode: "official-hosted-client",
      baseUrlHost: resolution.url.host,
    }, 502);
  }
}

function officialStatusBase(resolution: OfficialBaseResolution): OfficialPaidAgentStatus {
  return {
    configured: Boolean(resolution.url),
    mode: "official-hosted-client",
    baseUrlSet: Boolean(resolution.raw),
    baseUrlHost: resolution.url?.host ?? "",
    missing: resolution.raw ? [] : [OFFICIAL_PAID_AGENT_BASE_URL_ENV],
    errors: resolution.error ? [resolution.error] : [],
    upstreamReachable: false,
    runtimeMatrix: PAID_AGENT_RUNTIME_MATRIX,
    modelProviderMatrix: PAID_AGENT_MODEL_PROVIDER_MATRIX,
  };
}

function resolveOfficialPaidAgentBaseUrl(): OfficialBaseResolution {
  const raw = (
    process.env[OFFICIAL_PAID_AGENT_BASE_URL_ENV]
    || process.env[OFFICIAL_PAID_AGENT_PUBLIC_BASE_URL_ENV]
    || DEFAULT_OFFICIAL_PAID_AGENT_BASE_URL
    || ""
  ).trim().replace(/\/+$/, "");
  if (!raw) return { raw };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { raw, error: `${OFFICIAL_PAID_AGENT_BASE_URL_ENV} must be a valid absolute URL.` };
  }

  const allowInsecure = process.env.NODE_ENV !== "production"
    && booleanEnv(OFFICIAL_PAID_AGENT_ALLOW_INSECURE_ENV, false);
  if (!allowInsecure && url.protocol !== "https:") {
    return { raw, error: `${OFFICIAL_PAID_AGENT_BASE_URL_ENV} must use https for official paid-agent traffic.` };
  }
  if (!allowInsecure && isLocalOrPrivateHostname(url.hostname)) {
    return { raw, error: `${OFFICIAL_PAID_AGENT_BASE_URL_ENV} must point to public HivemindOS-controlled infrastructure, not localhost or a private network host.` };
  }
  return { raw, url };
}

function officialPaidAgentTargetUrl(baseUrl: URL, slug: string | undefined) {
  const target = new URL(baseUrl);
  target.pathname = joinUrlPath(target.pathname, "api", "paid-agents", normalizeSlug(slug || DEFAULT_SLUG), "chat", "completions");
  target.search = "";
  target.hash = "";
  return target;
}

function forwardedRequestHeaders(source: Headers) {
  const headers = new Headers();
  for (const [name, value] of source.entries()) {
    const lower = name.toLowerCase();
    if (REQUEST_HEADER_ALLOWLIST.has(lower) || lower.startsWith("x-payment-") || lower.startsWith("x402-")) {
      headers.set(name, value);
    }
  }
  headers.set("X-HivemindOS-Official-Paid-Agent-Client", "downloaded-app-proxy");
  return headers;
}

function forwardedResponseHeaders(source: Headers) {
  const headers = new Headers();
  for (const [name, value] of source.entries()) {
    const lower = name.toLowerCase();
    if (
      RESPONSE_HEADER_ALLOWLIST.has(lower)
      || lower.startsWith("x-payment-")
      || lower.startsWith("payment-")
      || lower.startsWith("x402-")
      || lower.startsWith("x-hivemindos-paid-agent")
    ) {
      headers.set(name, value);
    }
  }
  headers.set("Cache-Control", headers.get("Cache-Control") || "no-store");
  return headers;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json().catch(() => null);
  return response.text().catch(() => "");
}

function joinUrlPath(...parts: string[]) {
  return `/${parts.flatMap((part) => part.split("/")).map((part) => part.trim()).filter(Boolean).join("/")}`;
}

function normalizeSlug(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || DEFAULT_SLUG;
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
