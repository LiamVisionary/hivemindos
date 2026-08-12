import { NextRequest } from "next/server";

import {
  HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID,
  normalizeHivemindosWalletPaidSlug,
} from "@/lib/config/hivemindos-wallet-paid-models";
import {
  resolvePooledHivemindosModelCreditToken,
  storeHivemindosModelCreditToken,
} from "@/lib/services/hivemindos-model-credit-vault";
import { officialPaidAgentCheckoutReturnUrl } from "@/lib/services/paid-agent-cloud-client";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREDIT_TOKEN_HEADER = "X-HivemindOS-Credit-Token";
const MOBILE_IAP_SUBSCRIPTION_URL = "https://hivemindos-mobile-iap.hivemindos.workers.dev/v1/subscription";
const CREDIT_TOKEN_PATTERN = /^hmos_credit_[A-Za-z0-9_-]{20,500}$/;
const CANCEL_CONFIRMATION = "CANCEL_HIVEMINDOS_CREDIT_SUBSCRIPTION";

type SubscriptionBody = {
  action?: "checkout" | "cancel" | "sync";
  tier?: string;
  slug?: string;
  mobileCreditToken?: string | null;
};

type JsonResult = {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

function upstreamErrorStatus(status: number): number {
  return status >= 400 && status <= 599 ? status : 502;
}

async function localHostedJson(
  request: NextRequest,
  path: string,
  init: { method?: "GET" | "POST"; token?: string; body?: Record<string, unknown> } = {},
): Promise<{ status: number; data: JsonResult | null }> {
  const response = await fetch(new URL(path, request.url), {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...internalApiAuthHeaders(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.token ? { [CREDIT_TOKEN_HEADER]: init.token } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  return {
    status: response.status,
    data: await response.json().catch(() => null) as JsonResult | null,
  };
}

async function appleSubscription(token: string): Promise<JsonResult | null> {
  if (!token) return null;
  try {
    const response = await fetch(MOBILE_IAP_SUBSCRIPTION_URL, {
      headers: { Accept: "application/json", [CREDIT_TOKEN_HEADER]: token },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json().catch(() => null) as JsonResult | null;
    return response.ok && data?.ok ? data : null;
  } catch {
    return null;
  }
}

async function readUnifiedStatus(request: NextRequest, slug: string, token: string) {
  const plansPath = `/api/official-paid-agents/${slug}/credits/subscription/plans`;
  const [plans, stripe, apple, balance] = await Promise.all([
    localHostedJson(request, plansPath).catch(() => ({ status: 502, data: null })),
    token
      ? localHostedJson(request, `/api/official-paid-agents/${slug}/credits/subscription`, { token }).catch(() => ({ status: 502, data: null }))
      : Promise.resolve({ status: 401, data: null }),
    appleSubscription(token),
    token
      ? localHostedJson(request, `/api/official-paid-agents/${slug}/credits/balance`, { token }).catch(() => ({ status: 502, data: null }))
      : Promise.resolve({ status: 401, data: null }),
  ]);
  return {
    configured: Boolean(token),
    balanceCredits: typeof balance.data?.balanceCredits === "number" ? balance.data.balanceCredits : null,
    plans: Array.isArray(plans.data?.plans) ? plans.data.plans : [],
    subscriptions: {
      desktop: stripe.data?.subscription ?? null,
      mobile: apple?.subscription ?? null,
    },
    catalogAvailable: plans.status >= 200 && plans.status < 300 && plans.data?.ok === true,
  };
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const slug = normalizeHivemindosWalletPaidSlug(new URL(request.url).searchParams.get("slug"));
  const token = await resolvePooledHivemindosModelCreditToken(slug);
  return okJson({ slug, ...(await readUnifiedStatus(request, slug, token)) });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as SubscriptionBody;
  const slug = normalizeHivemindosWalletPaidSlug(body.slug);

  if (body.action === "sync") {
    return syncPairedCreditAccount(request, slug, body.mobileCreditToken);
  }

  const token = await resolvePooledHivemindosModelCreditToken(slug);
  if (body.action === "cancel") {
    if (!token) return errorJson("No desktop HivemindOS credit subscription is connected.", 404);
    const canceled = await localHostedJson(
      request,
      `/api/official-paid-agents/${slug}/credits/subscription/cancel`,
      { method: "POST", token, body: { confirmation: CANCEL_CONFIRMATION } },
    ).catch(() => ({ status: 502, data: null }));
    if (canceled.status < 200 || canceled.status >= 300 || !canceled.data?.ok) {
      return errorJson(
        canceled.data?.error || "The desktop subscription could not be canceled.",
        upstreamErrorStatus(canceled.status),
      );
    }
    return okJson({ canceled: true, slug, ...(await readUnifiedStatus(request, slug, token)) });
  }

  if (body.action !== "checkout") return errorJson("A subscription action is required.", 400);
  const tier = body.tier?.trim().toLowerCase() || "";
  if (!tier) return errorJson("Choose a subscription tier.", 400);
  const checkout = await localHostedJson(
    request,
    `/api/official-paid-agents/${slug}/credits/subscription/checkout`,
    {
      method: "POST",
      token,
      body: {
        tier,
        successUrl: officialPaidAgentCheckoutReturnUrl("success", slug),
        cancelUrl: officialPaidAgentCheckoutReturnUrl("cancel", slug),
      },
    },
  ).catch(() => ({ status: 502, data: null }));
  if (checkout.status < 200 || checkout.status >= 300 || !checkout.data?.ok) {
    return errorJson(
      checkout.data?.error || "The desktop subscription checkout could not be started.",
      upstreamErrorStatus(checkout.status),
    );
  }
  const minted = typeof checkout.data.creditToken === "string" ? checkout.data.creditToken.trim() : "";
  if (minted) {
    await storeHivemindosModelCreditToken({
      walletAgentId: HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID,
      slug,
      token: minted,
    });
  }
  return okJson({
    slug,
    checkoutUrl: checkout.data.checkoutUrl,
    checkoutSessionId: checkout.data.checkoutSessionId,
    plan: checkout.data.plan,
  });
}

async function syncPairedCreditAccount(
  request: NextRequest,
  slug: string,
  rawMobileToken: string | null | undefined,
) {
  const mobileToken = typeof rawMobileToken === "string" ? rawMobileToken.trim() : "";
  if (mobileToken && !CREDIT_TOKEN_PATTERN.test(mobileToken)) {
    return errorJson("The mobile HivemindOS credit token is invalid.", 400);
  }
  const desktopToken = await resolvePooledHivemindosModelCreditToken(slug);
  let canonicalToken = mobileToken || desktopToken;

  if (mobileToken && desktopToken && mobileToken !== desktopToken) {
    const consolidated = await localHostedJson(
      request,
      `/api/official-paid-agents/${slug}/credits/consolidate`,
      { method: "POST", body: { creditTokens: [mobileToken, desktopToken] } },
    ).catch(() => ({ status: 502, data: null }));
    if (
      consolidated.status < 200 ||
      consolidated.status >= 300 ||
      !consolidated.data?.ok ||
      consolidated.data.creditTokenIndex !== 0
    ) {
      return errorJson(
        consolidated.data?.error || "Mobile and desktop credits could not be consolidated safely.",
        upstreamErrorStatus(consolidated.status),
      );
    }
    canonicalToken = mobileToken;
  } else if (mobileToken && !desktopToken) {
    const verified = await localHostedJson(
      request,
      `/api/official-paid-agents/${slug}/credits/balance`,
      { token: mobileToken },
    ).catch(() => ({ status: 502, data: null }));
    if (verified.status < 200 || verified.status >= 300 || !verified.data?.ok) {
      return errorJson("The mobile HivemindOS credit account could not be verified.", 401);
    }
  }

  if (canonicalToken) {
    await storeHivemindosModelCreditToken({
      walletAgentId: HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID,
      slug,
      token: canonicalToken,
    });
  }
  const status = await readUnifiedStatus(request, slug, canonicalToken);
  const response = okJson({
    slug,
    creditToken: canonicalToken || null,
    merged: Boolean(mobileToken && desktopToken && mobileToken !== desktopToken),
    ...status,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
