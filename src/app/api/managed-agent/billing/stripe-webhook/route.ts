import { NextRequest, NextResponse } from "next/server";

import { recordManagedAgentCredit, type ManagedAgentFundingRail } from "@/lib/services/managed-agent-billing";
import { parseStripeWebhookEvent, verifyStripeWebhookSignature } from "@/lib/utils/stripe-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "STRIPE_WEBHOOK_SECRET is not configured." }, { status: 500 });

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("stripe-signature") ?? "";
  if (!verifyStripeWebhookSignature(rawBody, signatureHeader, secret)) {
    return NextResponse.json({ ok: false, error: "Invalid Stripe webhook signature." }, { status: 401 });
  }

  const event = parseStripeWebhookEvent(rawBody);
  if (!event) return NextResponse.json({ ok: false, error: "Invalid Stripe webhook payload." }, { status: 400 });
  if (event.type !== "checkout.session.completed") return NextResponse.json({ ok: true, ignored: true });

  const session = event.data?.object;
  if (!session || session.payment_status !== "paid") {
    return NextResponse.json({ ok: true, ignored: true, reason: "Checkout session is not paid." });
  }

  const metadata = session.metadata ?? {};
  const agentId = metadata.agentId?.trim();
  if (!agentId) return NextResponse.json({ ok: false, error: "Stripe checkout session is missing agentId metadata." }, { status: 400 });

  const amountUsd = Number(metadata.amountUsd ?? 0) || Number(session.amount_total ?? 0) / 100;
  const rail = metadata.rail === "stripe-crypto" ? "stripe-crypto" : "stripe";
  const result = await recordManagedAgentCredit({
    agentId,
    amountUsd,
    rail: rail as ManagedAgentFundingRail,
    eventId: metadata.eventId || event.id || session.id,
    idempotencyKey: session.id || event.id,
    metadata: {
      stripeEventId: event.id,
      stripeCheckoutSessionId: session.id,
      rail,
    },
  });

  return NextResponse.json({ ok: true, ...result });
}
