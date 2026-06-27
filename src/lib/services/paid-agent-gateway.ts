import "server-only";

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createFacilitatorConfig } from "@coinbase/x402";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
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
  builderCodeResourceServerExtension,
  declareBuilderCodeExtension,
} from "@x402/extensions/builder-code";
import type { NextRequest } from "next/server";

import { homedir } from "@/lib/home-dir";
import {
  createAgentProfile,
  HIVEMIND_OS_RUNTIME,
  normalizeAgentRuntime,
  type AgentProfile,
  type AgentRuntime,
  type SharedVaultConfig,
} from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import {
  getManagedAgentBillingConfig,
  recordManagedAgentCredit,
  recordManagedAgentDebit,
  type ManagedAgentQuote,
} from "@/lib/services/managed-agent-billing";
import { recordTelemetryBatch } from "@/lib/services/telemetry/local-telemetry";
import {
  normalizeX402BuilderCodeForNetwork,
  X402_SELLER_BUILDER_CODE_ENV_KEYS,
  x402BuilderCodeFromEnvForNetwork,
} from "@/lib/services/wallet/x402-builder-code";

const DEFAULT_SLUG = "default";
const BASE_MAINNET_NETWORK = "eip155:8453";
const BASE_SEPOLIA_NETWORK = "eip155:84532";
const DEFAULT_NETWORK = "eip155:8453";
const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const TESTNET_FACILITATOR_URL = "https://x402.org/facilitator";
const DEFAULT_PRICE_USD = 0.05;
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_MESSAGES = 64;
const DEFAULT_MAX_CONTENT_CHARS = 200_000;
const RECEIPT_PATH = join(homedir(), ".hivemindos", "paid-agent-gateway", "receipts.jsonl");
const SELLER_MODE_ENV = "HIVEMINDOS_PAID_AGENT_SELLER_MODE";

type PaidAgentSellerMode = "hosted" | "self-hosted" | "development";

export const PAID_AGENT_RUNTIME_MATRIX = [
  {
    runtime: HIVEMIND_OS_RUNTIME,
    status: "recommended",
    rails: ["x402", "managed-HONEY", "HIVE-funded-Bankr", "UsePod"],
    notes: "Best default for OpenAI-compatible model hosts, local runtimes, Bankr LLM, Venice, UsePod, OpenRouter, and Hive Fusion.",
  },
  {
    runtime: "hermes",
    status: "allowed-with-profile",
    rails: ["x402", "managed-HONEY"],
    notes: "Use for curated chat/workflow agents; expose wallet tools or workspace actions only when the paid-agent profile explicitly enables them.",
  },
  {
    runtime: "openclaw",
    status: "allowed-with-gateway",
    rails: ["x402", "managed-HONEY"],
    notes: "Good for a dedicated OpenClaw HTTP gateway, not for raw local workspace side effects.",
  },
  {
    runtime: "codex",
    status: "internal-by-default",
    rails: ["managed-HONEY"],
    notes: "Keep as managed jobs with explicit workspace/task scope instead of public per-call chat.",
  },
  {
    runtime: "claude-code",
    status: "internal-by-default",
    rails: ["managed-HONEY"],
    notes: "Keep as managed jobs with explicit workspace/task scope instead of public per-call chat.",
  },
  {
    runtime: "opencode",
    status: "internal-by-default",
    rails: ["managed-HONEY"],
    notes: "Keep as managed jobs with explicit workspace/task scope instead of public per-call chat.",
  },
  {
    runtime: "openhands",
    status: "internal-by-default",
    rails: ["managed-HONEY"],
    notes: "Keep as managed jobs with explicit workspace/task scope instead of public per-call chat.",
  },
] as const;

export const PAID_AGENT_MODEL_PROVIDER_MATRIX = [
  {
    provider: "lm-studio",
    rail: "x402",
    notes: "Local OpenAI-compatible models behind HivemindOS; charge externally per call.",
  },
  {
    provider: "bankr",
    rail: "HIVE-funded Bankr credits or managed HONEY",
    notes: "Useful when the operator or user funds Bankr LLM credits with HIVE/Bankr rails.",
  },
  {
    provider: "venice",
    rail: "x402 or managed HONEY",
    notes: "Privacy-oriented hosted inference through the server-side provider key.",
  },
  {
    provider: "usepod",
    rail: "UsePod prepaid credits or x402",
    notes: "Good for marketplace-hosted models and provider-managed paid inference.",
  },
  {
    provider: "openrouter",
    rail: "x402 or managed HONEY",
    notes: "Broad hosted model catalog; keep provider keys server-side.",
  },
  {
    provider: "hive-fusion",
    rail: "x402 or managed HONEY",
    notes: "Compound-model routing over configured server-side providers.",
  },
] as const;

type OpenAIContentPart = {
  type?: string;
  text?: string;
  image_url?: { url?: string };
  file?: { filename?: string; file_data?: string };
};

