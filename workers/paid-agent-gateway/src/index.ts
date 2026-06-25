import { createFacilitatorConfig } from "@coinbase/x402";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import {
  x402HTTPResourceServer,
  type HTTPAdapter,
  type HTTPProcessResult,
  type HTTPRequestContext,
  type HTTPResponseInstructions,
  type ProcessSettleResultResponse,
} from "@x402/core/http";
import type { Network } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import {
  BUILDER_CODE,
  BUILDER_CODE_PATTERN,
  builderCodeResourceServerExtension,
  declareBuilderCodeExtension,
} from "@x402/extensions/builder-code";

type Env = {
  DB: D1Database;
  CORS_ORIGIN?: string;
  HIVEMINDOS_PAID_AGENT_CATALOG_JSON?: string;
  HIVEMINDOS_PAID_AGENT_SLUG?: string;
  HIVEMINDOS_PAID_AGENT_DESCRIPTION?: string;
  HIVEMINDOS_PAID_AGENT_PRICE_USD?: string;
  HIVEMINDOS_PAID_AGENT_TESTNET_MODE?: string;
  HIVEMINDOS_PAID_AGENT_NETWORK?: string;
  HIVEMINDOS_PAID_AGENT_PAY_TO?: string;
  HIVEMINDOS_PAID_AGENT_FACILITATOR_URL?: string;
  HIVEMINDOS_PAID_AGENT_FACILITATOR_BEARER?: string;
  HIVEMINDOS_PAID_AGENT_CDP_API_KEY_ID?: string;
  HIVEMINDOS_PAID_AGENT_CDP_API_KEY_SECRET?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  HIVEMINDOS_PAID_AGENT_BUILDER_CODE?: string;
  HIVEMINDOS_X402_SELLER_BUILDER_CODE?: string;
  HIVEMINDOS_X402_BUILDER_CODE?: string;
  HIVEMINDOS_PAID_AGENT_UPSTREAM_URL?: string;
  HIVEMINDOS_PAID_AGENT_UPSTREAM_BEARER?: string;
  HIVEMINDOS_PAID_AGENT_UPSTREAM_TIMEOUT_MS?: string;
  HIVEMINDOS_PAID_AGENT_MAX_BODY_CHARS?: string;
  HIVEMINDOS_PLATFORM_FEES_ENABLED?: string;
  HIVEMINDOS_TRADING_PLATFORM_FEES_ENABLED?: string;
  HIVEMINDOS_PLATFORM_FEE_BPS?: string;
  HIVEMINDOS_TRADING_PLATFORM_FEE_BPS?: string;
  HIVEMINDOS_PLATFORM_MIN_FEE_USD?: string;
  HIVEMINDOS_TRADING_PLATFORM_MIN_FEE_USD?: string;
  HIVEMINDOS_PLATFORM_MAX_FEE_USD?: string;
  HIVEMINDOS_TRADING_PLATFORM_MAX_FEE_USD?: string;
  HIVEMINDOS_PLATFORM_FEE_RECIPIENT_EVM?: string;
  HIVEMINDOS_PLATFORM_FEE_RECIPIENT?: string;
  HIVEMINDOS_PLATFORM_FEE_RECIPIENT_SOLANA?: string;
  HIVEMINDOS_PLATFORM_FEE_RECIPIENT_SVM?: string;
  HIVEMINDOS_HYPERLIQUID_BUILDER_ENABLED?: string;
  HIVEMINDOS_HYPERLIQUID_BUILDER_ADDRESS?: string;
  HIVEMINDOS_HYPERLIQUID_BUILDER_FEE_TENTH_BPS?: string;
  HIVEMINDOS_HYPERLIQUID_MAX_BUILDER_FEE_TENTH_BPS?: string;
  HIVEMINDOS_HYPERLIQUID_TESTNET?: string;
  HIVEMINDOS_HYPERLIQUID_API_URL?: string;
};

type OpenAIMessage = {
  role?: string;
  content?: unknown;
};

type OpenAIChatCompletionBody = {
  messages?: OpenAIMessage[];
  model?: string;
  stream?: boolean;
  [key: string]: unknown;
};

