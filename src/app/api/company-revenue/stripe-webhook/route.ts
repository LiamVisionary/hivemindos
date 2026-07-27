import { NextRequest } from "next/server";

import { companyStripeWebhookSecret } from "@/lib/services/company-revenue-bridge";
import { recordCompanyRevenue } from "@/lib/services/company-revenue-share";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { parseStripeWebhookEvent, verifyStripeWebhookSignature } from "@/lib/utils/stripe-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Second company revenue-IN source: a Stripe checkout/payment-link webhook.
// Map a payment link (or checkout session) to a company by setting
// metadata.companyId on the payment link, or by passing the company id as
// client_reference_id. The settled amount_total is the only amount honored —
// metadata cannot inflate revenue — and session.id is the idempotency key, so
// Stripe's retries and replays never double-count. The Stripe-Signature HMAC
// is the auth (this route is exempt from the dashboard gate in src/proxy.ts).
export async function POST(request: NextRequest) {
  const secret = companyStripeWebhookSecret();
  if (!secret) {
    return errorJson("Set HIVEMINDOS_COMPANY_STRIPE_WEBHOOK_SECRET (or STRIPE_WEBHOOK_SECRET) to enable the company revenue Stripe webhook.", 503);
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("stripe-signature") ?? "";
  if (!verifyStripeWebhookSignature(rawBody, signatureHeader, secret)) {
    return errorJson("Invalid Stripe webhook signature.", 401);
  }

  const event = parseStripeWebhookEvent(rawBody);
  if (!event) return errorJson("Invalid Stripe webhook payload.", 400);
  if (event.type !== "checkout.session.completed") return okJson({ ignored: true });

  const session = event.data?.object;
  if (!session || session.payment_status !== "paid") {
    return okJson({ ignored: true, reason: "Checkout session is not paid." });
  }

  const companyId = session.metadata?.companyId?.trim() || session.client_reference_id?.trim() || "";
  if (!companyId) {
    return errorJson("Stripe checkout session is missing companyId metadata (or client_reference_id).", 400);
  }

  const amountUsd = Number(session.amount_total ?? 0) / 100;
  if (!(amountUsd > 0)) return okJson({ ignored: true, reason: "Checkout session settled no positive amount." });

  try {
    const result = await recordCompanyRevenue({
      companyId,
      amountUsd,
      source: "stripe",
      externalId: session.id || event.id,
      customerLabel: session.customer_details?.email || session.customer_details?.name,
      description: session.metadata?.description || `Stripe checkout ${session.id ?? ""}`.trim(),
    });
    return okJson({
      recorded: !result.duplicate,
      duplicate: result.duplicate,
      recordId: result.record.id,
      rollup: result.rollup,
    });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Failed to record Stripe revenue.", 400);
  }
}
