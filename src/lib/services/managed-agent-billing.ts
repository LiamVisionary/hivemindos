import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  getHoneyWorkspaceId,
  readHoneyLedger,
  recordManagedHoneyBillingEvent,
  type ManagedHoneyBillingEvent,
} from "@/lib/services/wallet/honey-ledger";

export type ManagedAgentBillingIntent = "chat" | "coding" | "research" | "paid-api" | "tool";
export type ManagedAgentBillingProvider = "auto" | "bankr" | "openai" | "x402" | "hivemindos-models" | "moneyclaw" | "agent-wallet" | "hive";
export type ManagedAgentFundingRail = "stripe" | "stripe-crypto" | "x402" | "bankr" | "agent-wallet" | "hive";

export type ManagedAgentQuoteInput = {
  intent?: ManagedAgentBillingIntent;
  provider?: ManagedAgentBillingProvider;
  estimatedTokens?: number;
  estimatedCalls?: number;
  upstreamUsd?: number;
};

export type ManagedAgentQuote = {
  intent: ManagedAgentBillingIntent;
  provider: ManagedAgentBillingProvider;
  sku: string;
  units: number;
  unit: "1k-tokens" | "call";
  upstreamUsd: number;
  markupBps: number;
  retailUsd: number;
  honeyAmount: number;
  honeyCreditsPerUsd: number;
  explanation: string;
};

type PricingProfile = {
  provider: ManagedAgentBillingProvider;
  sku: string;
  unit: ManagedAgentQuote["unit"];
  defaultUnits: number;
  upstreamUnitUsd: number;
  markupBps: number;
};

const DEFAULT_HONEY_CREDITS_PER_USD = 100;
const DEFAULT_MARKUP_BPS = 5_000;
const STRIPE_API_URL = "https://api.stripe.com/v1";

const PRICING: Record<ManagedAgentBillingIntent, PricingProfile> = {
  chat: { provider: "bankr", sku: "managed-agent-chat", unit: "1k-tokens", defaultUnits: 4, upstreamUnitUsd: 0.006, markupBps: 5_000 },
  coding: { provider: "bankr", sku: "managed-agent-coding", unit: "1k-tokens", defaultUnits: 20, upstreamUnitUsd: 0.012, markupBps: 6_000 },
  research: { provider: "bankr", sku: "managed-agent-research", unit: "1k-tokens", defaultUnits: 12, upstreamUnitUsd: 0.01, markupBps: 6_000 },
  "paid-api": { provider: "x402", sku: "managed-agent-paid-api", unit: "call", defaultUnits: 1, upstreamUnitUsd: 0.05, markupBps: 4_000 },
  tool: { provider: "moneyclaw", sku: "managed-agent-tool", unit: "call", defaultUnits: 1, upstreamUnitUsd: 0.02, markupBps: 5_000 },
};

export function getManagedAgentBillingConfig() {
  const honeyCreditsPerUsd = positiveNumber(process.env.MANAGED_HONEY_CREDITS_PER_USD, DEFAULT_HONEY_CREDITS_PER_USD);
  return {
    honeyCreditsPerUsd,
    defaultMarkupBps: Math.max(0, Math.round(positiveNumber(process.env.MANAGED_AGENT_MARKUP_BPS, DEFAULT_MARKUP_BPS))),
    stripeReady: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
    stripeWebhookReady: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
    x402Ready: Boolean(process.env.MANAGED_AGENT_X402_URL?.trim()),
    bankrReady: Boolean(process.env.BANKR_LLM_KEY?.trim() || process.env.BANKR_API_KEY?.trim() || process.env.BANKR_MANAGEMENT_KEY?.trim()),
    billingSignerReady: Boolean(process.env.HONEY_BILLING_SIGNING_SECRET?.trim() || process.env.HONEY_LEDGER_SIGNING_SECRET?.trim()),
    manualCreditEnabled: process.env.MANAGED_HONEY_MANUAL_CREDIT_ENABLED === "true",
  };
}