type PaidAgentEntry = {
  slug: string;
  description: string;
  priceUsd: number;
  network: Network;
  payTo: string;
  facilitatorUrl: string;
  facilitatorBearer?: string;
  cdpApiKeyId?: string;
  cdpApiKeySecret?: string;
  builderCode?: string;
  upstreamUrl: string;
  upstreamBearer?: string;
  upstreamTimeoutMs: number;
};

type PaymentContext = {
  kind: "x402";
  context: HTTPRequestContext;
  result: Extract<HTTPProcessResult, { type: "payment-verified" }>;
  server: x402HTTPResourceServer;
};

type UpstreamResult = {
  body: string;
  status: number;
  headers: Headers;
};

type ReceiptRow = {
  id: string;
  created_at: string;
  transaction_hash: string | null;
};

const DEFAULT_SLUG = "default";
const DEFAULT_PRICE_USD = 0.001;
const BASE_MAINNET_NETWORK = "eip155:8453";
const BASE_SEPOLIA_NETWORK = "eip155:84532";
const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const TESTNET_FACILITATOR_URL = "https://x402.org/facilitator";
const DEFAULT_NETWORK = BASE_MAINNET_NETWORK;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BODY_CHARS = 200_000;
const DEFAULT_PLATFORM_FEE_BPS = 100;
const DEFAULT_PLATFORM_MIN_FEE_USD = 0.01;
const DEFAULT_PLATFORM_MAX_FEE_USD = 0;
const DEFAULT_HYPERLIQUID_BUILDER_FEE_TENTH_BPS = 5;
const MAX_HYPERLIQUID_PERP_BUILDER_FEE_TENTH_BPS = 100;

const serverCache = new Map<string, Promise<x402HTTPResourceServer>>();

const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(env) });
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(env, { ok: true, service: "hivemindos-paid-agent-gateway", ...(statusPayload(env)) });
    }
    if (request.method === "GET" && url.pathname === "/api/platform-fees/config") {
      return json(env, publicPlatformFeePolicy(env));
    }
    if (request.method === "GET" && url.pathname === "/api/hyperliquid/builder-policy") {
      return json(env, publicHyperliquidBuilderPolicy(env));
    }

    const paidAgent = paidAgentRoute(url.pathname);
    if (!paidAgent) return json(env, { ok: false, error: "Not found." }, 404);

    const entry = findEntry(env, paidAgent.slug);
    if (!entry) return json(env, { ok: false, error: "Paid agent is not configured." }, 404);

    if (request.method === "GET") {
      return json(env, { ok: true, agent: publicAgentInfo(entry), missing: missingConfig(entry) });
    }
    if (request.method !== "POST") return json(env, { ok: false, error: "Method not allowed." }, 405);

    return processPaidAgentRequest(request, env, entry, url.pathname);
  },
};

export default worker;

