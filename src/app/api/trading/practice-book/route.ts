import { NextRequest, NextResponse } from "next/server";

import {
  CRYPTO_PRACTICE_REPLAY_CONFIRMATION,
  buildHyperliquidCryptoSnapshot,
  clearCryptoPracticeTarget,
  fetchAlpacaPaperCryptoSnapshot,
  holdingsFromHyperliquidStatus,
  planHyperliquidReplay,
  readCryptoPracticeBook,
  saveCryptoPracticeSnapshot,
  upsertManualCryptoPracticeHolding,
  type CryptoPracticeReplayOrder,
} from "@/lib/services/trading/crypto-practice-book";
import {
  HYPERLIQUID_ORDER_CONFIRMATION,
  executeHyperliquidOrder,
  getHyperliquidAccountStatus,
} from "@/lib/services/trading/hyperliquid";
import { getWalletInfo, getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { loadGovernanceWallet } from "@/lib/services/wallet/spend-governance";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PracticeBookAction =
  | "read"
  | "snapshot-alpaca-paper"
  | "snapshot-hyperliquid"
  | "manual-holding"
  | "clear-target"
  | "plan-hyperliquid"
  | "execute-hyperliquid-replay";

type PracticeBookBody = {
  action?: PracticeBookAction;
  agentId?: string;
  replaceTarget?: boolean;
  symbol?: string;
  marketType?: "spot" | "perp";
  side?: "long" | "short";
  quantity?: number | string;
  notionalUsd?: number | string;
  avgEntryPrice?: number | string;
  markPrice?: number | string;
  includeCurrent?: boolean;
  confirmation?: string;
  maxOrders?: number | string;
  slippageBps?: number | string;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const agentId = new URL(request.url).searchParams.get("agentId")?.trim();
  if (!agentId) return badRequest("An agentId is required.");
  return NextResponse.json({ ok: true, book: await readCryptoPracticeBook(agentId) });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json().catch(() => ({}))) as PracticeBookBody;
    const agentId = body.agentId?.trim();
    if (!agentId) return badRequest("An agentId is required.");
    const action = body.action || "read";

    if (action === "read") {
      return NextResponse.json({ ok: true, book: await readCryptoPracticeBook(agentId) });
    }

    if (action === "snapshot-alpaca-paper") {
      const loaded = await loadGovernanceWallet(agentId).catch(() => null);
      const snapshot = await fetchAlpacaPaperCryptoSnapshot({ agentId, policy: loaded?.wallet });
      const book = await saveCryptoPracticeSnapshot({ agentId, snapshot, replaceTarget: body.replaceTarget !== false });
      return NextResponse.json({ ok: true, book, snapshot });
    }

    if (action === "snapshot-hyperliquid") {
      const status = await readHyperliquidStatus(agentId);
      const snapshot = buildHyperliquidCryptoSnapshot(status);
      const book = await saveCryptoPracticeSnapshot({ agentId, snapshot, replaceTarget: body.replaceTarget === true });
      return NextResponse.json({ ok: true, book, snapshot, status });
    }

    if (action === "manual-holding") {
      const book = await upsertManualCryptoPracticeHolding({
        agentId,
        holding: {
          symbol: body.symbol,
          marketType: body.marketType,
          side: body.side,
          quantity: Number(body.quantity) || 0,
          notionalUsd: Number(body.notionalUsd) || 0,
          avgEntryPrice: Number(body.avgEntryPrice) || 0,
          markPrice: Number(body.markPrice) || 0,
        },
      });
      return NextResponse.json({ ok: true, book });
    }

    if (action === "clear-target") {
      return NextResponse.json({ ok: true, book: await clearCryptoPracticeTarget(agentId) });
    }

    if (action === "plan-hyperliquid") {
      const { book, status } = await bookAndOptionalHyperliquidStatus(agentId, body.includeCurrent !== false);
      const plan = planHyperliquidReplay({
        agentId,
        book,
        currentHoldings: status ? holdingsFromHyperliquidStatus(status) : undefined,
        network: status?.network,
      });
      return NextResponse.json({ ok: true, book, status, plan });
    }

    if (action === "execute-hyperliquid-replay") {
      if (body.confirmation !== CRYPTO_PRACTICE_REPLAY_CONFIRMATION) {
        return badRequest(`Replay needs confirmation. Type ${CRYPTO_PRACTICE_REPLAY_CONFIRMATION} to place the planned Hyperliquid order set.`);
      }
      const [stored, loaded] = await Promise.all([
        getWalletSecret(agentId),
        loadGovernanceWallet(agentId),
      ]);
      if (!stored) return NextResponse.json({ ok: false, error: "No local signing wallet exists for this selection." }, { status: 404 });
      if (!loaded) return NextResponse.json({ ok: false, error: "No governed wallet policy exists for this selection." }, { status: 404 });

      const { book, status } = await bookAndOptionalHyperliquidStatus(agentId, true);
      const plan = planHyperliquidReplay({
        agentId,
        book,
        currentHoldings: status ? holdingsFromHyperliquidStatus(status) : undefined,
        network: status?.network,
      });
      const maxOrders = Math.max(1, Math.min(6, Math.trunc(Number(body.maxOrders) || 6)));
      const executable = plan.orders.slice(0, maxOrders);
      if (!executable.length) return NextResponse.json({ ok: true, book, plan, results: [], message: "No executable replay orders are needed." });

      const results = [];
      for (const order of executable) {
        const result = await executeReplayOrder({
          agentId,
          order,
          walletAddress: stored.info.address,
          walletNetwork: stored.info.network,
          secret: stored.secret,
          policy: loaded.wallet,
          slippageBps: Number(body.slippageBps) || undefined,
        });
        results.push(result);
      }
      return NextResponse.json({
        ok: true,
        book,
        plan,
        results,
        message: `Submitted ${results.length} Hyperliquid replay order${results.length === 1 ? "" : "s"}.`,
      });
    }

    return badRequest(`Unsupported practice-book action "${action}".`);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Crypto practice book action failed." }, { status: 400 });
  }
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

