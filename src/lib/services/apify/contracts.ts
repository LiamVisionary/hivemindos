export const APIFY_API_BASE_URL = "https://api.apify.com/v2";
export const APIFY_X402_BASE_URL = "https://agi.apify.com";
export const APIFY_MINIMUM_FUNDING_USD = 1;
export const APIFY_MAXIMUM_FUNDING_USD = 100;
export const APIFY_MAX_RUN_CHARGE_USD = 100;
export const APIFY_MAX_SEARCH_RESULTS = 10;
export const APIFY_MAX_RETURNED_ITEMS = 100;
export const APIFY_MAX_RUN_TIMEOUT_SECONDS = 150;

const ACTOR_PART_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type JsonRecord = Record<string, unknown>;

export type ApifyActorSummary = {
  id: string;
  actorId: string;
  title: string;
  description: string;
  url: string;
  categories: string[];
  pricing: {
    model: string;
    minimumChargeUsd: number | null;
    events: Array<{ name: string; title: string; priceUsd: number | null }>;
  };
  stats: {
    totalRuns: number | null;
    totalUsers: number | null;
    rating: number | null;
    reviewCount: number | null;
  };
  inputSchema?: unknown;
};

export type ApifyPrepaidTokenPayload = {
  token: string;
  remainingBalanceUsd: number;
  expiresAt: string;
};

