import "server-only";

import { randomUUID } from "node:crypto";

import type { HTTPProcessResult, HTTPRequestContext } from "@x402/core/http";
import type { NextRequest } from "next/server";

import {
  appendPaidAgentGatewayReceipt,
  bridgeReceiptToCompanyRevenue,
  createX402SellerHttpServer,
  missingSellerPaymentConfig,
  paidAgentSellerGate,
  sellerDevBypassAllowed,
  sellerPaymentConfigFromEnv,
  x402InstructionsToResponse,
  x402SellerRequestContext,
  type PaidAgentGatewayReceipt,
  type X402SellerPaymentConfig,
} from "@/lib/services/paid-agent-gateway";
import { getCompany, readCompanies, setCompanyProducts } from "@/lib/services/companies-store";
import type { Company, CompanyProduct } from "@/lib/types/company";

/**
 * Company product offers as x402 seller endpoints — the Zero Human Company
 * revenue-IN rail. A published catalog product becomes a public
 * POST /api/paid-agents/offers/<slug> endpoint where payment IS the auth
 * (same proxy exemption and seller-mode gating as the paid-agent gateway).
 *
 * Pricing authority: the price served in the 402 challenge is read from the
 * company's replicated product catalog on THIS machine at request time. The
 * buyer's request never carries a price, and the local gateway itself only
 * runs in explicit self-hosted/development seller mode — official hosted
 * monetization stays on HivemindOS-controlled infrastructure.
 */

const BASE_MAINNET_NETWORK = "eip155:8453";
const MAX_BUYER_TEXT_CHARS = 200;
const OFFER_SERVER_CACHE_MAX = 32;

export type CompanyOfferListing = {
  slug: string;
  companyId: string;
  companyName: string;
  productKey: string;
  productName: string;
  description?: string;
  priceUsd: number;
  /** Absent = one-time purchase. Recurring intervals are informational; each x402 call settles once. */
  interval?: "month" | "year";
  publishedAt?: string;
};

const offerServerCache = new Map<string, ReturnType<typeof createX402SellerHttpServer>>();

/** Every published, positively-priced offer across all companies on this machine. */
export async function listPublishedCompanyOffers(): Promise<CompanyOfferListing[]> {
  const companies = await readCompanies();
  const offers: CompanyOfferListing[] = [];
  for (const company of companies) {
    for (const product of company.products?.items ?? []) {
      const listing = offerListing(company, product);
      if (listing) offers.push(listing);
    }
  }
  return offers;
}

export async function getCompanyOfferBySlug(slug: string): Promise<CompanyOfferListing | null> {
  const normalized = normalizeOfferSlug(slug);
  if (!normalized) return null;
  return (await listPublishedCompanyOffers()).find((offer) => offer.slug === normalized) ?? null;
}

export function companyOfferPath(slug: string): string {
  return `/api/paid-agents/offers/${slug}`;
}

/** Buyer-facing offer payload: catalog identity + server-side price, no internal ids. */
export function publicCompanyOfferInfo(offer: CompanyOfferListing, payment: X402SellerPaymentConfig) {
  return {
    slug: offer.slug,
    company: offer.companyName,
    product: {
      key: offer.productKey,
      name: offer.productName,
      description: offer.description,
      interval: offer.interval,
    },
    priceUsd: offer.priceUsd,
    network: payment.network,
    testnet: payment.network !== BASE_MAINNET_NETWORK,
    endpoint: companyOfferPath(offer.slug),
    publishedAt: offer.publishedAt,
  };
}

export async function companyOfferGatewayStatus(companyId?: string) {
  const gate = paidAgentSellerGate();
  const payment = sellerPaymentConfigFromEnv();
  const all = await listPublishedCompanyOffers();
  const offers = companyId ? all.filter((offer) => offer.companyId === companyId) : all;
  const missing = [
    ...(gate.requestedEnabled && !gate.localGatewayAllowed ? ["HIVEMINDOS_PAID_AGENT_SELLER_MODE=self-hosted"] : []),
    ...(!gate.requestedEnabled ? ["HIVEMINDOS_PAID_AGENT_GATEWAY_ENABLED"] : []),
    // Price is per-offer and validated at purchase time; only the seller
    // payment identity is a readiness requirement here.
    ...missingSellerPaymentConfig({ ...payment, priceUsd: 1 }),
  ];
  return {
    enabled: gate.enabled,
    requestedEnabled: gate.requestedEnabled,
    sellerMode: gate.sellerMode,
    localGatewayAllowed: gate.localGatewayAllowed,
    configured: gate.enabled && missing.length === 0,
    missing: [...new Set(missing)],
    offers: offers.map((offer) => publicCompanyOfferInfo(offer, payment)),
  };
}

/**
 * Publish one catalog product as an x402 offer. The slug is assigned once
 * (unique across every company's offers on this machine) and survives
 * unpublish/republish so buyer links stay stable.
 */
