import "server-only";

import { readFile } from "node:fs/promises";

import { optionalEnv } from "@/lib/config/env";
import { listPublishedCompanyOffers } from "@/lib/services/company-offer-gateway";
import {
  missingSellerPaymentConfig,
  PAID_AGENT_RECEIPT_PATH,
  paidAgentSellerGate,
  sellerPaymentConfigFromEnv,
  type PaidAgentGatewayReceipt,
} from "@/lib/services/paid-agent-gateway";
import {
  readCompanyRevenueLedger,
  recordCompanyRevenue,
} from "@/lib/services/company-revenue-share";
import type { CompanyRevenueRailStatus } from "@/lib/types/company-revenue";

/**
 * Bridges x402 seller receipts (receipts.jsonl) into the company revenue
 * ledger, closing the loop the 2026-07-16 audit flagged: money settled on the
 * seller endpoints now lands in recordCompanyRevenue — which also moves the
 * company's apexGoal.current — instead of waiting for a human to re-type it.
 *
 * Idempotency: every bridged record carries source "x402" and
 * externalId = the receipt id, and recordCompanyRevenue dedupes on
 * (companyId, source, externalId). The sweep can therefore run any number of
 * times (inline after settlement, on dashboard polls, on demand) without
 * double-counting a cent.
 */

const REVENUE_SOURCE = "x402" as const;

export type ReceiptSyncResult = {
  /** Receipt lines read from receipts.jsonl (bad lines don't count). */
  scanned: number;
  /** Receipts that carry a companyId and a real successful settlement. */
  eligible: number;
  /** Newly written revenue records. */
  recorded: number;
  /** Eligible receipts that were already in the ledger. */
  duplicates: number;
  /** Receipts skipped as ineligible (no companyId, dev-bypass, failed/zero). */
  skipped: number;
  /** Eligible receipts whose recording failed (e.g. company deleted). */
  failed: number;
  errors: string[];
};

/** Why a receipt does or does not create company revenue. */
export function receiptRevenueEligibility(receipt: PaidAgentGatewayReceipt): { eligible: boolean; reason?: string } {
  if (!receipt.companyId?.trim()) return { eligible: false, reason: "no-company" };
  if (!(Number(receipt.priceUsd) > 0)) return { eligible: false, reason: "zero-price" };
  if (receipt.settlement?.success !== true) return { eligible: false, reason: "settlement-failed" };
  // A dev bypass moved no money; recording it would be false accounting.
  if (receipt.settlement.transaction === "dev-bypass") return { eligible: false, reason: "dev-bypass" };
  return { eligible: true };
}

/** Record one settled receipt in its company's revenue ledger (idempotent on receipt id). */
export async function recordPaidAgentReceiptAsCompanyRevenue(
  receipt: PaidAgentGatewayReceipt,
): Promise<"recorded" | "duplicate" | "skipped"> {
  const eligibility = receiptRevenueEligibility(receipt);
  if (!eligibility.eligible) return "skipped";
  const result = await recordCompanyRevenue({
    companyId: receipt.companyId ?? "",
    amountUsd: receipt.priceUsd,
    source: REVENUE_SOURCE,
    externalId: receipt.id,
    customerLabel: receipt.customerContact || receipt.settlement?.payer,
    description: receipt.kind === "company-offer"
      ? `x402 offer ${receipt.slug}${receipt.productKey ? ` (${receipt.productKey})` : ""}`
      : `x402 paid agent ${receipt.slug}`,
    receivedAt: receipt.createdAt,
    network: receipt.settlement?.network || receipt.network,
  });
  return result.duplicate ? "duplicate" : "recorded";
}

/**
 * Sweep receipts.jsonl into the company revenue ledger. Safe to call
 * repeatedly; pass a companyId to scope the sweep to one company.
 */
export async function syncPaidAgentReceiptsToCompanyRevenue(options?: { companyId?: string }): Promise<ReceiptSyncResult> {
  const result: ReceiptSyncResult = { scanned: 0, eligible: 0, recorded: 0, duplicates: 0, skipped: 0, failed: 0, errors: [] };
  const receipts = await readReceipts();
  // Pre-read the ledger once so a large already-synced backlog costs one read,
  // not one ledger scan per receipt.
  const ledger = await readCompanyRevenueLedger().catch(() => []);
  const known = new Set(
    ledger
      .filter((record) => record.source === REVENUE_SOURCE && record.externalId)
      .map((record) => `${record.companyId}|${record.externalId}`),
  );

  for (const receipt of receipts) {
    result.scanned += 1;
    if (options?.companyId && receipt.companyId !== options.companyId) continue;
    const eligibility = receiptRevenueEligibility(receipt);
    if (!eligibility.eligible) {
      result.skipped += 1;
      continue;
    }
    result.eligible += 1;
    if (known.has(`${receipt.companyId}|${receipt.id}`)) {
      result.duplicates += 1;
      continue;
    }
    try {
      const outcome = await recordPaidAgentReceiptAsCompanyRevenue(receipt);
      if (outcome === "recorded") result.recorded += 1;
      else if (outcome === "duplicate") result.duplicates += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failed += 1;
      if (result.errors.length < 5) {
        result.errors.push(`${receipt.id}: ${error instanceof Error ? error.message : "record failed"}`);
      }
    }
  }
  return result;
}

