// guard:allow-hive-action-route - dashboard credits funding surface: card checkout or wallet-governed x402/swap behind explicit confirmation tokens, not an agent capability.
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  HIVEMINDOS_MODEL_CREDIT_TOP_UP_CONFIRMATION,
  HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID,
  normalizeHivemindosWalletPaidSlug,
} from "@/lib/config/hivemindos-wallet-paid-models";
import {
  resolvePooledHivemindosModelCreditToken,
  storeHivemindosModelCreditToken,
} from "@/lib/services/hivemindos-model-credit-vault";
import { officialPaidAgentCheckoutReturnUrl } from "@/lib/services/paid-agent-cloud-client";
import { SWAP_CONFIRMATION, executeDexSwap, quoteDexSwap } from "@/lib/services/trading/dex-swap";
import { getWalletBalance } from "@/lib/services/wallet/chain-wallet";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { quoteTradingPlatformFee } from "@/lib/services/wallet/platform-fees";
import { loadGovernanceWallet } from "@/lib/services/wallet/spend-governance";
import { executeX402Fetch, type X402FetchPolicy, type X402FetchResult } from "@/lib/services/wallet/x402-agent-fetch";
import type { AgentWalletBalance, AgentWalletTokenBalance } from "@/lib/types/agent-wallet";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreditTopUpBody = {
  creditAccountId?: string;
  walletVaultId?: string;
  slug?: string;
  method?: "card" | "crypto";
  amountUsd?: number;
  paymentToken?: string;
  confirmation?: string;
  successUrl?: string;
  cancelUrl?: string;
  returnUrl?: string;
};

type CreditTopUpResponse = {
  ok?: boolean;
  error?: string;
  slug?: string;
  creditToken?: string;
  checkoutUrl?: string;
  checkoutSessionId?: string;
  creditedUsd?: number;
  balanceUsd?: number;
  totalCreditedUsd?: number;
  totalDebitedUsd?: number;
  updatedAt?: string;
};

type CreditTopUpPaymentToken = {
  selector: string;
  symbol: string;
  label: string;
  balance: number;
  valueUsd: number | null;
};