async function readHyperliquidStatus(agentId: string) {
  const wallet = await resolvePublicWallet(agentId);
  if (!wallet) throw new Error("No local or governed EVM wallet exists for this Hyperliquid practice-book action.");
  return getHyperliquidAccountStatus({ walletAddress: wallet.address, walletNetwork: wallet.network });
}

async function bookAndOptionalHyperliquidStatus(agentId: string, includeCurrent: boolean) {
  const [book, status] = await Promise.all([
    readCryptoPracticeBook(agentId),
    includeCurrent ? readHyperliquidStatus(agentId).catch(() => null) : Promise.resolve(null),
  ]);
  return { book, status };
}

async function executeReplayOrder(input: {
  agentId: string;
  order: CryptoPracticeReplayOrder;
  walletAddress: string;
  walletNetwork: string;
  secret: string;
  policy: { enabled: boolean; maxPaymentUsd: number; maxTradeUsd?: number };
  slippageBps?: number;
}) {
  return executeHyperliquidOrder({
    agentId: input.agentId,
    walletAddress: input.walletAddress,
    walletNetwork: input.walletNetwork,
    secret: input.secret,
    policy: {
      enabled: input.policy.enabled,
      maxPaymentUsd: input.policy.maxPaymentUsd,
      maxTradeUsd: input.policy.maxTradeUsd,
    },
    coin: input.order.coin,
    marketType: input.order.marketType,
    side: input.order.side,
    notionalUsd: input.order.notionalUsd,
    orderType: "market",
    reduceOnly: input.order.reduceOnly,
    slippageBps: input.slippageBps,
    confirmation: HYPERLIQUID_ORDER_CONFIRMATION,
  });
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}