async function processPaidAgentRequest(request: Request, env: Env, entry: PaidAgentEntry, path: string): Promise<Response> {
  const missing = missingConfig(entry);
  if (missing.length) {
    return json(env, { ok: false, error: "Paid agent gateway is not configured.", missing, agent: publicAgentInfo(entry) }, 424);
  }

  const idempotencyKey = headerValue(request.headers, "idempotency-key") || headerValue(request.headers, "x-idempotency-key");
  if (idempotencyKey) {
    const existing = await findReceiptByIdempotencyKey(env, entry.slug, idempotencyKey);
    if (existing) {
      return json(env, {
        ok: false,
        error: "Idempotency key has already been used for this paid agent.",
        receiptId: existing.id,
        transaction: existing.transaction_hash,
        createdAt: existing.created_at,
      }, 409);
    }
  }

  const body = await readCompletionBody(request, env);
  if ("response" in body) return body.response;

  const requestError = validateCompletionBody(body.parsed);
  if (requestError) return json(env, { ok: false, error: requestError }, 400);

  const payment = await verifyPayment(request, entry, path, body.parsed);
  if ("response" in payment) return withCors(payment.response, env);

  const upstream = await callUpstream(request, entry, body.raw);
  if (upstream.status >= 400) {
    await cancelVerifiedPayment(payment, `Upstream returned ${upstream.status}.`);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: withCorsHeaders(forwardedUpstreamResponseHeaders(upstream.headers), env),
    });
  }

  const receiptId = `pagw_${crypto.randomUUID()}`;
  const responseHeaders: Record<string, string> = {
    "Cache-Control": "no-store",
    "Content-Type": upstream.headers.get("content-type") || "application/json",
    "X-HivemindOS-Paid-Agent": entry.slug,
    "X-HivemindOS-Paid-Agent-Receipt": receiptId,
  };
  const settlement = await settlePayment(payment, upstream.body, responseHeaders);
  if (!settlement.success) {
    await writeReceipt(env, receiptId, entry, path, upstream.status, idempotencyKey, body.raw, settlement).catch(() => undefined);
    return withCors(instructionsToResponse(settlement.response), env);
  }

  await writeReceipt(env, receiptId, entry, path, upstream.status, idempotencyKey, body.raw, settlement).catch(() => undefined);
  const headers = forwardedUpstreamResponseHeaders(upstream.headers);
  for (const [key, value] of Object.entries(responseHeaders)) headers.set(key, value);
  for (const [key, value] of Object.entries(settlement.headers)) headers.set(key, value);
  return new Response(upstream.body, { status: 200, headers: withCorsHeaders(headers, env) });
}

async function verifyPayment(
  request: Request,
  entry: PaidAgentEntry,
  path: string,
  body: OpenAIChatCompletionBody,
): Promise<PaymentContext | { response: Response }> {
  const server = await paidAgentX402Server(entry, path);
  const context = requestContext(request, body);
  const result = await server.processHTTPRequest(context, {
    appName: "HivemindOS paid agent",
    currentUrl: request.url,
    testnet: entry.network !== BASE_MAINNET_NETWORK,
  });
  if (result.type === "payment-error") return { response: instructionsToResponse(result.response) };
  if (result.type === "no-payment-required") {
    return { response: jsonBare({ ok: false, error: "Paid route did not require payment." }, 500) };
  }
  return { kind: "x402", context, result, server };
}

async function paidAgentX402Server(entry: PaidAgentEntry, path: string) {
  const key = [entry.slug, path, entry.network, entry.payTo, entry.priceUsd, entry.facilitatorUrl, entry.builderCode].join("|");
  const cached = serverCache.get(key);
  if (cached) return cached;
  const next = createPaidAgentX402Server(entry, path);
  serverCache.set(key, next);
  return next;
}

async function createPaidAgentX402Server(entry: PaidAgentEntry, path: string) {
  const facilitator = new HTTPFacilitatorClient(facilitatorConfigForEntry(entry));
  const resourceServer = registerExactEvmScheme(new x402ResourceServer(facilitator), {
    networks: [entry.network],
  });
  if (entry.builderCode) {
    resourceServer.registerExtension(builderCodeResourceServerExtension);
  }
  const httpServer = new x402HTTPResourceServer(resourceServer, {
    [`POST ${path}`]: {
      accepts: {
        scheme: "exact",
        network: entry.network,
        payTo: entry.payTo,
        price: formatUsdPrice(entry.priceUsd),
      },
      resource: path,
      description: `${entry.description} (${entry.slug})`,
      mimeType: "application/json",
      extensions: builderCodeRouteExtensions(entry.builderCode),
      unpaidResponseBody: () => ({
        contentType: "application/json",
        body: { ok: false, error: "Payment required.", agent: publicAgentInfo(entry) },
      }),
      settlementFailedResponseBody: (_context, settleResult) => ({
        contentType: "application/json",
        body: { ok: false, error: settleResult.errorMessage || settleResult.errorReason || "x402 settlement failed." },
      }),
    },
  });
  await httpServer.initialize();
  return httpServer;
}