export function quoteManagedAgentUsage(input: ManagedAgentQuoteInput = {}): ManagedAgentQuote {
  const intent = normalizeIntent(input.intent);
  const profile = PRICING[intent];
  const provider = input.provider && input.provider !== "auto" ? input.provider : profile.provider;
  const units = profile.unit === "1k-tokens"
    ? Math.max(0.001, Math.ceil(Math.max(1, Math.round(Number(input.estimatedTokens ?? profile.defaultUnits * 1000))) / 100) / 10)
    : Math.max(1, Math.round(Number(input.estimatedCalls ?? profile.defaultUnits) || profile.defaultUnits));
  const markupBps = Math.max(0, Math.round(positiveNumber(process.env.MANAGED_AGENT_MARKUP_BPS, profile.markupBps)));
  const upstreamUsd = roundMoney(input.upstreamUsd ?? profile.upstreamUnitUsd * units);
  const retailUsd = roundMoney(Math.max(0.01, upstreamUsd * (1 + markupBps / 10_000)));
  const honeyCreditsPerUsd = getManagedAgentBillingConfig().honeyCreditsPerUsd;
  return {
    intent,
    provider,
    sku: profile.sku,
    units,
    unit: profile.unit,
    upstreamUsd,
    markupBps,
    retailUsd,
    honeyAmount: roundHoney(retailUsd * honeyCreditsPerUsd),
    honeyCreditsPerUsd,
    explanation: "Quote is computed server-side from the managed-agent pricing matrix and markup settings.",
  };
}

export async function readManagedAgentBillingStatus(agentId?: string) {
  const [ledger, workspaceId] = await Promise.all([readHoneyLedger(), getHoneyWorkspaceId()]);
  const balances = ledger.balances ?? [];
  const balance = agentId ? balances.find((item) => item.agentId === agentId) ?? null : null;
  return {
    workspaceId,
    ledger,
    balance,
    config: getManagedAgentBillingConfig(),
    fundingRails: fundingRails(),
    providerModes: providerModes(),
  };
}

export async function recordManagedAgentCredit(input: {
  agentId: string;
  amountUsd: number;
  rail: ManagedAgentFundingRail;
  eventId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}) {
  const config = getManagedAgentBillingConfig();
  const honeyAmount = roundHoney(input.amountUsd * config.honeyCreditsPerUsd);
  return recordManagedHoneyBillingEvent({
    eventId: input.eventId ?? randomUUID(),
    issuerId: process.env.HONEY_BILLING_ISSUER_ID?.trim() || "hivemindos-managed-agent-billing",
    agentId: cleanAgentId(input.agentId),
    kind: "credit",
    honeyAmount,
    usdAmount: roundMoney(input.amountUsd),
    provider: input.rail,
    sku: "managed-agent-honey-top-up",
    source: sourceForFundingRail(input.rail),
    idempotencyKey: input.idempotencyKey,
    metadataHash: hashMetadata(input.metadata),
  });
}

export async function recordManagedAgentDebit(input: {
  agentId: string;
  quote: ManagedAgentQuote;
  eventId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}) {
  return recordManagedHoneyBillingEvent({
    eventId: input.eventId ?? randomUUID(),
    issuerId: process.env.HONEY_BILLING_ISSUER_ID?.trim() || "hivemindos-managed-agent-billing",
    agentId: cleanAgentId(input.agentId),
    kind: "debit",
    honeyAmount: input.quote.honeyAmount,
    usdAmount: input.quote.retailUsd,
    provider: input.quote.provider,
    sku: input.quote.sku,
    units: input.quote.units,
    unitUsd: input.quote.unit === "1k-tokens" ? roundMoney(input.quote.upstreamUsd / input.quote.units) : input.quote.upstreamUsd,
    markupBps: input.quote.markupBps,
    source: "managed-agent",
    idempotencyKey: input.idempotencyKey,
    metadataHash: hashMetadata(input.metadata),
  });
}

