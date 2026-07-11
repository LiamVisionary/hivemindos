import "server-only";

import { optionalEnv } from "@/lib/config/env";
import { resolvePooledHivemindosModelCreditToken } from "@/lib/services/hivemindos-model-credit-vault";

export const DEFAULT_APP_HOSTING_BASE_URL = "https://hivemindos-app-hosting.hivemindos.workers.dev";
export const APP_HOSTING_BASE_URL_ENV = "HIVEMINDOS_APP_HOSTING_BASE_URL";

const CREDIT_SLUG = "default";
const REQUEST_TIMEOUT_MS = 600_000;

export type StaticHostingArtifact = {
  protocol: "hivemindos.static-artifact/v1";
  projectId: string;
  digest: string;
  fileCount: number;
  totalBytes: number;
  files: Array<{ path: string; size: number; sha256: string; contentBase64: string }>;
};

export type HostedAppSite = {
  id: string;
  slug: string;
  url: string;
  planId: string;
  runtime: "static" | "dynamic";
  status: "active" | "grace" | "unpublished" | "expired" | "error";
  expiresAt: string;
  autoRenew: boolean;
  currentReleaseId: string | null;
};

export type AppHostingPlan = {
  id: string;
  label: string;
  runtime: "static" | "dynamic";
  billing: "one-time" | "recurring-credit";
  priceUsd: number;
  durationSeconds: number;
  limits: { files: number; bytes: number; cpuMs?: number; subRequests?: number };
};

type GatewayResult<T> = { status: number; payload: T & { ok?: boolean; error?: string } };

function baseUrl() {
  return (optionalEnv(APP_HOSTING_BASE_URL_ENV) || DEFAULT_APP_HOSTING_BASE_URL).replace(/\/+$/, "");
}

async function creditToken(legacyAccountIds: string[] = []) {
  const token = await resolvePooledHivemindosModelCreditToken(CREDIT_SLUG, legacyAccountIds);
  if (!token) throw Object.assign(new Error("Add HivemindOS hosted credits before purchasing app hosting."), { status: 402 });
  return token;
}

async function callAppHosting<T extends Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<GatewayResult<T>> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (token) headers.set("x-hivemindos-credit-token", token);
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null) as T | null;
    return {
      status: response.status,
      payload: payload || ({ ok: false, error: `App-hosting gateway returned HTTP ${response.status} without JSON.` } as unknown as T),
    };
  } catch (error) {
    return {
      status: 502,
      payload: { ok: false, error: error instanceof Error ? error.message : "App-hosting gateway is unreachable." } as unknown as T,
    };
  }
}

function unwrap<T>(result: GatewayResult<Record<string, unknown>>, key: string): T {
  if (result.status >= 400 || result.payload.ok === false) {
    throw Object.assign(new Error(String(result.payload.error || `App hosting failed with HTTP ${result.status}.`)), { status: result.status });
  }
  return result.payload[key] as T;
}

export async function getAppHostingCatalog(): Promise<AppHostingPlan[]> {
  const result = await callAppHosting<{ plans?: AppHostingPlan[] }>("/v1/catalog");
  return unwrap<AppHostingPlan[]>(result, "plans") || [];
}

export async function listHostedApps(legacyAccountIds: string[] = []): Promise<HostedAppSite[]> {
  const result = await callAppHosting<{ sites?: HostedAppSite[] }>("/v1/sites", {}, await creditToken(legacyAccountIds));
  return unwrap<HostedAppSite[]>(result, "sites") || [];
}

export async function getHostedApp(siteId: string, legacyAccountIds: string[] = []): Promise<HostedAppSite> {
  const result = await callAppHosting<{ site?: HostedAppSite }>(`/v1/sites/${encodeURIComponent(siteId)}`, {}, await creditToken(legacyAccountIds));
  return unwrap<HostedAppSite>(result, "site");
}

export async function publishHostedApp(input: {
  artifact: StaticHostingArtifact | Record<string, unknown>;
  slug: string;
  planId: string;
  idempotencyKey: string;
  siteId?: string;
  autoRenew?: boolean;
  legacyAccountIds?: string[];
}): Promise<HostedAppSite> {
  const result = await callAppHosting<{ site?: HostedAppSite }>("/v1/sites/publish", {
    method: "POST",
    headers: { "idempotency-key": input.idempotencyKey },
    body: JSON.stringify({
      artifact: input.artifact,
      slug: input.slug,
      planId: input.planId,
      siteId: input.siteId,
      autoRenew: input.autoRenew === true,
    }),
  }, await creditToken(input.legacyAccountIds));
  return unwrap<HostedAppSite>(result, "site");
}

export async function renewHostedApp(input: { siteId: string; idempotencyKey: string; legacyAccountIds?: string[] }) {
  const result = await callAppHosting<{ site?: HostedAppSite }>(`/v1/sites/${encodeURIComponent(input.siteId)}/renew`, {
    method: "POST",
    headers: { "idempotency-key": input.idempotencyKey },
    body: "{}",
  }, await creditToken(input.legacyAccountIds));
  return unwrap<HostedAppSite>(result, "site");
}

export async function unpublishHostedApp(input: { siteId: string; legacyAccountIds?: string[] }) {
  const result = await callAppHosting<{ site?: HostedAppSite }>(`/v1/sites/${encodeURIComponent(input.siteId)}/unpublish`, {
    method: "POST",
    body: "{}",
  }, await creditToken(input.legacyAccountIds));
  return unwrap<HostedAppSite>(result, "site");
}
