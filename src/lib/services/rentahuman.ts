import "server-only";

import { hiveEnvPresence, hiveEnvValue, type HiveEnvPresence } from "@/lib/services/shared-hive-env";

export const RENTAHUMAN_API_KEY_ENV = "RENTAHUMAN_API_KEY";
export const RENTAHUMAN_API_URL_ENV = "RENTAHUMAN_API_URL";
export const RENTAHUMAN_DEFAULT_API_BASE = "https://rentahuman.ai/api";
export const RENTAHUMAN_ACTION_CONFIRMATION = "RENTAHUMAN_ACTION";

type RentAHumanMethod = "GET" | "POST" | "PATCH" | "DELETE";
type RentAHumanAuth = "none" | "optional" | "required";
type RentAHumanSideEffect = "none" | "message" | "bounty" | "booking" | "payment";

type RentAHumanActionDefinition = {
  action: string;
  label: string;
  method: RentAHumanMethod;
  path: string;
  auth: RentAHumanAuth;
  sideEffect: RentAHumanSideEffect;
  queryKeys?: readonly string[];
  bodyKeys?: readonly string[];
  bodyDefaults?: Record<string, unknown>;
};

export const RENTAHUMAN_ACTION_DEFINITIONS = [
  {
    action: "search-humans",
    label: "Search humans",
    method: "GET",
    path: "/humans",
    auth: "optional",
    sideEffect: "none",
    queryKeys: ["skill", "name", "minRate", "maxRate", "city", "country", "countryCode", "featured", "fields", "limit", "offset", "cursor"],
  },
  {
    action: "get-human",
    label: "Get human profile",
    method: "GET",
    path: "/humans/:humanId",
    auth: "optional",
    sideEffect: "none",
  },
  {
    action: "list-bounties",
    label: "List bounties",
    method: "GET",
    path: "/bounties",
    auth: "optional",
    sideEffect: "none",
    queryKeys: ["status", "includePartiallyFilled", "category", "skill", "minPrice", "maxPrice", "city", "country", "isRemoteOnly", "sort", "mine", "limit", "cursor"],
  },
  {
    action: "get-bounty",
    label: "Get bounty",
    method: "GET",
    path: "/bounties/:bountyId",
    auth: "optional",
    sideEffect: "none",
  },
  {
    action: "get-bounty-applications",
    label: "Get bounty applications",
    method: "GET",
    path: "/bounties/:bountyId/applications",
    auth: "required",
    sideEffect: "none",
    queryKeys: ["status", "sort", "limit", "cursor"],
  },
  {
    action: "browse-services",
    label: "Browse services",
    method: "GET",
    path: "/services/browse",
    auth: "optional",
    sideEffect: "none",
    queryKeys: ["category", "search", "sort", "verifiedOnly", "limit", "page"],
  },
  {
    action: "get-service-availability",
    label: "Get service availability",
    method: "GET",
    path: "/services/bookings",
    auth: "none",
    sideEffect: "none",
    queryKeys: ["humanId", "date"],
  },
  {
    action: "list-agent-bookings",
    label: "List agent service bookings",
    method: "GET",
    path: "/services/agent-bookings",
    auth: "required",
    sideEffect: "none",
    queryKeys: ["status"],
  },
  {
    action: "list-conversations",
    label: "List conversations",
    method: "GET",
    path: "/conversations",
    auth: "required",
    sideEffect: "none",
    queryKeys: ["humanId", "agentId", "ownerUid", "scope", "status", "unreadByAgent", "hasReplies", "limit", "cursor"],
  },
  {
    action: "get-conversation",
    label: "Get conversation",
    method: "GET",
    path: "/conversations/:conversationId",
    auth: "required",
    sideEffect: "none",
  },
  {
    action: "get-conversation-messages",
    label: "Get conversation messages",
    method: "GET",
    path: "/conversations/:conversationId/messages",
    auth: "required",
    sideEffect: "none",
    queryKeys: ["limit", "cursor"],
  },
  {
    action: "list-rentals",
    label: "List rentals",
    method: "GET",
    path: "/escrow/agent-rentals",
    auth: "required",
    sideEffect: "none",
  },
  {
    action: "get-escrow",
    label: "Get escrow",
    method: "GET",
    path: "/escrow/:escrowId",
    auth: "required",
    sideEffect: "none",
  },
  {
    action: "get-wallet-balance",
    label: "Get wallet balance",
    method: "GET",
    path: "/wallet/balance",
    auth: "required",
    sideEffect: "none",
  },
  {
    action: "list-transfers",
    label: "List transfers",
    method: "GET",
    path: "/transfers/mine",
    auth: "required",
    sideEffect: "none",
    queryKeys: ["direction", "status", "limit", "cursor"],
  },
  {
    action: "get-transfer",
    label: "Get transfer",
    method: "GET",
    path: "/transfers/:transferId",
    auth: "required",
    sideEffect: "none",
  },
  {
    action: "start-conversation",
    label: "Start conversation",
    method: "POST",
    path: "/conversations",
    auth: "required",
    sideEffect: "message",
    bodyKeys: ["humanId", "subject", "message", "agentName", "agentType", "messageType", "metadata"],
    bodyDefaults: { agentType: "other" },
  },
  {
    action: "send-message",
    label: "Send message",
    method: "POST",
    path: "/conversations/:conversationId/messages",
    auth: "required",
    sideEffect: "message",
    bodyKeys: ["content", "messageType", "metadata"],
  },
  {
    action: "create-bounty",
    label: "Create bounty",
    method: "POST",
    path: "/bounties",
    auth: "required",
    sideEffect: "bounty",
    bodyKeys: ["title", "description", "completionCriteria", "evidenceTypes", "estimatedHours", "priceType", "price", "category", "skillsNeeded", "location", "deadline", "spotsAvailable", "requiredLinks", "applicationDetails"],
  },
  {
    action: "update-bounty",
    label: "Update bounty",
    method: "PATCH",
    path: "/bounties/:bountyId",
    auth: "required",
    sideEffect: "bounty",
    bodyKeys: ["title", "description", "completionCriteria", "evidenceTypes", "price", "priceType", "category", "skillsNeeded", "location", "deadline", "spotsAvailable", "supportedCountries", "intakeClosedCountries"],
  },
  {
    action: "accept-application",
    label: "Accept bounty application",
    method: "PATCH",
    path: "/bounties/:bountyId/applications/:applicationId",
    auth: "required",
    sideEffect: "bounty",
    bodyKeys: ["response"],
    bodyDefaults: { action: "accept" },
  },
  {
    action: "reject-application",
    label: "Reject bounty application",
    method: "PATCH",
    path: "/bounties/:bountyId/applications/:applicationId",
    auth: "required",
    sideEffect: "bounty",
    bodyKeys: ["response"],
    bodyDefaults: { action: "reject" },
  },
  {
    action: "book-service",
    label: "Book service",
    method: "POST",
    path: "/services/book",
    auth: "required",
    sideEffect: "booking",
    bodyKeys: ["humanId", "serviceId", "date", "startTime", "message"],
  },
  {
    action: "subscribe-service",
    label: "Subscribe to service",
    method: "POST",
    path: "/services/subscribe",
    auth: "required",
    sideEffect: "booking",
    bodyKeys: ["humanId", "serviceId", "interval", "dayOfWeek", "startTime"],
  },
  {
    action: "create-escrow-checkout",
    label: "Create escrow checkout",
    method: "POST",
    path: "/escrow/checkout",
    auth: "required",
    sideEffect: "payment",
    bodyKeys: ["bountyId", "applicationId", "bookingId", "conversationId", "amount"],
  },
  {
    action: "rent-human",
    label: "Rent human",
    method: "POST",
    path: "/escrow/agent-checkout",
    auth: "required",
    sideEffect: "payment",
    bodyKeys: ["humanId", "taskTitle", "taskDescription", "price", "estimatedHours"],
  },
  {
    action: "create-personal-bounty",
    label: "Create personal bounty",
    method: "POST",
    path: "/escrow/personal-bounty",
    auth: "required",
    sideEffect: "payment",
    bodyKeys: ["humanId", "taskTitle", "taskDescription", "price", "estimatedHours", "completionCriteria", "evidenceTypes", "deadline"],
  },
  {
    action: "confirm-delivery",
    label: "Confirm delivery",
    method: "POST",
    path: "/escrow/:escrowId/complete",
    auth: "required",
    sideEffect: "payment",
  },
  {
    action: "release-payment",
    label: "Release payment",
    method: "POST",
    path: "/escrow/:escrowId/release",
    auth: "required",
    sideEffect: "payment",
  },
  {
    action: "cancel-escrow",
    label: "Cancel escrow",
    method: "POST",
    path: "/escrow/:escrowId/cancel",
    auth: "required",
    sideEffect: "payment",
  },
  {
    action: "open-dispute",
    label: "Open dispute",
    method: "POST",
    path: "/escrow/:escrowId/dispute",
    auth: "required",
    sideEffect: "payment",
  },
  {
    action: "deposit-wallet",
    label: "Deposit wallet funds",
    method: "POST",
    path: "/wallet/deposit",
    auth: "required",
    sideEffect: "payment",
    bodyKeys: ["amount"],
  },
  {
    action: "create-payment-link",
    label: "Create payment link",
    method: "POST",
    path: "/payment-links",
    auth: "required",
    sideEffect: "payment",
    bodyKeys: ["amount", "description", "payerEmail"],
  },
  {
    action: "send-money",
    label: "Send money",
    method: "POST",
    path: "/transfers/send",
    auth: "required",
    sideEffect: "payment",
    bodyKeys: ["recipientId", "recipientEmail", "amount", "description", "conversationId"],
  },
  {
    action: "bulk-send-money",
    label: "Bulk send money",
    method: "POST",
    path: "/transfers/bulk-send",
    auth: "required",
    sideEffect: "payment",
    bodyKeys: ["recipients", "description"],
  },
] as const satisfies readonly RentAHumanActionDefinition[];

