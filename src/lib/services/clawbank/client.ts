import "server-only";

import { readFile } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { join } from "node:path";
import { hiveEnvValue, hiveEnvPresence } from "@/lib/services/shared-hive-env";
import {
  CLAWBANK_DEFAULT_API_URL,
  CLAWBANK_DEFAULT_MCP_PATH,
  CLAWBANK_MISSING_CREDENTIAL_MESSAGE,
  CLAWBANK_TOKEN_ENV_NAMES,
} from "./constants";
import type { ClawbankMe, ClawbankResponse } from "./types";

/**
 * ClawBank REST client.
 *
 * Mirrors the Bankr integration's credential discipline: the token is resolved
 * at request time from the shared hive env first, then process.env, then the
 * ClawBank CLI config — never baked into code, never logged. Money-moving
 * endpoints are gated by the API routes (confirmation tokens), not here; this
 * module is the thin, defensive HTTP layer.
 *
 * Auth: `Authorization: Bearer <api_token>`. The long-lived API token is minted
 * through ClawBank's three-step email flow (request_code -> verify_code ->
 * bootstrap/api_tokens); see {@link clawbankRequestCode} et al.
 */

const CLAWBANK_CONFIG_FILE = join(homedir(), ".config", "clawbank", "config.json");
const CLAWBANK_DEFAULT_TIMEOUT_MS = 60_000;