export async function createManagedHoneyStripeCheckout(input: {
  agentId: string;
  amountUsd: number;
  origin: string;
  rail?: "stripe" | "stripe-crypto";
}) {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) throw Object.assign(new Error("Set STRIPE_SECRET_KEY before creating Hivemind Cloud credit checkout sessions."), { status: 500 });
  const workspaceId = await getHoneyWorkspaceId();
  const amountUsd = roundMoney(Math.max(1, input.amountUsd));
  const honeyAmount = roundHoney(amountUsd * getManagedAgentBillingConfig().honeyCreditsPerUsd);
  const eventId = randomUUID();
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("client_reference_id", `${workspaceId}:${input.agentId}:${eventId}`);
  params.set("success_url", `${input.origin.replace(/\/+$/, "")}/?managedHoney=success`);
  params.set("cancel_url", `${input.origin.replace(/\/+$/, "")}/?managedHoney=cancelled`);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(Math.round(amountUsd * 100)));
  params.set("line_items[0][price_data][product_data][name]", "Hivemind Cloud credits");
  params.set("metadata[workspaceId]", workspaceId);
  params.set("metadata[agentId]", cleanAgentId(input.agentId));
  params.set("metadata[eventId]", eventId);
  params.set("metadata[honeyAmount]", String(honeyAmount));
  params.set("metadata[amountUsd]", String(amountUsd));
  params.set("metadata[rail]", input.rail ?? "stripe");
  params.set("payment_intent_data[metadata][workspaceId]", workspaceId);
  params.set("payment_intent_data[metadata][agentId]", cleanAgentId(input.agentId));
  params.set("payment_intent_data[metadata][eventId]", eventId);
  params.set("payment_intent_data[metadata][honeyAmount]", String(honeyAmount));
  params.set("payment_intent_data[metadata][amountUsd]", String(amountUsd));
  params.set("payment_intent_data[metadata][rail]", input.rail ?? "stripe");

  const response = await fetch(`${STRIPE_API_URL}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const data = await response.json().catch(() => null) as { id?: string; url?: string; error?: { message?: string } } | null;
  if (!response.ok || !data?.url) {
    throw Object.assign(new Error(data?.error?.message || "Stripe Checkout session creation failed."), { status: response.status || 502 });
  }
  return { checkoutId: data.id ?? "", url: data.url, workspaceId, agentId: cleanAgentId(input.agentId), amountUsd, honeyAmount, eventId };
}

export function fundingRails() {
  const config = getManagedAgentBillingConfig();
  return [
    { rail: "stripe", label: "Card / Apple Pay", ready: config.stripeReady, default: true },
    { rail: "stripe-crypto", label: "Crypto wallet via Stripe", ready: config.stripeReady, default: false },
    { rail: "x402", label: "x402 USDC", ready: config.x402Ready, default: false },
    { rail: "bankr", label: "Bankr wallet", ready: config.bankrReady, default: false },
    { rail: "agent-wallet", label: "Agent wallet", ready: true, default: false },
    { rail: "hive", label: "$HIVE", ready: true, default: false },
  ] satisfies Array<{ rail: ManagedAgentFundingRail; label: string; ready: boolean; default: boolean }>;
}

function providerModes() {
  return [
    { provider: "auto", label: "Auto choose best for task", default: true },
    { provider: "bankr", label: "Bankr / managed LLM gateway", default: false },
    { provider: "openai", label: "Direct model provider", default: false },
    { provider: "x402", label: "x402 paid API", default: false },
    { provider: "hivemindos-models", label: "HivemindOS wallet-paid models", default: false },
    { provider: "moneyclaw", label: "MoneyClaw web payment", default: false },
    { provider: "agent-wallet", label: "Agent wallet", default: false },
    { provider: "hive", label: "$HIVE settlement", default: false },
  ] satisfies Array<{ provider: ManagedAgentBillingProvider; label: string; default: boolean }>;
}

function normalizeIntent(value: unknown): ManagedAgentBillingIntent {
  if (value === "coding" || value === "research" || value === "paid-api" || value === "tool") return value;
  return "chat";
}

function sourceForFundingRail(rail: ManagedAgentFundingRail): ManagedHoneyBillingEvent["source"] {
  if (rail === "stripe" || rail === "stripe-crypto") return "managed-agent-stripe";
  if (rail === "x402") return "managed-agent-x402";
  if (rail === "bankr") return "managed-agent-bankr";
  if (rail === "agent-wallet") return "managed-agent-wallet";
  return "managed-agent";
}

function cleanAgentId(value: string) {
  const trimmed = value.trim().slice(0, 160);
  if (!trimmed) throw Object.assign(new Error("Missing agentId."), { status: 400 });
  return trimmed;
}

function positiveNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function roundMoney(value: number) {
  return Math.max(0, Math.round(value * 1_000_000) / 1_000_000);
}

function roundHoney(value: number) {
  return Math.max(0, Math.round(value * 1_000_000) / 1_000_000);
}

function hashMetadata(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
