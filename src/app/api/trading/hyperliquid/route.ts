import { NextRequest, NextResponse } from "next/server";
import {
  HYPERLIQUID_ACCOUNT_CONFIRMATION,
  HYPERLIQUID_BUILDER_CONFIRMATION,
  HYPERLIQUID_CANCEL_CONFIRMATION,
  HYPERLIQUID_ORDER_CONFIRMATION,
  HYPERLIQUID_TRANSFER_CONFIRMATION,
  HYPERLIQUID_TWAP_CONFIRMATION,
  approveHyperliquidBuilderFee,
  executeHyperliquidCancel,
  executeHyperliquidLeverage,
  executeHyperliquidMargin,
  executeHyperliquidModify,
  executeHyperliquidOrder,
  executeHyperliquidScheduleCancel,
  executeHyperliquidTransfer,
  executeHyperliquidTwapCancel,
  executeHyperliquidTwapOrder,
  getHyperliquidAccountStatus,
  getHyperliquidFees,
  getHyperliquidFills,
  getHyperliquidOpenOrders,
  getHyperliquidOrderStatus,
  hyperliquidPolicyPresence,
  quoteHyperliquidOrder,
  readHyperliquidBuilderConfig,
  type HyperliquidOrderInput,
  type HyperliquidSignedActionInput,
} from "@/lib/services/trading/hyperliquid";
import { getWalletInfo, getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { loadGovernanceWallet } from "@/lib/services/wallet/spend-governance";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local Hyperliquid rail with builder-code support. The browser supplies an
 * agentId and action intent only; the server resolves wallet address, network,
 * signing key, spend policy, and builder recipient/fee from authoritative local
 * stores and the official HivemindOS builder policy endpoint.
 */

type HyperliquidBody = {
  action?: string;
  agentId?: string;
  coin?: string;
  marketType?: string;
  assetId?: number | string;
  side?: string;
  notionalUsd?: number | string;
  size?: number | string;
  orderType?: "market" | "limit" | "trigger";
  limitPrice?: number | string;
  timeInForce?: string;
  triggerPx?: number | string;
  triggerType?: string;
  triggerIsMarket?: boolean;
  grouping?: string;
  clientOrderId?: string;
  reduceOnly?: boolean;
  slippageBps?: number | string;
  orderId?: number | string;
  oid?: number | string;
  cloid?: string;
  fastCancel?: boolean;
  alwaysPlace?: boolean;
  scheduleCancelTime?: number | string | null;
  leverage?: number | string;
  marginMode?: string;
  isCross?: boolean;
  marginDeltaUsd?: number | string;
  transferType?: string;
  amount?: number | string;
  amountUsd?: number | string;
  destination?: string;
  token?: string;
  toPerp?: boolean;
  twapMinutes?: number | string;
  twapRandomize?: boolean;
  twapId?: number | string;
  aggregateByTime?: boolean;
  confirmation?: string;
  approvalToken?: string;
  companyTaskId?: string;
};

type HyperliquidAction =
  | "status"
  | "positions"
  | "open-orders"
  | "fills"
  | "fees"
  | "order-status"
  | "quote"
  | "approve-builder"
  | "order"
  | "cancel"
  | "cancel-by-cloid"
  | "modify"
  | "schedule-cancel"
  | "leverage"
  | "margin"
  | "usd-class"
  | "usd-send"
  | "spot-send"
  | "withdraw"
  | "twap-order"
  | "twap-cancel";

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
      cancel: HYPERLIQUID_CANCEL_CONFIRMATION,
      account: HYPERLIQUID_ACCOUNT_CONFIRMATION,
      transfer: HYPERLIQUID_TRANSFER_CONFIRMATION,
      twap: HYPERLIQUID_TWAP_CONFIRMATION,
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

    if (isReadAction(action)) {
      const wallet = await resolvePublicWallet(agentId);
      if (!wallet) return NextResponse.json({ ok: false, error: "No local or governed wallet exists for this selection." }, { status: 404 });
      const input = { walletAddress: wallet.address, walletNetwork: wallet.network };
      if (action === "open-orders") return NextResponse.json({ ok: true, result: await getHyperliquidOpenOrders(input) });
      if (action === "fills") return NextResponse.json({ ok: true, result: await getHyperliquidFills({ ...input, aggregateByTime: Boolean(body.aggregateByTime) }) });
      if (action === "fees") return NextResponse.json({ ok: true, result: await getHyperliquidFees(input) });
      if (action === "order-status") return NextResponse.json({ ok: true, result: await getHyperliquidOrderStatus({ ...input, orderId: body.orderId ?? body.oid, cloid: body.cloid }) });
      const status = await getHyperliquidAccountStatus(input);
      return NextResponse.json({ ok: true, status, result: status });
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

    if (action === "quote") {
      const wallet = await resolvePublicWallet(agentId);
      if (!wallet) return NextResponse.json({ ok: false, error: "No local or governed wallet exists for this selection." }, { status: 404 });
      const orderInput = buildOrderInput(agentId, wallet, body);
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
    const signedInput = buildSignedInput(agentId, stored.info, loaded.wallet, stored.secret, body, action);
    const result = await executeSignedAction(action, signedInput);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Hyperliquid action failed." }, { status: 400 });
  }
}

async function executeSignedAction(action: HyperliquidAction, input: HyperliquidSignedActionInput) {
  if (action === "order") return executeHyperliquidOrder(input);
  if (action === "cancel" || action === "cancel-by-cloid") return executeHyperliquidCancel(input);
  if (action === "modify") return executeHyperliquidModify(input);
  if (action === "schedule-cancel") return executeHyperliquidScheduleCancel(input);
  if (action === "leverage") return executeHyperliquidLeverage(input);
  if (action === "margin") return executeHyperliquidMargin(input);
  if (["usd-class", "usd-send", "spot-send", "withdraw"].includes(action)) return executeHyperliquidTransfer(input);
  if (action === "twap-order") return executeHyperliquidTwapOrder(input);
  if (action === "twap-cancel") return executeHyperliquidTwapCancel(input);
  throw new Error(`Unsupported Hyperliquid action "${action}".`);
}

function buildSignedInput(
  agentId: string,
  wallet: { address: string; network: string },
  policy: { enabled: boolean; maxPaymentUsd: number; maxTradeUsd?: number },
  secret: string,
  body: HyperliquidBody,
  action: HyperliquidAction,
): HyperliquidSignedActionInput {
  return {
    ...buildOrderInput(agentId, wallet, body, { coinRequired: action === "order" || action === "modify" || action === "twap-order" }),
    walletAddress: wallet.address,
    walletNetwork: wallet.network,
    secret,
    policy: {
      enabled: policy.enabled,
      maxPaymentUsd: policy.maxPaymentUsd,
      maxTradeUsd: policy.maxTradeUsd,
    },
    assetId: numeric(body.assetId),
    orderId: body.orderId ?? body.oid,
    cloid: body.cloid?.trim() || undefined,
    fastCancel: Boolean(body.fastCancel),
    alwaysPlace: Boolean(body.alwaysPlace),
    scheduleCancelTime: body.scheduleCancelTime === null ? null : numeric(body.scheduleCancelTime),
    leverage: numeric(body.leverage),
    marginMode: body.marginMode?.trim() || undefined,
    isCross: body.isCross,
    marginDeltaUsd: numeric(body.marginDeltaUsd),
    transferType: ["usd-class", "usd-send", "spot-send", "withdraw"].includes(action) ? action : body.transferType?.trim(),
    amount: numeric(body.amount),
    amountUsd: numeric(body.amountUsd),
    destination: body.destination?.trim() || undefined,
    token: body.token?.trim() || undefined,
    toPerp: body.toPerp,
    twapMinutes: numeric(body.twapMinutes),
    twapRandomize: Boolean(body.twapRandomize),
    twapId: body.twapId,
    confirmation: body.confirmation,
    approvalToken: body.approvalToken?.trim() || undefined,
    companyTaskId: body.companyTaskId?.trim() || undefined,
  };
}

function normalizeAction(action: HyperliquidBody["action"]): HyperliquidAction {
  const normalized = String(action || "quote").trim().toLowerCase();
  if (normalized === "send-usdc" || normalized === "usdc-send") return "usd-send";
  if (normalized === "send-spot") return "spot-send";
  if (normalized === "withdrawal") return "withdraw";
  if (normalized === "transfer") return "usd-class";
  const known: HyperliquidAction[] = ["status", "positions", "open-orders", "fills", "fees", "order-status", "quote", "approve-builder", "order", "cancel", "cancel-by-cloid", "modify", "schedule-cancel", "leverage", "margin", "usd-class", "usd-send", "spot-send", "withdraw", "twap-order", "twap-cancel"];
  return known.includes(normalized as HyperliquidAction) ? normalized as HyperliquidAction : "quote";
}

function isReadAction(action: HyperliquidAction) {
  return ["status", "positions", "open-orders", "fills", "fees", "order-status"].includes(action);
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
  options?: { coinRequired?: boolean },
): HyperliquidOrderInput {
  const coin = body.coin?.trim();
  if (!coin && options?.coinRequired !== false) throw new Error("A Hyperliquid market symbol is required.");
  return {
    agentId,
    walletAddress: wallet.address,
    walletNetwork: wallet.network,
    coin: coin || "",
    marketType: body.marketType?.trim().toLowerCase() === "spot" ? "spot" : "perp",
    side: body.side?.trim() || "long",
    notionalUsd: numeric(body.notionalUsd),
    size: numeric(body.size),
    orderType: body.orderType === "trigger" ? "trigger" : body.orderType === "limit" ? "limit" : "market",
    limitPrice: numeric(body.limitPrice),
    timeInForce: body.timeInForce?.trim() || undefined,
    triggerPx: numeric(body.triggerPx),
    triggerType: body.triggerType?.trim() || undefined,
    triggerIsMarket: body.triggerIsMarket,
    grouping: body.grouping?.trim() || undefined,
    clientOrderId: body.clientOrderId?.trim() || undefined,
    reduceOnly: Boolean(body.reduceOnly),
    slippageBps: numeric(body.slippageBps),
    companyTaskId: body.companyTaskId?.trim() || undefined,
  };
}

function numeric(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}
