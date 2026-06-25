import { NextRequest, NextResponse } from "next/server";
import {
  HYPERLIQUID_BUILDER_CONFIRMATION,
  HYPERLIQUID_ORDER_CONFIRMATION,
  approveHyperliquidBuilderFee,
  executeHyperliquidOrder,
  getHyperliquidAccountStatus,
  hyperliquidPolicyPresence,
  quoteHyperliquidOrder,
  readHyperliquidBuilderConfig,
  type HyperliquidOrderInput,
  type HyperliquidSide,
} from "@/lib/services/trading/hyperliquid";
import { getWalletInfo, getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { loadGovernanceWallet } from "@/lib/services/wallet/spend-governance";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local Hyperliquid perp rail with builder-code support. The browser supplies an
 * agentId and order intent only; the server resolves wallet address, network,
 * signing key, spend policy, and builder recipient/fee from authoritative
 * local stores and the official HivemindOS builder policy endpoint. Builder
 * approvals are a separate explicit action because Hyperliquid requires the
 * user's main wallet to sign ApproveBuilderFee before a builder fee can be
 * attached to orders.
 */

type HyperliquidBody = {
  action?: "status" | "positions" | "quote" | "approve-builder" | "order";
  agentId?: string;
  coin?: string;
  side?: string;
  notionalUsd?: number | string;
  size?: number | string;
  orderType?: "market" | "limit";
  limitPrice?: number | string;
  reduceOnly?: boolean;
  slippageBps?: number | string;
  confirmation?: string;
  approvalToken?: string;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId")?.trim();
  const [builderConfig, policy] = await Promise.all([
    readHyperliquidBuilderConfig(),
    hyperliquidPolicyPresence(),
  ]);
  let status = null;
  if (agentId) {
    const wallet = await resolvePublicWallet(agentId);
    if (wallet) {
      status = await getHyperliquidAccountStatus({
        walletAddress: wallet.address,
        walletNetwork: wallet.network,
      }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : "Hyperliquid status failed." }));
    }
  }

  return NextResponse.json({
    ok: true,
    confirmations: {
      order: HYPERLIQUID_ORDER_CONFIRMATION,
      builder: HYPERLIQUID_BUILDER_CONFIRMATION,
    },
    builder: builderConfig,
    policy,
    status,
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json().catch(() => ({}))) as HyperliquidBody;
    const action = normalizeAction(body.action);
    const agentId = body.agentId?.trim();
    if (!agentId) return badRequest("A wallet (agentId) is required.");

    if (action === "status" || action === "positions") {
      const wallet = await resolvePublicWallet(agentId);
      if (!wallet) return NextResponse.json({ ok: false, error: "No local or governed wallet exists for this selection." }, { status: 404 });
      const status = await getHyperliquidAccountStatus({
        walletAddress: wallet.address,
        walletNetwork: wallet.network,
      });
      return NextResponse.json({ ok: true, status });
    }

    if (action === "approve-builder") {
      const [stored, loaded] = await Promise.all([
        getWalletSecret(agentId),
        loadGovernanceWallet(agentId),
      ]);
      if (!stored) return NextResponse.json({ ok: false, error: "No local signing wallet exists for this selection." }, { status: 404 });
      if (loaded?.wallet.enabled === false) return badRequest("This wallet is disabled.");
      const result = await approveHyperliquidBuilderFee({
        walletAddress: stored.info.address,
        walletNetwork: stored.info.network,
        secret: stored.secret,
        confirmation: body.confirmation,
      });
      return NextResponse.json({ ok: true, result });
    }

    const wallet = await resolvePublicWallet(agentId);
    if (!wallet) return NextResponse.json({ ok: false, error: "No local or governed wallet exists for this selection." }, { status: 404 });
    const orderInput = buildOrderInput(agentId, wallet, body);

    if (action === "quote") {
      const quote = await quoteHyperliquidOrder(orderInput);
      return NextResponse.json({
        ok: true,
        quote,
        confirmation: HYPERLIQUID_ORDER_CONFIRMATION,
        builderConfirmation: HYPERLIQUID_BUILDER_CONFIRMATION,
      });
    }

    const [stored, loaded] = await Promise.all([
      getWalletSecret(agentId),
      loadGovernanceWallet(agentId),
    ]);
    if (!stored) return NextResponse.json({ ok: false, error: "No local signing wallet exists for this selection." }, { status: 404 });
    if (!loaded) return NextResponse.json({ ok: false, error: "No governed wallet policy exists for this selection." }, { status: 404 });
    const result = await executeHyperliquidOrder({
      ...orderInput,
      walletAddress: stored.info.address,
      walletNetwork: stored.info.network,
      secret: stored.secret,
      policy: {
        enabled: loaded.wallet.enabled,
        maxPaymentUsd: loaded.wallet.maxPaymentUsd,
        maxTradeUsd: loaded.wallet.maxTradeUsd,
      },
      confirmation: body.confirmation,
      approvalToken: body.approvalToken?.trim() || undefined,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Hyperliquid trade failed." }, { status: 400 });
  }
}

function normalizeAction(action: HyperliquidBody["action"]) {
  if (action === "positions") return "positions";
  if (action === "approve-builder") return "approve-builder";
  if (action === "order") return "order";
  if (action === "status") return "status";
  return "quote";
}

async function resolvePublicWallet(agentId: string): Promise<{ address: string; network: string } | null> {
  const [local, governed] = await Promise.all([
    getWalletInfo(agentId),
    loadGovernanceWallet(agentId).catch(() => null),
  ]);
  if (local) return { address: local.address, network: local.network };
  const address = governed?.wallet.vaultAddress || governed?.wallet.walletAddress;
  const network = governed?.wallet.network;
  if (address && network) return { address, network };
  return null;
}

function buildOrderInput(
  agentId: string,
  wallet: { address: string; network: string },
  body: HyperliquidBody,
): HyperliquidOrderInput {
  const coin = body.coin?.trim();
  if (!coin) throw new Error("A Hyperliquid market symbol is required.");
  return {
    agentId,
    walletAddress: wallet.address,
    walletNetwork: wallet.network,
    coin,
    side: normalizeSide(body.side),
    notionalUsd: numeric(body.notionalUsd),
    size: numeric(body.size),
    orderType: body.orderType === "limit" ? "limit" : "market",
    limitPrice: numeric(body.limitPrice),
    reduceOnly: Boolean(body.reduceOnly),
    slippageBps: numeric(body.slippageBps),
  };
}

function normalizeSide(side: unknown): HyperliquidSide {
  return String(side || "").trim().toLowerCase() === "short" ? "short" : "long";
}

function numeric(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}