export async function publishCompanyProductOffer(companyId: string, productKey: string): Promise<{ company: Company; offer: CompanyOfferListing }> {
  const company = await getCompany(companyId);
  if (!company) throw new Error("Company not found.");
  const items = company.products?.items ?? [];
  const product = items.find((item) => item.key === productKey);
  if (!product) throw new Error("Product not found in the company catalog.");
  if (!(product.amountUsd > 0)) throw new Error("Zero-priced products cannot be published as paid x402 offers.");

  const slug = product.x402Offer?.slug || await assignOfferSlug(company, product);
  const nextItems = items.map((item) => (item.key === productKey
    ? { ...item, x402Offer: { published: true, slug, publishedAt: new Date().toISOString() } }
    : item));
  const updated = await setCompanyProducts(companyId, { items: nextItems }, "company-offers:publish");
  if (!updated) throw new Error("Company not found.");
  const published = updated.products?.items.find((item) => item.key === productKey);
  const listing = published && offerListing(updated, published);
  if (!listing) throw new Error("Offer publication did not persist.");
  return { company: updated, offer: listing };
}

/** Unpublish keeps the assigned slug so a later republish restores the same URL. */
export async function unpublishCompanyProductOffer(companyId: string, productKey: string): Promise<Company> {
  const company = await getCompany(companyId);
  if (!company) throw new Error("Company not found.");
  const items = company.products?.items ?? [];
  const product = items.find((item) => item.key === productKey);
  if (!product) throw new Error("Product not found in the company catalog.");
  const nextItems = items.map((item) => (item.key === productKey && item.x402Offer
    ? { ...item, x402Offer: { ...item.x402Offer, published: false } }
    : item));
  const updated = await setCompanyProducts(companyId, { items: nextItems }, "company-offers:unpublish");
  if (!updated) throw new Error("Company not found.");
  return updated;
}

/**
 * The x402 purchase flow for one published offer. Mirrors the paid-agent
 * gateway's semantics: seller-mode gate, 402 challenge with the catalog price,
 * settle against the order acknowledgment, receipt to receipts.jsonl, then the
 * receipt bridges into the company revenue ledger (dev-bypass receipts are
 * excluded from revenue — no money moved).
 */
export async function processCompanyOfferPurchase(request: NextRequest, slug: string): Promise<Response> {
  const startedAt = Date.now();
  const gate = paidAgentSellerGate();
  if (gate.requestedEnabled && !gate.localGatewayAllowed) {
    return jsonResponse({
      ok: false,
      error: "Local paid-offer seller gateway is not enabled for this distribution mode.",
      reason: "Downloaded apps must sell through a hosted HivemindOS endpoint for official monetization. A local payTo is user-controlled and can only be trusted for explicit self-hosted seller mode.",
      required: "HIVEMINDOS_PAID_AGENT_SELLER_MODE=self-hosted",
    }, 403);
  }
  if (!gate.enabled) {
    return jsonResponse({ ok: false, error: "Paid offer gateway is disabled." }, 404);
  }
  const offer = await getCompanyOfferBySlug(slug);
  if (!offer) {
    return jsonResponse({ ok: false, error: "Offer is not published." }, 404);
  }
  const payment = sellerPaymentConfigFromEnv();
  const bypass = sellerDevBypassAllowed(request, offer.slug);
  const missing = missingSellerPaymentConfig({ ...payment, priceUsd: offer.priceUsd });
  if (missing.length > 0 && !bypass) {
    return jsonResponse({
      ok: false,
      error: "Offer x402 settlement is not configured.",
      missing,
      offer: publicCompanyOfferInfo(offer, payment),
    }, 424);
  }

  const body = await request.json().catch(() => null) as unknown;
  const buyer = buyerFields(body);

  let verified: {
    server: Awaited<ReturnType<typeof createX402SellerHttpServer>>;
    context: HTTPRequestContext;
    result: Extract<HTTPProcessResult, { type: "payment-verified" }>;
  } | null = null;
  if (!bypass) {
    const server = await offerX402Server(offer, payment);
    const context = x402SellerRequestContext(request, body ?? {});
    const result = await server.processHTTPRequest(context, {
      appName: "HivemindOS company offer",
      currentUrl: request.url,
      testnet: payment.network !== BASE_MAINNET_NETWORK,
    });
    if (result.type === "payment-error") return x402InstructionsToResponse(result.response);
    if (result.type === "payment-verified") verified = { server, context, result };
    // "no-payment-required" cannot occur for a positively-priced route; treat
    // it like the dev bypass if the x402 core ever returns it.
  }

  const orderId = `pago_${randomUUID()}`;
  const receivedAt = new Date().toISOString();
  const orderPayload = {
    ok: true,
    order: {
      id: orderId,
      offer: offer.slug,
      company: offer.companyName,
      product: {
        key: offer.productKey,
        name: offer.productName,
        description: offer.description,
        interval: offer.interval,
      },
      paidUsd: offer.priceUsd,
      network: payment.network,
      receivedAt,
      fulfillment: "Order recorded for the company crew. They follow up using the contact you provided with this purchase.",
    },
  };
  const responseBody = `${JSON.stringify(orderPayload)}\n`;
  const responseHeaders: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-HivemindOS-Company-Offer": offer.slug,
    "X-HivemindOS-Paid-Agent-Receipt": orderId,
  };

  const settlement = verified
    ? await verified.server.processSettlement(
      verified.result.paymentPayload,
      verified.result.paymentRequirements,
      verified.result.declaredExtensions,
      {
        request: verified.context,
        responseBody: Buffer.from(responseBody, "utf8"),
        responseHeaders,
      },
    )
    : null;
  if (settlement && !settlement.success) {
    return x402InstructionsToResponse(settlement.response);
  }

  const receipt: PaidAgentGatewayReceipt = {
    id: orderId,
    createdAt: receivedAt,
    slug: offer.slug,
    kind: "company-offer",
    companyId: offer.companyId,
    productKey: offer.productKey,
    customerContact: buyer.contact,
    customerNote: buyer.note,
    agentId: "",
    agentName: offer.companyName,
    runtime: "company-offer",
    provider: "",
    model: "",
    priceUsd: offer.priceUsd,
    network: payment.network,
    settlement: settlement ? {
      success: settlement.success,
      transaction: settlement.transaction,
      payer: settlement.payer,
      amount: settlement.amount,
      network: settlement.network,
      errorReason: settlement.errorReason,
    } : { success: true, transaction: "dev-bypass" },
    durationMs: Date.now() - startedAt,
    inputChars: 0,
    outputChars: responseBody.length,
  };
  await appendPaidAgentGatewayReceipt(receipt);
  await bridgeReceiptToCompanyRevenue(receipt);

  return new Response(responseBody, {
    status: 200,
    headers: {
      ...responseHeaders,
      ...(settlement?.headers ?? {}),
      "Content-Type": "application/json",
    },
  });
}