type OpenAIMessage = {
  role?: string;
  content?: string | OpenAIContentPart[];
};

type RuntimeMessage = {
  role: string;
  content: string | Array<{
    type: string;
    text?: string;
    image_url?: { url?: string };
    file?: { filename?: string; file_data?: string };
  }>;
};

type OpenAIChatCompletionBody = {
  messages?: OpenAIMessage[];
  model?: string;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
};

type PaidAgentCatalogEntry = {
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
  maxTimeoutSeconds: number;
  agent: AgentProfile;
  wallet?: AgentWalletConfig;
  sharedVault?: SharedVaultConfig;
  honeyLedgerEnabled: boolean;
  mirrorManagedHoney: boolean;
  allowClientModelSelection: boolean;
  allowedModels: string[];
};

type GatewayStatus = {
  enabled: boolean;
  requestedEnabled: boolean;
  sellerMode: PaidAgentSellerMode;
  localGatewayAllowed: boolean;
  configured: boolean;
  missing: string[];
  agents: Array<ReturnType<typeof publicAgentInfo>>;
  runtimeMatrix: typeof PAID_AGENT_RUNTIME_MATRIX;
  modelProviderMatrix: typeof PAID_AGENT_MODEL_PROVIDER_MATRIX;
};

type PaymentContext = {
  kind: "x402";
  context: HTTPRequestContext;
  result: Extract<HTTPProcessResult, { type: "payment-verified" }>;
  server: x402HTTPResourceServer;
} | {
  kind: "dev-bypass";
};

type CompletionResult = {
  content: string;
  raw: string;
  contentType: string;
};

type GatewayReceipt = {
  id: string;
  createdAt: string;
  slug: string;
  agentId: string;
  agentName: string;
  runtime: string;
  provider: string;
  model: string;
  priceUsd: number;
  network: string;
  settlement?: {
    success: boolean;
    transaction?: string;
    payer?: string;
    amount?: string;
    network?: string;
    errorReason?: string;
  };
  honey?: {
    mirrored: boolean;
    creditEventId?: string;
    debitEventId?: string;
    error?: string;
  };
  durationMs: number;
  inputChars: number;
  outputChars: number;
};

let serverCacheKey = "";
let serverCachePromise: Promise<x402HTTPResourceServer> | null = null;

export async function getPaidAgentGatewayStatus(slug?: string): Promise<GatewayStatus> {
  const catalog = await loadPaidAgentCatalog();
  const filtered = slug ? catalog.entries.filter((entry) => entry.slug === slug) : catalog.entries;
  const missing = filtered.length > 0
    ? uniqueStrings(filtered.flatMap(missingPaymentConfig))
    : [...catalog.missing];
  if (slug && filtered.length === 0) missing.push(`paid agent '${slug}'`);
  return {
    enabled: catalog.enabled,
    requestedEnabled: catalog.requestedEnabled,
    sellerMode: catalog.sellerMode,
    localGatewayAllowed: catalog.localGatewayAllowed,
    configured: catalog.enabled && filtered.length > 0 && missing.length === 0,
    missing,
    agents: filtered.map(publicAgentInfo),
    runtimeMatrix: PAID_AGENT_RUNTIME_MATRIX,
    modelProviderMatrix: PAID_AGENT_MODEL_PROVIDER_MATRIX,
  };
}