let lastOpportunisticSweepMs = 0;
const OPPORTUNISTIC_SWEEP_INTERVAL_MS = 30_000;

/**
 * Throttled sweep for hot read paths (the /api/companies dashboard poll):
 * every poll is a self-heal opportunity, but the file scan runs at most once
 * per interval per process. Never throws.
 */
export async function opportunisticReceiptSweep(): Promise<void> {
  const now = Date.now();
  if (now - lastOpportunisticSweepMs < OPPORTUNISTIC_SWEEP_INTERVAL_MS) return;
  lastOpportunisticSweepMs = now;
  await syncPaidAgentReceiptsToCompanyRevenue().catch(() => undefined);
}

/**
 * Precomputed machine-wide inputs for per-company rail status, so a companies
 * list can price N companies with one env/catalog read.
 */
export type CompanyRevenueRailContext = {
  x402GateEnabled: boolean;
  x402GateDetail: string;
  x402PaymentMissing: string[];
  stripeConfigured: boolean;
  offersByCompany: Map<string, number>;
};

export async function companyRevenueRailContext(): Promise<CompanyRevenueRailContext> {
  const gate = paidAgentSellerGate();
  const payment = sellerPaymentConfigFromEnv();
  const offersByCompany = new Map<string, number>();
  for (const offer of await listPublishedCompanyOffers().catch(() => [])) {
    offersByCompany.set(offer.companyId, (offersByCompany.get(offer.companyId) ?? 0) + 1);
  }
  const paymentMissing = missingSellerPaymentConfig({ ...payment, priceUsd: 1 });
  const gateDetail = !gate.requestedEnabled
    ? "seller gateway disabled"
    : !gate.localGatewayAllowed
      ? "seller mode blocks the local gateway"
      : paymentMissing.length > 0
        ? `missing ${paymentMissing.join(", ")}`
        : "";
  return {
    x402GateEnabled: gate.enabled && paymentMissing.length === 0,
    x402GateDetail: gateDetail,
    x402PaymentMissing: paymentMissing,
    stripeConfigured: Boolean(companyStripeWebhookSecret()),
    offersByCompany,
  };
}

export function companyRevenueRailStatusFromContext(
  context: CompanyRevenueRailContext,
  companyId: string,
): CompanyRevenueRailStatus {
  const publishedOffers = context.offersByCompany.get(companyId) ?? 0;
  const x402Connected = context.x402GateEnabled && publishedOffers > 0;
  const x402Detail = x402Connected
    ? `${publishedOffers} offer${publishedOffers === 1 ? "" : "s"} live`
    : context.x402GateDetail || (publishedOffers === 0 ? "no published offers" : "not connected");
  return {
    connected: x402Connected || context.stripeConfigured,
    x402: { connected: x402Connected, detail: x402Detail, publishedOffers },
    stripe: {
      connected: context.stripeConfigured,
      detail: context.stripeConfigured ? "webhook configured" : "webhook secret not set",
    },
  };
}

/** One company's revenue-rail status (Cockpit "revenue rail: connected / not connected"). */
export async function companyRevenueRailStatus(companyId: string): Promise<CompanyRevenueRailStatus> {
  return companyRevenueRailStatusFromContext(await companyRevenueRailContext(), companyId);
}

/**
 * Signing secret for the company-revenue Stripe webhook. Each Stripe webhook
 * endpoint has its own signing secret, so a dedicated key wins over the
 * managed-agent billing secret; single-endpoint setups can share
 * STRIPE_WEBHOOK_SECRET.
 */
export function companyStripeWebhookSecret(): string {
  return optionalEnv("HIVEMINDOS_COMPANY_STRIPE_WEBHOOK_SECRET") || optionalEnv("STRIPE_WEBHOOK_SECRET");
}

async function readReceipts(): Promise<PaidAgentGatewayReceipt[]> {
  let raw: string;
  try {
    raw = await readFile(PAID_AGENT_RECEIPT_PATH, "utf8");
  } catch {
    return [];
  }
  const receipts: PaidAgentGatewayReceipt[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as PaidAgentGatewayReceipt;
      if (parsed && typeof parsed === "object" && typeof parsed.id === "string" && parsed.id) {
        receipts.push(parsed);
      }
    } catch {
      // A torn/corrupt line never blocks the rest of the sweep.
    }
  }
  return receipts;
}
