import { createHash } from "crypto";
import { NextRequest } from "next/server";

import { okJson, errorJson } from "@/lib/utils/api-response";
import {
  DEFAULT_OFFICIAL_PAID_AGENT_BASE_URL,
  OFFICIAL_PAID_AGENT_BASE_URL_ENV,
} from "@/lib/services/paid-agent-cloud-client";
import {
  getHivemindosModelCreditToken,
  listHivemindosModelCreditTokenSummaries,
} from "@/lib/services/hivemindos-model-credit-vault";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_TOKEN_KEY = "HIVEMINDOS_PAID_AGENT_ADMIN_TOKEN";
const ADMIN_HEADER = "x-hivemindos-admin-token";

function workerBaseUrl(): string {
  return (process.env[OFFICIAL_PAID_AGENT_BASE_URL_ENV] || DEFAULT_OFFICIAL_PAID_AGENT_BASE_URL).replace(/\/+$/, "");
}

// Fingerprint a credit token exactly as the paid-agent-gateway does
// (paid-agent-credit-token: prefix, SHA-256 hex) so we can match a vault label
// to the account row the worker returns.
function paidAgentCreditTokenHash(token: string): string {
  return createHash("sha256").update(`paid-agent-credit-token:${token}`).digest("hex");
}

// Build tokenHash -> friendly label from the LOCAL model-credit vault, so the
// console can show "service:hive-research" etc. without any DB migration. The
// raw tokens never leave the server.
async function labelsByTokenHash(): Promise<Record<string, string>> {
  const summaries = await listHivemindosModelCreditTokenSummaries().catch(() => []);
  const map: Record<string, string> = {};
  for (const summary of summaries) {
    const token = await getHivemindosModelCreditToken(summary.walletAgentId, summary.slug).catch(() => "");
    if (!token) continue;
    map[paidAgentCreditTokenHash(token)] = summary.walletAgentId;
  }
  return map;
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const adminToken = (await hiveEnvValue(ADMIN_TOKEN_KEY)).trim();
  if (!adminToken) {
    return errorJson(`The credit admin token is not configured. Set ${ADMIN_TOKEN_KEY} in the shared hive env.`, 424);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${workerBaseUrl()}/api/internal/credit-accounts`, {
      method: "GET",
      headers: { accept: "application/json", [ADMIN_HEADER]: adminToken },
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
    return errorJson(message, upstream.status === 401 ? 401 : 502);
  }

  const labels = await labelsByTokenHash();
  const accounts = (Array.isArray(payload.accounts) ? payload.accounts : []).map((account: Record<string, unknown>) => ({
    ...account,
    label: (typeof account.tokenHash === "string" && labels[account.tokenHash]) || null,
  }));
  return okJson({ accounts });
}