async function callUpstream(request: Request, entry: PaidAgentEntry, body: string): Promise<UpstreamResult> {
  const headers = forwardedUpstreamRequestHeaders(request.headers);
  headers.set("Content-Type", request.headers.get("content-type") || "application/json");
  headers.set("X-HivemindOS-Paid-Agent", entry.slug);
  if (entry.upstreamBearer) headers.set("Authorization", `Bearer ${entry.upstreamBearer}`);

  const response = await fetch(entry.upstreamUrl, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(entry.upstreamTimeoutMs),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
  };
}

async function settlePayment(
  payment: PaymentContext,
  responseBody: string,
  responseHeaders: Record<string, string>,
): Promise<ProcessSettleResultResponse> {
  return payment.server.processSettlement(
    payment.result.paymentPayload,
    payment.result.paymentRequirements,
    payment.result.declaredExtensions,
    {
      request: payment.context,
      responseBody: Buffer.from(responseBody, "utf8"),
      responseHeaders,
    },
  );
}

async function cancelVerifiedPayment(payment: PaymentContext, reason: string) {
  await payment.result.cancellationDispatcher.cancel({
    reason: "handler_failed",
    error: new Error(reason),
    responseStatus: 502,
  }).catch(() => undefined);
}

function requestContext(request: Request, body: OpenAIChatCompletionBody): HTTPRequestContext {
  const adapter = requestAdapter(request, body);
  return {
    adapter,
    path: adapter.getPath(),
    method: adapter.getMethod(),
    paymentHeader: adapter.getHeader("payment-signature") ?? adapter.getHeader("x-payment"),
  };
}

function requestAdapter(request: Request, body: OpenAIChatCompletionBody): HTTPAdapter {
  const url = new URL(request.url);
  return {
    getHeader: (name) => request.headers.get(name) ?? undefined,
    getMethod: () => request.method,
    getPath: () => url.pathname,
    getUrl: () => request.url,
    getAcceptHeader: () => request.headers.get("accept") ?? "",
    getUserAgent: () => request.headers.get("user-agent") ?? "",
    getQueryParams: () => queryParams(url),
    getQueryParam: (name) => queryParams(url)[name],
    getBody: () => body,
  };
}

function queryParams(url: URL): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const current = params[key];
    if (Array.isArray(current)) current.push(value);
    else if (typeof current === "string") params[key] = [current, value];
    else params[key] = value;
  }
  return params;
}

async function readCompletionBody(request: Request, env: Env): Promise<{ raw: string; parsed: OpenAIChatCompletionBody } | { response: Response }> {
  const raw = await request.text();
  if (raw.length > positiveInteger(env.HIVEMINDOS_PAID_AGENT_MAX_BODY_CHARS, DEFAULT_MAX_BODY_CHARS)) {
    return { response: json(env, { ok: false, error: "Request body is too large." }, 413) };
  }
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) {
    return { response: json(env, { ok: false, error: "Expected an OpenAI-compatible chat completion JSON body." }, 400) };
  }
  return { raw, parsed: parsed as OpenAIChatCompletionBody };
}

function validateCompletionBody(body: OpenAIChatCompletionBody) {
  if (!Array.isArray(body.messages) || body.messages.length === 0) return "messages must be a non-empty array.";
  if (!body.messages.some((message) => message?.role === "user" && messageText(message).trim())) {
    return "At least one user message with text is required.";
  }
  return "";
}

function statusPayload(env: Env) {
  const agents = entriesFromEnv(env).map((entry) => ({
    ...publicAgentInfo(entry),
    configured: missingConfig(entry).length === 0,
    missing: missingConfig(entry),
  }));
  return { agents };
}

