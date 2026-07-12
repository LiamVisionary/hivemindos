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
  name: string;
  slug: string;
  url: string;
  planId: string;
  runtime: "static" | "dynamic";
  status: "draft" | "active" | "grace" | "unpublished" | "expired" | "error";
  expiresAt: string;
  autoRenew: boolean;
  currentReleaseId: string | null;
  accessMode: SiteAccessMode;
};

export type SiteAccessMode = "private" | "workspace" | "link" | "public";
export type HostedAppBindings = { d1: string[]; r2: string[] };
export type HostedAppUsage = {
  periodStartedAt: string;
  resetsAt: string;
  requests: { used: number; limit: number };
  reservedCpuMs: { used: number; limit: number };
  operations: { used: number; limit: number };
  storageBytes: { used: number; limit: number };
};

export type HostedAppVersion = {
  id: string;
  siteId: string;
  projectId: string;
  runtime: "static" | "dynamic";
  digest: string;
  fileCount: number;
  totalBytes: number;
  status: "saved" | "active" | "superseded" | "failed";
  sourceCommitSha: string | null;
  createdAt: string;
  activatedAt: string | null;
};

export type HostedAppDeployment = {
  id: string;
  siteId: string;
  releaseId: string;
  environment: "production";
  reason: "deploy" | "rollback" | "publish";
  status: "active" | "superseded" | "failed";
  accessMode: SiteAccessMode;
  url: string;
  createdAt: string;
  activatedAt: string | null;
  supersededAt: string | null;
};