export async function processPaidAgentGatewayRequest(request: NextRequest, slug: string): Promise<Response> {
  const startedAt = Date.now();
  const normalizedSlug = normalizeSlug(slug);
  const catalog = await loadPaidAgentCatalog();
  const entry = catalog.entries.find((candidate) => candidate.slug === normalizedSlug);

  if (catalog.requestedEnabled && !catalog.localGatewayAllowed) {
    return jsonResponse({
      ok: false,
      error: "Local paid-agent seller gateway is not enabled for this distribution mode.",
      reason: "Downloaded apps must call a hosted HivemindOS paid-agent endpoint for official monetization. A local payTo is user-controlled and can only be trusted for explicit self-hosted seller mode.",
      required: `${SELLER_MODE_ENV}=self-hosted`,
    }, 403);
  }
  if (!catalog.enabled) {
    return jsonResponse({ ok: false, error: "Paid agent gateway is disabled." }, 404);
  }
  if (!entry) {
    return jsonResponse({ ok: false, error: "Paid agent is not configured." }, 404);
  }
  const missing = missingPaymentConfig(entry);
  if (missing.length > 0 && !devBypassAllowed(request, entry)) {
    return jsonResponse({
      ok: false,
      error: "Paid agent x402 settlement is not configured.",
      missing,
      agent: publicAgentInfo(entry),
    }, 424);
  }

  const body = await readCompletionBody(request);
  const messages = normalizeMessages(body.messages);
  const requestError = validateCompletionRequest(messages);
  if (requestError) return jsonResponse({ ok: false, error: requestError }, 400);

  const profile = profileForRequest(entry, body);
  const payment = await verifyPaymentOrBypass(request, entry, body);
  if ("response" in payment) return payment.response;

  let completion: CompletionResult;
  try {
    completion = await callAgentRuntime(request, entry, profile, messages);
  } catch (error) {
    await cancelVerifiedPayment(payment, error);
    await recordPaidGatewayTelemetry("paid_agent_gateway.runtime_failed", entry, startedAt, {
      error: error instanceof Error ? error.message : "unknown",
    });
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "Agent runtime call failed." }, 502);
  }

  const receiptId = `pag_${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const responseHeaders: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-HivemindOS-Paid-Agent": entry.slug,
    "X-HivemindOS-Paid-Agent-Receipt": receiptId,
  };
  const finalBody = openAICompletionPayload({
    id: receiptId,
    created,
    profile,
    entry,
    content: completion.content,
  });
  const responseBody = body.stream === true
    ? streamCompletionPayload({ id: receiptId, created, profile, content: completion.content })
    : `${JSON.stringify(finalBody)}\n`;
  const settlement = await settlePayment(payment, responseBody, responseHeaders);
  if (settlement && !settlement.success) {
    await recordPaidGatewayTelemetry("paid_agent_gateway.settlement_failed", entry, startedAt, {
      errorReason: settlement.errorReason,
      errorMessage: settlement.errorMessage,
    });
    return instructionsToResponse(settlement.response);
  }

  const settledHeaders = {
    ...responseHeaders,
    ...(settlement?.headers ?? {}),
    "Content-Type": body.stream === true ? "text/event-stream" : "application/json",
  };
  const honey = await mirrorManagedHoneyIfEnabled(entry, receiptId, settlement, completion);
  await writeReceipt({
    id: receiptId,
    createdAt: new Date().toISOString(),
    slug: entry.slug,
    agentId: profile.id,
    agentName: profile.name,
    runtime: String(profile.runtime),
    provider: profile.provider ?? "",
    model: profile.model ?? "",
    priceUsd: entry.priceUsd,
    network: entry.network,
    settlement: settlement ? {
      success: settlement.success,
      transaction: settlement.transaction,
      payer: settlement.payer,
      amount: settlement.amount,
      network: settlement.network,
      errorReason: settlement.errorReason,
    } : { success: true, transaction: "dev-bypass" },
    honey,
    durationMs: Date.now() - startedAt,
    inputChars: messages.reduce((total, message) => total + messageText(message).length, 0),
    outputChars: completion.content.length,
  });
  await recordPaidGatewayTelemetry("paid_agent_gateway.completed", entry, startedAt, {
    receiptId,
    stream: body.stream === true,
    outputChars: completion.content.length,
    settlementNetwork: settlement?.network ?? entry.network,
    settlementTransactionSet: Boolean(settlement?.transaction),
    honeyMirrored: honey?.mirrored === true,
  });

  return new Response(responseBody, { status: 200, headers: settledHeaders });
}

async function loadPaidAgentCatalog(): Promise<{
  enabled: boolean;
  requestedEnabled: boolean;
  sellerMode: PaidAgentSellerMode;
  localGatewayAllowed: boolean;
  missing: string[];
  entries: PaidAgentCatalogEntry[];
}> {
  const requestedEnabled = booleanEnv("HIVEMINDOS_PAID_AGENT_GATEWAY_ENABLED", false);
  const sellerMode = paidAgentSellerMode();
  const localGatewayAllowed = sellerModeAllowsLocalGateway(sellerMode);
  const enabled = requestedEnabled && localGatewayAllowed;
  const catalogJson = await optionalJsonFromEnv("HIVEMINDOS_PAID_AGENT_CATALOG_JSON", "HIVEMINDOS_PAID_AGENT_CATALOG_PATH");
  const rawEntries = rawCatalogEntries(catalogJson);
  const entries = rawEntries.length > 0
    ? await Promise.all(rawEntries.map((raw, index) => entryFromRaw(raw, index)))
    : [await defaultEntryFromEnv()];
  const missing = [
    ...(!localGatewayAllowed && requestedEnabled ? [`${SELLER_MODE_ENV}=self-hosted`] : []),
    ...entries.flatMap(missingPaymentConfig),
  ];
  return { enabled, requestedEnabled, sellerMode, localGatewayAllowed, missing: uniqueStrings(missing), entries };
}

async function defaultEntryFromEnv(): Promise<PaidAgentCatalogEntry> {
  const slug = normalizeSlug(process.env.HIVEMINDOS_PAID_AGENT_SLUG || DEFAULT_SLUG);
  const testnetMode = paidAgentTestnetMode();
  const network = networkEnv(process.env.HIVEMINDOS_PAID_AGENT_NETWORK || defaultPaidAgentNetwork(testnetMode));
  const agent = await loadAgentProfile(slug, {
    agent: await optionalJsonFromEnv("HIVEMINDOS_PAID_AGENT_PROFILE_JSON", "HIVEMINDOS_PAID_AGENT_PROFILE_PATH", "HIVE_AGENT_PROFILE_JSON"),
    runtime: process.env.HIVEMINDOS_PAID_AGENT_RUNTIME,
    gatewayUrl: process.env.HIVEMINDOS_PAID_AGENT_RUNTIME_URL || process.env.HIVEMINDOS_PAID_AGENT_GATEWAY_URL,
    provider: process.env.HIVEMINDOS_PAID_AGENT_PROVIDER,
    model: process.env.HIVEMINDOS_PAID_AGENT_MODEL,
  });
  return {
    slug,
    description: process.env.HIVEMINDOS_PAID_AGENT_DESCRIPTION?.trim() || "Paid HivemindOS agent",
    priceUsd: positiveMoney(process.env.HIVEMINDOS_PAID_AGENT_PRICE_USD, DEFAULT_PRICE_USD),
    network,
    payTo: process.env.HIVEMINDOS_PAID_AGENT_PAY_TO?.trim() || "",
    facilitatorUrl: process.env.HIVEMINDOS_PAID_AGENT_FACILITATOR_URL?.trim() || defaultFacilitatorUrl(testnetMode),
    facilitatorBearer: process.env.HIVEMINDOS_PAID_AGENT_FACILITATOR_BEARER?.trim() || undefined,
    cdpApiKeyId: process.env.HIVEMINDOS_PAID_AGENT_CDP_API_KEY_ID?.trim() || process.env.CDP_API_KEY_ID?.trim() || undefined,
    cdpApiKeySecret: process.env.HIVEMINDOS_PAID_AGENT_CDP_API_KEY_SECRET?.trim() || process.env.CDP_API_KEY_SECRET?.trim() || undefined,
    builderCode: x402BuilderCodeFromEnvForNetwork(network, X402_SELLER_BUILDER_CODE_ENV_KEYS),
    maxTimeoutSeconds: positiveInteger(process.env.HIVEMINDOS_PAID_AGENT_MAX_TIMEOUT_SECONDS, 600),
    agent,
    wallet: objectFromUnknown<AgentWalletConfig>(await optionalJsonFromEnv("HIVEMINDOS_PAID_AGENT_WALLET_JSON")),
    sharedVault: objectFromUnknown<SharedVaultConfig>(await optionalJsonFromEnv("HIVEMINDOS_PAID_AGENT_SHARED_VAULT_JSON")),
    honeyLedgerEnabled: booleanEnv("HIVEMINDOS_PAID_AGENT_REWARD_HONEY_ENABLED", false),
    mirrorManagedHoney: booleanEnv("HIVEMINDOS_PAID_AGENT_MIRROR_MANAGED_HONEY", false),
    allowClientModelSelection: booleanEnv("HIVEMINDOS_PAID_AGENT_ALLOW_CLIENT_MODEL", false),
    allowedModels: listEnv("HIVEMINDOS_PAID_AGENT_ALLOWED_MODELS"),
  };
}

async function entryFromRaw(raw: unknown, index: number): Promise<PaidAgentCatalogEntry> {
  const record = isRecord(raw) ? raw : {};
  const slug = normalizeSlug(stringField(record.slug) || `${DEFAULT_SLUG}-${index + 1}`);
  const testnetMode = paidAgentTestnetMode();
  const network = networkEnv(stringField(record.network) || process.env.HIVEMINDOS_PAID_AGENT_NETWORK || defaultPaidAgentNetwork(testnetMode));
  const configuredBuilderCode = normalizeX402BuilderCodeForNetwork(network, stringField(record.builderCode), `${slug}.builderCode`)
    ?? x402BuilderCodeFromEnvForNetwork(network, X402_SELLER_BUILDER_CODE_ENV_KEYS);
  const agent = await loadAgentProfile(slug, {
    agent: record.agent,
    runtime: stringField(record.runtime),
    gatewayUrl: stringField(record.gatewayUrl),
    provider: stringField(record.provider),
    model: stringField(record.model),
  });
  return {
    slug,
    description: stringField(record.description) || `Paid HivemindOS agent ${index + 1}`,
    priceUsd: positiveMoney(record.priceUsd, DEFAULT_PRICE_USD),
    network,
    payTo: stringField(record.payTo) || process.env.HIVEMINDOS_PAID_AGENT_PAY_TO?.trim() || "",
    facilitatorUrl: stringField(record.facilitatorUrl) || process.env.HIVEMINDOS_PAID_AGENT_FACILITATOR_URL?.trim() || defaultFacilitatorUrl(testnetMode),
    facilitatorBearer: stringField(record.facilitatorBearer) || process.env.HIVEMINDOS_PAID_AGENT_FACILITATOR_BEARER?.trim() || undefined,
    cdpApiKeyId: stringField(record.cdpApiKeyId) || process.env.HIVEMINDOS_PAID_AGENT_CDP_API_KEY_ID?.trim() || process.env.CDP_API_KEY_ID?.trim() || undefined,
    cdpApiKeySecret: stringField(record.cdpApiKeySecret) || process.env.HIVEMINDOS_PAID_AGENT_CDP_API_KEY_SECRET?.trim() || process.env.CDP_API_KEY_SECRET?.trim() || undefined,
    builderCode: configuredBuilderCode,
    maxTimeoutSeconds: positiveInteger(record.maxTimeoutSeconds, 600),
    agent,
    wallet: objectFromUnknown<AgentWalletConfig>(record.wallet),
    sharedVault: objectFromUnknown<SharedVaultConfig>(record.sharedVault),
    honeyLedgerEnabled: booleanField(record.honeyLedgerEnabled, false),
    mirrorManagedHoney: booleanField(record.mirrorManagedHoney, false),
    allowClientModelSelection: booleanField(record.allowClientModelSelection, false),
    allowedModels: arrayOfStrings(record.allowedModels),
  };
}

async function loadAgentProfile(slug: string, input: {
  agent?: unknown;
  runtime?: unknown;
  gatewayUrl?: unknown;
  provider?: unknown;
  model?: unknown;
}): Promise<AgentProfile> {
  const runtime = normalizeAgentRuntime(stringField(input.runtime) || stringField(isRecord(input.agent) ? input.agent.runtime : undefined) || HIVEMIND_OS_RUNTIME);
  const base = createAgentProfile(runtime as AgentRuntime, 1);
  const rawAgent = isRecord(input.agent) ? input.agent : {};
  const profile = {
    ...base,
    ...rawAgent,
    id: stringField(rawAgent.id) || `paid-agent-${slug}`,
    name: stringField(rawAgent.name) || `Paid ${base.name}`,
    runtime,
    gatewayUrl: stringField(input.gatewayUrl) || stringField(rawAgent.gatewayUrl) || base.gatewayUrl,
    provider: stringField(input.provider) || stringField(rawAgent.provider) || base.provider,
    model: stringField(input.model) || stringField(rawAgent.model) || base.model,
    useSharedVault: booleanField(rawAgent.useSharedVault, false),
  };
  return profile;
}

function rawCatalogEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (Array.isArray(value.agents)) return value.agents;
  return Object.values(value).filter(isRecord);
}

async function readCompletionBody(request: NextRequest): Promise<OpenAIChatCompletionBody> {
  const body = await request.json().catch(() => null) as unknown;
  if (!isRecord(body)) throw Object.assign(new Error("Expected an OpenAI-compatible chat completion body."), { status: 400 });
  return {
    messages: Array.isArray(body.messages) ? body.messages as OpenAIMessage[] : undefined,
    model: stringField(body.model) || undefined,
    stream: body.stream === true,
    temperature: typeof body.temperature === "number" ? body.temperature : undefined,
    max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
  };
}

function normalizeMessages(messages: OpenAIMessage[] | undefined): RuntimeMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.slice(0, maxMessages()).map((message) => ({
    role: normalizeRole(message.role),
    content: normalizeContent(message.content),
  }));
}

function normalizeRole(role: unknown) {
  if (role === "system" || role === "assistant" || role === "user" || role === "developer") return role;
  return "user";
}

function normalizeContent(content: OpenAIMessage["content"]): RuntimeMessage["content"] {
  if (typeof content === "string") return content.slice(0, maxContentChars());
  if (!Array.isArray(content)) return "";
  return content.slice(0, 64).map((part) => ({
    type: stringField(part.type) || "text",
    text: stringField(part.text).slice(0, maxContentChars()),
    image_url: part.image_url && typeof part.image_url.url === "string" ? { url: part.image_url.url } : undefined,
    file: part.file && typeof part.file.file_data === "string"
      ? { filename: stringField(part.file.filename), file_data: part.file.file_data }
      : undefined,
  }));
}

function validateCompletionRequest(messages: RuntimeMessage[]) {
  if (!messages.length) return "messages must be a non-empty array.";
  if (!messages.some((message) => message.role === "user" && messageText(message).trim())) {
    return "At least one user message with text is required.";
  }
  const totalChars = messages.reduce((total, message) => total + messageText(message).length, 0);
  if (totalChars > maxContentChars()) return `Request content exceeds ${maxContentChars()} characters.`;
  return "";
}

function profileForRequest(entry: PaidAgentCatalogEntry, body: OpenAIChatCompletionBody): AgentProfile {
  const requestedModel = body.model?.trim();
  const modelAllowed = requestedModel
    && entry.allowClientModelSelection
    && (entry.allowedModels.length === 0 || entry.allowedModels.includes(requestedModel));
  return modelAllowed ? { ...entry.agent, model: requestedModel } : entry.agent;
}

async function verifyPaymentOrBypass(
  request: NextRequest,
  entry: PaidAgentCatalogEntry,
  body: OpenAIChatCompletionBody,
): Promise<PaymentContext | { response: Response }> {
  if (devBypassAllowed(request, entry)) return { kind: "dev-bypass" };
  const server = await paidAgentX402Server(entry, request.nextUrl.pathname);
  const context = requestContext(request, body);
  const result = await server.processHTTPRequest(context, {
    appName: "HivemindOS paid agent",
    currentUrl: request.url,
    testnet: entry.network !== DEFAULT_NETWORK,
  });
  if (result.type === "payment-error") return { response: instructionsToResponse(result.response) };
  if (result.type === "no-payment-required") return { kind: "dev-bypass" };
  return { kind: "x402", context, result, server };
}

async function paidAgentX402Server(entry: PaidAgentCatalogEntry, path: string): Promise<x402HTTPResourceServer> {
  const key = [
    entry.slug,
    path,
    entry.network,
    entry.payTo,
    entry.priceUsd,
    entry.facilitatorUrl,
    entry.maxTimeoutSeconds,
    entry.builderCode,
  ].join("|");
  if (serverCachePromise && serverCacheKey === key) return serverCachePromise;
  serverCacheKey = key;
  serverCachePromise = createPaidAgentX402Server(entry, path);
  return serverCachePromise;
}

async function createPaidAgentX402Server(entry: PaidAgentCatalogEntry, path: string): Promise<x402HTTPResourceServer> {
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
        maxTimeoutSeconds: entry.maxTimeoutSeconds,
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
        body: {
          ok: false,
          error: settleResult.errorMessage || settleResult.errorReason || "x402 settlement failed.",
          agent: publicAgentInfo(entry),
        },
      }),
    },
  });
  await httpServer.initialize();
  return httpServer;
}

async function callAgentRuntime(
  request: NextRequest,
  entry: PaidAgentCatalogEntry,
  profile: AgentProfile,
  messages: RuntimeMessage[],
): Promise<CompletionResult> {
  const response = await fetch(new URL("/api/chat/agent-runtime", request.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-HivemindOS-Paid-Agent-Gateway": entry.slug,
    },
    body: JSON.stringify({
      agent: profile,
      messages,
      wallet: entry.wallet,
      sharedVault: entry.sharedVault,
      honeyLedgerEnabled: entry.honeyLedgerEnabled,
      agentMode: "act",
      clientRunId: `paid-agent-${entry.slug}-${Date.now().toString(36)}`,
    }),
    signal: AbortSignal.timeout(positiveInteger(process.env.HIVEMINDOS_PAID_AGENT_RUNTIME_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
    cache: "no-store",
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(runtimeError(raw, response.status));
  }
  const contentType = response.headers.get("content-type") ?? "";
  const content = contentType.includes("text/event-stream")
    ? collectSseText(raw)
    : collectJsonText(raw);
  if (!content.trim()) throw new Error("Agent runtime returned an empty response.");
  return { content, raw, contentType };
}

async function settlePayment(
  payment: PaymentContext,
  responseBody: string,
  responseHeaders: Record<string, string>,
): Promise<ProcessSettleResultResponse | null> {
  if (payment.kind !== "x402") return null;
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

async function cancelVerifiedPayment(payment: PaymentContext, error: unknown) {
  if (payment.kind !== "x402") return;
  await payment.result.cancellationDispatcher.cancel({
    reason: "handler_failed",
    error,
    responseStatus: 502,
  }).catch(() => undefined);
}

async function mirrorManagedHoneyIfEnabled(
  entry: PaidAgentCatalogEntry,
  receiptId: string,
  settlement: ProcessSettleResultResponse | null,
  completion: CompletionResult,
): Promise<GatewayReceipt["honey"]> {
  if (!entry.mirrorManagedHoney) return { mirrored: false };
  try {
    const config = getManagedAgentBillingConfig();
    const honeyAmount = Math.max(0.000001, roundSix(entry.priceUsd * config.honeyCreditsPerUsd));
    const quote: ManagedAgentQuote = {
      intent: "chat",
      provider: "x402",
      sku: "paid-agent-x402-call",
      units: 1,
      unit: "call",
      upstreamUsd: entry.priceUsd,
      markupBps: 0,
      retailUsd: entry.priceUsd,
      honeyAmount,
      honeyCreditsPerUsd: config.honeyCreditsPerUsd,
      explanation: "x402 per-call settlement mirrored into managed HONEY for operator accounting.",
    };
    const transaction = settlement?.transaction || receiptId;
    const credit = await recordManagedAgentCredit({
      agentId: entry.agent.id,
      amountUsd: entry.priceUsd,
      rail: "x402",
      idempotencyKey: `paid-agent:${entry.slug}:${transaction}:credit`,
      metadata: { receiptId, transaction, outputChars: completion.content.length },
    });
    const debit = await recordManagedAgentDebit({
      agentId: entry.agent.id,
      quote,
      idempotencyKey: `paid-agent:${entry.slug}:${transaction}:debit`,
      metadata: { receiptId, transaction, outputChars: completion.content.length },
    });
    return {
      mirrored: true,
      creditEventId: credit.event?.id,
      debitEventId: debit.event?.id,
    };
  } catch (error) {
    return {
      mirrored: false,
      error: error instanceof Error ? error.message : "Managed HONEY mirror failed.",
    };
  }
}

function requestContext(request: NextRequest, body: OpenAIChatCompletionBody): HTTPRequestContext {
  const adapter = nextRequestAdapter(request, body);
  return {
    adapter,
    path: adapter.getPath(),
    method: adapter.getMethod(),
    paymentHeader: adapter.getHeader("x-payment") ?? adapter.getHeader("X-PAYMENT"),
  };
}

function nextRequestAdapter(request: NextRequest, body: OpenAIChatCompletionBody): HTTPAdapter {
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

function openAICompletionPayload(input: {
  id: string;
  created: number;
  profile: AgentProfile;
  entry: PaidAgentCatalogEntry;
  content: string;
}) {
  return {
    id: input.id,
    object: "chat.completion",
    created: input.created,
    model: input.profile.model || input.profile.provider || String(input.profile.runtime),
    choices: [{
      index: 0,
      message: { role: "assistant", content: input.content },
      finish_reason: "stop",
    }],
    usage: null,
    hivemindos: {
      paidAgent: input.entry.slug,
      runtime: input.profile.runtime,
      provider: input.profile.provider ?? "",
      receiptId: input.id,
      payment: {
        rail: "x402",
        priceUsd: input.entry.priceUsd,
        network: input.entry.network,
        builderCode: input.entry.builderCode,
      },
    },
  };
}

function streamCompletionPayload(input: {
  id: string;
  created: number;
  profile: AgentProfile;
  content: string;
}) {
  const model = input.profile.model || input.profile.provider || String(input.profile.runtime);
  const chunks = [
    {
      id: input.id,
      object: "chat.completion.chunk",
      created: input.created,
      model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id: input.id,
      object: "chat.completion.chunk",
      created: input.created,
      model,
      choices: [{ index: 0, delta: { content: input.content }, finish_reason: null }],
    },
    {
      id: input.id,
      object: "chat.completion.chunk",
      created: input.created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
}

function collectSseText(raw: string) {
  let output = "";
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.replace(/^data:\s*/, "").trim();
    if (!data || data === "[DONE]") continue;
    const parsed = parseJson(data);
    output += textFromRuntimePayload(parsed);
  }
  return output.trim();
}

function collectJsonText(raw: string) {
  const parsed = parseJson(raw);
  return textFromRuntimePayload(parsed) || raw.trim();
}

function textFromRuntimePayload(value: unknown): string {
  if (!isRecord(value)) return "";
  const choices = value.choices;
  if (Array.isArray(choices)) {
    return choices.map((choice) => {
      if (!isRecord(choice)) return "";
      const delta = isRecord(choice.delta) ? choice.delta : {};
      const message = isRecord(choice.message) ? choice.message : {};
      return stringField(delta.content) || stringField(choice.text) || stringField(message.content);
    }).join("");
  }
  return stringField(value.content) || stringField(value.text) || stringField(value.delta);
}

function publicAgentInfo(entry: PaidAgentCatalogEntry) {
  return {
    slug: entry.slug,
    description: entry.description,
    priceUsd: entry.priceUsd,
    network: entry.network,
    testnet: entry.network !== BASE_MAINNET_NETWORK,
    runtime: entry.agent.runtime,
    provider: entry.agent.provider ?? "",
    model: entry.agent.model ?? "",
    allowClientModelSelection: entry.allowClientModelSelection,
    allowedModels: entry.allowedModels,
    honeyLedgerEnabled: entry.honeyLedgerEnabled,
    mirrorManagedHoney: entry.mirrorManagedHoney,
    builderCode: entry.builderCode,
    cdpFacilitatorConfigured: usesCdpFacilitator(entry) ? Boolean(entry.cdpApiKeyId && entry.cdpApiKeySecret) : undefined,
  };
}

function missingPaymentConfig(entry: PaidAgentCatalogEntry) {
  const missing: string[] = [];
  if (!entry.payTo.trim()) missing.push("HIVEMINDOS_PAID_AGENT_PAY_TO");
  if (!entry.facilitatorUrl.trim()) missing.push("HIVEMINDOS_PAID_AGENT_FACILITATOR_URL");
  if (usesCdpFacilitator(entry) && !entry.cdpApiKeyId) missing.push("CDP_API_KEY_ID");
  if (usesCdpFacilitator(entry) && !entry.cdpApiKeySecret) missing.push("CDP_API_KEY_SECRET");
  if (entry.priceUsd <= 0) missing.push("HIVEMINDOS_PAID_AGENT_PRICE_USD");
  return missing;
}

function paidAgentTestnetMode() {
  return booleanEnv("HIVEMINDOS_PAID_AGENT_TESTNET_MODE", false);
}

function defaultPaidAgentNetwork(testnetMode: boolean): Network {
  return (testnetMode ? BASE_SEPOLIA_NETWORK : DEFAULT_NETWORK) as Network;
}

function defaultFacilitatorUrl(testnetMode: boolean) {
  return testnetMode ? TESTNET_FACILITATOR_URL : CDP_FACILITATOR_URL;
}

function builderCodeRouteExtensions(builderCode?: string): Record<string, unknown> | undefined {
  return builderCode ? { [BUILDER_CODE]: declareBuilderCodeExtension(builderCode) } : undefined;
}

function facilitatorConfigForEntry(entry: PaidAgentCatalogEntry) {
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

function usesCdpFacilitator(entry: Pick<PaidAgentCatalogEntry, "facilitatorUrl">) {
  return normalizeUrl(entry.facilitatorUrl) === CDP_FACILITATOR_URL;
}

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function devBypassAllowed(request: NextRequest, entry: PaidAgentCatalogEntry) {
  if (process.env.NODE_ENV === "production") return false;
  if (paidAgentSellerMode() !== "development") return false;
  if (!booleanEnv("HIVEMINDOS_PAID_AGENT_DEV_BYPASS", false)) return false;
  return request.headers.get("x-hivemindos-paid-agent-dev-bypass") === entry.slug;
}

function paidAgentSellerMode(): PaidAgentSellerMode {
  const raw = process.env[SELLER_MODE_ENV]?.trim().toLowerCase();
  if (raw === "self-hosted" || raw === "self_hosted" || raw === "selfhosted") return "self-hosted";
  if (raw === "development" || raw === "dev") return "development";
  return "hosted";
}

function sellerModeAllowsLocalGateway(mode: PaidAgentSellerMode) {
  if (mode === "self-hosted") return true;
  return mode === "development" && process.env.NODE_ENV !== "production";
}

async function optionalJsonFromEnv(jsonKey: string, ...pathKeys: string[]): Promise<unknown> {
  const raw = process.env[jsonKey]?.trim();
  if (raw) {
    if (raw.startsWith("{") || raw.startsWith("[")) return parseJson(raw);
    return parseJson(await readFile(raw, "utf8"));
  }
  for (const key of pathKeys) {
    const path = process.env[key]?.trim();
    if (!path) continue;
    const pathOrJson = path.startsWith("{") || path.startsWith("[") ? path : await readFile(path, "utf8");
    return parseJson(pathOrJson);
  }
  return undefined;
}

async function writeReceipt(receipt: GatewayReceipt) {
  await mkdir(dirname(RECEIPT_PATH), { recursive: true, mode: 0o700 });
  await appendFile(RECEIPT_PATH, `${JSON.stringify(receipt)}\n`, "utf8");
}

async function recordPaidGatewayTelemetry(
  type: string,
  entry: PaidAgentCatalogEntry,
  startedAt: number,
  payload: Record<string, unknown> = {},
) {
  await recordTelemetryBatch([{
    source: "route",
    type,
    payload: {
      slug: entry.slug,
      runtime: entry.agent.runtime,
      provider: entry.agent.provider ?? "",
      model: entry.agent.model ?? "",
      elapsedMs: Date.now() - startedAt,
      ...payload,
    },
  }]).catch(() => undefined);
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

function messageText(message: RuntimeMessage) {
  if (typeof message.content === "string") return message.content;
  return message.content.map((part) => part.text ?? "").join("\n");
}

function runtimeError(raw: string, status: number) {
  const parsed = parseJson(raw);
  if (isRecord(parsed) && typeof parsed.error === "string") return parsed.error;
  return raw.trim() || `Agent runtime returned ${status}.`;
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

function networkEnv(value: unknown): Network {
  const network = stringField(value) || DEFAULT_NETWORK;
  return network as Network;
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

function roundSix(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function booleanEnv(key: string, fallback: boolean) {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function booleanField(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function listEnv(key: string) {
  return arrayOfStrings(process.env[key]?.split(","));
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => stringField(item)).filter(Boolean)
    : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function stringField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function objectFromUnknown<T>(value: unknown): T | undefined {
  return isRecord(value) ? value as T : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function maxMessages() {
  return positiveInteger(process.env.HIVEMINDOS_PAID_AGENT_MAX_MESSAGES, DEFAULT_MAX_MESSAGES);
}

function maxContentChars() {
  return positiveInteger(process.env.HIVEMINDOS_PAID_AGENT_MAX_CONTENT_CHARS, DEFAULT_MAX_CONTENT_CHARS);
}