function publicPlatformFeePolicy(env: Env) {
  const enabled = booleanValue(env.HIVEMINDOS_PLATFORM_FEES_ENABLED ?? env.HIVEMINDOS_TRADING_PLATFORM_FEES_ENABLED, false);
  const basisPoints = positiveNumber(env.HIVEMINDOS_PLATFORM_FEE_BPS ?? env.HIVEMINDOS_TRADING_PLATFORM_FEE_BPS, DEFAULT_PLATFORM_FEE_BPS);
  const minFeeUsd = positiveNumber(env.HIVEMINDOS_PLATFORM_MIN_FEE_USD ?? env.HIVEMINDOS_TRADING_PLATFORM_MIN_FEE_USD, DEFAULT_PLATFORM_MIN_FEE_USD);
  const maxFeeUsd = positiveNumber(env.HIVEMINDOS_PLATFORM_MAX_FEE_USD ?? env.HIVEMINDOS_TRADING_PLATFORM_MAX_FEE_USD, DEFAULT_PLATFORM_MAX_FEE_USD);
  const evm = normalizeEvmAddress(env.HIVEMINDOS_PLATFORM_FEE_RECIPIENT_EVM || env.HIVEMINDOS_PLATFORM_FEE_RECIPIENT || "");
  const solana = normalizeSolanaAddress(env.HIVEMINDOS_PLATFORM_FEE_RECIPIENT_SOLANA || env.HIVEMINDOS_PLATFORM_FEE_RECIPIENT_SVM || "");
  return {
    ok: true,
    service: "hivemindos-platform-fees",
    official: true,
    enabled,
    basisPoints,
    minFeeUsd,
    maxFeeUsd: maxFeeUsd > 0 ? maxFeeUsd : undefined,
    recipients: {
      ...(evm ? { evm } : {}),
      ...(solana ? { solana } : {}),
    },
    supportedSources: ["wallet-send", "dex-swap", "xstocks"],
    generatedAt: new Date().toISOString(),
  };
}

function publicHyperliquidBuilderPolicy(env: Env) {
  const builderAddress = normalizeEvmAddress(env.HIVEMINDOS_HYPERLIQUID_BUILDER_ADDRESS || "");
  const enabled = booleanValue(env.HIVEMINDOS_HYPERLIQUID_BUILDER_ENABLED, Boolean(builderAddress));
  const builderFeeTenthBps = builderFeeTenthBpsValue(env.HIVEMINDOS_HYPERLIQUID_BUILDER_FEE_TENTH_BPS, DEFAULT_HYPERLIQUID_BUILDER_FEE_TENTH_BPS);
  const maxBuilderFeeTenthBps = Math.max(
    builderFeeTenthBps,
    builderFeeTenthBpsValue(env.HIVEMINDOS_HYPERLIQUID_MAX_BUILDER_FEE_TENTH_BPS, builderFeeTenthBps),
  );
  const isTestnet = booleanValue(env.HIVEMINDOS_HYPERLIQUID_TESTNET, false);
  const missing = [
    ...(builderAddress ? [] : ["HIVEMINDOS_HYPERLIQUID_BUILDER_ADDRESS"]),
    ...(builderFeeTenthBps > 0 ? [] : ["HIVEMINDOS_HYPERLIQUID_BUILDER_FEE_TENTH_BPS"]),
  ];
  const configured = enabled && missing.length === 0;
  return {
    ok: true,
    service: "hivemindos-hyperliquid-builder-policy",
    official: true,
    enabled,
    configured,
    network: isTestnet ? "testnet" : "mainnet",
    builderAddress: configured ? builderAddress : undefined,
    builderFeeTenthBps,
    builderFeeBps: builderFeeTenthBps / 10,
    maxBuilderFeeTenthBps,
    maxBuilderFeeRate: builderFeeTenthBpsToPercentString(maxBuilderFeeTenthBps),
    apiUrl: env.HIVEMINDOS_HYPERLIQUID_API_URL || undefined,
    missing,
    detail: configured
      ? `Official HivemindOS Hyperliquid ${isTestnet ? "testnet" : "mainnet"} builder ${shortAddress(builderAddress)} charges ${formatBuilderFee(builderFeeTenthBps)} per perp fill.`
      : "Official HivemindOS Hyperliquid builder policy is not fully configured.",
    generatedAt: new Date().toISOString(),
  };
}

function findEntry(env: Env, slug: string) {
  return entriesFromEnv(env).find((entry) => entry.slug === normalizeSlug(slug));
}

