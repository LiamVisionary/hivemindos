import { NextRequest } from "next/server";

import { okJson, errorJson } from "@/lib/utils/api-response";
import {
  DEFAULT_OFFICIAL_PAID_AGENT_BASE_URL,
  OFFICIAL_PAID_AGENT_BASE_URL_ENV,
} from "@/lib/services/paid-agent-cloud-client";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_TOKEN_KEY = "HIVEMINDOS_PAID_AGENT_ADMIN_TOKEN";
const ADMIN_HEADER = "x-hivemindos-admin-token";

function workerBaseUrl(): string {
  return (process.env[OFFICIAL_PAID_AGENT_BASE_URL_ENV] || DEFAULT_OFFICIAL_PAID_AGENT_BASE_URL).replace(/\/+$/, "");
}

// Admin credit-by-id: adds prepaid credits to any internal account without a
// card/x402 payment. Dashboard-auth gated here; the worker independently
// verifies the admin token. The worker makes the credit idempotent, so a
// deterministic idempotencyKey guards against a double-tap.
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";
  const amountUsd = Number(body?.amountUsd);
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 200) : "";
  if (!accountId) return errorJson("accountId is required.", 400);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return errorJson("amountUsd must be a positive number.", 400);
  if (amountUsd > 10_000) return errorJson("amountUsd exceeds the $10,000 per-credit ceiling.", 400);

  const adminToken = (await hiveEnvValue(ADMIN_TOKEN_KEY)).trim();
  if (!adminToken) {
    return errorJson(`The credit admin token is not configured. Set ${ADMIN_TOKEN_KEY} in the shared hive env.`, 424);
  }

  const idempotencyKey = typeof body?.idempotencyKey === "string" && body.idempotencyKey.trim()
    ? body.idempotencyKey.trim()
    : `${accountId}:${amountUsd}:${Math.round(Date.now() / 60_000)}`; // dedupe rapid double-taps within the same minute

  let upstream: Response;
  try {
    upstream = await fetch(`${workerBaseUrl()}/api/internal/credit-accounts/fund`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", [ADMIN_HEADER]: adminToken },
      body: JSON.stringify({ accountId, amountUsd, reason, idempotencyKey }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return errorJson("The credit gateway is unreachable right now.", 502);
  }
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok || !payload?.ok) {
    const message = upstream.status === 401
      ? "The credit admin token was rejected by the gateway. Confirm it matches the worker secret."
      : (payload?.error || `The credit gateway returned HTTP ${upstream.status}.`);
    return errorJson(message, upstream.status === 401 ? 401 : upstream.status === 404 ? 404 : 502);
  }
  return okJson({
    accountId,
    creditedUsd: payload.creditedUsd ?? amountUsd,
    balanceUsd: payload.balanceUsd,
    duplicate: Boolean(payload.duplicate),
  });
}