export type ApifyBalancePayload = {
  remainingBalanceUsd: number;
  expiresAt?: string;
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableNumber(value: unknown): number | null {
  return finiteNumber(value);
}

function boundedInteger(value: number, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

export function apifyMoneyAmount(value: unknown, min: number, max: number, label: string) {
  const parsed = finiteNumber(value);
  if (parsed == null || parsed < min || parsed > max || Math.abs(Math.round(parsed * 100) - parsed * 100) > 1e-8) {
    throw new Error(`${label} must be from $${min.toFixed(2)} to $${max.toFixed(2)} with at most two decimal places.`);
  }
  return parsed;
}

export function normalizeApifyActorId(value: string) {
  const compact = value.trim().replace("~", "/");
  const parts = compact.split("/");
  if (parts.length !== 2 || parts.some((part) => !ACTOR_PART_PATTERN.test(part))) {
    throw new Error('Apify Actor id must use the exact "username/name" format.');
  }
  return `${parts[0]}/${parts[1]}`;
}

export function apifyActorApiId(value: string) {
  return normalizeApifyActorId(value).replace("/", "~");
}

export function buildApifyFundingUrl(amountUsd: number) {
  const amount = apifyMoneyAmount(
    amountUsd,
    APIFY_MINIMUM_FUNDING_USD,
    APIFY_MAXIMUM_FUNDING_USD,
    "Apify funding amount",
  );
  const url = new URL("/protocols/x402/prepaid-tokens", APIFY_X402_BASE_URL);
  url.searchParams.set("amount", amount.toFixed(2).replace(/\.00$/, ""));
  url.searchParams.set("currency", "usd");
  return url.toString();
}

export function buildApifyStoreSearchUrl(query: string, limit: number, offset: number) {
  const safeLimit = boundedInteger(limit, 1, APIFY_MAX_SEARCH_RESULTS, "Apify search limit");
  const safeOffset = boundedInteger(offset, 0, 10_000, "Apify search offset");
  const url = new URL(`${APIFY_API_BASE_URL}/store`);
  if (query.trim()) url.searchParams.set("search", query.trim().slice(0, 120));
  url.searchParams.set("limit", String(safeLimit));
  url.searchParams.set("offset", String(safeOffset));
  url.searchParams.set("allowsAgenticUsers", "true");
  url.searchParams.set("includeInputSchema", "true");
  return url.toString();
}

export function buildApifyActorRunUrl(input: {
  actorId: string;
  maxChargeUsd: number;
  resultLimit: number;
  timeoutSecs: number;
}) {
  const actorId = apifyActorApiId(input.actorId);
  const maxChargeUsd = apifyMoneyAmount(
    input.maxChargeUsd,
    0.01,
    APIFY_MAX_RUN_CHARGE_USD,
    "Apify Actor maximum charge",
  );
  const resultLimit = boundedInteger(input.resultLimit, 1, APIFY_MAX_RETURNED_ITEMS, "Apify result limit");
  const timeoutSecs = boundedInteger(input.timeoutSecs, 10, APIFY_MAX_RUN_TIMEOUT_SECONDS, "Apify run timeout");
  const url = new URL(`${APIFY_API_BASE_URL}/actors/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`);
  url.searchParams.set("maxTotalChargeUsd", String(maxChargeUsd));
  url.searchParams.set("limit", String(resultLimit));
  url.searchParams.set("timeout", String(timeoutSecs));
  url.searchParams.set("format", "json");
  url.searchParams.set("clean", "1");
  url.searchParams.set("restartOnError", "false");
  return url.toString();
}

function payloadRecord(value: unknown): JsonRecord {
  const outer = record(value);
  if (!outer) throw new Error("Apify returned an invalid JSON object.");
  return record(outer.data) ?? outer;
}

export function parseApifyPrepaidTokenPayload(value: unknown): ApifyPrepaidTokenPayload {
  const payload = payloadRecord(value);
  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  const remainingBalanceUsd = finiteNumber(payload.remainingBalanceUsd);
  const expiresAt = typeof payload.expiresAt === "string" ? payload.expiresAt.trim() : "";
  const expiresAtMs = Date.parse(expiresAt);
  if (token.length < 20 || token.length > 2_000 || remainingBalanceUsd == null || remainingBalanceUsd < 0 || !Number.isFinite(expiresAtMs)) {
    throw new Error("Apify returned an invalid prepaid-token payload.");
  }
  return { token, remainingBalanceUsd, expiresAt: new Date(expiresAtMs).toISOString() };
}

export function parseApifyBalancePayload(value: unknown): ApifyBalancePayload {
  const payload = payloadRecord(value);
  const remainingBalanceUsd = finiteNumber(payload.remainingBalanceUsd ?? payload.balanceUsd ?? payload.balance);
  const expiresAt = typeof payload.expiresAt === "string" && Number.isFinite(Date.parse(payload.expiresAt))
    ? new Date(payload.expiresAt).toISOString()
    : undefined;
  if (remainingBalanceUsd == null || remainingBalanceUsd < 0) {
    throw new Error("Apify returned an invalid prepaid-token balance.");
  }
  return { remainingBalanceUsd, expiresAt };
}

function pricingEvents(pricing: JsonRecord | null) {
  const pricingPerEvent = record(pricing?.pricingPerEvent);
  const actorChargeEvents = record(pricingPerEvent?.actorChargeEvents);
  if (!actorChargeEvents) return [];
  return Object.entries(actorChargeEvents).slice(0, 20).map(([name, rawEvent]) => {
    const event = record(rawEvent);
    const tiers = record(event?.eventTieredPricingUsd);
    const freeTier = record(tiers?.FREE);
    return {
      name,
      title: typeof event?.eventTitle === "string" ? event.eventTitle : name,
      priceUsd: nullableNumber(freeTier?.tieredEventPriceUsd ?? event?.eventPriceUsd),
    };
  });
}

export function projectApifyStoreResponse(value: unknown): { total: number; actors: ApifyActorSummary[] } {
  const outer = record(value);
  const data = record(outer?.data);
  if (!data || !Array.isArray(data.items)) throw new Error("Apify Store returned an invalid response.");
  const actors = data.items.flatMap((raw): ApifyActorSummary[] => {
    const actor = record(raw);
    if (!actor || actor.isWhiteListedForAgenticPayments !== true) return [];
    const username = typeof actor.username === "string" ? actor.username : "";
    const name = typeof actor.name === "string" ? actor.name : "";
    let actorId: string;
    try {
      actorId = normalizeApifyActorId(`${username}/${name}`);
    } catch {
      return [];
    }
    const pricing = record(actor.currentPricingInfo);
    const stats = record(actor.stats);
    return [{
      id: typeof actor.id === "string" ? actor.id : actorId,
      actorId,
      title: typeof actor.title === "string" ? actor.title : name,
      description: typeof actor.description === "string" ? actor.description : "",
      url: typeof actor.url === "string" ? actor.url : `https://apify.com/${actorId}`,
      categories: Array.isArray(actor.categories)
        ? actor.categories.filter((item): item is string => typeof item === "string").slice(0, 20)
        : [],
      pricing: {
        model: typeof pricing?.pricingModel === "string" ? pricing.pricingModel : "",
        minimumChargeUsd: nullableNumber(pricing?.minimalMaxTotalChargeUsd),
        events: pricingEvents(pricing),
      },
      stats: {
        totalRuns: nullableNumber(stats?.totalRuns),
        totalUsers: nullableNumber(stats?.totalUsers),
        rating: nullableNumber(actor.actorReviewRating ?? stats?.actorReviewRating),
        reviewCount: nullableNumber(actor.actorReviewCount ?? stats?.actorReviewCount),
      },
      inputSchema: actor.inputSchema,
    }];
  });
  return { total: Math.max(0, finiteNumber(data.total) ?? actors.length), actors };
}
