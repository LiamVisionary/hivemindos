import type { NextRequest } from "next/server";

import {
  executePlumeOptionAction,
  inspectPlumeOptionsSnapshot,
  PLUME_ACTION_CONFIRMATIONS,
  preparePlumeOptionAction,
} from "@/lib/services/trading/plume-options";
import type { PlumeOptionAction } from "@/lib/services/trading/plume-options-domain";
import { getWalletInfo, getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlumePostBody = {
  mode?: "prepare" | "execute";
  agentId?: string;
  action?: PlumeOptionAction | PlumeOptionAction["action"];
  symbol?: string;
  kind?: "call" | "put";
  strikePrice?: string;
  expiry?: number;
  amount?: string;
  premiumPerOption?: string;
  offerId?: string;
  seriesId?: string;
  roundId?: string;
  confirmation?: string;
  approvalToken?: string;
  reviewFingerprint?: string;
  jurisdictionAttestation?: boolean;
};

function normalizeAction(body: PlumePostBody): PlumeOptionAction | null {
  if (body.action && typeof body.action === "object") return body.action;
  if (!body.action || !body.symbol || !body.kind) return null;
  const base = { symbol: body.symbol, kind: body.kind };
  if (body.action === "write") return { ...base, action: body.action, strikePrice: body.strikePrice ?? "", expiry: Number(body.expiry), amount: body.amount ?? "", premiumPerOption: body.premiumPerOption ?? "" };
  if (body.action === "buy") return { ...base, action: body.action, offerId: body.offerId ?? "", amount: body.amount ?? "" };
  if (body.action === "cancel") return { ...base, action: body.action, offerId: body.offerId ?? "", amount: body.amount ?? "" };
  if (body.action === "buy-to-close" || body.action === "exercise" || body.action === "redeem") {
    return { ...base, action: body.action, seriesId: body.seriesId ?? "", amount: body.amount ?? "" };
  }
  if (body.action === "settle") return { ...base, action: body.action, seriesId: body.seriesId ?? "", roundId: body.roundId };
  return { ...base, action: body.action, seriesId: body.seriesId ?? "" };
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const agentId = request.nextUrl.searchParams.get("agentId")?.trim();
    const wallet = agentId ? await getWalletInfo(agentId) : null;
    const snapshot = await inspectPlumeOptionsSnapshot({
      walletAddress: wallet?.address,
      walletNetwork: wallet?.network,
    });
    return okJson({ snapshot });
  } catch (error) {
    return upstreamErrorJson("Plume testnet discovery failed", error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json().catch(() => ({}))) as PlumePostBody;
    const action = normalizeAction(body);
    if (!action) return errorJson("A Plume option action, symbol, and option type are required.");
    if (!body.mode || !["prepare", "execute"].includes(body.mode)) return errorJson("Use prepare or execute mode.");

    const review = await preparePlumeOptionAction(action);
    if (body.mode === "prepare") return okJson({ review });

    const agentId = body.agentId?.trim();
    if (!agentId) return errorJson("Select a local EVM wallet before executing a Plume action.");
    if (body.jurisdictionAttestation !== true) {
      return errorJson("Confirm the Plume jurisdiction attestation before execution.", 409, { code: "jurisdiction_attestation_required" });
    }
    if (body.confirmation !== review.confirmation) {
      return errorJson(`This action requires exact confirmation: ${review.confirmation}.`, 409, {
        code: "confirmation_required",
        confirmation: review.confirmation,
      });
    }

    const stored = await getWalletSecret(agentId);
    if (!stored) return errorJson("No local signing wallet exists for this selection.", 404);
    const result = await executePlumeOptionAction({
      agentId,
      walletAddress: stored.info.address,
      walletNetwork: stored.info.network,
      secret: stored.secret,
      action,
      confirmation: body.confirmation,
      approvalToken: body.approvalToken?.trim() || undefined,
      reviewFingerprint: body.reviewFingerprint?.trim() || undefined,
      approvalThresholdSatisfied: body.confirmation === PLUME_ACTION_CONFIRMATIONS[action.action],
    });
    return okJson({ result });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Plume option action failed.", 400);
  }
}
