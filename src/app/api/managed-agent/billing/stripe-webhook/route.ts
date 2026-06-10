import { createHmac, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { recordManagedAgentCredit, type ManagedAgentFundingRail } from "@/lib/services/managed-agent-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StripeCheckoutSession = {
  id?: string;
  object?: "checkout.session";
  payment_status?: string;
  amount_total?: number;
  metadata?: Record<string, string>;
};

type StripeWebhookEvent = {
  id?: string;
  type?: string;
  data?: { object?: StripeCheckoutSession };
};

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "STRIPE_WEBHOOK_SECRET is not configured." }, { status: 500 });

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("stripe-signature") ?? "";
  if (!verifyStripeSignature(rawBody, signatureHeader, secret)) {
    return NextResponse.json({ ok: false, error: "Invalid Stripe webhook signature." }, { status: 401 });
  }

  const event = parseStripeEvent(rawBody);
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

function parseStripeEvent(rawBody: string) {
  try {
    return JSON.parse(rawBody) as StripeWebhookEvent;
  } catch {
    return null;
  }
}

function verifyStripeSignature(rawBody: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (ageSeconds > 300) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  return expectedBuffer.length === signatureBuffer.length
    && timingSafeEqual(new Uint8Array(expectedBuffer), new Uint8Array(signatureBuffer));
}
