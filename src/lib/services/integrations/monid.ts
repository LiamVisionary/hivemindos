import { z } from "zod";

import {
  readSharedAgentEnv,
  sharedEnvValue,
} from "@/lib/services/integrations/shared-env";
import { MONID_API_KEY_ENV } from "@/lib/services/integrations/provider-connection-env";

export const MONID_API_BASE_URL = "https://api.monid.ai";
export { MONID_API_KEY_ENV } from "@/lib/services/integrations/provider-connection-env";
export const MONID_RUN_CONFIRMATION = "CONFIRM_MONID_RUN";

const monidProviderSchema = z.string().trim().min(1).max(120);
const monidEndpointSchema = z.string().trim().min(1).max(500).startsWith("/");
const monidPriceTypeSchema = z.enum(["PER_CALL", "PER_RESULT"]);

export const monidPriceSnapshotSchema = z.object({
  type: monidPriceTypeSchema,
  amount: z.number().finite().nonnegative(),
  flatFee: z.number().finite().nonnegative().nullable().optional(),
  currency: z.string().trim().min(1).max(12),
});

export type MonidPriceSnapshot = z.infer<typeof monidPriceSnapshotSchema>;

export const monidReadSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("status"),
  }),
  z.object({
    action: z.literal("discover"),
    query: z.string().trim().min(1).max(500),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    action: z.literal("inspect"),
    provider: monidProviderSchema,
    endpoint: monidEndpointSchema,
  }),
  z.object({
    action: z.literal("get-run"),
    runId: z.string().trim().min(1).max(160),
  }),
  z.object({
    action: z.literal("list-runs"),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().trim().min(1).max(500).optional(),
  }),
]);

export const monidRunSchema = z.object({
  provider: monidProviderSchema,
  endpoint: monidEndpointSchema,
  input: z.record(z.string(), z.unknown()),
  confirmedPrice: monidPriceSnapshotSchema,
  confirmation: z.string().trim().optional(),
});

export type MonidReadInput = z.infer<typeof monidReadSchema>;
export type MonidRunInput = z.infer<typeof monidRunSchema>;

type MonidFetcher = typeof fetch;

type MonidRequestOptions = {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  token?: string;
  fetcher?: MonidFetcher;
};

export type MonidApiResult = {
  data: unknown;
  status: number;
};

export class MonidApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "MonidApiError";
    this.status = status;
    this.data = data;
  }
}

export async function monidBalance(token?: string, fetcher?: MonidFetcher) {
  return monidRequest("/v1/wallet/balance", { token, fetcher });
}

export async function readMonid(input: MonidReadInput, token?: string, fetcher?: MonidFetcher) {
  if (input.action === "status") return monidBalance(token, fetcher);
  if (input.action === "discover") {
    return monidRequest("/v1/discover", {
      method: "POST",
      body: { query: input.query, ...(input.limit ? { limit: input.limit } : {}) },
      token,
      fetcher,
    });
  }
  if (input.action === "inspect") {
    return inspectMonidEndpoint(input.provider, input.endpoint, token, fetcher);
  }
  if (input.action === "get-run") {
    return monidRequest(`/v1/runs/${encodeURIComponent(input.runId)}`, { token, fetcher });
  }

  const search = new URLSearchParams();
  if (input.limit) search.set("limit", String(input.limit));
  if (input.cursor) search.set("cursor", input.cursor);
  const query = search.toString();
  return monidRequest(`/v1/runs${query ? `?${query}` : ""}`, { token, fetcher });
}

export function inspectMonidEndpoint(
  provider: string,
  endpoint: string,
  token?: string,
  fetcher?: MonidFetcher,
) {
  return monidRequest("/v1/inspect", {
    method: "POST",
    body: { provider, endpoint },
    token,
    fetcher,
  });
}

export function runMonid(input: MonidRunInput, token?: string, fetcher?: MonidFetcher) {
  return monidRequest("/v1/run", {
    method: "POST",
    body: {
      provider: input.provider,
      endpoint: input.endpoint,
      input: input.input,
    },
    token,
    fetcher,
  });
}

export function monidPriceSnapshot(value: unknown): MonidPriceSnapshot | null {
  const parsed = monidPriceSnapshotSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    currency: parsed.data.currency.toUpperCase(),
    flatFee: parsed.data.flatFee ?? null,
  };
}

export function monidPricesMatch(expected: MonidPriceSnapshot, actual: unknown) {
  const left = monidPriceSnapshot(expected);
  const right = monidPriceSnapshot(actual);
  return Boolean(
    left &&
      right &&
      left.type === right.type &&
      left.amount === right.amount &&
      left.flatFee === right.flatFee &&
      left.currency === right.currency,
  );
}

export function monidBalanceLabel(value: unknown) {
  if (!value || typeof value !== "object" || !("balance" in value)) return "Monid workspace";
  const balance = (value as { balance?: unknown }).balance;
  if (!balance || typeof balance !== "object") return "Monid workspace";
  const amount = (balance as { value?: unknown }).value;
  const currency = (balance as { currency?: unknown }).currency;
  if ((typeof amount !== "number" && typeof amount !== "string") || typeof currency !== "string") {
    return "Monid workspace";
  }
  return `${amount} ${currency.toUpperCase()} balance`;
}

async function monidRequest(path: string, options: MonidRequestOptions = {}): Promise<MonidApiResult> {
  const token = options.token?.trim() || await connectedMonidApiKey();
  if (!token) {
    throw new MonidApiError("Monid is not connected. Add a Monid API key in Integrations first.", 401, null);
  }

  const response = await (options.fetcher ?? fetch)(`${MONID_API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    throw new MonidApiError(monidErrorMessage(data, response.status), response.status, data);
  }
  return { data, status: response.status };
}

async function connectedMonidApiKey() {
  const sharedEnv = await readSharedAgentEnv();
  return sharedEnvValue(MONID_API_KEY_ENV, sharedEnv);
}

function monidErrorMessage(value: unknown, status: number) {
  if (value && typeof value === "object") {
    for (const key of ["error", "message", "detail"] as const) {
      const candidate = (value as Record<string, unknown>)[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
      if (candidate && typeof candidate === "object") {
        const nested = (candidate as Record<string, unknown>).message;
        if (typeof nested === "string" && nested.trim()) return nested.trim();
      }
    }
  }
  return `Monid rejected the request (HTTP ${status}).`;
}
