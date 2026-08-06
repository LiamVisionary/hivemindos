import "server-only";

import type { ReasoningTrail } from "@/lib/types/reasoning-trail";
import {
  executeX402Fetch,
  type X402FetchPolicy,
} from "@/lib/services/wallet/x402-agent-fetch";
import {
  APIFY_MAX_RETURNED_ITEMS,
  APIFY_MAX_RUN_TIMEOUT_SECONDS,
  APIFY_MAX_SEARCH_RESULTS,
  APIFY_X402_BASE_URL,
  apifyMoneyAmount,
  buildApifyActorRunUrl,
  buildApifyFundingUrl,
  buildApifyStoreSearchUrl,
  normalizeApifyActorId,
  parseApifyBalancePayload,
  parseApifyPrepaidTokenPayload,
  projectApifyStoreResponse,
  type ApifyActorSummary,
} from "./contracts";
import {
  readApifyToken,
  storeApifyToken,
  updateApifyTokenBalance,
  type ApifyTokenSummary,
} from "./token-vault";

const APIFY_BALANCE_URL = `${APIFY_X402_BASE_URL}/prepaid-tokens/balance`;
const MAX_APIFY_RESPONSE_BYTES = 8 * 1024 * 1024;

export class ApifyRequestError extends Error {
  readonly status: number;
  readonly upstream: boolean;

  constructor(message: string, status = 400, upstream = false) {
    super(message);
    this.name = "ApifyRequestError";
    this.status = status;
    this.upstream = upstream;
  }
}

type Fetcher = typeof fetch;

function errorMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : null;
  const message = [record.message, nested?.message, record.error]
    .find((candidate) => typeof candidate === "string" && candidate.trim()) as string | undefined;
  return message?.slice(0, 500) || fallback;
}

async function responseJson(response: Response) {
  const length = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > MAX_APIFY_RESPONSE_BYTES) {
    throw new ApifyRequestError("Apify response exceeded the local 8 MB safety limit.", 502, true);
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_APIFY_RESPONSE_BYTES) {
    throw new ApifyRequestError("Apify response exceeded the local 8 MB safety limit.", 502, true);
  }
  try {
    return text ? JSON.parse(text) as unknown : null;
  } catch {
    throw new ApifyRequestError("Apify returned non-JSON output.", 502, true);
  }
}

