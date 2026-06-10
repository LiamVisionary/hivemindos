import { NextRequest, NextResponse } from "next/server";
import {
  getCryptoCapabilityMap,
  normalizeCryptoIntent,
  normalizeCryptoProvider,
  prepareCryptoAction,
} from "@/lib/services/crypto-capability-router";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CryptoCapabilityBody = {
  action?: "status" | "select" | "prepare";
  agentId?: string;
  intent?: string;
  preferredProvider?: string;
  wallet?: Partial<AgentWalletConfig>;
  amountUsd?: number;
  asset?: "USDC" | "ETH";
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  recipientAddress?: string;
  amount?: number | string;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const intentParam = request.nextUrl.searchParams.get("intent");
  const providerParam = request.nextUrl.searchParams.get("provider");
  const result = await getCryptoCapabilityMap({
    agentId: request.nextUrl.searchParams.get("agentId")?.trim() || undefined,
    intent: intentParam ? normalizeCryptoIntent(intentParam) : undefined,
    preferredProvider: normalizeCryptoProvider(providerParam),
  });
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as CryptoCapabilityBody;
    const intent = normalizeCryptoIntent(body.intent);
    const preferredProvider = normalizeCryptoProvider(body.preferredProvider);
    const input = {
      agentId: body.agentId?.trim() || undefined,
      intent,
      preferredProvider,
      wallet: normalizeWalletPolicy(body.wallet),
      amountUsd: positiveNumber(body.amountUsd),
      asset: body.asset,
      url: body.url?.trim() || undefined,
      method: body.method?.trim().toUpperCase() || undefined,
      headers: body.headers,
      body: body.body,
      recipientAddress: body.recipientAddress?.trim() || undefined,
      amount: body.amount,
    };

    if (body.action === "prepare") {
      const prepared = await prepareCryptoAction(input);
      return NextResponse.json({ ok: true, prepared });
    }

    const result = await getCryptoCapabilityMap(input);
    return NextResponse.json({
      ok: true,
      ...result,
      selected: body.action === "select" || body.action == null ? result.selected : undefined,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not resolve crypto capabilities." }, { status: 400 });
  }
}

function normalizeWalletPolicy(wallet: Partial<AgentWalletConfig> | undefined) {
  if (!wallet || typeof wallet !== "object") return undefined;
  return wallet;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}