const MODEL_CREDIT_CARD_TOP_UP_USD = 10;
const MODEL_CREDIT_CARD_TOP_UP_MIN_USD = 1;
const MODEL_CREDIT_CARD_TOP_UP_MAX_USD = 500;
const MODEL_CREDIT_TOP_UP_CAP_USD = MODEL_CREDIT_CARD_TOP_UP_MAX_USD;
const CREDIT_TOP_UP_SWAP_BUFFER_BPS = 300;

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const accountId = url.searchParams.get("creditAccountId")?.trim()
    || url.searchParams.get("walletVaultId")?.trim()
    || "";
  const slug = normalizeHivemindosWalletPaidSlug(url.searchParams.get("slug"));
  if (!accountId) {
    return NextResponse.json({ ok: false, error: "creditAccountId or walletVaultId is required to check HivemindOS Models credits." }, { status: 400 });
  }

  const token = await resolvePooledHivemindosModelCreditToken(slug, [accountId]);
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
  const accountId = body.creditAccountId?.trim() || walletVaultId;
  const slug = normalizeHivemindosWalletPaidSlug(body.slug);
  if (body.method === "card") {
    if (!accountId) {
      return NextResponse.json({ ok: false, error: "creditAccountId is required to fund HivemindOS Models credits by card." }, { status: 400 });
    }
    return startCardCheckout(request, slug, body, accountId);
  }

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
  const cryptoTopUpAmountUsd = normalizedCreditTopUpUsd(body.amountUsd);
  if (wallet.network !== "eip155:8453") {
    return NextResponse.json({
      ok: false,
      error: "HivemindOS credit top-ups require a Base wallet with USDC.",
      status: 403,
      amountUsd: cryptoTopUpAmountUsd,
      paymentAsset: "USDC",
    }, { status: 403 });
  }
  const x402Fee = await quoteTradingPlatformFee({
    source: "x402-paid-api",
    network: wallet.network,
    amountUsd: cryptoTopUpAmountUsd,
  }).catch(() => null);
  const x402FeeUsd = x402Fee?.enabled && x402Fee.configured ? x402Fee.amountUsd : 0;
  const requiredUsdcUsd = cryptoTopUpAmountUsd + x402FeeUsd;
  let walletBalance = await getWalletBalance(vault.info.address, wallet.network).catch(() => null);
  let stableBalance = stablecoinPaymentBalanceUsd(walletBalance);
  const paymentToken = paymentTokenForCreditTopUp(walletBalance, body.paymentToken);
  if (stableBalance != null && stableBalance + 0.000001 < requiredUsdcUsd && paymentToken && paymentToken.symbol !== "USDC") {
    const swap = await swapPaymentTokenShortfallToUsdc({
      walletVaultId,
      network: wallet.network,
      secret: vault.secret,
      fromAddress: vault.info.address,
      topUpUsd: cryptoTopUpAmountUsd,
      requiredUsdcUsd,
      stableBalanceUsd: stableBalance,
      paymentToken,
      topUpConfirmation: body.confirmation,
    });
    if (!swap.ok) return NextResponse.json(swap.body, { status: swap.status });
    walletBalance = await getWalletBalance(vault.info.address, wallet.network).catch(() => null);
    stableBalance = stablecoinPaymentBalanceUsd(walletBalance);
  }
  if (stableBalance != null && stableBalance + 0.000001 < requiredUsdcUsd) {
    return NextResponse.json(insufficientStablecoinResponse({
      topUpUsd: cryptoTopUpAmountUsd,
      requiredUsdcUsd,
      stableBalanceUsd: stableBalance,
      x402FeeUsd,
      paymentToken: paymentToken?.label,
    }), { status: 402 });
  }
  const policy: X402FetchPolicy = {
    enabled: wallet.enabled,
    provider: "x402",
    network: wallet.network,
    maxPaymentUsd: cryptoTopUpAmountUsd,
    approvalRequiredOverUsd: 0,
    autoPayEnabled: true,
    x402BaseUrl: paidBase,
  };

  try {
    // Top up the shared pool: pass the pool's existing token so the hosted
    // gateway credits the same account instead of minting a new one per top-up.
    const existingPoolToken = await resolvePooledHivemindosModelCreditToken(slug, [walletVaultId, accountId]);
    const result = await executeX402Fetch({
      agentId: walletVaultId,
      network: vault.info.network,
      secret: vault.secret,
      fromAddress: vault.info.address,
      url: target.toString(),
      method: "POST",
      // The target is our own /api/official-paid-agents route; self-fetches
      // 401 without the server's device token since the gate moved to src/proxy.ts.
      headers: {
        Accept: "application/json",
        "Idempotency-Key": `hmos-model-credit-${randomUUID()}`,
        ...(existingPoolToken ? { "X-HivemindOS-Credit-Token": existingPoolToken } : {}),
        ...internalApiAuthHeaders(),
      },
      body: { amountUsd: cryptoTopUpAmountUsd },
      policy,
      confirmation: "PAY_X402",
      approvalThresholdSatisfied: body.confirmation === HIVEMINDOS_MODEL_CREDIT_TOP_UP_CONFIRMATION,
      approvalContext: {
        headline: `Add $${cryptoTopUpAmountUsd.toFixed(2)} of HivemindOS Models credits to the shared model balance.`,
        summary: "This buys prepaid hosted model credits. Future paid HivemindOS Models calls use this shared balance before asking for another wallet payment.",
        whyNow: `The selected top-up is $${cryptoTopUpAmountUsd.toFixed(2)}. The wallet policy requires a human decision before this payment can settle.`,
        impact: `Approving spends $${cryptoTopUpAmountUsd.toFixed(2)} from the selected local wallet over x402 and credits the hosted model pool. Rejecting leaves the model balance unchanged.`,
        requestedAction: "Approve only if you want this install to add hosted model credits now. Reject if the balance is already funded or paid model use should wait.",
        evidence: [
          `Credit pool: ${slug}`,
          `Funding wallet: ${walletVaultId}`,
          `Network: ${wallet.network}`,
          `Endpoint: ${target.toString()}`,
          `Existing pool token: ${existingPoolToken ? "present" : "not found"}`,
        ],
        missingContext: [],
        source: "HivemindOS Models credit top-up",
      },
      timeoutMs: 120_000,
    });

    if (!result.ok) {
      const x402Requirement = x402RequirementDetail(result.responseHeaders);
      return NextResponse.json({
        ok: false,
        error: creditTopUpFailureMessage(result, x402Requirement),
        status: result.status,
        paid: result.paid,
        paymentAttempted: result.paymentAttempted,
        paymentSettled: result.paymentSettled,
        amountUsd: result.amountUsd,
        x402Requirement: x402Requirement?.summary,
        x402Error: x402Requirement?.error,
        paymentResponse: result.paymentResponse,
      }, { status: result.status >= 400 && result.status < 600 ? result.status : 502 });
    }

    const topUp = result.bodyJson as CreditTopUpResponse | undefined;
    const creditToken = typeof topUp?.creditToken === "string" ? topUp.creditToken.trim() : "";
    if (!creditToken) {
      return NextResponse.json({ ok: false, error: "Hosted HivemindOS Models top-up did not return a credit token." }, { status: 502 });
    }

    await storeHivemindosModelCreditToken({ walletAgentId: HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID, slug, token: creditToken });
    const balance = await readHostedBalance(request, slug, creditToken);
    return NextResponse.json({
      ok: true,
      slug,
      paid: result.paid,
      amountUsd: result.amountUsd,
      creditedUsd: numberOrUndefined(topUp?.creditedUsd) ?? cryptoTopUpAmountUsd,
      balanceUsd: balance.balanceUsd ?? numberOrUndefined(topUp?.balanceUsd) ?? numberOrUndefined(topUp?.creditedUsd) ?? cryptoTopUpAmountUsd,
      balanceLabel: formatUsd(balance.balanceUsd ?? numberOrUndefined(topUp?.balanceUsd) ?? numberOrUndefined(topUp?.creditedUsd) ?? cryptoTopUpAmountUsd),
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

async function startCardCheckout(
  request: NextRequest,
  slug: string,
  body: CreditTopUpBody,
  accountId: string,
) {
  const target = new URL(`/api/official-paid-agents/${slug}/credits/checkout`, request.url);
  const existingToken = await resolvePooledHivemindosModelCreditToken(slug, [accountId]);
  const response = await fetch(target, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": `hmos-model-credit-card-${randomUUID()}`,
      ...(existingToken ? { "X-HivemindOS-Credit-Token": existingToken } : {}),
      ...internalApiAuthHeaders(),
    },
    body: JSON.stringify({
      creditAccountId: accountId,
      amountUsd: normalizedCreditTopUpUsd(body.amountUsd),
      successUrl: officialPaidAgentCheckoutReturnUrl("success", slug),
      cancelUrl: officialPaidAgentCheckoutReturnUrl("cancel", slug),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const checkout = await response.json().catch(() => null) as CreditTopUpResponse | null;
  if (!response.ok || !checkout?.ok) {
    return NextResponse.json({
      ok: false,
      error: hostedError(checkout) || `HivemindOS Models card checkout returned HTTP ${response.status}.`,
      status: response.status,
    }, { status: response.status >= 400 && response.status < 600 ? response.status : 502 });
  }

  const checkoutCreditToken = typeof checkout.creditToken === "string" ? checkout.creditToken.trim() : "";
  if (checkoutCreditToken) {
    await storeHivemindosModelCreditToken({ walletAgentId: HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID, slug, token: checkoutCreditToken });
  }
  const balance = checkoutCreditToken ? await readHostedBalance(request, slug, checkoutCreditToken).catch(() => ({} as CreditTopUpResponse)) : {};
  return NextResponse.json({
    ok: true,
    slug,
    checkoutUrl: checkout.checkoutUrl,
    checkoutSessionId: checkout.checkoutSessionId,
    creditedUsd: numberOrUndefined(checkout.creditedUsd) ?? normalizedCreditTopUpUsd(body.amountUsd),
    balanceUsd: balance.balanceUsd ?? checkout.balanceUsd ?? null,
    balanceLabel: typeof balance.balanceUsd === "number" ? formatUsd(balance.balanceUsd) : checkout.balanceUsd === undefined ? "Checkout pending" : formatUsd(checkout.balanceUsd),
    totalCreditedUsd: balance.totalCreditedUsd,
    totalDebitedUsd: balance.totalDebitedUsd,
    updatedAt: balance.updatedAt,
    message: "Card checkout opened. Refresh credits after payment completes.",
  });
}

async function readHostedBalance(request: NextRequest, slug: string, token: string): Promise<CreditTopUpResponse> {
  const target = new URL(`/api/official-paid-agents/${slug}/credits/balance`, request.url);
  const response = await fetch(target, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-HivemindOS-Credit-Token": token,
      ...internalApiAuthHeaders(),
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

function creditTopUpFailureMessage(result: X402FetchResult, x402Requirement?: X402RequirementDetail) {
  const upstream = hostedError(result.bodyJson);
  if (result.status === 402) {
    if (result.paymentAttempted && !result.paymentSettled) {
      return [
        "The hosted HivemindOS gateway still returned Payment Required after the wallet signed the x402 retry, so no credits were added.",
        x402Requirement?.error ? `x402 said: ${x402Requirement.error}.` : "",
        x402Requirement?.summary ? `Gateway requirement: ${x402Requirement.summary}.` : "",
        upstream && upstream !== "Payment required." ? `Upstream said: ${upstream}` : "",
      ].filter(Boolean).join(" ");
    }
    return [
      upstream || "The hosted HivemindOS gateway requested x402 payment before credits could be funded.",
      x402Requirement?.error && x402Requirement.error !== "Payment required" ? `x402 said: ${x402Requirement.error}.` : "",
      x402Requirement?.summary ? `Gateway requirement: ${x402Requirement.summary}.` : "",
    ].filter(Boolean).join(" ");
  }
  return upstream || `HivemindOS Models credit top-up returned HTTP ${result.status}.`;
}

type X402RequirementDetail = {
  summary?: string;
  error?: string;
};

function x402RequirementDetail(headers: Record<string, string>): X402RequirementDetail | undefined {
  const raw = headers["payment-required"] || headers["x-payment-required"];
  if (!raw) return undefined;
  const parsed = decodePaymentRequirement(raw);
  if (!parsed || typeof parsed !== "object") return undefined;
  const error = typeof (parsed as { error?: unknown }).error === "string"
    ? (parsed as { error: string }).error.trim()
    : "";
  const accepts = (parsed as { accepts?: unknown }).accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) return error ? { error } : undefined;
  const requirement = accepts[0];
  if (!requirement || typeof requirement !== "object") return error ? { error } : undefined;
  const record = requirement as Record<string, unknown>;
  const amountUsd = paymentRequirementAmountUsd(record.amount ?? record.maxAmountRequired ?? record.value);
  const amount = amountUsd === undefined ? undefined : formatUsd(amountUsd);
  const network = typeof record.network === "string" ? record.network : undefined;
  const asset = typeof record.asset === "string" ? record.asset : undefined;
  const payTo = typeof record.payTo === "string" ? record.payTo : undefined;
  const tokenLabel = tokenLabelForPaymentRequirement(asset);
  const summary = [
    amount || "payment",
    tokenLabel,
    network ? `on ${network}` : "",
    payTo ? `to ${shortAddress(payTo)}` : "",
  ].filter(Boolean).join(" ");
  return { summary, error: error || undefined };
}

function decodePaymentRequirement(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    try {
      return JSON.parse(Buffer.from(trimmed, "base64").toString("utf8")) as unknown;
    } catch {
      return null;
    }
  }
}

function paymentRequirementAmountUsd(value: unknown) {
  if (typeof value === "bigint") return Number(value) / 1_000_000;
  if (typeof value === "number") return value > 10_000 ? value / 1_000_000 : value;
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return undefined;
  if (trimmed.includes(".")) {
    const decimal = Number(trimmed);
    return Number.isFinite(decimal) ? decimal : undefined;
  }
  try {
    return Number(BigInt(trimmed)) / 1_000_000;
  } catch {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
}

function stablecoinPaymentBalanceUsd(balance: AgentWalletBalance | null) {
  if (!balance || balance.tokenSymbol !== "USDC") return null;
  const tokenBalance = Number(balance.tokenBalance);
  return Number.isFinite(tokenBalance) ? roundSix(Math.max(0, tokenBalance)) : null;
}

function paymentTokenForCreditTopUp(
  balance: AgentWalletBalance | null,
  requestedToken: unknown,
): CreditTopUpPaymentToken | null {
  if (!balance) return null;
  const normalized = typeof requestedToken === "string" ? requestedToken.trim().toUpperCase() : "USDC";
  const requested = normalized || "USDC";
  for (const token of balance.tokens ?? []) {
    const symbol = token.symbol.trim().toUpperCase();
    const address = token.tokenAddress?.trim().toUpperCase() || "";
    if (symbol !== requested && address !== requested) continue;
    const tokenBalance = Number(token.balance);
    if (!Number.isFinite(tokenBalance) || tokenBalance <= 0) continue;
    return {
      selector: token.tokenAddress?.trim() || symbol,
      symbol,
      label: tokenLabel(token),
      balance: tokenBalance,
      valueUsd: numberOrNull(token.valueUsd),
    };
  }
  return null;
}

function tokenLabel(token: AgentWalletTokenBalance) {
  const symbol = token.symbol.trim().toUpperCase();
  return symbol || token.tokenAddress?.trim() || "token";
}

async function swapPaymentTokenShortfallToUsdc(input: {
  walletVaultId: string;
  network: string;
  secret: string;
  fromAddress: string;
  topUpUsd: number;
  requiredUsdcUsd: number;
  stableBalanceUsd: number;
  paymentToken: CreditTopUpPaymentToken;
  topUpConfirmation?: string;
}): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }> {
  if (input.topUpConfirmation !== HIVEMINDOS_MODEL_CREDIT_TOP_UP_CONFIRMATION) {
    return {
      ok: false,
      status: 402,
      body: {
        ok: false,
        error: "Swapping a payment token into USDC requires the Fund with crypto confirmation.",
        status: 402,
        paymentAsset: "USDC",
      },
    };
  }
  const shortfallUsd = Math.max(0, input.requiredUsdcUsd - input.stableBalanceUsd);
  if (shortfallUsd <= 0) return { ok: true };
  const valueUsd = input.paymentToken.valueUsd;
  if (valueUsd == null || valueUsd <= 0) {
    return {
      ok: false,
      status: 402,
      body: {
        ok: false,
        error: `Cannot price ${input.paymentToken.label} for this top-up. Choose USDC, ETH, HIVE, USDT, WETH, or a token with a live USD quote.`,
        status: 402,
        amountUsd: input.topUpUsd,
        paymentAsset: input.paymentToken.label,
      },
    };
  }

  const bufferedShortfallUsd = shortfallUsd * (1 + CREDIT_TOP_UP_SWAP_BUFFER_BPS / 10_000);
  const sellValueUsd = Math.min(valueUsd, bufferedShortfallUsd);
  if (sellValueUsd + 0.000001 < shortfallUsd) {
    return {
      ok: false,
      status: 402,
      body: {
        ok: false,
        error: `This crypto top-up still needs ${formatUsd(shortfallUsd)} more USDC, but the selected wallet has only ${formatUsd(valueUsd)} of ${input.paymentToken.label}. Choose a smaller amount or another token.`,
        status: 402,
        amountUsd: input.topUpUsd,
        paymentAsset: input.paymentToken.label,
      },
    };
  }

  let sellAmount = roundTokenAmount((input.paymentToken.balance * sellValueUsd) / valueUsd);
  let quotedBuyAmount = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const quote = await quoteDexSwap({
      agentId: input.walletVaultId,
      network: input.network,
      fromAddress: input.fromAddress,
      sellToken: input.paymentToken.selector,
      buyToken: "USDC",
      amountHuman: sellAmount,
    });
    quotedBuyAmount = quote.buyAmount;
    if (quotedBuyAmount + 0.000001 >= shortfallUsd) break;
    const nextSellAmount = roundTokenAmount(sellAmount * ((shortfallUsd / Math.max(quote.buyAmount, 0.000001)) * 1.015));
    if (nextSellAmount <= sellAmount || nextSellAmount > input.paymentToken.balance + 0.000001) break;
    sellAmount = nextSellAmount;
  }
  if (quotedBuyAmount + 0.000001 < shortfallUsd) {
    return {
      ok: false,
      status: 402,
      body: {
        ok: false,
        error: `The best ${input.paymentToken.label} swap quote returns ${formatUsd(quotedBuyAmount)} USDC, but this top-up needs ${formatUsd(shortfallUsd)} more USDC. Choose another token or a smaller amount.`,
        status: 402,
        amountUsd: input.topUpUsd,
        paymentAsset: input.paymentToken.label,
      },
    };
  }

  await executeDexSwap({
    agentId: input.walletVaultId,
    network: input.network,
    fromAddress: input.fromAddress,
    secret: input.secret,
    sellToken: input.paymentToken.selector,
    buyToken: "USDC",
    amountHuman: sellAmount,
    confirmation: SWAP_CONFIRMATION,
    approvalThresholdSatisfied: true,
  });
  return { ok: true };
}

function insufficientStablecoinResponse(input: {
  topUpUsd: number;
  requiredUsdcUsd: number;
  stableBalanceUsd: number;
  x402FeeUsd: number;
  paymentToken?: string;
}) {
  const feeCopy = input.x402FeeUsd > 0.000001
    ? ` (${formatUsd(input.topUpUsd)} credit top-up plus ${formatUsd(input.x402FeeUsd)} platform fee)`
    : "";
  const tokenCopy = input.paymentToken && input.paymentToken !== "USDC"
    ? ` Could not swap enough ${input.paymentToken} first.`
    : " Choose another token to swap, add USDC to the funding wallet, or choose a smaller amount.";
  return {
    ok: false,
    error: `This crypto top-up needs ${formatUsd(input.requiredUsdcUsd)} USDC on Base${feeCopy}, but the selected wallet has ${formatUsd(input.stableBalanceUsd)} USDC.${tokenCopy}`,
    status: 402,
    amountUsd: input.topUpUsd,
    stableBalanceUsd: input.stableBalanceUsd,
    requiredUsdcUsd: input.requiredUsdcUsd,
    paymentAsset: "USDC",
  };
}

function tokenLabelForPaymentRequirement(asset?: string) {
  if (!asset) return undefined;
  if (asset.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913") return "USDC";
  return shortAddress(asset);
}

function shortAddress(value: string) {
  const trimmed = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return trimmed;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

function numberOrUndefined(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function numberOrNull(value: unknown) {
  const numeric = numberOrUndefined(value);
  return numeric === undefined ? null : Math.max(0, numeric);
}

function roundSix(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundTokenAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(Math.max(0, value));
}

function normalizedCreditTopUpUsd(value: unknown) {
  const amount = numberOrUndefined(value) ?? MODEL_CREDIT_CARD_TOP_UP_USD;
  return Math.min(MODEL_CREDIT_TOP_UP_CAP_USD, Math.max(MODEL_CREDIT_CARD_TOP_UP_MIN_USD, Math.round(amount * 100) / 100));
}

function errorStatusFor(message: string) {
  if (/PAY_X402|auto-use is off|approve/i.test(message)) return 402;
  if (/cap|budget|kill switch|frozen/i.test(message)) return 402;
  if (/wallet|provider|custody|network/i.test(message)) return 403;
  return 502;
}
