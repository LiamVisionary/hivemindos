import { NextRequest, NextResponse } from "next/server";

import {
  createManagedHoneyStripeCheckout,
  quoteManagedAgentUsage,
  readManagedAgentBillingStatus,
  recordManagedAgentCredit,
  recordManagedAgentDebit,
  type ManagedAgentFundingRail,
  type ManagedAgentQuote,
  type ManagedAgentQuoteInput,
} from "@/lib/services/managed-agent-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREDIT_CONFIRMATION = "CREDIT_MANAGED_HONEY";
const SPEND_CONFIRMATION = "SPEND_MANAGED_HONEY";

export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agentId") ?? undefined;
  return NextResponse.json({ ok: true, ...(await readManagedAgentBillingStatus(agentId)) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    action?: string;
    agentId?: string;
    amountUsd?: number;
    rail?: ManagedAgentFundingRail;
    confirmation?: string;
    idempotencyKey?: string;
    quote?: ManagedAgentQuote;
  } & ManagedAgentQuoteInput;

  try {
    if (body.action === "quote") {
      return NextResponse.json({ ok: true, quote: quoteManagedAgentUsage(body) });
    }

    if (body.action === "funding-options") {
      return NextResponse.json({ ok: true, ...(await readManagedAgentBillingStatus(body.agentId)) });
    }

    if (body.action === "create-stripe-checkout") {
      const origin = request.headers.get("origin") || request.nextUrl.origin;
      const checkout = await createManagedHoneyStripeCheckout({
        agentId: requiredAgentId(body.agentId),
        amountUsd: Number(body.amountUsd ?? 10),
        rail: body.rail === "stripe-crypto" ? "stripe-crypto" : "stripe",
        origin,
      });
      return NextResponse.json({ ok: true, checkout });
    }

    if (body.action === "credit") {
      if (process.env.MANAGED_HONEY_MANUAL_CREDIT_ENABLED !== "true") {
        return NextResponse.json({ ok: false, error: "Manual managed HONEY credits are disabled. Use Stripe/webhook or another verified funding rail." }, { status: 403 });
      }
      if (body.confirmation !== CREDIT_CONFIRMATION) {
        return NextResponse.json({ ok: false, error: `Confirmation required: ${CREDIT_CONFIRMATION}` }, { status: 400 });
      }
      const result = await recordManagedAgentCredit({
        agentId: requiredAgentId(body.agentId),
        amountUsd: Number(body.amountUsd ?? 0),
        rail: body.rail ?? "stripe",
        idempotencyKey: body.idempotencyKey,
        metadata: { action: "manual-credit" },
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (body.action === "debit") {
      const authError = requireInternalBillingAuth(request);
      if (authError && !(process.env.MANAGED_HONEY_MANUAL_DEBIT_ENABLED === "true" && body.confirmation === SPEND_CONFIRMATION)) {
        return NextResponse.json({ ok: false, error: authError }, { status: 401 });
      }
      const quote = body.quote ?? quoteManagedAgentUsage(body);
      const result = await recordManagedAgentDebit({
        agentId: requiredAgentId(body.agentId),
        quote,
        idempotencyKey: body.idempotencyKey,
        metadata: { action: "managed-agent-debit", sku: quote.sku },
      });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ ok: false, error: "Unsupported managed-agent billing action." }, { status: 400 });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) || 500 : 500;
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Managed-agent billing failed.",
    }, { status });
  }
}

function requiredAgentId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error("Missing agentId."), { status: 400 });
  }
  return value;
}

function requireInternalBillingAuth(request: NextRequest) {
  const token = process.env.HONEY_BILLING_LOCAL_TOKEN?.trim();
  if (!token) return "Internal managed-agent billing token is not configured.";
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${token}` ? "" : "Unauthorized managed-agent billing request.";
}
