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
// Free-tier model calls go to the same HivemindOS-controlled gateway, which
// owns the daily allowance (per device + per IP + global). The override env is
// for self-hosters and local testing only — the official free tier must stay
// behind hosted enforcement, never a direct model origin in shipped config.
export const FREE_MODELS_BASE_URL_ENV = "HIVEMINDOS_FREE_MODELS_BASE_URL";

const DEFAULT_SLUG = "default";
const STATUS_TIMEOUT_MS = 8_000;
const PROXY_TIMEOUT_MS = 600_000;
const MODEL_LIST_TIMEOUT_MS = 5_000;

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
  "x-hivemindos-credit-token",
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
  "x-hivemindos-credit-top-up-usd",
  "x-hivemindos-credit-debited-usd",
  "x-hivemindos-credit-balance-usd",
]);

type OfficialBaseResolution = {
  raw: string;
  url?: URL;
  error?: string;
};

export type OfficialPaidAgentCheckoutReturnStatus = "success" | "cancel";

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
  return proxyOfficialPaidAgentRequestPath(request, slug, ["chat", "completions"], "POST");
}

export async function proxyOfficialPaidAgentCreditTopUpRequest(request: NextRequest, slug: string): Promise<Response> {
  return proxyOfficialPaidAgentRequestPath(request, slug, ["credits", "top-up"], "POST");
}

export async function proxyOfficialPaidAgentCreditCheckoutRequest(request: NextRequest, slug: string): Promise<Response> {
  return proxyOfficialPaidAgentRequestPath(request, slug, ["credits", "checkout"], "POST");
}

export async function proxyOfficialPaidAgentCreditBalanceRequest(request: NextRequest, slug: string): Promise<Response> {
  return proxyOfficialPaidAgentRequestPath(request, slug, ["credits", "balance"], "GET");
}

export type OfficialGatewayModel = {
  id: string;
  displayName?: string;
  /** Unix seconds the model was published upstream (for "New" sorting). */
  created?: number;
  /** Retail USD per token (markup already applied by the gateway). */
  promptUsdPerToken?: number;
  completionUsdPerToken?: number;
};

// Dynamic model inventory from the hosted gateway (OpenAI-style
// GET <base>/api/paid-agents/<slug>/models). Older gateway deploys may not
// expose it yet; callers must treat an empty list as "static options only".
export async function fetchOfficialPaidAgentModelList(slug?: string): Promise<OfficialGatewayModel[]> {
  const resolution = resolveOfficialPaidAgentBaseUrl();
  if (!resolution.url) return [];
  const target = officialPaidAgentTargetUrl(resolution.url, slug, ["models"]);
  try {
    const response = await fetch(target, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-HivemindOS-Official-Paid-Agent-Client": "models",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const payload = await response.json().catch(() => null) as { data?: unknown; models?: unknown } | null;
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
    return rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const record = row as Record<string, unknown>;
      const id = String(record.id || record.model || "").trim();
      if (!id) return [];
      const displayName = String(record.display_name || record.name || "").trim();
      const created = Number(record.created);
      const pricing = record.pricing && typeof record.pricing === "object" ? record.pricing as Record<string, unknown> : null;
      const promptUsdPerToken = pricing ? Number(pricing.prompt) : NaN;
      const completionUsdPerToken = pricing ? Number(pricing.completion) : NaN;
      return [{
        id,
        displayName: displayName || undefined,
        created: Number.isFinite(created) && created > 0 ? Math.floor(created) : undefined,
        promptUsdPerToken: Number.isFinite(promptUsdPerToken) && promptUsdPerToken >= 0 ? promptUsdPerToken : undefined,
        completionUsdPerToken: Number.isFinite(completionUsdPerToken) && completionUsdPerToken >= 0 ? completionUsdPerToken : undefined,
      }];
    });
  } catch {
    return [];
  }
}

// Where a free-tier chat completion goes. Default is the hosted gateway's
// free-models surface (which enforces the daily allowance); the env override
// exists for self-hosters and local testing of the free rail.
export function freeModelChatCompletionsUrl(upstreamModel: string): string {
  const override = (process.env[FREE_MODELS_BASE_URL_ENV] || "").trim().replace(/\/+$/, "");
  if (override) return `${override}/chat/completions`;
  const resolution = resolveOfficialPaidAgentBaseUrl();
  if (!resolution.url) return "";
  const target = new URL(resolution.url);
  target.pathname = joinUrlPath(target.pathname, "api", "free-models", upstreamModel, "chat", "completions");
  target.search = "";
  target.hash = "";
  return target.toString();
}

export function managedUsePodOpenAiBaseUrl(): string {
  const resolution = resolveOfficialPaidAgentBaseUrl();
  if (!resolution.url) return "";
  const target = new URL(resolution.url);
  target.pathname = joinUrlPath(target.pathname, "api", "usepod", "managed", "v1");
  target.search = "";
  target.hash = "";
  return target.toString().replace(/\/+$/, "");
}

export function managedNansenBaseUrl(): string {
  const resolution = resolveOfficialPaidAgentBaseUrl();
  if (!resolution.url) return "";
  const target = new URL(resolution.url);
  target.pathname = joinUrlPath(target.pathname, "api", "nansen", "managed");
  target.search = "";
  target.hash = "";
  return target.toString().replace(/\/+$/, "");
}

export function managedMediaBaseUrl(): string {
  const resolution = resolveOfficialPaidAgentBaseUrl();
  if (!resolution.url) return "";
  const target = new URL(resolution.url);
  target.pathname = joinUrlPath(target.pathname, "api", "media", "managed");
  target.search = "";
  target.hash = "";
  return target.toString().replace(/\/+$/, "");
}

export function officialPaidAgentCheckoutReturnUrl(status: OfficialPaidAgentCheckoutReturnStatus, slug?: string): string {
  const resolution = resolveOfficialPaidAgentBaseUrl();
  const target = new URL(resolution.url ?? DEFAULT_OFFICIAL_PAID_AGENT_BASE_URL);
  target.pathname = joinUrlPath(target.pathname, "models", "credits", "return");
  target.search = "";
  target.hash = "";
  target.searchParams.set("status", status);
  target.searchParams.set("source", "stripe");
  target.searchParams.set("slug", normalizeSlug(slug || DEFAULT_SLUG));
  return target.toString();
}

async function proxyOfficialPaidAgentRequestPath(
  request: NextRequest,
  slug: string,
  pathSegments: string[],
  method: "GET" | "POST",
): Promise<Response> {
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

  const target = officialPaidAgentTargetUrl(resolution.url, slug, pathSegments);
  try {
    const response = await fetch(target, {
      method,
      headers: forwardedRequestHeaders(request.headers),
      body: method === "GET" ? undefined : await request.arrayBuffer(),
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

function officialPaidAgentTargetUrl(baseUrl: URL, slug: string | undefined, pathSegments: string[] = ["chat", "completions"]) {
  const target = new URL(baseUrl);
  target.pathname = joinUrlPath(target.pathname, "api", "paid-agents", normalizeSlug(slug || DEFAULT_SLUG), ...pathSegments);
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