function entriesFromEnv(env: Env): PaidAgentEntry[] {
  const catalog = parseJson(env.HIVEMINDOS_PAID_AGENT_CATALOG_JSON || "");
  const rawEntries = rawCatalogEntries(catalog);
  if (rawEntries.length) return rawEntries.map((raw, index) => entryFromRecord(env, raw, index));
  return [entryFromRecord(env, {}, 0)];
}

function entryFromRecord(env: Env, raw: Record<string, unknown>, index: number): PaidAgentEntry {
  const slug = normalizeSlug(stringField(raw.slug) || env.HIVEMINDOS_PAID_AGENT_SLUG || (index === 0 ? DEFAULT_SLUG : `${DEFAULT_SLUG}-${index + 1}`));
  const testnetMode = paidAgentTestnetMode(env);
  const network = (stringField(raw.network) || env.HIVEMINDOS_PAID_AGENT_NETWORK || defaultPaidAgentNetwork(testnetMode)) as Network;
  const configuredBuilderCode = network === BASE_MAINNET_NETWORK
    ? normalizeBuilderCode(stringField(raw.builderCode), `${slug}.builderCode`) ?? builderCodeFromEnv(env)
    : undefined;
  return {
    slug,
    description: stringField(raw.description) || env.HIVEMINDOS_PAID_AGENT_DESCRIPTION || "Official HivemindOS paid agent",
    priceUsd: positiveMoney(raw.priceUsd ?? env.HIVEMINDOS_PAID_AGENT_PRICE_USD, DEFAULT_PRICE_USD),
    network,
    payTo: stringField(raw.payTo) || env.HIVEMINDOS_PAID_AGENT_PAY_TO || "",
    facilitatorUrl: stringField(raw.facilitatorUrl) || env.HIVEMINDOS_PAID_AGENT_FACILITATOR_URL || defaultFacilitatorUrl(testnetMode),
    facilitatorBearer: stringField(raw.facilitatorBearer) || env.HIVEMINDOS_PAID_AGENT_FACILITATOR_BEARER || undefined,
    cdpApiKeyId: stringField(raw.cdpApiKeyId) || env.HIVEMINDOS_PAID_AGENT_CDP_API_KEY_ID || env.CDP_API_KEY_ID || undefined,
    cdpApiKeySecret: stringField(raw.cdpApiKeySecret) || env.HIVEMINDOS_PAID_AGENT_CDP_API_KEY_SECRET || env.CDP_API_KEY_SECRET || undefined,
    builderCode: configuredBuilderCode,
    upstreamUrl: stringField(raw.upstreamUrl) || env.HIVEMINDOS_PAID_AGENT_UPSTREAM_URL || "",
    upstreamBearer: stringField(raw.upstreamBearer) || env.HIVEMINDOS_PAID_AGENT_UPSTREAM_BEARER || undefined,
    upstreamTimeoutMs: positiveInteger(raw.upstreamTimeoutMs ?? env.HIVEMINDOS_PAID_AGENT_UPSTREAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

function publicAgentInfo(entry: PaidAgentEntry) {
  return {
    slug: entry.slug,
    description: entry.description,
    priceUsd: entry.priceUsd,
    network: entry.network,
    testnet: entry.network !== BASE_MAINNET_NETWORK,
    builderCode: entry.builderCode,
    cdpFacilitatorConfigured: usesCdpFacilitator(entry) ? Boolean(entry.cdpApiKeyId && entry.cdpApiKeySecret) : undefined,
    upstreamConfigured: Boolean(entry.upstreamUrl),
  };
}

function missingConfig(entry: PaidAgentEntry) {
  const missing: string[] = [];
  if (!entry.payTo) missing.push("HIVEMINDOS_PAID_AGENT_PAY_TO");
  if (!entry.facilitatorUrl) missing.push("HIVEMINDOS_PAID_AGENT_FACILITATOR_URL");
  if (usesCdpFacilitator(entry) && !entry.cdpApiKeyId) missing.push("CDP_API_KEY_ID");
  if (usesCdpFacilitator(entry) && !entry.cdpApiKeySecret) missing.push("CDP_API_KEY_SECRET");
  if (!entry.upstreamUrl) missing.push("HIVEMINDOS_PAID_AGENT_UPSTREAM_URL");
  return missing;
}

function paidAgentTestnetMode(env: Env) {
  return booleanValue(env.HIVEMINDOS_PAID_AGENT_TESTNET_MODE, false);
}

function defaultPaidAgentNetwork(testnetMode: boolean): Network {
  return (testnetMode ? BASE_SEPOLIA_NETWORK : DEFAULT_NETWORK) as Network;
}

function defaultFacilitatorUrl(testnetMode: boolean) {
  return testnetMode ? TESTNET_FACILITATOR_URL : CDP_FACILITATOR_URL;
}

function rawCatalogEntries(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  if (Array.isArray(value.agents)) return value.agents.filter(isRecord);
  return Object.values(value).filter(isRecord);
}

async function writeReceipt(
  env: Env,
  receiptId: string,
  entry: PaidAgentEntry,
  resource: string,
  upstreamStatus: number,
  idempotencyKey: string,
  requestBody: string,
  settlement: ProcessSettleResultResponse,
) {
  await env.DB.prepare(
    `INSERT INTO paid_agent_receipts (
      id, created_at, slug, resource, price_usd, network, payer, transaction_hash,
      payment_amount, settlement_success, upstream_status, idempotency_key,
      request_fingerprint, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    receiptId,
    new Date().toISOString(),
    entry.slug,
    resource,
    entry.priceUsd,
    entry.network,
    "payer" in settlement ? settlement.payer ?? null : null,
    "transaction" in settlement ? settlement.transaction ?? null : null,
    "amount" in settlement ? settlement.amount ?? null : null,
    settlement.success ? 1 : 0,
    upstreamStatus,
    idempotencyKey || null,
    await requestFingerprint(requestBody),
    JSON.stringify({
      builderCode: entry.builderCode,
      errorReason: settlement.success ? undefined : settlement.errorReason,
      errorMessage: settlement.success ? undefined : settlement.errorMessage,
    }),
  ).run();
}

function builderCodeFromEnv(env: Env) {
  return normalizeBuilderCode(env.HIVEMINDOS_PAID_AGENT_BUILDER_CODE, "HIVEMINDOS_PAID_AGENT_BUILDER_CODE")
    ?? normalizeBuilderCode(env.HIVEMINDOS_X402_SELLER_BUILDER_CODE, "HIVEMINDOS_X402_SELLER_BUILDER_CODE")
    ?? normalizeBuilderCode(env.HIVEMINDOS_X402_BUILDER_CODE, "HIVEMINDOS_X402_BUILDER_CODE");
}

function normalizeBuilderCode(value: unknown, source: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!BUILDER_CODE_PATTERN.test(trimmed)) {
    throw new Error(`${source} must be 1-32 lowercase letters, digits, or underscores.`);
  }
  return trimmed;
}

function builderCodeRouteExtensions(builderCode?: string): Record<string, unknown> | undefined {
  return builderCode ? { [BUILDER_CODE]: declareBuilderCodeExtension(builderCode) } : undefined;
}

function facilitatorConfigForEntry(entry: PaidAgentEntry) {
  if (usesCdpFacilitator(entry)) {
    return createFacilitatorConfig(entry.cdpApiKeyId, entry.cdpApiKeySecret);
  }
  return {
    url: entry.facilitatorUrl,
    ...(entry.facilitatorBearer ? {
      createAuthHeaders: async () => ({
        verify: { Authorization: `Bearer ${entry.facilitatorBearer}` },
        settle: { Authorization: `Bearer ${entry.facilitatorBearer}` },
        supported: { Authorization: `Bearer ${entry.facilitatorBearer}` },
      }),
    } : {}),
  };
}

function usesCdpFacilitator(entry: Pick<PaidAgentEntry, "facilitatorUrl">) {
  return normalizeUrl(entry.facilitatorUrl) === CDP_FACILITATOR_URL;
}

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function booleanValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

async function findReceiptByIdempotencyKey(env: Env, slug: string, idempotencyKey: string): Promise<ReceiptRow | null> {
  const result = await env.DB.prepare(
    "SELECT id, created_at, transaction_hash FROM paid_agent_receipts WHERE slug = ? AND idempotency_key = ? LIMIT 1",
  ).bind(slug, idempotencyKey).first<ReceiptRow>();
  return result ?? null;
}

async function requestFingerprint(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function instructionsToResponse(instructions: HTTPResponseInstructions): Response {
  const headers = new Headers(instructions.headers);
  if (instructions.isHtml) {
    headers.set("Content-Type", headers.get("Content-Type") || "text/html; charset=utf-8");
    return new Response(String(instructions.body ?? ""), { status: instructions.status, headers });
  }
  if (typeof instructions.body === "string") {
    return new Response(instructions.body, { status: instructions.status, headers });
  }
  headers.set("Content-Type", headers.get("Content-Type") || "application/json");
  return new Response(JSON.stringify(instructions.body ?? {}), { status: instructions.status, headers });
}

function paidAgentRoute(pathname: string) {
  const match = pathname.match(/^\/api\/paid-agents\/([^/]+)\/chat\/completions\/?$/);
  return match ? { slug: normalizeSlug(match[1]) } : null;
}

function forwardedUpstreamRequestHeaders(source: Headers) {
  const headers = new Headers();
  for (const name of ["accept", "user-agent", "idempotency-key", "x-idempotency-key"]) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function forwardedUpstreamResponseHeaders(source: Headers) {
  const headers = new Headers();
  const contentType = source.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  return headers;
}

function withCors(response: Response, env: Env) {
  return new Response(response.body, {
    status: response.status,
    headers: withCorsHeaders(response.headers, env),
  });
}

function withCorsHeaders(headers: Headers, env: Env) {
  const next = new Headers(headers);
  for (const [key, value] of Object.entries(corsHeaders(env))) next.set(key, value);
  return next;
}

function corsHeaders(env: Env) {
  return {
    "Access-Control-Allow-Origin": env.CORS_ORIGIN ?? "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,Payment-Signature,PAYMENT-SIGNATURE,X-PAYMENT,X-Payment,X402-Version,Idempotency-Key,X-Idempotency-Key",
    "Access-Control-Expose-Headers": "PAYMENT-RESPONSE,Payment-Response,X-PAYMENT-RESPONSE,X-HivemindOS-Paid-Agent,X-HivemindOS-Paid-Agent-Receipt",
  };
}

function json(env: Env, body: unknown, status = 200) {
  return withCors(jsonBare(body, status), env);
}

function jsonBare(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function messageText(message: OpenAIMessage) {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.map((part) => isRecord(part) ? stringField(part.text) : "").join("\n");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeSlug(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || DEFAULT_SLUG;
}

function formatUsdPrice(value: number) {
  return `$${roundSix(value).toFixed(6).replace(/\.?0+$/, "")}`;
}

function positiveMoney(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? roundSix(numeric) : fallback;
}

function positiveInteger(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function builderFeeTenthBpsValue(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) return fallback;
  return Math.min(numeric, MAX_HYPERLIQUID_PERP_BUILDER_FEE_TENTH_BPS);
}

function builderFeeTenthBpsToPercentString(feeTenthBps: number) {
  return `${trimFixed(Math.max(0, feeTenthBps) / 1000, 3)}%`;
}

function formatBuilderFee(feeTenthBps: number) {
  const bps = feeTenthBps / 10;
  return `${trimFixed(bps, 1)} bps (${builderFeeTenthBpsToPercentString(feeTenthBps)})`;
}

function trimFixed(value: number, decimals: number) {
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

function shortAddress(value?: string) {
  if (!value) return "(none)";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function normalizeEvmAddress(value: string) {
  const trimmed = value.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed : "";
}

function normalizeSolanaAddress(value: string) {
  const trimmed = value.trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed) ? trimmed : "";
}

function roundSix(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function headerValue(headers: Headers, name: string) {
  return headers.get(name)?.trim() || "";
}

function stringField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