export type RentAHumanActionName = typeof RENTAHUMAN_ACTION_DEFINITIONS[number]["action"];

export type RentAHumanStatus = {
  ok: boolean;
  ready: boolean;
  apiBaseUrl: string;
  credentials: HiveEnvPresence[];
  actions: Array<{
    action: RentAHumanActionName;
    label: string;
    method: RentAHumanMethod;
    auth: RentAHumanAuth;
    sideEffect: RentAHumanSideEffect;
    requiresConfirmation: boolean;
  }>;
};

export type RentAHumanCallInput = {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  confirmation?: unknown;
  mode?: unknown;
} & Record<string, unknown>;

export type RentAHumanCallDeps = {
  apiKey?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type RentAHumanPreparedAction = {
  action: RentAHumanActionName;
  label: string;
  method: RentAHumanMethod;
  path: string;
  auth: RentAHumanAuth;
  sideEffect: RentAHumanSideEffect;
  requiresConfirmation: boolean;
  confirmation?: typeof RENTAHUMAN_ACTION_CONFIRMATION;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
};

const ACTIONS_BY_NAME = new Map<string, typeof RENTAHUMAN_ACTION_DEFINITIONS[number]>(
  RENTAHUMAN_ACTION_DEFINITIONS.map((definition) => [definition.action, definition]),
);

export function normalizeRentAHumanAction(value: unknown): RentAHumanActionName | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  return ACTIONS_BY_NAME.has(normalized) ? normalized as RentAHumanActionName : null;
}

