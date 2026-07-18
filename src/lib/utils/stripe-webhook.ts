import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shared Stripe webhook plumbing for the self-authenticating webhook routes
 * (managed-agent billing credits, company revenue). The Stripe-Signature HMAC
 * is the auth: verification fails closed on a missing/expired/forged header,
 * and the routes never require dashboard credentials (Stripe cannot carry
 * them — they are exempted in src/proxy.ts).
 */

export type StripeCheckoutSession = {
  id?: string;
  object?: "checkout.session";
  payment_status?: string;
  amount_total?: number;
  client_reference_id?: string;
  customer_details?: { email?: string; name?: string };
  metadata?: Record<string, string>;
};

export type StripeWebhookEvent = {
  id?: string;
  type?: string;
  data?: { object?: StripeCheckoutSession };
};

export function parseStripeWebhookEvent(rawBody: string): StripeWebhookEvent | null {
  try {
    return JSON.parse(rawBody) as StripeWebhookEvent;
  } catch {
    return null;
  }
}

export function verifyStripeWebhookSignature(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  const parts = Object.fromEntries(header.split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (ageSeconds > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  return expectedBuffer.length === signatureBuffer.length
    && timingSafeEqual(new Uint8Array(expectedBuffer), new Uint8Array(signatureBuffer));
}
