import { type NextRequest } from "next/server";

import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import {
  ApifyRequestError,
  fundApifyPrepaidToken,
  getApifyTokenStatus,
  runApifyActor,
  searchApifyActors,
} from "@/lib/services/apify/client";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { loadGovernanceWallet } from "@/lib/services/wallet/spend-governance";
import { normalizeX402Policy } from "@/lib/services/wallet/x402-agent-fetch";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 210;

type ApifyPostBody = {
  action?: string;
  agentId?: string;
  amountUsd?: number;
  policy?: Partial<AgentWalletConfig>;
  confirmation?: string;
  approvalToken?: string;
  companyTaskId?: string;
  actorId?: string;
  input?: unknown;
  maxChargeUsd?: number;
  resultLimit?: number;
  timeoutSecs?: number;
};

function cleanAgentId(value: unknown) {
  const agentId = typeof value === "string" ? value.trim() : "";
  if (!agentId) throw new ApifyRequestError("agentId is required.", 400);
  return agentId;
}

function objectInput(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApifyRequestError("Apify Actor input must be a JSON object.", 400);
  }
  return value as Record<string, unknown>;
}

function queryInteger(value: string | null, fallback: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ApifyRequestError("Numeric query parameters must be integers.", 400);
  return parsed;
}

async function assertActorRunAuthorized(input: {
  agentId: string;
  maxChargeUsd: number;
  confirmation?: string;
}) {
  const stored = await loadGovernanceWallet(input.agentId);
  const wallet = stored?.wallet;
  if (!wallet) throw new ApifyRequestError("No persisted wallet policy exists for this agent.", 404);
  if (!wallet.enabled) throw new ApifyRequestError("Wallet spending is off. Enable Spend before running an Apify Actor.", 400);
  const personal = input.agentId.startsWith("user:");
  const cap = Number(wallet.maxPaymentUsd) || 0.5;
  if (input.maxChargeUsd > cap + 1e-9) {
    throw new ApifyRequestError(
      `Apify Actor cap $${input.maxChargeUsd.toFixed(2)} exceeds this wallet's per-payment cap ($${cap.toFixed(2)}).`,
      400,
    );
  }
  const autoAllowed = !personal
    && wallet.enabled === true
    && wallet.provider === "x402"
    && wallet.autoPayEnabled === true;
  if (!autoAllowed && input.confirmation !== "RUN_APIFY_ACTOR") {
    throw new ApifyRequestError("Apify Actor execution requires RUN_APIFY_ACTOR confirmation unless this agent wallet allows governed auto-use.", 400);
  }
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const action = params.get("action")?.trim().toLowerCase() || "search";
    if (action === "search") {
      const result = await searchApifyActors({
        query: params.get("query") ?? "",
        limit: queryInteger(params.get("limit"), 5),
        offset: queryInteger(params.get("offset"), 0),
      });
      return okJson({ result });
    }
    if (action === "status") {
      const result = await getApifyTokenStatus(cleanAgentId(params.get("agentId")));
      return okJson({ result });
    }
    return errorJson("Unsupported Apify read action.", 400);
  } catch (error) {
    return apifyError(error, "Apify read failed");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as ApifyPostBody;
    const action = body.action?.trim().toLowerCase();
    const agentId = cleanAgentId(body.agentId);
    if (action === "fund") {
      const stored = await getWalletSecret(agentId);
      if (!stored) return errorJson("No local wallet exists for this agent.", 404);
      const amountUsd = Number(body.amountUsd);
      const directlyConfirmed = body.confirmation === "PAY_APIFY";
      const persistedWallet = await loadGovernanceWallet(agentId);
      const policy = normalizeX402Policy(
        persistedWallet?.wallet ?? body.policy,
        stored.info.network,
        agentId.startsWith("user:"),
      );
      const result = await fundApifyPrepaidToken({
        agentId,
        network: stored.info.network,
        secret: stored.secret,
        fromAddress: stored.info.address,
        amountUsd,
        policy,
        confirmation: directlyConfirmed ? "PAY_X402" : undefined,
        approvalToken: body.approvalToken?.trim() || undefined,
        approvalThresholdSatisfied: directlyConfirmed,
        companyTaskId: body.companyTaskId?.trim() || undefined,
        approvalContext: {
          summary: "Buy a spend-capped Apify prepaid token over x402.",
          whyNow: "Apify Actor calls need prepaid credit and no usable encrypted token balance is available.",
          impact: `Approving settles up to $${Number.isFinite(amountUsd) ? amountUsd.toFixed(2) : "0.00"} USDC plus any disclosed x402 platform fee. The Apify credit is non-refundable and expires after 14 days.`,
          requestedAction: "Approve only if the Base wallet, amount, expiry, and non-refundable prepaid balance are expected.",
          evidence: [
            `Wallet: ${agentId}`,
            `Network: ${stored.info.network}`,
            `Apify prepaid amount: $${Number.isFinite(amountUsd) ? amountUsd.toFixed(2) : "invalid"}`,
          ],
          source: "Apify x402 funding",
        },
      });
      return okJson({ result });
    }
    if (action === "run") {
      const maxChargeUsd = Number(body.maxChargeUsd);
      if (!Number.isFinite(maxChargeUsd)) throw new ApifyRequestError("maxChargeUsd is required.", 400);
      await assertActorRunAuthorized({ agentId, maxChargeUsd, confirmation: body.confirmation });
      const result = await runApifyActor({
        agentId,
        actorId: body.actorId?.trim() || "",
        actorInput: objectInput(body.input),
        maxChargeUsd,
        resultLimit: body.resultLimit,
        timeoutSecs: body.timeoutSecs,
      });
      return okJson({ result });
    }
    return errorJson("Unsupported Apify write action.", 400);
  } catch (error) {
    return apifyError(error, "Apify operation failed");
  }
}

function apifyError(error: unknown, context: string) {
  if (error instanceof ApifyRequestError) {
    return error.upstream ? upstreamErrorJson(context, error) : errorJson(error.message, error.status);
  }
  return errorJson(error instanceof Error ? error.message : context, 400);
}