export function rentAHumanActionDefinition(action: RentAHumanActionName) {
  return ACTIONS_BY_NAME.get(action);
}

export function rentAHumanActionRequiresConfirmation(action: RentAHumanActionName) {
  return ACTIONS_BY_NAME.get(action)?.sideEffect !== "none";
}

export async function rentAHumanStatus(deps: RentAHumanCallDeps = {}): Promise<RentAHumanStatus> {
  const credentials = await hiveEnvPresence([RENTAHUMAN_API_KEY_ENV, RENTAHUMAN_API_URL_ENV]);
  const keyReady = credentials.some((item) => item.key === RENTAHUMAN_API_KEY_ENV && item.present);
  return {
    ok: true,
    ready: keyReady,
    apiBaseUrl: await rentAHumanApiBaseUrl(deps),
    credentials,
    actions: RENTAHUMAN_ACTION_DEFINITIONS.map((definition) => ({
      action: definition.action,
      label: definition.label,
      method: definition.method,
      auth: definition.auth,
      sideEffect: definition.sideEffect,
      requiresConfirmation: definition.sideEffect !== "none",
    })),
  };
}

export function prepareRentAHumanAction(action: RentAHumanActionName, input: RentAHumanCallInput = {}): RentAHumanPreparedAction {
  const definition = requiredDefinition(action);
  return {
    action,
    label: definition.label,
    method: definition.method,
    path: definition.path,
    auth: definition.auth,
    sideEffect: definition.sideEffect,
    requiresConfirmation: definition.sideEffect !== "none",
    confirmation: definition.sideEffect !== "none" ? RENTAHUMAN_ACTION_CONFIRMATION : undefined,
    query: pickQuery(definition, input),
    body: pickBody(definition, input),
  };
}

