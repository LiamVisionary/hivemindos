import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { HIVEMINDOS_MODEL_CREDIT_TOP_UP_CONFIRMATION } from "@/lib/config/hivemindos-wallet-paid-models";
import { getHivemindosModelCreditToken } from "@/lib/services/hivemindos-model-credit-vault";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { loadGovernanceWallet } from "@/lib/services/wallet/spend-governance";
import { executeX402Fetch, type X402FetchPolicy } from "@/lib/services/wallet/x402-agent-fetch";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG = "default";

// Pay a service credit account with USDC from one of your local wallets, over
// x402. This reuses the exact top-up machinery the HivemindOS Models funding
// flow uses (executeX402Fetch → the official-paid-agents /credits/top-up
// seller), except it credits an ARBITRARY account: the target account's own
// credit token (resolved from the local vault by its label, e.g.
// "service:hive-research") is passed in X-HivemindOS-Credit-Token so the gateway
// credits that exact account instead of minting a new one. The wallet owner
// signs the payment (confirmation gate) — nothing settles without it.
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null) as {
    accountLabel?: string; walletVaultId?: string; amountUsd?: number; confirmation?: string;
  } | null;
  const accountLabel = typeof body?.accountLabel === "string" ? body.accountLabel.trim() : "";
  const walletVaultId = typeof body?.walletVaultId === "string" ? body.walletVaultId.trim() : "";
  const amountUsd = Math.round(Number(body?.amountUsd) * 100) / 100;
  if (!accountLabel) return NextResponse.json({ ok: false, error: "accountLabel is required (the vault label of the target account)." }, { status: 400 });
  if (!walletVaultId) return NextResponse.json({ ok: false, error: "walletVaultId is required (the funding wallet)." }, { status: 400 });
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return NextResponse.json({ ok: false, error: "amountUsd must be a positive number." }, { status: 400 });
  if (amountUsd > 5_000) return NextResponse.json({ ok: false, error: "amountUsd exceeds the $5,000 per-payment ceiling." }, { status: 400 });

  // The target account's credit token lives in the local model-credit vault under
  // its label. Without it we cannot direct the x402 top-up at the right account.
  const targetToken = (await getHivemindosModelCreditToken(accountLabel, SLUG).catch(() => "")).trim();
  if (!targetToken) {
    return NextResponse.json({ ok: false, error: `No credit token is stored locally for "${accountLabel}". Only vault-known accounts can be funded from a wallet.` }, { status: 404 });
  }

  const [walletRecord, vault] = await Promise.all([
    loadGovernanceWallet(walletVaultId),
    getWalletSecret(walletVaultId),
  ]);
  if (!walletRecord) return NextResponse.json({ ok: false, error: "The selected funding wallet is missing from Wallets." }, { status: 404 });
  if (!vault) return NextResponse.json({ ok: false, error: "The encrypted local wallet secret is missing for this funding wallet." }, { status: 404 });
  const wallet = walletRecord.wallet;
  if (!wallet.enabled) return NextResponse.json({ ok: false, error: "The selected funding wallet is disabled." }, { status: 403 });
  if (wallet.custodyMode !== "local") return NextResponse.json({ ok: false, error: "Funding a credit account requires a local signing wallet." }, { status: 403 });
  if (wallet.network !== "eip155:8453" || vault.info.network !== "eip155:8453") {
    return NextResponse.json({ ok: false, error: "Credit top-ups require a Base (eip155:8453) wallet with USDC." }, { status: 403 });
  }

  const target = new URL(`/api/official-paid-agents/${SLUG}/credits/top-up`, request.url);
  const paidBase = new URL(`/api/official-paid-agents/${SLUG}`, request.url).toString().replace(/\/+$/, "");
  const policy: X402FetchPolicy = {
    enabled: wallet.enabled,
    provider: "x402",
    network: wallet.network,
    maxPaymentUsd: amountUsd,
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
        "Idempotency-Key": `admin-credit-wallet-${randomUUID()}`,
        // Direct the credit at the TARGET account, not a freshly minted one.
        "X-HivemindOS-Credit-Token": targetToken,
        ...internalApiAuthHeaders(),
      },
      body: { amountUsd },
      policy,
      confirmation: "PAY_X402",
      approvalThresholdSatisfied: body?.confirmation === HIVEMINDOS_MODEL_CREDIT_TOP_UP_CONFIRMATION,
      approvalContext: {
        headline: `Add $${amountUsd.toFixed(2)} of credits to ${accountLabel} from ${walletVaultId}.`,
        summary: "This pays USDC from the selected wallet over x402 and credits the chosen service account's prepaid balance.",
        whyNow: `The selected top-up is $${amountUsd.toFixed(2)}; the wallet policy requires a human decision before this payment settles.`,
        impact: `Approving spends $${amountUsd.toFixed(2)} USDC from ${walletVaultId} and credits ${accountLabel}. Rejecting leaves both unchanged.`,
        requestedAction: "Approve only if you want to fund this service account from this wallet now.",
        evidence: [`Target account: ${accountLabel}`, `Funding wallet: ${walletVaultId}`, `Network: ${wallet.network}`, `Endpoint: ${target.toString()}`],
        missingContext: [],
        source: "HivemindOS service-account wallet funding",
      },
      timeoutMs: 120_000,
    });

    if (!result.ok) {
      return NextResponse.json({
        ok: false,
        error: typeof result.bodyJson === "object" && result.bodyJson && "error" in result.bodyJson
          ? String((result.bodyJson as { error: unknown }).error)
          : `The credit top-up failed (HTTP ${result.status}).`,
        status: result.status,
        paymentAttempted: result.paymentAttempted,
        paymentSettled: result.paymentSettled,
      }, { status: result.status >= 400 && result.status < 600 ? result.status : 502 });
    }

    const topUp = result.bodyJson as { creditedUsd?: number; balanceUrl?: string } | undefined;
    return NextResponse.json({
      ok: true,
      accountLabel,
      paid: result.paid,
      creditedUsd: typeof topUp?.creditedUsd === "number" ? topUp.creditedUsd : amountUsd,
      message: `Funded ${accountLabel} with $${amountUsd.toFixed(2)} USDC from ${walletVaultId}.`,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not fund the account from the wallet." }, { status: 500 });
  }
}
