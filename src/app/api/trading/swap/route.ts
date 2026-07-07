import { NextRequest, NextResponse } from "next/server";
import {
  SWAP_CONFIRMATION,
  type DexSwapInput,
  executeDexSwap,
  quoteDexSwap,
} from "@/lib/services/trading/dex-swap";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local DEX swap from the user's own wallet (0x on Base). The wallet — its
 * network, address, and signing key — is resolved server-side from the local
 * vault by agentId; a client request never supplies the key or address. The
 * hard $10 cap, spend governance, and the CONFIRM_SWAP gate are enforced in
 * the dex-swap service.
 */
type SwapBody = {
  action?: "quote" | "execute";
  agentId?: string;
  sellToken?: string;
  buyToken?: string;
  amountHuman?: number | string;
  slippageBps?: number;
  confirmation?: string;
  approvalToken?: string;
  /** Acting-wallet network for a price-only quote when the wallet has no local
   *  signing key (e.g. a Bankr-managed wallet). Ignored for execute. */
  network?: string;
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json().catch(() => ({}))) as SwapBody;
    const agentId = body.agentId?.trim();
    const sellToken = body.sellToken?.trim();
    const buyToken = body.buyToken?.trim();
    const amountHuman = Number(body.amountHuman);
    if (!agentId) return bad("A wallet (agentId) is required.");
    if (!sellToken || !buyToken) return bad("Both sell and buy tokens are required.");
    if (!Number.isFinite(amountHuman) || amountHuman <= 0) return bad("Enter an amount greater than zero.");

    // Authoritative wallet: local vault only (key + address + network), never client-supplied.
    const stored = await getWalletSecret(agentId);
    const isExecute = body.action === "execute";

    // A price quote is wallet-agnostic — it needs only the network + tokens, no
    // signing key or address. Bankr-managed wallets sign on Bankr and have no
    // local key, so only EXECUTE requires the vault; a quote falls back to the
    // network the client resolved from the acting wallet. (Bankr never executes
    // through this route — it routes through the Bankr capability rail.)
    if (isExecute && !stored) {
      return NextResponse.json({ ok: false, error: "No local signing wallet exists for this selection." }, { status: 404 });
    }
    const network = stored?.info.network ?? body.network?.trim();
    if (!network) return bad("A network is required to quote this swap.");

    const input: DexSwapInput = {
      agentId,
      network,
      fromAddress: stored?.info.address ?? "",
      secret: stored?.secret,
      sellToken,
      buyToken,
      amountHuman,
      slippageBps: Number(body.slippageBps) || undefined,
      confirmation: body.confirmation,
      approvalToken: body.approvalToken?.trim() || undefined,
      approvalThresholdSatisfied: body.confirmation === SWAP_CONFIRMATION,
    };

    if (isExecute) {
      const result = await executeDexSwap(input);
      return NextResponse.json({ ok: true, result });
    }
    const quote = await quoteDexSwap({ ...input, secret: undefined });
    return NextResponse.json({ ok: true, quote, confirmation: SWAP_CONFIRMATION });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Swap failed." }, { status: 400 });
  }
}

function bad(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}