async function apifyJson(input: {
  url: string;
  method?: "GET" | "POST";
  token?: string;
  body?: Record<string, unknown>;
  timeoutMs?: number;
  fetcher?: Fetcher;
}) {
  const fetcher = input.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(input.url, {
      method: input.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new ApifyRequestError(`Apify request failed: ${error instanceof Error ? error.message : String(error)}`, 502, true);
  }
  const json = await responseJson(response);
  if (!response.ok) {
    throw new ApifyRequestError(errorMessage(json, `Apify returned HTTP ${response.status}.`), response.status, true);
  }
  return json;
}

export async function searchApifyActors(input: {
  query?: string;
  limit?: number;
  offset?: number;
  fetcher?: Fetcher;
}) {
  const query = input.query?.trim() ?? "";
  const limit = input.limit ?? 5;
  const offset = input.offset ?? 0;
  const json = await apifyJson({
    url: buildApifyStoreSearchUrl(query, limit, offset),
    fetcher: input.fetcher,
  });
  return { query, offset, ...projectApifyStoreResponse(json) };
}

async function eligibleActor(actorId: string, fetcher?: Fetcher): Promise<ApifyActorSummary> {
  const normalized = normalizeApifyActorId(actorId);
  const { actors } = await searchApifyActors({
    query: normalized.replace("/", " "),
    limit: APIFY_MAX_SEARCH_RESULTS,
    fetcher,
  });
  const actor = actors.find((candidate) => candidate.actorId.toLowerCase() === normalized.toLowerCase());
  if (!actor) {
    throw new ApifyRequestError(`Apify Actor ${normalized} is not currently eligible for agentic prepaid payments.`, 400);
  }
  if (actor.pricing.model !== "PAY_PER_EVENT") {
    throw new ApifyRequestError(`Apify Actor ${normalized} does not use the required pay-per-event pricing model.`, 400);
  }
  return actor;
}

export async function getApifyTokenStatus(agentId: string, fetcher?: Fetcher) {
  const stored = await readApifyToken(agentId);
  if (!stored) return { configured: false as const, agentId };
  if (Date.parse(stored.summary.expiresAt) <= Date.now()) {
    return { configured: true as const, active: false, expired: true, ...stored.summary };
  }
  const json = await apifyJson({ url: APIFY_BALANCE_URL, token: stored.token, fetcher });
  const balance = parseApifyBalancePayload(json);
  const updated = await updateApifyTokenBalance(agentId, balance.remainingBalanceUsd, balance.expiresAt);
  return {
    configured: true as const,
    active: balance.remainingBalanceUsd > 0,
    expired: false,
    ...(updated ?? stored.summary),
  };
}

export async function fundApifyPrepaidToken(input: {
  agentId: string;
  network: string;
  secret: string;
  fromAddress: string;
  amountUsd: number;
  policy: X402FetchPolicy;
  confirmation?: string;
  approvalToken?: string;
  approvalThresholdSatisfied?: boolean;
  companyTaskId?: string;
  approvalContext?: Partial<ReasoningTrail>;
  fetcher?: Fetcher;
}) {
  const amountUsd = apifyMoneyAmount(input.amountUsd, 1, 100, "Apify funding amount");
  if (input.network !== "eip155:8453") {
    throw new ApifyRequestError("Apify x402 prepaid tokens currently require a Base mainnet wallet (eip155:8453).", 400);
  }
  const existing = await readApifyToken(input.agentId);
  if (existing && Date.parse(existing.summary.expiresAt) > Date.now()) {
    try {
      const status = await getApifyTokenStatus(input.agentId, input.fetcher);
      if (status.configured && status.active && status.remainingBalanceUsd > 0) {
        throw new ApifyRequestError(
          `This wallet already has an active Apify token with $${status.remainingBalanceUsd.toFixed(2)} remaining. Use that balance before buying another non-refundable token.`,
          409,
        );
      }
    } catch (error) {
      if (error instanceof ApifyRequestError && error.status === 409) throw error;
      if (!(error instanceof ApifyRequestError) || ![401, 403, 404].includes(error.status)) throw error;
      // An invalid/removed upstream token may be replaced by a newly settled token.
    }
  }
  let storedToken: ApifyTokenSummary | null = null;
  const payment = await executeX402Fetch({
    agentId: input.agentId,
    network: input.network,
    secret: input.secret,
    fromAddress: input.fromAddress,
    url: buildApifyFundingUrl(amountUsd),
    method: "GET",
    policy: input.policy,
    confirmation: input.confirmation,
    approvalToken: input.approvalToken,
    approvalThresholdSatisfied: input.approvalThresholdSatisfied,
    approvalContext: input.approvalContext,
    companyTaskId: input.companyTaskId,
    timeoutMs: 90_000,
    acceptPaidResourceAsSettlement: (settled) => {
      parseApifyPrepaidTokenPayload(settled.bodyJson);
      return true;
    },
    onPaymentSettled: async (settled) => {
      const token = parseApifyPrepaidTokenPayload(settled.bodyJson);
      storedToken = await storeApifyToken({
        agentId: input.agentId,
        token: token.token,
        purchasedAmountUsd: amountUsd,
        remainingBalanceUsd: token.remainingBalanceUsd,
        expiresAt: token.expiresAt,
      });
    },
  });
  if (!payment.ok || !payment.paymentSettled) {
    throw new ApifyRequestError(`Apify token funding did not settle successfully (HTTP ${payment.status}).`, 502, true);
  }
  if (!storedToken) throw new ApifyRequestError("Apify settled payment without returning a usable prepaid token.", 502, true);
  return {
    prepaid: storedToken,
    payment: {
      amountUsd: payment.amountUsd,
      network: payment.network,
      status: payment.status,
      builderCode: payment.builderCode,
      platformFee: payment.platformFee,
    },
  };
}

export async function runApifyActor(input: {
  agentId: string;
  actorId: string;
  actorInput: Record<string, unknown>;
  maxChargeUsd: number;
  resultLimit?: number;
  timeoutSecs?: number;
  fetcher?: Fetcher;
}) {
  const maxChargeUsd = apifyMoneyAmount(input.maxChargeUsd, 0.01, 100, "Apify Actor maximum charge");
  const actor = await eligibleActor(input.actorId, input.fetcher);
  if (actor.pricing.minimumChargeUsd != null && maxChargeUsd < actor.pricing.minimumChargeUsd) {
    throw new ApifyRequestError(
      `${actor.actorId} requires maxChargeUsd of at least $${actor.pricing.minimumChargeUsd.toFixed(4)}.`,
      400,
    );
  }
  const stored = await readApifyToken(input.agentId);
  if (!stored) throw new ApifyRequestError("No encrypted Apify prepaid token exists for this wallet. Fund it first.", 404);
  const before = await getApifyTokenStatus(input.agentId, input.fetcher);
  if (!before.configured || !before.active || before.expired) {
    throw new ApifyRequestError("The Apify prepaid token is expired or empty. Fund a new token before running an Actor.", 402);
  }
  if (maxChargeUsd > before.remainingBalanceUsd + 1e-9) {
    throw new ApifyRequestError(
      `Apify Actor cap $${maxChargeUsd.toFixed(2)} exceeds the token's $${before.remainingBalanceUsd.toFixed(2)} remaining balance.`,
      400,
    );
  }
  const resultLimit = input.resultLimit ?? 20;
  const timeoutSecs = input.timeoutSecs ?? 120;
  const json = await apifyJson({
    url: buildApifyActorRunUrl({ actorId: actor.actorId, maxChargeUsd, resultLimit, timeoutSecs }),
    method: "POST",
    token: stored.token,
    body: input.actorInput,
    timeoutMs: (Math.min(timeoutSecs, APIFY_MAX_RUN_TIMEOUT_SECONDS) + 15) * 1_000,
    fetcher: input.fetcher,
  });
  if (!Array.isArray(json)) throw new ApifyRequestError("Apify Actor did not return a JSON dataset-item array.", 502, true);
  const balance = await getApifyTokenStatus(input.agentId, input.fetcher).catch(() => before);
  return {
    actor,
    maxChargeUsd,
    resultLimit: Math.min(resultLimit, APIFY_MAX_RETURNED_ITEMS),
    itemCount: json.length,
    items: json.slice(0, APIFY_MAX_RETURNED_ITEMS),
    balance,
  };
}
