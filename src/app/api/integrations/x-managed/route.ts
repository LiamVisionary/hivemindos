import { NextRequest, NextResponse } from "next/server";

import { normalizeHivemindosWalletPaidSlug } from "@/lib/config/hivemindos-wallet-paid-models";
import {
  getHivemindosModelCreditToken,
  listHivemindosModelCreditTokenSummaries,
  type HivemindosModelCreditTokenSummary,
} from "@/lib/services/hivemindos-model-credit-vault";
import {
  getManagedXBalance,
  getManagedXConnections,
  getManagedXGatewayStatus,
  proxyManagedXApiCall,
  startManagedXOAuth,
  type ManagedXProxyInput,
} from "@/lib/services/managed-x-api-client";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManagedXBody = ManagedXProxyInput & {
  action?: string;
  creditAccountId?: string;
  walletVaultId?: string;
  slug?: string;
  returnUrl?: string;
  scopes?: string;
};

type ManagedXCreditAccount = {
  accountId: string;
  slug: string;
  updatedAt: string;
  balanceUsd: number | null;
  balanceLabel: string;
  error?: string;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const creditAccountId = url.searchParams.get("creditAccountId")?.trim()
    || url.searchParams.get("walletVaultId")?.trim()
    || "";
  const slug = normalizeHivemindosWalletPaidSlug(url.searchParams.get("slug"));
  const status = await getManagedXGatewayStatus();
  const creditAccounts = await listManagedXCreditAccounts(slug);
  const selectedCreditAccountId = creditAccountId || creditAccounts[0]?.accountId || "";
  if (!selectedCreditAccountId) return NextResponse.json({ ok: true, status, creditAccounts, connections: [] });

  const token = await getHivemindosModelCreditToken(selectedCreditAccountId, slug).catch(() => "");
  if (!token) {
    return NextResponse.json({
      ok: true,
      status,
      creditAccounts,
      selectedCreditAccountId,
      credits: { configured: false, balanceUsd: null },
      connections: [],
    });
  }

  const [balance, connections] = await Promise.all([
    responseJson(getManagedXBalance(token, slug)),
    responseJson(getManagedXConnections(token, slug)),
  ]);
  return NextResponse.json({
    ok: true,
    status,
    creditAccounts,
    selectedCreditAccountId,
    credits: balance,
    connections: Array.isArray(connections.connections) ? connections.connections : [],
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => ({})) as ManagedXBody;
  const slug = normalizeHivemindosWalletPaidSlug(body.slug);
  const creditAccountId = body.creditAccountId?.trim() || body.walletVaultId?.trim() || "";
  if (!creditAccountId) {
    return NextResponse.json({ ok: false, error: "creditAccountId or walletVaultId is required for managed X API credits." }, { status: 400 });
  }
  const token = await getHivemindosModelCreditToken(creditAccountId, slug).catch(() => "");
  if (!token) {
    return NextResponse.json({ ok: false, error: "No hosted HivemindOS credit token is stored for this account. Fund credits first." }, { status: 402 });
  }

  switch (body.action) {
    case "oauth-start":
      return startManagedXOAuth({ request, creditToken: token, slug, returnUrl: body.returnUrl, scopes: body.scopes });
    case "balance":
      return getManagedXBalance(token, slug);
    case "connections":
      return getManagedXConnections(token, slug);
    case "proxy":
      if (isWriteMethod(body.method) && body.confirmation !== "CONFIRM_X_API_CALL") {
        return NextResponse.json({
          ok: false,
          error: "X API write calls require confirmation CONFIRM_X_API_CALL.",
        }, { status: 403 });
      }
      return proxyManagedXApiCall({ request, creditToken: token, slug, body });
    default:
      return NextResponse.json({ ok: false, error: `Unknown managed X action "${body.action ?? ""}".` }, { status: 400 });
  }
}

async function responseJson(responsePromise: Promise<Response>): Promise<Record<string, unknown>> {
  const response = await responsePromise;
  const data = await response.json().catch(() => ({}));
  return data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
}

function isWriteMethod(method: unknown) {
  const clean = typeof method === "string" ? method.trim().toUpperCase() : "GET";
  return clean && clean !== "GET";
}

async function listManagedXCreditAccounts(slug: string): Promise<ManagedXCreditAccount[]> {
  const records = (await listHivemindosModelCreditTokenSummaries())
    .filter((record) => normalizeHivemindosWalletPaidSlug(record.slug) === slug);
  return Promise.all(records.map(accountSummary));
}

async function accountSummary(record: HivemindosModelCreditTokenSummary): Promise<ManagedXCreditAccount> {
  const slug = normalizeHivemindosWalletPaidSlug(record.slug);
  const base = {
    accountId: record.walletAgentId,
    slug,
    updatedAt: record.updatedAt,
    balanceUsd: null,
    balanceLabel: "Unknown balance",
  };
  const token = await getHivemindosModelCreditToken(record.walletAgentId, slug).catch(() => "");
  if (!token) return { ...base, error: "Stored credit token is unavailable." };
  try {
    const data = await responseJson(getManagedXBalance(token, slug));
    const balanceUsd = typeof data.balanceUsd === "number" ? data.balanceUsd : null;
    return {
      ...base,
      balanceUsd,
      balanceLabel: typeof data.balanceLabel === "string"
        ? data.balanceLabel
        : balanceUsd === null ? "Unknown balance" : `$${balanceUsd.toFixed(2)}`,
      error: typeof data.error === "string" ? data.error : undefined,
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : "Could not read credit balance." };
  }
}
