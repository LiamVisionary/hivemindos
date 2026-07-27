import { NextRequest, NextResponse } from "next/server";

import { normalizeHivemindosWalletPaidSlug } from "@/lib/config/hivemindos-wallet-paid-models";
import { getHivemindosModelCreditToken } from "@/lib/services/hivemindos-model-credit-vault";
import { proxyManagedXMcpRequest } from "@/lib/services/managed-x-api-client";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const creditAccountId = url.searchParams.get("creditAccountId")?.trim()
    || url.searchParams.get("walletVaultId")?.trim()
    || "";
  const slug = normalizeHivemindosWalletPaidSlug(url.searchParams.get("slug"));
  if (!creditAccountId) {
    return NextResponse.json({ ok: false, error: "creditAccountId or walletVaultId is required for managed X MCP." }, { status: 400 });
  }
  const token = await getHivemindosModelCreditToken(creditAccountId, slug).catch(() => "");
  if (!token) {
    return NextResponse.json({ ok: false, error: "No hosted HivemindOS credit token is stored for this account. Fund credits first." }, { status: 402 });
  }
  return proxyManagedXMcpRequest({
    request,
    creditToken: token,
    slug,
    connectionId: request.headers.get("x-hivemindos-x-connection-id") || url.searchParams.get("connectionId") || undefined,
  });
}