type ClawbankCliConfig = {
  token: string;
  apiUrl: string;
  mcpUrl: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

async function clawbankCliConfig(): Promise<ClawbankCliConfig> {
  const raw = await readFile(CLAWBANK_CONFIG_FILE, "utf8").catch(() => "");
  if (!raw) return { token: "", apiUrl: "", mcpUrl: "" };
  try {
    const parsed = asRecord(JSON.parse(raw));
    return {
      token: stringValue(parsed.token ?? parsed.apiToken ?? parsed.api_token),
      apiUrl: stringValue(parsed.apiUrl ?? parsed.api_url),
      mcpUrl: stringValue(parsed.mcpUrl ?? parsed.mcp_url),
    };
  } catch {
    return { token: "", apiUrl: "", mcpUrl: "" };
  }
}

/** Resolve the ClawBank API token. Empty string when unconfigured — callers
 *  must treat empty as "not ready", never as a usable token. */
export async function clawbankApiToken(): Promise<string> {
  for (const key of CLAWBANK_TOKEN_ENV_NAMES) {
    const value = await hiveEnvValue(key).catch(() => "");
    if (value) return value;
  }
  const config = await clawbankCliConfig();
  return config.token;
}

/** Per-key presence (set/missing + source) without ever returning a value. */
export async function clawbankCredentialPresence() {
  return hiveEnvPresence(CLAWBANK_TOKEN_ENV_NAMES);
}

export async function clawbankConfigured(): Promise<boolean> {
  return Boolean(await clawbankApiToken().catch(() => ""));
}

export async function clawbankApiUrl(): Promise<string> {
  const override = await hiveEnvValue("CLAWBANK_API_URL").catch(() => "");
  if (override) return override.replace(/\/+$/, "");
  const config = await clawbankCliConfig();
  if (config.apiUrl) return config.apiUrl.replace(/\/+$/, "");
  return CLAWBANK_DEFAULT_API_URL;
}

export async function clawbankMcpUrl(): Promise<string> {
  const override = await hiveEnvValue("CLAWBANK_MCP_URL").catch(() => "");
  if (override) return override.replace(/\/+$/, "");
  const config = await clawbankCliConfig();
  if (config.mcpUrl) return config.mcpUrl.replace(/\/+$/, "");
  return `${await clawbankApiUrl()}${CLAWBANK_DEFAULT_MCP_PATH}`;
}

function joinPath(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function statusMessage(status: number): string {
  if (status === 0) return "ClawBank could not be reached.";
  if (status === 400) return "ClawBank rejected the request (validation).";
  if (status === 401) return "ClawBank rejected the credential (unauthorized).";
  if (status === 402) return "ClawBank reports insufficient funds or credits.";
  if (status === 403) return "ClawBank denied the request (forbidden).";
  if (status === 404) return "ClawBank resource not found.";
  if (status === 409 || status === 422) return "ClawBank rejected the request (business rule).";
  if (status === 429) return "ClawBank rate limit hit; retry shortly.";
  if (status >= 500) return `ClawBank service error (HTTP ${status}).`;
  return `ClawBank returned HTTP ${status}.`;
}

/** Extract a human error from the `{ ok:false, error: {...} }` envelope,
 *  probing the field names ClawBank and its upstreams (Bridge, Squid) use. */
export function clawbankErrorMessage(raw: unknown, status: number): string {
  const record = asRecord(raw);
  const error = record.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  const errorRecord = asRecord(error);
  for (const key of ["message", "detail", "description", "reason"]) {
    const value = errorRecord[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const code = stringValue(errorRecord.code);
  if (code) return `${statusMessage(status)} (${code})`;
  for (const key of ["error_description", "message", "detail"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return statusMessage(status);
}

export function clawbankErrorCode(raw: unknown, status: number): string {
  const errorRecord = asRecord(asRecord(raw).error);
  const code = stringValue(errorRecord.code);
  if (code) return code;
  return status > 0 ? `http_${status}` : "network_error";
}

function networkErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "ClawBank request timed out.";
    return error.message || "ClawBank request failed.";
  }
  return "ClawBank request failed.";
}

export type ClawbankFetchInit = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  token?: string;
  timeoutMs?: number;
};

/**
 * Low-level ClawBank REST call. Returns a normalized {@link ClawbankResponse};
 * it never throws for HTTP/business errors (only programmer errors bubble),
 * so callers can treat errors as control flow per ClawBank's guidance.
 *
 * Pass `token` to use a caller-supplied bearer (e.g. the bootstrap token during
 * onboarding); otherwise the resolved long-lived API token is used.
 */
export async function clawbankFetch<T = unknown>(
  path: string,
  init: ClawbankFetchInit = {},
): Promise<ClawbankResponse<T>> {
  const token = (init.token ?? (await clawbankApiToken())).trim();
  if (!token) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: CLAWBANK_MISSING_CREDENTIAL_MESSAGE,
      errorCode: "missing_credential",
      raw: null,
    };
  }

  const base = await clawbankApiUrl();
  let url: URL;
  try {
    url = new URL(joinPath(base, path));
  } catch {
    return { ok: false, status: 0, data: null, error: "Invalid ClawBank request path.", errorCode: "bad_path", raw: null };
  }
  if (init.query) {
    for (const [key, value] of Object.entries(init.query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
  }

  const method = init.method ?? "GET";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  let payload: string | undefined;
  if (init.body !== undefined && method !== "GET") {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(init.body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(init.timeoutMs ?? CLAWBANK_DEFAULT_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    return { ok: false, status: 0, data: null, error: networkErrorMessage(error), errorCode: "network_error", raw: null };
  }

  const raw = await response.json().catch(() => null);
  const envelope = asRecord(raw);
  const okFlag = response.ok && envelope.ok !== false;
  if (!okFlag) {
    return {
      ok: false,
      status: response.status,
      data: (envelope.data as T) ?? null,
      error: clawbankErrorMessage(raw, response.status),
      errorCode: clawbankErrorCode(raw, response.status),
      raw,
    };
  }
  // Success: prefer the envelope `data`, but fall back to the whole body for
  // any endpoint that returns a bare object instead of the wrapper.
  const data = (envelope.ok === true && "data" in envelope ? envelope.data : raw) as T;
  return { ok: true, status: response.status, data, error: "", errorCode: "", raw };
}

// ---------------------------------------------------------------------------
// Typed convenience methods for the documented, stable endpoints. Everything
// else (coms, contracts, records, fight clubs, Wise, trading engines, bridge
// ops) is reachable through the generic `clawbankFetch` above or, for the
// authoritative live surface, through MCP discovery (see ./mcp).
// ---------------------------------------------------------------------------

/** `GET /api/v1/me` -> normalized readiness flags. */
export async function clawbankMe(token?: string): Promise<ClawbankResponse<ClawbankMe>> {
  const result = await clawbankFetch<Record<string, unknown>>("/api/v1/me", { token });
  if (!result.ok) return { ...result, data: null };
  const data = asRecord(result.data);
  const wallet = asRecord(data.wallet);
  const me: ClawbankMe = {
    id: (data.id as number | string | undefined),
    email: stringValue(data.email) || undefined,
    bridgeCustomerConfigured: boolean(data.bridge_customer_configured),
    kycApproved: boolean(data.kyc_approved),
    tradingEnabled: boolean(data.trading_enabled),
    // Only model the wallet when present, to match the optional type — a
    // missing wallet returns undefined, not an object of undefined fields.
    wallet: data.wallet
      ? {
          address: stringValue(wallet.address) || undefined,
          chain: stringValue(wallet.chain) || undefined,
          provisioned: boolean(wallet.provisioned),
        }
      : undefined,
    raw: data,
  };
  return { ...result, data: me };
}

// --- Auth onboarding (three-step email flow) -------------------------------

/** Step 1: `POST /api/v1/auth/request_code` — email a login code. No token. */
export async function clawbankRequestCode(email: string): Promise<ClawbankResponse> {
  return clawbankFetchNoToken("/api/v1/auth/request_code", { email });
}

/** Step 2: `POST /api/v1/auth/verify_code` — exchange the code for a short-lived
 *  bootstrap token. No long-lived token. */
export async function clawbankVerifyCode(email: string, code: string): Promise<ClawbankResponse> {
  return clawbankFetchNoToken("/api/v1/auth/verify_code", { email, code });
}

/** Step 3: `POST /api/v1/auth/bootstrap/api_tokens` — mint a long-lived API
 *  token using the bootstrap token from step 2. */
export async function clawbankMintApiToken(
  bootstrapToken: string,
  options: { name?: string; expiresAt?: string } = {},
): Promise<ClawbankResponse> {
  return clawbankFetch("/api/v1/auth/bootstrap/api_tokens", {
    method: "POST",
    token: bootstrapToken,
    body: {
      name: options.name || "hivemindos-agent",
      ...(options.expiresAt ? { expires_at: options.expiresAt } : {}),
    },
  });
}

/** Auth endpoints that take no bearer (request_code, verify_code). */
async function clawbankFetchNoToken(path: string, body: unknown): Promise<ClawbankResponse> {
  const base = await clawbankApiUrl();
  let response: Response;
  try {
    response = await fetch(joinPath(base, path), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CLAWBANK_DEFAULT_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    return { ok: false, status: 0, data: null, error: networkErrorMessage(error), errorCode: "network_error", raw: null };
  }
  const raw = await response.json().catch(() => null);
  const envelope = asRecord(raw);
  const okFlag = response.ok && envelope.ok !== false;
  if (!okFlag) {
    return { ok: false, status: response.status, data: (envelope.data ?? null), error: clawbankErrorMessage(raw, response.status), errorCode: clawbankErrorCode(raw, response.status), raw };
  }
  return { ok: true, status: response.status, data: (envelope.ok === true && "data" in envelope ? envelope.data : raw), error: "", errorCode: "", raw };
}

// --- Self-custody wallet ---------------------------------------------------

export async function clawbankWalletAddress(): Promise<ClawbankResponse> {
  return clawbankFetch("/api/v1/self_custody/address");
}

export async function clawbankTokenBalance(symbol?: string): Promise<ClawbankResponse> {
  return clawbankFetch("/api/v1/self_custody/token_balance", {
    query: symbol ? { symbol } : undefined,
  });
}

/** Gas-sponsored USDC transfer from the self-custody wallet. Money-moving —
 *  routes gate this behind a confirmation token before calling. */
export async function clawbankSendUsdc(input: { toAddress: string; amount: string | number }): Promise<ClawbankResponse> {
  return clawbankFetch("/api/v1/self_custody/send_usdc", {
    method: "POST",
    body: { to_address: input.toAddress, amount: String(input.amount) },
  });
}

export async function clawbankTopupLink(amount: string | number): Promise<ClawbankResponse> {
  return clawbankFetch("/api/v1/self_custody/topup_link", {
    method: "POST",
    body: { amount: String(amount) },
  });
}

// --- Trading ---------------------------------------------------------------

export async function clawbankTradingTokens(): Promise<ClawbankResponse> {
  return clawbankFetch("/api/v1/trading/tokens");
}

/** One-off spot swap against USDC from the self-custody wallet. Money-moving. */
export async function clawbankSpotSwap(input: {
  baseToken: string;
  side: "buy" | "sell";
  amountUsdc: string | number;
  maxSlippageBps?: number;
}): Promise<ClawbankResponse> {
  return clawbankFetch("/api/v1/trading/swaps", {
    method: "POST",
    body: {
      base_token: input.baseToken,
      side: input.side,
      amount_usdc: String(input.amountUsdc),
      ...(input.maxSlippageBps !== undefined ? { max_slippage_bps: input.maxSlippageBps } : {}),
    },
  });
}

export async function clawbankTradingReport(): Promise<ClawbankResponse> {
  return clawbankFetch("/api/v1/trading/report");
}

// --- Money (bank rails) ----------------------------------------------------

export async function clawbankMoneyBalance(): Promise<ClawbankResponse> {
  return clawbankFetch("/api/v1/money/balance");
}

export async function clawbankDepositInstructions(): Promise<ClawbankResponse> {
  return clawbankFetch("/api/v1/money/deposit");
}

/** On-chain USDC transfer from the custodial (Bridge) wallet. Money-moving. */
export async function clawbankMoneyTransfer(input: {
  chain: string;
  toAddress: string;
  amount: string | number;
}): Promise<ClawbankResponse> {
  return clawbankFetch("/api/v1/money/transfers", {
    method: "POST",
    body: { chain: input.chain, to_address: input.toAddress, amount: String(input.amount) },
  });
}

// --- Formation -------------------------------------------------------------

export async function clawbankFormationJurisdictions(): Promise<ClawbankResponse> {
  return clawbankFetch("/api/v1/formation/jurisdictions");
}

export async function clawbankFormationOrders(): Promise<ClawbankResponse> {
  return clawbankFetch("/api/v1/formation/orders");
}