function offerListing(company: Company, product: CompanyProduct): CompanyOfferListing | null {
  const offer = product.x402Offer;
  if (!offer?.published || !offer.slug || !(product.amountUsd > 0)) return null;
  return {
    slug: offer.slug,
    companyId: company.id,
    companyName: company.name,
    productKey: product.key,
    productName: product.name,
    description: product.description,
    priceUsd: product.amountUsd,
    interval: product.interval === "month" || product.interval === "year" ? product.interval : undefined,
    publishedAt: offer.publishedAt,
  };
}

async function assignOfferSlug(company: Company, product: CompanyProduct): Promise<string> {
  const taken = new Set<string>();
  for (const candidate of await readCompanies()) {
    for (const item of candidate.products?.items ?? []) {
      if (item.x402Offer?.slug) taken.add(item.x402Offer.slug);
    }
  }
  const base = normalizeOfferSlug(`${company.name}-${product.key}`) || normalizeOfferSlug(product.key) || "offer";
  let slug = base;
  for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}-${suffix}`;
  return slug;
}

async function offerX402Server(offer: CompanyOfferListing, payment: X402SellerPaymentConfig) {
  const key = [
    offer.slug,
    offer.priceUsd,
    payment.network,
    payment.payTo,
    payment.facilitatorUrl,
    payment.maxTimeoutSeconds,
    payment.builderCode,
  ].join("|");
  const cached = offerServerCache.get(key);
  if (cached) return cached;
  if (offerServerCache.size >= OFFER_SERVER_CACHE_MAX) {
    const oldest = offerServerCache.keys().next().value;
    if (oldest !== undefined) offerServerCache.delete(oldest);
  }
  const created = createX402SellerHttpServer({
    path: companyOfferPath(offer.slug),
    description: `${offer.productName} — ${offer.companyName} (${offer.slug})`,
    priceUsd: offer.priceUsd,
    payment,
    unpaidBody: () => ({ ok: false, error: "Payment required.", offer: publicCompanyOfferInfo(offer, payment) }),
    settlementFailedBody: (message) => ({ ok: false, error: message, offer: publicCompanyOfferInfo(offer, payment) }),
  });
  offerServerCache.set(key, created);
  return created;
}

function buyerFields(body: unknown): { contact?: string; note?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const raw = body as Record<string, unknown>;
  return {
    contact: boundedText(raw.contact),
    note: boundedText(raw.note),
  };
}

function boundedText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.replaceAll("\0", "").trim() : "";
  return text ? text.slice(0, MAX_BUYER_TEXT_CHARS) : undefined;
}

function normalizeOfferSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
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