export async function callRentAHumanAction(action: RentAHumanActionName, input: RentAHumanCallInput = {}, deps: RentAHumanCallDeps = {}) {
  const definition = requiredDefinition(action);
  if (definition.sideEffect !== "none" && input.confirmation !== RENTAHUMAN_ACTION_CONFIRMATION) {
    return {
      ok: true,
      mode: "prepare" as const,
      prepared: prepareRentAHumanAction(action, input),
      message: `Review this RentAHuman ${definition.sideEffect} action, then send confirmation ${RENTAHUMAN_ACTION_CONFIRMATION} to execute it.`,
    };
  }

  const request = await buildRentAHumanRequest(definition, input, deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(request.url, request.init);
  const data = await parseRentAHumanResponse(response);
  return {
    ok: true,
    mode: "execute" as const,
    action,
    label: definition.label,
    method: definition.method,
    path: request.path,
    sideEffect: definition.sideEffect,
    data,
  };
}

export async function buildRentAHumanRequest(
  definition: typeof RENTAHUMAN_ACTION_DEFINITIONS[number],
  input: RentAHumanCallInput,
  deps: RentAHumanCallDeps = {},
) {
  const apiKey = deps.apiKey ?? await hiveEnvValue(RENTAHUMAN_API_KEY_ENV).catch(() => "");
  if (definition.auth === "required" && !apiKey) {
    throw new Error(`Set ${RENTAHUMAN_API_KEY_ENV} in shared env before calling RentAHuman ${definition.label}.`);
  }
  const baseUrl = await rentAHumanApiBaseUrl(deps);
  const path = buildPath(definition.path, input);
  const url = new URL(`${baseUrl}${path}`);
  appendQuery(url, definition, input);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey && definition.auth !== "none") headers["X-API-Key"] = apiKey;

  const body = pickBody(definition, input);
  const init: RequestInit = {
    method: definition.method,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(Math.max(1_000, Math.min(deps.timeoutMs ?? 30_000, 120_000))),
  };
  if (definition.method !== "GET") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body ?? {});
  }
  return { url: url.toString(), init, path };
}

async function rentAHumanApiBaseUrl(deps: RentAHumanCallDeps) {
  const configured = deps.apiBaseUrl ?? await hiveEnvValue(RENTAHUMAN_API_URL_ENV).catch(() => "");
  return normalizeApiBaseUrl(configured || RENTAHUMAN_DEFAULT_API_BASE);
}

function normalizeApiBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  const parsed = new URL(trimmed);
  const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new Error(`${RENTAHUMAN_API_URL_ENV} must use https, except localhost development URLs.`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

function requiredDefinition(action: RentAHumanActionName) {
  const definition = ACTIONS_BY_NAME.get(action);
  if (!definition) throw new Error(`Unsupported RentAHuman action: ${action}`);
  return definition;
}

function buildPath(pathTemplate: string, input: RentAHumanCallInput) {
  return pathTemplate.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_match, key: string) => {
    const value = inputValue(input, key);
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error(`RentAHuman request requires ${key}.`);
    }
    const text = String(value).trim();
    if (!text) throw new Error(`RentAHuman request requires ${key}.`);
    return encodeURIComponent(text);
  });
}

function appendQuery(url: URL, definition: RentAHumanActionDefinition, input: RentAHumanCallInput) {
  for (const key of definition.queryKeys ?? []) {
    const value = inputValue(input, key);
    appendQueryValue(url.searchParams, key, value);
  }
}

function appendQueryValue(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(params, key, item);
    return;
  }
  if (typeof value === "object") return;
  params.append(key, String(value));
}

function pickQuery(definition: RentAHumanActionDefinition, input: RentAHumanCallInput) {
  const result: Record<string, unknown> = {};
  for (const key of definition.queryKeys ?? []) {
    const value = inputValue(input, key);
    if (value !== undefined && value !== null && value !== "") result[key] = value;
  }
  return Object.keys(result).length ? result : undefined;
}

function pickBody(definition: RentAHumanActionDefinition, input: RentAHumanCallInput) {
  if (!definition.bodyKeys?.length && !definition.bodyDefaults) return undefined;
  const result: Record<string, unknown> = { ...(definition.bodyDefaults ?? {}) };
  for (const key of definition.bodyKeys ?? []) {
    const value = bodyValue(input, key);
    if (value !== undefined && value !== null && value !== "") result[key] = value;
  }
  return result;
}

function inputValue(input: RentAHumanCallInput, key: string) {
  return input.params?.[key] ?? input.query?.[key] ?? input.body?.[key] ?? input[key];
}

function bodyValue(input: RentAHumanCallInput, key: string) {
  return input.body?.[key] ?? (key === "action" ? undefined : input[key]);
}

async function parseRentAHumanResponse(response: Response) {
  const text = await response.text().catch(() => "");
  const data = parseJson(text);
  if (!response.ok || responseBodyFailed(data)) {
    throw new Error(rentAHumanErrorMessage(data, `RentAHuman returned HTTP ${response.status}.`));
  }
  return data;
}

function parseJson(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function responseBodyFailed(data: unknown) {
  return Boolean(data && typeof data === "object" && (data as Record<string, unknown>).success === false);
}

function rentAHumanErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, unknown>;
  const value = typeof record.error === "string" && record.error.trim()
    ? record.error
    : typeof record.message === "string" && record.message.trim()
      ? record.message
      : fallback;
  return redactRentAHumanSecrets(value);
}

function redactRentAHumanSecrets(value: string) {
  return value.replace(/\brah_[A-Za-z0-9_-]+\b/g, "rah_REDACTED");
}
