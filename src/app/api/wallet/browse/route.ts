import { NextRequest, NextResponse } from "next/server";
import { listWalletInfos } from "@/lib/services/wallet/local-wallet-vault";
import { VENICE_WALLET_VAULT_PREFIX } from "@/lib/services/venice";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BrowseWalletKind = "venice" | "personal" | "agent";

function walletKind(vaultId: string): BrowseWalletKind {
  if (vaultId.startsWith(VENICE_WALLET_VAULT_PREFIX)) return "venice";
  if (vaultId.startsWith("user:")) return "personal";
  return "agent";
}

// Lists every locally-held wallet (encrypted vault custody) so setup flows can
// offer "Other wallets" instead of minting a new wallet per agent.
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const infos = await listWalletInfos();
    const seen = new Set<string>();
    const wallets = infos
      .filter((info) => {
        const key = `${info.network}|${info.address}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((info) => ({
        vaultId: info.agentId,
        address: info.address,
        network: info.network,
        kind: walletKind(info.agentId),
        createdAt: info.createdAt,
      }));
    return NextResponse.json({ ok: true, wallets });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not list local wallets." }, { status: 500 });
  }
}
