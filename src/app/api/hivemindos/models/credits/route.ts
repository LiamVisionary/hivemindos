import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { normalizeHivemindosWalletPaidSlug } from "@/lib/config/hivemindos-wallet-paid-models";
import {
  getHivemindosModelCreditToken,
  storeHivemindosModelCreditToken,
} from "@/lib/services/hivemindos-model-credit-vault";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { loadGovernanceWallet } from "@/lib/services/wallet/spend-governance";
import { executeX402Fetch, type X402FetchPolicy } from "@/lib/services/wallet/x402-agent-fetch";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreditTopUpBody = {
  walletVaultId?: string;
  slug?: string;
};

type CreditTopUpResponse = {
  ok?: boolean;
  error?: string;
  slug?: string;
  creditToken?: string;
  creditedUsd?: number;
  balanceUsd?: number;
  totalCreditedUsd?: number;
  totalDebitedUsd?: number;
  updatedAt?: string;
};

const MODEL_CREDIT_TOP_UP_CAP_USD = 10;

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const walletVaultId = url.searchParams.get("walletVaultId")?.trim() || "";
  const slug = normalizeHivemindosWalletPaidSlug(url.searchParams.get("slug"));
  if (!walletVaultId) {
    return NextResponse.json({ ok: false, error: "walletVaultId is required to check HivemindOS Models credits." }, { status: 400 });
  }

  const token = await getHivemindosModelCreditToken(walletVaultId, slug).catch(() => "");
  if (!token) {
    return NextResponse.json({
      ok: true,
      configured: false,
      slug,
      balanceUsd: null,
      balanceLabel: "No prepaid credits",
    });
  }

  const balance = await readHostedBalance(request, slug, token);
  if (!balance.ok) {
    return NextResponse.json({
      ok: false,
      configured: true,
      slug,
      error: balance.error || "Could not read HivemindOS Models balance.",
    }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    slug,
    balanceUsd: balance.balanceUsd ?? null,
    balanceLabel: balance.balanceUsd === undefined ? "Unknown" : formatUsd(balance.balanceUsd),
    totalCreditedUsd: balance.totalCreditedUsd,
    totalDebitedUsd: balance.totalDebitedUsd,
    updatedAt: balance.updatedAt,
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => ({})) as CreditTopUpBody;
  const walletVaultId = body.walletVaultId?.trim() || "";
  const slug = normalizeHivemindosWalletPaidSlug(body.slug);
  if (!walletVaultId) {
    return NextResponse.json({ ok: false, error: "walletVaultId is required to top up HivemindOS Models credits." }, { status: 400 });
  }

  const [walletRecord, vault] = await Promise.all([
    loadGovernanceWallet(walletVaultId),
    getWalletSecret(walletVaultId),
  ]);
  if (!walletRecord) {
    return NextResponse.json({ ok: false, error: "The selected HivemindOS Models funding wallet is missing from Wallets." }, { status: 404 });
  }
  if (!vault) {
    return NextResponse.json({ ok: false, error: "The encrypted local wallet secret is missing for this funding wallet." }, { status: 404 });
  }

  const wallet = walletRecord.wallet;
  if (!wallet.enabled) {
    return NextResponse.json({ ok: false, error: "The selected HivemindOS Models funding wallet is disabled." }, { status: 403 });
  }
  if (wallet.custodyMode !== "local") {
    return NextResponse.json({ ok: false, error: "HivemindOS Models credits require a local signing wallet." }, { status: 403 });
  }
  if (wallet.network !== vault.info.network) {
    return NextResponse.json({ ok: false, error: "Stored wallet network does not match the encrypted wallet vault." }, { status: 409 });
  }
  const persistedAddress = wallet.vaultAddress?.trim() || wallet.walletAddress?.trim() || "";
  if (persistedAddress && persistedAddress.toLowerCase() !== vault.info.address.toLowerCase()) {
    return NextResponse.json({ ok: false, error: "Stored wallet address does not match the encrypted wallet vault." }, { status: 409 });
  }

  const target = new URL(`/api/official-paid-agents/${slug}/credits/top-up`, request.url);
  const paidBase = new URL(`/api/official-paid-agents/${slug}`, request.url).toString().replace(/\/+$/, "");
  const policy: X402FetchPolicy = {
    enabled: wallet.enabled,
    provider: "x402",
    network: wallet.network,
    maxPaymentUsd: Math.max(MODEL_CREDIT_TOP_UP_CAP_USD, Number(wallet.maxPaymentUsd) || 0),
    approvalRequiredOverUsd: 0,
    autoPayEnabled: true,
    x402BaseUrl: paidBase,
  };

  try {
    const result = await executeX402Fetch({
      agentId: walletVaultId,
      network: vault.info.network,
      secret: vault.secret,
      fromAddress: vault.info.address,
      url: target.toString(),
      method: "POST",
      headers: {
        Accept: "application/json",
        "Idempotency-Key": `hmos-model-credit-${randomUUID()}`,
      },
      body: {},
      policy,
      confirmation: "PAY_X402",
      timeoutMs: 120_000,
    });

    if (!result.ok) {
      return NextResponse.json({
        ok: false,
        error: hostedError(result.bodyJson) || `HivemindOS Models credit top-up returned HTTP ${result.status}.`,
        status: result.status,
        paid: result.paid,
        amountUsd: result.amountUsd,
        paymentResponse: result.paymentResponse,
      }, { status: result.status >= 400 && result.status < 600 ? result.status : 502 });
    }

    const topUp = result.bodyJson as CreditTopUpResponse | undefined;
    const creditToken = typeof topUp?.creditToken === "string" ? topUp.creditToken.trim() : "";
    if (!creditToken) {
      return NextResponse.json({ ok: false, error: "Hosted HivemindOS Models top-up did not return a credit token." }, { status: 502 });
    }

    await storeHivemindosModelCreditToken({ walletAgentId: walletVaultId, slug, token: creditToken });
    const balance = await readHostedBalance(request, slug, creditToken);
    return NextResponse.json({
      ok: true,
      slug,
      paid: result.paid,
      amountUsd: result.amountUsd,
      creditedUsd: numberOrUndefined(topUp?.creditedUsd),
      balanceUsd: balance.balanceUsd ?? numberOrUndefined(topUp?.balanceUsd) ?? numberOrUndefined(topUp?.creditedUsd) ?? null,
      balanceLabel: formatUsd(balance.balanceUsd ?? numberOrUndefined(topUp?.balanceUsd) ?? numberOrUndefined(topUp?.creditedUsd) ?? 0),
      totalCreditedUsd: balance.totalCreditedUsd,
      totalDebitedUsd: balance.totalDebitedUsd,
      updatedAt: balance.updatedAt,
      message: "HivemindOS Models credits funded.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not top up HivemindOS Models credits.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatusFor(message) });
  }
}

async function readHostedBalance(request: NextRequest, slug: string, token: string): Promise<CreditTopUpResponse> {
  const target = new URL(`/api/official-paid-agents/${slug}/credits/balance`, request.url);
  const response = await fetch(target, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-HivemindOS-Credit-Token": token,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => null) as CreditTopUpResponse | null;
  if (!response.ok || !data?.ok) {
    return { ok: false, error: data?.error || `Balance route returned HTTP ${response.status}.` };
  }
  return data;
}

function hostedError(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error === "object") {
    const message = (record.error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  if (typeof record.message === "string") return record.message;
  return "";
}

function numberOrUndefined(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(Math.max(0, value));
}

function errorStatusFor(message: string) {
  if (/PAY_X402|auto-use is off|approve/i.test(message)) return 402;
  if (/cap|budget|kill switch|frozen/i.test(message)) return 402;
  if (/wallet|provider|custody|network/i.test(message)) return 403;
  return 502;
}