export type AppHostingPlan = {
  id: string;
  label: string;
  runtime: "static" | "dynamic";
  billing: "one-time" | "recurring-credit";
  priceUsd: number;
  durationSeconds: number;
  planChangePolicy: "full-price-extension";
  limits: {
    files: number;
    bytes: number;
    cpuMs?: number;
    subRequests?: number;
    monthlyRequests?: number;
    monthlyCpuMs?: number;
    storageBytes?: number;
    monthlyOperations?: number;
  };
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

function unwrapPayload<T extends Record<string, unknown>>(result: GatewayResult<T>): T {
  if (result.status >= 400 || result.payload.ok === false) {
    throw Object.assign(new Error(String(result.payload.error || `App hosting failed with HTTP ${result.status}.`)), { status: result.status });
  }
  return result.payload;
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

export async function createHostedAppSite(input: {
  name: string;
  slug: string;
  planId: string;
  accessMode?: SiteAccessMode;
  legacyAccountIds?: string[];
}) {
  const result = await callAppHosting<{ site?: HostedAppSite }>("/v1/sites", {
    method: "POST",
    body: JSON.stringify(input),
  }, await creditToken(input.legacyAccountIds));
  return unwrap<HostedAppSite>(result, "site");
}

export async function listHostedAppVersions(siteId: string, legacyAccountIds: string[] = []) {
  const result = await callAppHosting<{ versions?: HostedAppVersion[] }>(`/v1/sites/${encodeURIComponent(siteId)}/versions`, {}, await creditToken(legacyAccountIds));
  return unwrap<HostedAppVersion[]>(result, "versions") || [];
}

export async function saveHostedAppVersion(input: {
  siteId: string;
  slug: string;
  planId: string;
  artifact: StaticHostingArtifact | Record<string, unknown>;
  idempotencyKey: string;
  sourceCommitSha?: string;
  bindings?: HostedAppBindings;
  legacyAccountIds?: string[];
}) {
  const result = await callAppHosting<{ site?: HostedAppSite; version?: HostedAppVersion }>(`/v1/sites/${encodeURIComponent(input.siteId)}/versions`, {
    method: "POST",
    headers: { "idempotency-key": input.idempotencyKey },
    body: JSON.stringify(input),
  }, await creditToken(input.legacyAccountIds));
  const payload = unwrapPayload(result);
  return { site: payload.site as HostedAppSite, version: payload.version as HostedAppVersion };
}

export async function listHostedAppDeployments(siteId: string, legacyAccountIds: string[] = []) {
  const result = await callAppHosting<{ deployments?: HostedAppDeployment[] }>(`/v1/sites/${encodeURIComponent(siteId)}/deployments`, {}, await creditToken(legacyAccountIds));
  return unwrap<HostedAppDeployment[]>(result, "deployments") || [];
}

async function activateHostedAppVersion(input: {
  siteId: string;
  releaseId: string;
  planId?: string;
  autoRenew?: boolean;
  accessMode?: SiteAccessMode;
  idempotencyKey: string;
  rollback?: boolean;
  legacyAccountIds?: string[];
}) {
  const suffix = input.rollback ? "rollback" : "deployments";
  const result = await callAppHosting<{ site?: HostedAppSite; deployment?: HostedAppDeployment }>(`/v1/sites/${encodeURIComponent(input.siteId)}/${suffix}`, {
    method: "POST",
    headers: { "idempotency-key": input.idempotencyKey },
    body: JSON.stringify(input),
  }, await creditToken(input.legacyAccountIds));
  const payload = unwrapPayload(result);
  return { site: payload.site as HostedAppSite, deployment: payload.deployment as HostedAppDeployment };
}

export const deployHostedAppVersion = (input: Parameters<typeof activateHostedAppVersion>[0]) => activateHostedAppVersion(input);
export const rollbackHostedAppVersion = (input: Parameters<typeof activateHostedAppVersion>[0]) => activateHostedAppVersion({ ...input, rollback: true });

export async function getHostedAppAccess(siteId: string, legacyAccountIds: string[] = []) {
  const result = await callAppHosting<{ access?: { mode: SiteAccessMode } }>(`/v1/sites/${encodeURIComponent(siteId)}/access`, {}, await creditToken(legacyAccountIds));
  return unwrap<{ mode: SiteAccessMode }>(result, "access");
}

export async function setHostedAppAccess(input: { siteId: string; mode: SiteAccessMode; legacyAccountIds?: string[] }) {
  const result = await callAppHosting<{ access?: { mode: SiteAccessMode; accessUrl: string | null } }>(`/v1/sites/${encodeURIComponent(input.siteId)}/access`, {
    method: "POST",
    body: JSON.stringify({ mode: input.mode }),
  }, await creditToken(input.legacyAccountIds));
  return unwrap<{ mode: SiteAccessMode; accessUrl: string | null }>(result, "access");
}

export async function createHostedAppAccessToken(input: { siteId: string; purpose?: "preview" | "workspace"; ttlSeconds?: number; legacyAccountIds?: string[] }) {
  const result = await callAppHosting<{ access?: { purpose: string; url: string; expiresAt: string | null } }>(`/v1/sites/${encodeURIComponent(input.siteId)}/access-token`, {
    method: "POST",
    body: JSON.stringify(input),
  }, await creditToken(input.legacyAccountIds));
  return unwrap<{ purpose: string; url: string; expiresAt: string | null }>(result, "access");
}

export async function getHostedAppBindings(siteId: string, legacyAccountIds: string[] = []) {
  const result = await callAppHosting<{ bindings?: HostedAppBindings }>(`/v1/sites/${encodeURIComponent(siteId)}/bindings`, {}, await creditToken(legacyAccountIds));
  return unwrap<HostedAppBindings>(result, "bindings");
}

export async function setHostedAppBindings(input: { siteId: string; bindings: HostedAppBindings; legacyAccountIds?: string[] }) {
  const result = await callAppHosting<{ bindings?: HostedAppBindings }>(`/v1/sites/${encodeURIComponent(input.siteId)}/bindings`, {
    method: "POST",
    body: JSON.stringify({ bindings: input.bindings }),
  }, await creditToken(input.legacyAccountIds));
  return unwrap<HostedAppBindings>(result, "bindings");
}

export async function getHostedAppEnvironment(siteId: string, legacyAccountIds: string[] = []) {
  const result = await callAppHosting<{ environment?: { keys: string[] } }>(`/v1/sites/${encodeURIComponent(siteId)}/environment`, {}, await creditToken(legacyAccountIds));
  return unwrap<{ keys: string[] }>(result, "environment");
}

export async function setHostedAppEnvironment(input: { siteId: string; values?: Record<string, string>; unset?: string[]; legacyAccountIds?: string[] }) {
  const result = await callAppHosting<{ environment?: { keys: string[] } }>(`/v1/sites/${encodeURIComponent(input.siteId)}/environment`, {
    method: "POST",
    body: JSON.stringify({ values: input.values || {}, unset: input.unset || [] }),
  }, await creditToken(input.legacyAccountIds));
  return unwrap<{ keys: string[] }>(result, "environment");
}

export async function getHostedAppUsage(siteId: string, legacyAccountIds: string[] = []) {
  const result = await callAppHosting<{ usage?: HostedAppUsage | null }>(`/v1/sites/${encodeURIComponent(siteId)}/usage`, {}, await creditToken(legacyAccountIds));
  return unwrap<HostedAppUsage | null>(result, "usage");
}

export async function publishHostedApp(input: {
  artifact: StaticHostingArtifact | Record<string, unknown>;
  slug: string;
  planId: string;
  idempotencyKey: string;
  siteId?: string;
  autoRenew?: boolean;
  accessMode?: SiteAccessMode;
  bindings?: HostedAppBindings;
  sourceCommitSha?: string;
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
      accessMode: input.accessMode,
      bindings: input.bindings,
      sourceCommitSha: input.sourceCommitSha,
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
